/* plume-cheatsheet.js — the ingredient cheat sheet.

   Lives in its own file so plume-ingredients.html (already the largest page)
   does not grow; Ingredients loads it after plume-core.js and shows it as a
   List / Cheat sheet toggle.

   The job, in Heide's words: an at-a-glance comparison to help choose
   between similar ingredients -- "why would I formulate with this over
   that." So the chart is built to show DIFFERENCES:
     - ingredients are grouped by function (a multipurpose one appears in
       every group it belongs to);
     - within a group, a column where every row says the same thing is
       hidden, because it cannot help choose;
     - a value that differs from the rest of its group is highlighted;
     - the 'Choose it when' line -- what sets it apart -- is the main column,
       next to her own purpose line.
   Blank cells are left visibly blank: an empty line next to a filled one is
   the prompt to fill it in.                                                */

var PlumeCheat = (function () {

var state = { q: '', group: null };

// ── Columns ───────────────────────────────────────────
function range(a, b) {
  a = (a === 0 || a) ? String(a).trim() : '';
  b = (b === 0 || b) ? String(b).trim() : '';
  if (a && b) return a + '\u2013' + b;
  if (b) return 'up to ' + b;
  if (a) return a + '+';
  return '';
}
var PHASE_NAMES = { water: 'Water', oil: 'Oil', 'cool-down': 'Cool-down', 'add-in': 'Add-in' };

var COLS = {
  use:    { label: 'Use %',          get: function (i) { return range(i.min, i.max); } },
  phase:  { label: 'Phase',          get: function (i) { return PHASE_NAMES[i.phase] || i.phase || ''; } },
  ph:     { label: 'pH',             get: function (i) { return i.optimalPh || ''; } },
  heat:   { label: 'Heat stability', get: function (i) { return i.heatStability || ''; } },
  restr:  { label: 'Restrictions',   get: function (i) { return i.restrictions || ''; } },
  absorb: { label: 'Absorption',     get: function (i) { return i.absorptionRate || ''; } },
  shelf:  { label: 'Shelf life',     get: function (i) { return i.oxidationStability || ''; } },
  melt:   { label: 'Melting point',  get: function (i) { return i.meltingPoint || ''; } },
  dermal: { label: 'Dermal limit',   get: function (i) { return i.dermalLimits || ''; } },
  scent:  { label: 'Scent',          get: function (i) { return i.scent || ''; } }
};

// The comparison columns worth offering per group. Use % leads every group.
// Offered, not guaranteed: a column only appears if it actually differs.
var TEXTURE = ['use', 'phase', 'ph', 'heat'];
var GROUP_COLS = {
  'Thickener': TEXTURE, 'Emulsifier': TEXTURE, 'Solubilizer': TEXTURE, 'Surfactant': TEXTURE,
  'Active': TEXTURE,
  'Preservative': ['use', 'phase', 'ph', 'restr'],
  'Emollient': ['use', 'absorb', 'shelf', 'melt'],
  'Essential oil': ['use', 'dermal', 'scent'],
  'Fragrance': ['use', 'dermal', 'scent']
};
var DEFAULT_COLS = ['use', 'phase'];

function norm(v) { return String(v || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

// Long reference text (restrictions, dermal limits) is clipped in the cell
// with the full text on hover, so one paragraph cannot swamp the table.
function clip(v, n) {
  v = String(v || '');
  if (v.length <= n) return esc(v);
  return '<span title="' + esc(v) + '">' + esc(v.slice(0, n - 1).trim()) + '\u2026</span>';
}

// ── Data ──────────────────────────────────────────────
function usageMap() {
  var forms = (Plume.Store.getJSON(Plume.KEYS.forms, []) || []);
  var map = {};
  forms.forEach(function (f) {
    if (!f || f.archived) return;
    var ids = {};
    (f.lines || []).forEach(function (l) { if (l && l.ingId) ids[l.ingId] = 1; });
    (f.variants || []).forEach(function (v) {
      (v.lines || []).forEach(function (l) { if (l && l.ingId) ids[l.ingId] = 1; });
    });
    Object.keys(ids).forEach(function (id) { (map[id] = map[id] || []).push(f.name || 'Untitled'); });
  });
  return map;
}

function fmtStock(i) {
  var g = Plume.stockG(i);
  if (!(g > 0)) return '';
  return g >= 1000 ? (g / 1000).toFixed(1) + ' kg' : Math.round(g) + ' g';
}

var NONE = 'No function set';

function buildGroups(ings) {
  var active = (ings || []).filter(function (i) { return i && !i.archived; });
  var order = Plume.FUNCTION_CATEGORIES.slice();
  var byGroup = {};
  active.forEach(function (i) {
    var cats = Plume.funcCats(i);
    if (!cats.length) cats = [NONE];
    cats.forEach(function (c) {
      if (order.indexOf(c) === -1 && c !== NONE) order.push(c);
      (byGroup[c] = byGroup[c] || []).push(i);
    });
  });
  order.push(NONE);
  return order.filter(function (g) { return byGroup[g] && byGroup[g].length; })
    .map(function (g) {
      return { name: g, rows: byGroup[g].slice().sort(function (a, b) {
        return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
      }) };
    });
}

// Which groups and rows the current search / chip selection shows.
function applyFilter(groups) {
  var q = norm(state.q);
  var out = groups;
  if (state.group) out = out.filter(function (g) { return g.name === state.group; });
  if (!q) return out;
  // Typing a function name ("thick", "preserv") shows those whole groups.
  var byName = out.filter(function (g) { return norm(g.name).indexOf(q) !== -1; });
  if (byName.length) return byName;
  // Anything else ("serum") is a cross-list: matching rows, kept in groups.
  return out.map(function (g) {
    return { name: g.name, rows: g.rows.filter(function (i) { return Plume.ingMatchRank(i, q) > 0; }) };
  }).filter(function (g) { return g.rows.length; });
}

// Decide columns for one group: hide what cannot help choose, and find the
// cells that stand out from the rest of their group.
function planGroup(g) {
  var offered = GROUP_COLS[g.name] || DEFAULT_COLS;
  var show = [], hidden = [];
  offered.forEach(function (key) {
    var col = COLS[key];
    var vals = g.rows.map(function (i) { return col.get(i); });
    var known = vals.filter(function (v) { return norm(v); });
    if (!known.length) return;                        // no data at all: omit quietly
    if (g.rows.length === 1) { show.push({ key: key, odd: {} }); return; }
    var counts = {};
    known.forEach(function (v) { var k = norm(v); counts[k] = (counts[k] || 0) + 1; });
    var distinct = Object.keys(counts);
    if (distinct.length <= 1) {
      // Only hide when EVERY row has the value and they all agree. If some
      // rows are blank, "the same for every one" would be false -- show the
      // column, and the blanks stay visible as gaps worth filling.
      if (known.length === g.rows.length) { hidden.push(col.label + ' (' + known[0] + ')'); return; }
      show.push({ key: key, odd: {} }); return;
    }
    // Highlight values that differ from a clear majority (at least two rows
    // agreeing). With no majority every value differs, so nothing is singled out.
    var mode = distinct.sort(function (a, b) { return counts[b] - counts[a]; })[0];
    var odd = {};
    if (counts[mode] >= 2) {
      g.rows.forEach(function (i) {
        var k = norm(col.get(i));
        if (k && k !== mode) odd[i.id] = true;
      });
    }
    show.push({ key: key, odd: odd });
  });
  return { show: show, hidden: hidden };
}

// ── Rendering ─────────────────────────────────────────
function tableHtml(g, used, forPrint) {
  var plan = planGroup(g);
  var h = '<div class="cs-table-wrap"><table class="cs-table"><thead><tr>' +
    '<th class="cs-name">Ingredient</th>';
  plan.show.forEach(function (c) { h += '<th>' + COLS[c.key].label + '</th>'; });
  h += '<th class="cs-choose">Choose it when\u2026</th><th class="cs-purpose">Your purpose</th>' +
    '<th class="cs-num">On hand</th><th class="cs-num">Used in</th></tr></thead><tbody>';

  g.rows.forEach(function (i) {
    var names = used[i.id] || [];
    h += '<tr' + (forPrint ? '' : ' onclick="viewIngredient(\'' + i.id + '\')" title="Open ' + esc(i.name) + '"') + '>';
    h += '<td class="cs-name"><b>' + esc(i.name) + '</b></td>';
    plan.show.forEach(function (c) {
      var v = COLS[c.key].get(i);
      var cell = v ? clip(v, 60) : '<span class="cs-blank">\u2014</span>';
      h += '<td>' + (c.odd[i.id] ? '<span class="cs-odd">' + cell + '</span>' : cell) + '</td>';
    });
    h += '<td class="cs-choose">' + (i.chooseWhen ? esc(i.chooseWhen) : '<span class="cs-blank">\u2014</span>') + '</td>';
    h += '<td class="cs-purpose">' + (i.purpose ? esc(i.purpose) : '<span class="cs-blank">\u2014</span>') + '</td>';
    var st = fmtStock(i);
    h += '<td class="cs-num">' + (st || '<span class="cs-blank">\u2014</span>') + '</td>';
    h += '<td class="cs-num"' + (names.length ? ' title="' + esc(names.join(', ')) + '"' : '') + '>' +
      (names.length ? names.length : '<span class="cs-blank">0</span>') + '</td>';
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  if (plan.hidden.length) {
    h += '<div class="cs-hidden">Not shown \u2014 the same for every one: ' + esc(plan.hidden.join(' \u00b7 ')) + '</div>';
  }
  return h;
}

function render(ings) {
  var body = document.getElementById('cs-body');
  var chips = document.getElementById('cs-chips');
  if (!body) return;
  var all = buildGroups(ings);

  if (chips) {
    chips.innerHTML = all.map(function (g) {
      var on = state.group === g.name;
      return '<button class="cs-chip' + (on ? ' on' : '') + '" onclick="PlumeCheat.pickGroup(\'' +
        esc(g.name).replace(/'/g, '&#39;') + '\')">' + esc(g.name) +
        ' <span class="cs-count">' + g.rows.length + '</span></button>';
    }).join('');
  }

  if (!all.length) {
    body.innerHTML = '<div class="cs-empty">No ingredients yet.</div>';
    return;
  }
  var shown = applyFilter(all);
  if (!shown.length) {
    body.innerHTML = '<div class="cs-empty">Nothing matches \u201c' + esc(state.q) + '\u201d.</div>';
    return;
  }
  var used = usageMap();
  body.innerHTML = shown.map(function (g) {
    return '<section class="cs-group"><div class="cs-group-hdr">' + esc(g.name) +
      ' <span class="cs-count">' + g.rows.length + '</span></div>' + tableHtml(g, used, false) + '</section>';
  }).join('');
}

function pickGroup(name) {
  state.group = state.group === name ? null : name;
  if (typeof ingredients !== 'undefined') render(ingredients);
}
function setQuery(q) {
  state.q = q || '';
  if (typeof ingredients !== 'undefined') render(ingredients);
}

// Prints what is on screen, one group per page, for the bench.
function print(ings) {
  var shown = applyFilter(buildGroups(ings));
  if (!shown.length) { alert('Nothing to print.'); return; }
  var used = usageMap();
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ingredient cheat sheet</title><style>' +
    'body{font-family:Georgia,serif;color:#222;margin:32px;font-size:12px}' +
    'h1{font-weight:400;font-size:22px;margin:0 0 4px}.meta{color:#666;margin-bottom:18px}' +
    'h2{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#555;border-bottom:1px solid #999;padding-bottom:4px}' +
    'section{page-break-before:always}section:first-of-type{page-break-before:auto}' +
    'table{width:100%;border-collapse:collapse}th{text-align:left;font-weight:400;color:#777;font-size:11px;padding:4px 6px 4px 0}' +
    'td{padding:6px 6px 6px 0;border-top:1px solid #ddd;vertical-align:top}tr{page-break-inside:avoid}' +
    '.cs-odd{font-weight:700;text-decoration:underline}.cs-blank{color:#bbb}.cs-hidden{color:#888;font-size:10px;margin-top:6px}' +
    '.cs-table-wrap{overflow:visible}</style></head><body>' +
    '<h1>Ingredient cheat sheet</h1><div class="meta">Printed ' + esc(Plume.fmtDate(Plume.todayISO())) +
    (state.q ? ' \u00b7 search: \u201c' + esc(state.q) + '\u201d' : '') + '</div>' +
    shown.map(function (g) {
      return '<section><h2>' + esc(g.name) + '</h2>' + tableHtml(g, used, true) + '</section>';
    }).join('') +
    '<scr' + 'ipt>window.onload=function(){window.print();};<\/scr' + 'ipt></body></html>';
  var w = window.open('', '_blank');
  if (!w) { alert('The print window was blocked. Allow popups for this site and try again.'); return; }
  w.document.write(html); w.document.close();
}

// ── Styles, injected so the file is self-contained ────
(function injectStyles() {
  if (document.getElementById('cs-styles')) return;
  var css =
    '.cs-top{display:flex;gap:10px;align-items:center;margin-bottom:10px}' +
    '.cs-search{flex:1;max-width:420px}' +
    '.cs-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:18px}' +
    '.cs-chip{font-family:inherit;font-size:12px;padding:4px 10px;border:1px solid var(--cream-border);border-radius:20px;background:var(--white);color:var(--ink-light);cursor:pointer}' +
    '.cs-chip:hover{border-color:var(--bark-light)}' +
    '.cs-chip.on{background:var(--cream-dark);border-color:var(--bark-light);color:var(--bark-dark);font-weight:500}' +
    '.cs-count{font-size:10px;color:var(--ink-lighter);margin-left:2px}' +
    '.cs-group{margin-bottom:26px}' +
    '.cs-group-hdr{font-size:11px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--bark-dark);margin-bottom:6px}' +
    '.cs-table-wrap{overflow-x:auto}' +
    '.cs-table{width:100%;border-collapse:collapse;font-size:13px;background:var(--white);border:1px solid var(--cream-border);border-radius:6px}' +
    '.cs-table th{text-align:left;font-weight:400;font-size:11px;color:var(--ink-lighter);padding:8px 10px;border-bottom:1px solid var(--cream-border);white-space:nowrap}' +
    '.cs-table th.cs-choose{color:var(--bark-dark);font-weight:500}' +
    '.cs-table td{padding:9px 10px;border-top:1px solid var(--cream-dark);vertical-align:top;color:var(--ink)}' +
    '.cs-table tbody tr{cursor:pointer}.cs-table tbody tr:hover td{background:var(--cream)}' +
    '.cs-name{min-width:140px}.cs-name b{font-weight:500;color:var(--bark-dark)}' +
    '.cs-choose{min-width:200px}.cs-purpose{min-width:150px;color:var(--ink-light)}' +
    '.cs-num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}' +
    '.cs-blank{color:var(--ink-lighter);opacity:.6}' +
    '.cs-odd{background:var(--warning-bg);color:var(--warning);padding:1px 6px;border-radius:4px}' +
    '.cs-hidden{font-size:11px;color:var(--ink-lighter);margin-top:6px}' +
    '.cs-empty{color:var(--ink-lighter);padding:2rem 0;font-size:13px}' +
    '.view-toggle{display:inline-flex;border:1px solid var(--cream-border);border-radius:6px;overflow:hidden;margin-left:auto}' +
    '.view-toggle button{font-family:inherit;font-size:12px;padding:6px 12px;border:none;background:var(--white);color:var(--ink-light);cursor:pointer}' +
    '.view-toggle button.on{background:var(--cream-dark);color:var(--bark-dark);font-weight:500}';
  var el = document.createElement('style');
  el.id = 'cs-styles'; el.textContent = css;
  document.head.appendChild(el);
})();

return { render: render, print: print, pickGroup: pickGroup, setQuery: setQuery,
         _planGroup: planGroup, _buildGroups: buildGroups, _applyFilter: applyFilter, _state: state };
})();
