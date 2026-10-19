/* ═══════════════════════════════════════════════════════════════════
   plume-core.js — shared foundation for every Plume module
   ═══════════════════════════════════════════════════════════════════

   WHY THIS FILE EXISTS
   Each Plume page used to carry its own copy of the storage code, the
   palettes, the modal helpers, and — most importantly — the logic that
   answers "what does this ingredient cost?". Copies drift. That is not
   hypothetical: Formulations once priced an ingredient at $0.06/g while
   Costing said $0.091/g for the same thing, because one copy honoured
   the active lot and the other just took the cheapest number it could
   find, including watchlist prices for ingredients never purchased.

   One copy here means two screens cannot disagree.

   HOW A MODULE USES IT
     Load plume-core.js with a <script src=...> tag BEFORE the inline script.
     ...
     Plume.setModule('formulations');          <- names the palette key
     Plume.boot(function () { loadAll(); });   <- hydrate, then render

   PALETTE
   One palette for the whole app ('plume-palette'), chosen in any module's
   Settings. (Until 2026-10-18 each module kept its own.)

   ES5 only. No build step. No dependencies.
   ═══════════════════════════════════════════════════════════════════ */

var Plume = (function () {
'use strict';

// THE app version (decided 2026-10-16). Every footer shows it, stamped by
// stampVersion(), and Settings -> Storage shows it too, so there is one
// number and it cannot drift the way the old hand-typed footers did
// (v0.4 / v0.5 / v0.6 across five modules). BUMP IT IN EVERY PULL REQUEST,
// core change or not: it is how "is this the update I just merged?" is
// answered by looking, and browsers cache .js files stubbornly.
var VERSION = '1.20';

// ══ Store ═════════════════════════════════════════════
// A single seam between Plume and wherever its data actually lives.
//
// WHY THIS SHAPE. localStorage is synchronous; IndexedDB and any web API
// are not. A shim that merely wrapped getItem/setItem would keep the
// synchronous shape and therefore could never be backed by anything async
// — swapping the backend would still mean rewriting every call site, and
// the shim would have bought nothing.
//
// So Store holds a hydrated in-memory cache. Reads are synchronous because
// they come from memory. Writes update memory and hand off to a driver.
// The only asynchronous moment is startup.
//
// To move to IndexedDB or a server: write a driver with the same four
// methods, call Store.useDriver(d), then Store.init(). Nothing else in
// any module changes.
//
// Drivers implement:
//   name        — label, for diagnostics
//   load(cb)    — cb({key: rawString, ...}) with everything it holds
//   save(k, v)  — persist one key; TRUE on success, FALSE if it failed
//   remove(k)   — delete one key
//
// A driver that returns true on a failed write makes a full disk look
// like a working app. Return false.
var Store = (function () {

  var localDriver = {
    name: 'localStorage',
    load: function (cb) {
      var out = {};
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          out[k] = localStorage.getItem(k);
        }
      } catch (e) {}
      cb(out);
    },
    save: function (k, v) {
      try { localStorage.setItem(k, v); return true; }
      catch (e) { return false; }
    },
    remove: function (k) {
      try { localStorage.removeItem(k); } catch (e) {}
    }
  };

  var DRIVER  = localDriver;
  var mem     = {};
  var ready   = false;
  var quotaFn = null;

  function init(cb) {
    DRIVER.load(function (data) {
      mem   = data || {};
      ready = true;
      if (cb) cb();
    });
  }

  function get(key) {
    return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null;
  }

  function set(key, val) {
    var str = String(val);
    mem[key] = str;
    var okWrite = DRIVER.save(key, str);
    if (!okWrite && quotaFn) quotaFn(key);
    return okWrite;
  }

  function getJSON(key, fallback) {
    var raw = get(key);
    if (raw === null) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }

  function setJSON(key, val) {
    try { return set(key, JSON.stringify(val)); }
    catch (e) { return false; }
  }

  function remove(key) {
    delete mem[key];
    DRIVER.remove(key);
  }

  function keys() {
    var out = [];
    for (var k in mem) if (Object.prototype.hasOwnProperty.call(mem, k)) out.push(k);
    return out;
  }

  function bytes(key) {
    var raw = get(key);
    return raw === null ? 0 : raw.length;
  }

  function totalBytes() {
    var t = 0, ks = keys();
    for (var i = 0; i < ks.length; i++) t += mem[ks[i]].length;
    return t;
  }

  function useDriver(d) {
    if (!d || typeof d.load !== 'function' || typeof d.save !== 'function') return false;
    DRIVER = d;
    ready  = false;
    return true;
  }

  return {
    init: init, get: get, set: set, getJSON: getJSON, setJSON: setJSON,
    remove: remove, keys: keys, bytes: bytes, totalBytes: totalBytes,
    useDriver: useDriver,
    onQuotaError: function (fn) { quotaFn = fn; },
    isReady:      function () { return ready; },
    driverName:   function () { return DRIVER.name; }
  };
})();

// ══ Storage keys ══════════════════════════════════════
// The 'aerie-' prefix is historical — Plume's earlier name. Renaming the
// keys would orphan everyone's existing data, so they stay.
var KEYS = {
  ings:     'aerie-ingredients-v2',
  forms:    'aerie-formulations-v1',
  pkgs:     'aerie-packaging-v2',
  batches:  'aerie-batches-v1',
  products: 'plume-products-v1',
  suppliers:'aerie-suppliers-v1',
  brands:   'aerie-brands-v1'
};

var KEY_LABELS = {
  'aerie-ingredients-v2':  'Ingredients',
  'aerie-suppliers-v1':    'Suppliers',
  'aerie-brands-v1':       'Brands',
  'aerie-formulations-v1': 'Formulations',
  'aerie-packaging-v2':    'Packaging (incl. photos)',
  'aerie-batches-v1':      'Batches',
  'plume-products-v1':     'Products & costing',
  'aerie-costing-v1':      'Costing (old, unused)'
};

// ══ Small helpers ═════════════════════════════════════
// Escapes single quotes as well as double. Four modules omitted the
// single-quote rule and Costing included it; the stricter version is
// correct, because a name like "Ben's oil" dropped into a single-quoted
// HTML attribute breaks the attribute without it.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// A module may define its own openModal to add behaviour -- Ingredients
// snapshots form state here so it can detect unsaved edits when the modal
// is dismissed. A local definition overrides this alias, which is the
// intended escape hatch: share the common case, keep the exception local.
function openModal(id)  { var e = document.getElementById(id); if (e) e.classList.add('open'); }
function closeModal(id) { var e = document.getElementById(id); if (e) e.classList.remove('open'); }

function todayISO() {
  var d = new Date();
  return d.getFullYear() + '-' +
         ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
         ('0' + d.getDate()).slice(-2);
}

// YYYY-MM-DD parsed with `new Date()` is treated as UTC, which displays as
// the previous day in any negative-offset timezone. Parse the parts.
function parseLocalDate(str) {
  if (!str) return null;
  var p = String(str).split('-');
  if (p.length === 3) {
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return isNaN(d.getTime()) ? null : d;
  }
  var f = new Date(str);
  return isNaN(f.getTime()) ? null : f;
}

function fmtDate(str, opts) {
  var d = parseLocalDate(str);
  if (!d) return String(str || '');
  return d.toLocaleDateString('en-US', opts || { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtBytes(b) {
  return b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB' : Math.round(b / 1024) + ' KB';
}

// ══ Ingredient cost & stock ═══════════════════════════
// THE CANONICAL CASCADE. Every module must get its cost answer here.
//
//   1. No real lots but a legacy ing.cost  -> use it
//   2. An activeLotId the user designated  -> use that lot's costPerG
//   3. Otherwise                           -> cheapest PURCHASED lot
//
// referenceOnly lots are watchlist entries — prices noted but never
// bought. They are excluded from cost AND stock. Including them in step 3
// is exactly the bug that made Formulations disagree with Costing.
function costPerG(ing) {
  if (!ing) return null;
  var lots = (ing.lots || []).filter(function (l) { return !l.referenceOnly; });

  if (!lots.length && (ing.supplier || ing.cost)) {
    var legacy = parseFloat(ing.cost);
    return (!isNaN(legacy) && legacy > 0) ? legacy : null;
  }

  // A designated active lot is AUTHORITATIVE. If it has no usable cost,
  // the answer is "unknown" -- not "quietly use some other lot's price".
  // Falling through here would price a product at a number never chosen,
  // which is the same failure as the watchlist bug. Ingredients already
  // behaved this way; Costing and Formulations did not. They do now.
  if (ing.activeLotId) {
    var match = lots.filter(function (l) { return l.id === ing.activeLotId; })[0];
    if (match) {
      var ac = parseFloat(match.costPerG);
      return (!isNaN(ac) && ac > 0) ? ac : null;
    }
    // activeLotId points at a deleted lot -- fall through to cheapest
  }

  var costs = lots
    .map(function (l) { return parseFloat(l.costPerG); })
    .filter(function (c) { return !isNaN(c) && c > 0; });
  return costs.length ? Math.min.apply(null, costs) : null;
}


// ── Density ──────────────────────────────────────────────────────
// Converting a lot bought by VOLUME into grams needs a density. Where none
// was recorded the arithmetic used 1.0, the density of water, which
// overstates a typical oil by about 7%. That inflated stock on hand and
// understated cost per gram on every oil bought by the litre.
//
// These tables used to live in the Ingredients edit form, where they could
// only ever produce a suggestion for a human to accept. Nothing else could
// see them, so the moment a density was left blank every module fell back to
// water. Here they resolve a density for any ingredient object.
//
// The 'measured' entries are Heide's own lookup, 2026-10-16. Her 31 values
// put 26 of them within 1.5% of the 0.92 carrier-oil default, which is what
// justifies trusting that default for everything not named here.
var DENSITY_BY_INCI = {
  'aqua':                          { value:1.00, why:'water' },
  'glycerin':                      { value:1.26, why:'typical for glycerin' },
  // Was 1.02, which is about 4% low. 1,3-propanediol is ~1.06 at 20 C and
  // ~1.053 at 25 C; the latter is the measured figure.
  'propanediol':                   { value:1.053, why:'measured, 1,3-propanediol' },
  'propylene glycol':              { value:1.04, why:'typical for propylene glycol' },
  'butylene glycol':               { value:1.00, why:'typical for butylene glycol' },
  'sodium lactate':                { value:1.32, why:'typical for 60% sodium lactate' },
  'lactic acid':                   { value:1.20, why:'typical for 88% lactic acid' },
  'aloe barbadensis leaf juice':   { value:1.00, why:'water-based' },
  'phenoxyethanol':                { value:1.11, why:'typical for phenoxyethanol' },
  'polysorbate 20':                { value:1.10, why:'typical for polysorbate 20' },
  'polysorbate 80':                { value:1.06, why:'typical for polysorbate 80' },
  'decyl glucoside':               { value:1.10, why:'typical as supplied' },
  'coco glucoside':                { value:1.10, why:'typical as supplied' },
  'cocamidopropyl betaine':        { value:1.04, why:'typical as supplied' },
  'caprylic/capric triglyceride':  { value:0.95, why:'typical for fractionated oils' },
  'squalane':                      { value:0.81, why:'typical for squalane' },
  'isopropyl myristate':           { value:0.85, why:'typical for IPM' },
  'c12-15 alkyl benzoate':         { value:0.92, why:'typical for this ester' },
  'tocopherol':                    { value:0.95, why:'typical for tocopherol' },
  'ricinus communis seed oil':     { value:0.96, why:'typical for castor oil' },
  'olea europaea fruit oil':       { value:0.91, why:'typical for olive oil' },
  'cocos nucifera oil':            { value:0.92, why:'typical for coconut oil' },

  // Measured.
  'adansonia digitata seed oil':              { value:0.917, why:'measured' },
  'aleurites moluccana seed oil':             { value:0.925, why:'measured' },
  'arachis hypogaea oil':                     { value:0.916, why:'measured' },
  'argania spinosa kernel oil':               { value:0.912, why:'measured' },
  'borago officinalis seed oil':              { value:0.918, why:'measured' },
  'brassica campestris seed oil':             { value:0.915, why:'measured' },
  'calophyllum inophyllum seed oil':          { value:0.942, why:'measured' },
  'camellia sinensis seed oil':               { value:0.915, why:'measured' },
  'cannabis sativa seed oil':                 { value:0.926, why:'measured' },
  'glycine soja oil':                         { value:0.922, why:'measured' },
  'helianthus annuus seed oil':               { value:0.918, why:'measured' },
  'hippophae rhamnoides fruit oil':           { value:0.925, why:'measured' },
  'limnanthes alba seed oil':                 { value:0.912, why:'measured' },
  'linum usitatissimum seed oil':             { value:0.928, why:'measured' },
  'macadamia ternifolia seed oil':            { value:0.914, why:'measured' },
  'melia azadirachta seed oil':               { value:0.940, why:'measured' },
  'nigella sativa seed oil':                  { value:0.925, why:'measured' },
  'oenothera biennis oil':                    { value:0.926, why:'measured' },
  'olea europaea husk oil':                   { value:0.914, why:'measured' },
  'persea gratissima oil':                    { value:0.920, why:'measured' },
  'prunus amygdalus dulcis oil':              { value:0.915, why:'measured' },
  'prunus armeniaca kernel oil':              { value:0.915, why:'measured' },
  'punica granatum seed oil':                 { value:0.928, why:'measured' },
  'rosa canina seed oil':                     { value:0.923, why:'measured' },
  'simmondsia chinensis seed oil':            { value:0.860, why:'measured' },
  'vitis vinifera seed oil':                  { value:0.923, why:'measured' },
  'zea mays oil':                             { value:0.921, why:'measured' },
};

var DENSITY_HINTS = [
  { cat:'Essential oil', value:0.90, why:'typical for essential oils' },
  { cat:'Emollient', phase:'oil', value:0.92, why:'typical for carrier oils' },
  { cat:'Solubilizer', value:1.05, why:'typical for solubilizers' },
  { cat:'Surfactant',  value:1.05, why:'typical for surfactant blends' },
  // Hydrosols, aloe, extracts, infusions -- anything that is essentially
  // water. Still held back for the few categories whose unknown members
  // genuinely scatter: an unrecognised humectant could be anywhere between
  // propanediol and glycerin, and a wrong figure is worse than none. The
  // ones that matter are named in DENSITY_BY_INCI and never reach here.
  { phase:'water', notCats:['Humectant','Preservative','Active','pH Adjuster','Thickener'],
    value:1.00, why:'water-based, near enough to 1.0' }
];

// Lowercase, drop any "(common name)" parenthetical, collapse whitespace.
function normDensityInci(s) {
  if (!s) return '';
  return String(s).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

// The density to use for this ingredient, and where it came from.
//
// Source matters and is returned alongside the number. A value the user
// typed must never be quietly overridden by a table, and a value the table
// inferred must be visible as inferred rather than passing for something she
// entered. 'default' means nothing is known and the figure is a guess.
function densityFor(ing) {
  var explicit = ing && parseFloat(ing.density);
  if (explicit > 0) return { value: explicit, source: 'set', why: 'set on the ingredient' };

  var key = normDensityInci(ing && ing.inci);
  if (key && DENSITY_BY_INCI[key]) {
    return { value: DENSITY_BY_INCI[key].value, source: 'inci', why: DENSITY_BY_INCI[key].why };
  }

  var cats = funcCats(ing);
  var phase = ing && ing.phase;
  for (var k = 0; k < DENSITY_HINTS.length; k++) {
    var h = DENSITY_HINTS[k];
    if (h.cat && cats.indexOf(h.cat) === -1) continue;
    if (h.phase && h.phase !== phase) continue;
    if (h.notCats && h.notCats.some(function (c) { return cats.indexOf(c) !== -1; })) continue;
    return { value: h.value, source: 'category', why: h.why };
  }
  return { value: 1.0, source: 'default', why: 'no density known, assuming water' };
}

// Convert a lot quantity to grams. Density only matters for volume units.
function qtyToGrams(qty, unit, density) {
  var q = parseFloat(qty);
  if (isNaN(q) || q <= 0) return 0;
  var d = parseFloat(density) || 1.0;
  if (unit === 'g')     return q;
  if (unit === 'mL')    return q * d;
  if (unit === 'fl oz') return q * 29.5735 * d;
  if (unit === 'oz')    return q * 28.3495;
  if (unit === 'lb')    return q * 453.592;
  return q;
}

// Total grams on hand across purchased lots.
//
// COPIED VERBATIM from the module implementations — not rewritten. Lot
// quantity lives in `qtyPurchased` with a legacy fallback to `stock`, and
// the unit in `qtyUnit` with a legacy fallback to `stockUnit`. There is no
// `l.unit` field. Reading the wrong field name doesn't throw; it silently
// returns the raw number as grams, so an 8 oz lot reads as 8 g and every
// stock figure quietly goes wrong. Check the source module before
// "improving" any field name here.
function stockG(ing) {
  if (!ing || !ing.lots || !ing.lots.length) return 0;
  var total = 0;
  ing.lots.forEach(function (l) {
    if (l.referenceOnly) return;
    var qty  = l.qtyPurchased || l.stock || '';
    var unit = l.qtyUnit      || l.stockUnit || 'g';
    if (qty) total += qtyToGrams(qty, unit, densityFor(ing).value);
  });
  return total;
}

// Batchlog's contract differs deliberately: null means "no quantity data
// recorded at all", which it displays differently from a genuine zero.
// Collapsing the two would make an untracked ingredient look out of stock.
function stockGOrNull(ing) {
  if (!ing || !ing.lots) return null;
  var total = 0, any = false;
  ing.lots.forEach(function (l) {
    if (l.referenceOnly) return;
    var qty  = l.qtyPurchased || l.stock || '';
    var unit = l.qtyUnit      || l.stockUnit || 'g';
    if (qty) { total += qtyToGrams(qty, unit, densityFor(ing).value); any = true; }
  });
  return any ? total : null;
}

function stockState(ing, needG) {
  var have = stockG(ing);
  if (have <= 0) return 'none';
  if (!needG || needG <= 0) return 'enough';
  // Tiny tolerance so a line needing exactly the stock on hand reads as
  // "enough" rather than "partial" from float fuzz.
  if (have + 0.001 >= needG) return 'enough';
  return 'partial';
}

// ══ Palettes ══════════════════════════════════════════
// One palette for the whole app (decided 2026-10-18; it used to be per
// module). Variable roles: --white is the main surface, --cream the sidebar
// and page, --bark the accent (buttons, highlights), --bark-dark headings and
// the old module headers, --clay-light the in-stock row tint. Heide asked
// for clean whites and in-stock tints from the palette's own family, never
// peach or sand across everything.
var PALETTES = {
  'finch': { label:'Finch', family:'red', vars: {
    '--cream':'#F5F5F3','--cream-dark':'#ECEBE8','--cream-border':'#DDDBD6','--white':'#FFFFFF',
    '--bark':'#B9492F','--bark-light':'#D3826D','--bark-dark':'#3B2B24',
    '--sage':'#6F8A68','--sage-light':'#EBF1E8','--sage-dark':'#3F5A3A','--sage-border':'#C3D2BE',
    '--clay':'#C76B52','--clay-light':'#EDF2EA','--clay-dark':'#8E3F2A','--clay-hover':'#E1E9DC',
    '--ink':'#26221F','--ink-light':'#5D5752','--ink-lighter':'#8C8580',
    '--warning':'#B07020','--warning-bg':'#FDF3E3','--warning-border':'#E8D0A0',
    '--danger':'#A03020','--danger-bg':'#FCE8E4','--danger-border':'#E8C0B8', '--success':'#3F5A3A'
  }},
  'garden': { label:'Garden', family:'green', vars: {
    '--cream':'#F3F6F2','--cream-dark':'#E8EEE6','--cream-border':'#D3DDCF','--white':'#FFFFFF',
    '--bark':'#3E7A4E','--bark-light':'#7FA889','--bark-dark':'#213A28',
    '--sage':'#5E8F6A','--sage-light':'#E6F1E8','--sage-dark':'#2F5A3A','--sage-border':'#BCD5C2',
    '--clay':'#C47A55','--clay-light':'#E9F3E7','--clay-dark':'#7A4A2C','--clay-hover':'#DCEBD8',
    '--ink':'#1D2A1F','--ink-light':'#4A5E4C','--ink-lighter':'#7C8F7D',
    '--warning':'#B07020','--warning-bg':'#FDF3E3','--warning-border':'#E8D0A0',
    '--danger':'#A03020','--danger-bg':'#FCE8E4','--danger-border':'#E8C0B8', '--success':'#2F5A3A'
  }},
  'lagoon': { label:'Lagoon', family:'blue', vars: {
    '--cream':'#F1F6F6','--cream-dark':'#E4EDED','--cream-border':'#CCDCDC','--white':'#FFFFFF',
    '--bark':'#2C7A78','--bark-light':'#6FA9A7','--bark-dark':'#173B3A',
    '--sage':'#4F8F86','--sage-light':'#E2F1EF','--sage-dark':'#2A5A54','--sage-border':'#B6D6D2',
    '--clay':'#C4845A','--clay-light':'#E5F2F1','--clay-dark':'#7A4E2C','--clay-hover':'#D7EAE9',
    '--ink':'#1A2B2D','--ink-light':'#485F62','--ink-lighter':'#7B9194',
    '--warning':'#B07020','--warning-bg':'#FDF3E3','--warning-border':'#E8D0A0',
    '--danger':'#A03020','--danger-bg':'#FCE8E4','--danger-border':'#E8C0B8', '--success':'#2A5A54'
  }},
  'plum': { label:'Plum', family:'purple', vars: {
    '--cream':'#F7F3F5','--cream-dark':'#EEE6EA','--cream-border':'#DDCED5','--white':'#FFFFFF',
    '--bark':'#8A3F63','--bark-light':'#B57A96','--bark-dark':'#3E1B2C',
    '--sage':'#8A7A90','--sage-light':'#EFEAF1','--sage-dark':'#4E4256','--sage-border':'#D2C8D6',
    '--clay':'#B0607E','--clay-light':'#F4E9EF','--clay-dark':'#7A3550','--clay-hover':'#ECDBE4',
    '--ink':'#2A1E24','--ink-light':'#634F59','--ink-lighter':'#95808A',
    '--warning':'#B07020','--warning-bg':'#FDF3E3','--warning-border':'#E8D0A0',
    '--danger':'#A03020','--danger-bg':'#FCE8E4','--danger-border':'#E8C0B8', '--success':'#3F5A3A'
  }},
  'sage-green': { label:'Sage (classic)', family:'green', vars: {
    '--cream':'#F4F5F1','--cream-dark':'#E7E9E2','--cream-border':'#C9CEC0','--white':'#FBFCFA',
    '--bark':'#6E7A5E','--bark-light':'#929E84','--bark-dark':'#404834',
    '--sage':'#869A78','--sage-light':'#E8EDE0','--sage-dark':'#4E5C40','--sage-border':'#C2CCB4',
    '--clay':'#B89A82','--clay-light':'#EBE2D8','--clay-dark':'#7A604E','--clay-hover':'#DDCEC0',
    '--ink':'#23271E','--ink-light':'#5C624E','--ink-lighter':'#8E9482',
    '--warning':'#B07020','--warning-bg':'#FDF3E3','--warning-border':'#E8D0A0',
    '--danger':'#A03020','--danger-bg':'#FCE8E4','--danger-border':'#E8C0B8','--success':'#4E5C40'
  }}
};

var DEFAULT_PALETTE = 'finch';
var MODULE_NAME     = 'module';

function setModule(name) { MODULE_NAME = String(name || 'module'); }
function paletteKey()    { return 'plume-palette'; }   // one key for every module

// The palette is set as inline custom properties on <html>. In dark mode
// applyTheme() sets a dark version of the same palette instead.
function applyPalette(name) {
  currentPalette = PALETTES[name] ? name : DEFAULT_PALETTE;
  applyTheme();
}

function savePaletteChoice(name) { Store.set(paletteKey(), name); }
function loadPaletteChoice()     { return Store.get(paletteKey()) || DEFAULT_PALETTE; }

function selectPalette(name) {
  applyPalette(name);
  savePaletteChoice(name);
  renderPaletteSwatches();
}

function renderPaletteSwatches() {
  var container = document.getElementById('palette-swatches');
  if (!container) return;
  renderThemeChoice(container);
  var current = loadPaletteChoice();
  var dark = isDark();
  container.innerHTML = Object.keys(PALETTES).map(function (name) {
    var p = PALETTES[name], isActive = (name === current);
    // In dark mode the swatches show the dark version she would get.
    var v = dark ? darkenVars(p.vars) : p.vars;
    return '<button type="button" class="palette-swatch' + (isActive ? ' active' : '') +
      '" onclick="selectPalette(\'' + name + '\')" title="' + esc(p.label) + '">' +
      '<div class="palette-swatch-stripes">' +
        '<span style="background:' + v['--cream'] + '"></span>' +
        '<span style="background:' + v['--bark']  + '"></span>' +
        '<span style="background:' + v['--sage']  + '"></span>' +
        '<span style="background:' + v['--clay']  + '"></span>' +
        '<span style="background:' + v['--ink']   + '"></span>' +
      '</div>' +
      '<div class="palette-swatch-label">' + esc(p.label) + '</div>' +
      '</button>';
  }).join('');
}

// ══ Light and dark (2026-10-17) ═══════════════════════
// One choice for the whole app, kept on this device: 'light', 'dark' or
// 'auto' (match the computer; the default). It sits in localStorage directly,
// not in Store, so every page, the landing page included, can apply it the
// moment core loads, before any data is read.
//
// HOW DARK IS MADE. There are no hand-drawn dark palettes. darkVars() turns
// each colour variable into its dark counterpart by its ROLE, read from its
// name, keeping its hue: the page background and surfaces go near-black,
// text goes near-white, pale tints (-light, -bg, -wash) become deep tints,
// strong shades used for text (-dark, -fg) become light ones, outlines
// (-border, -edge) sit in between, and accents are kept bright enough to
// read. So every module palette has a dark version, and so do the
// categorical colours a page defines in its own :root (phase colours,
// packaging types, quality bars) without being listed here.
//
// Inverse places (the header: dark background, cream text) get their own
// variables, --hdr-bg / --hdr-fg / --hdr-sub / --hdr-line, set only in dark
// mode; the modules use them with their light colours as the fallback.
//
// Printing always uses the light colours (beforeprint / afterprint).
var THEME_KEY = 'plume-theme';
var currentPalette = null;   // null on pages without palettes (landing page)
var themeSet = {};           // properties applyTheme set, removed on the next pass
var printing = false;

function themeChoice() {
  try {
    var v = window.localStorage.getItem(THEME_KEY);
    return (v === 'light' || v === 'dark') ? v : 'auto';
  } catch (e) { return 'auto'; }
}
function prefersDark() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }
  catch (e) { return false; }
}
function isDark() {
  if (printing) return false;
  var c = themeChoice();
  return c === 'dark' || (c === 'auto' && prefersDark());
}
function setTheme(v) {
  try { window.localStorage.setItem(THEME_KEY, v); } catch (e) {}
  applyTheme();
  renderPaletteSwatches();
}

// Colour arithmetic, small and local. Accepts #rgb, #rrggbb, rgb(), rgba().
function parseColor(str) {
  var s = String(str || '').trim(), m;
  if ((m = /^#([0-9a-f]{3})$/i.exec(s))) {
    return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16), a: 1 };
  }
  if ((m = /^#([0-9a-f]{6})$/i.exec(s))) {
    return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
  }
  if ((m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s))) {
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  }
  return null;
}
function toHsl(c) {
  var r = c.r / 255, g = c.g / 255, b = c.b / 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, h = 0, s = 0;
  if (max !== min) {
    var d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return { h: h, s: s, l: l };
}
function hslHex(h, s, l) {
  function f(n) {
    var k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
    var v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    var x = Math.round(v * 255).toString(16);
    return x.length < 2 ? '0' + x : x;
  }
  return '#' + f(0) + f(8) + f(4);
}

// The dark counterpart of one variable, or null to leave it alone (not a
// colour, or a colour with transparency, which already works on dark).
function darkValue(name, value) {
  var c = parseColor(value);
  if (!c || c.a < 1) return null;
  var x = toHsl(c), h = x.h, s = x.s, l = x.l;
  var cap = function (n) { return Math.min(s, n); };
  switch (name) {
    case '--cream':        return hslHex(h, cap(0.14), 0.11);   // page background
    case '--white':        return hslHex(h, cap(0.12), 0.15);   // cards, modals, inputs
    case '--cream-dark':   return hslHex(h, cap(0.12), 0.20);   // quiet fills, hover
    case '--cream-border': return hslHex(h, cap(0.12), 0.29);
    case '--ink':          return hslHex(h, cap(0.12), 0.90);
    case '--ink-light':    return hslHex(h, cap(0.12), 0.74);
    case '--ink-lighter':  return hslHex(h, cap(0.12), 0.64);
    case '--bark-light':   return hslHex(h, cap(0.30), 0.53);   // a mid accent (outlines, subtitles), not a pale tint
    case '--success':      return hslHex(h, cap(0.40), 0.74);   // text colour
    case '--warning':
    case '--danger':       return hslHex(h, cap(0.55), 0.70);   // text on their own tint
  }
  if (/-(dark|fg)$/.test(name))  return hslHex(h, cap(0.45), 0.80);
  if (/-wash$/.test(name))       return hslHex(h, cap(0.30), 0.17);
  if (/-hover$/.test(name))      return hslHex(h, cap(0.24), 0.235);
  if (/-(light|bg)$/.test(name)) return hslHex(h, cap(0.22), 0.195);
  if (/-edge$/.test(name))       return hslHex(h, cap(0.40), 0.50);
  if (/-border$/.test(name))     return hslHex(h, cap(0.30), 0.34);
  // Accents, dots, chart colours: keep the hue, bright enough to read.
  return hslHex(h, cap(0.50), Math.max(0.60, Math.min(l, 0.68)));
}
function darkenVars(vars) {
  var out = {};
  for (var k in vars) {
    if (!Object.prototype.hasOwnProperty.call(vars, k)) continue;
    var d = darkValue(k, vars[k]);
    if (d) out[k] = d;
  }
  return out;
}

// Colour variables a page defines in its own stylesheet :root.
function rootVars() {
  var out = {};
  try {
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      var rules;
      try { rules = sheets[i].cssRules; } catch (e) { continue; }   // a cross-origin sheet (fonts)
      if (!rules) continue;
      for (var j = 0; j < rules.length; j++) {
        var r = rules[j];
        if (!r.style || !r.selectorText || !/(^|,)\s*:root\s*($|,)/.test(r.selectorText)) continue;
        for (var n = 0; n < r.style.length; n++) {
          var prop = r.style[n];
          if (prop.indexOf('--') === 0) out[prop] = r.style.getPropertyValue(prop).trim();
        }
      }
    }
  } catch (e) {}
  return out;
}

function applyTheme() {
  if (typeof document === 'undefined' || !document.documentElement) return;
  var root = document.documentElement;
  for (var k in themeSet) if (Object.prototype.hasOwnProperty.call(themeSet, k)) root.style.removeProperty(k);
  themeSet = {};
  var pal = currentPalette ? PALETTES[currentPalette].vars : null;
  var dark = isDark();
  var setVar = function (name, v) { root.style.setProperty(name, v); themeSet[name] = true; };
  if (dark) {
    var src = rootVars(), name;
    if (pal) for (name in pal) if (Object.prototype.hasOwnProperty.call(pal, name)) src[name] = pal[name];
    var d = darkenVars(src);
    for (name in d) if (Object.prototype.hasOwnProperty.call(d, name)) setVar(name, d[name]);
    // The header: a deep tint of the palette's main colour, light text.
    var b = parseColor(src['--bark-dark'] || src['--bark'] || '#404834');
    var hb = b ? toHsl(b) : { h: 0.22, s: 0.15 };
    setVar('--hdr-bg', hslHex(hb.h, Math.min(hb.s, 0.22), 0.17));
    setVar('--hdr-fg', hslHex(hb.h, Math.min(hb.s, 0.12), 0.92));
    setVar('--hdr-sub', hslHex(hb.h, Math.min(hb.s, 0.20), 0.62));
    setVar('--hdr-line', hslHex(hb.h, Math.min(hb.s, 0.22), 0.27));
    root.setAttribute('data-theme', 'dark');
    root.style.colorScheme = 'dark';
  } else {
    if (pal) for (var p in pal) if (Object.prototype.hasOwnProperty.call(pal, p)) root.style.setProperty(p, pal[p]);
    root.removeAttribute('data-theme');
    root.style.colorScheme = '';
  }
  // The installed app's title bar follows along.
  var meta = document.querySelector && document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? root.style.getPropertyValue('--hdr-bg') : '#404834');
}

// Light / Dark / Match my computer, drawn above the palette swatches in
// every module's Settings (so no module needed its own markup).
function renderThemeChoice(container) {
  var host = container.parentNode;
  if (!host || !host.parentNode) return;
  var el = document.getElementById('plume-theme-choice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'plume-theme-choice';
    host.parentNode.insertBefore(el, host);
  }
  var c = themeChoice();
  var opt = function (v, label) {
    return '<button type="button" class="plume-theme-opt' + (c === v ? ' on' : '') + '" onclick="Plume.setTheme(\'' + v + '\')">' + label + '</button>';
  };
  el.innerHTML = '<div class="plume-theme-row">' + opt('light', 'Light') + opt('dark', 'Dark') + opt('auto', 'Match my computer') + '</div>' +
    '<div class="plume-theme-note">Light or dark applies to every module on this device, and so does the palette below.</div>';
}

// ══ App shell (2026-10-18 redesign) ═══════════════════
// The Notion-style frame Heide chose from a preview: a sidebar for moving
// between modules (icons, counts, a clear "you are here"), a page title with
// a one-line summary, one toolbar for actions, filter chips, a light list,
// and a panel that slides in from the right for a quick look.
//
// Modules move over one at a time. A module opts in by calling
// Plume.shell({ module: 'ingredients' }) after boot; until then it keeps its
// old header. All of it is styled from the palette variables, so palettes
// and dark mode carry over untouched.
//
// BRAND is the only place the app's name lives for the shell, so the
// eventual rename to Formula Finch is one edit here.
var BRAND = { name: 'Plume', sub: 'Little Bird Studio', mark: 'P' };

function countOf(key, keep) {
  var list = Store.getJSON ? Store.getJSON(key, []) : [];
  if (!Array.isArray(list)) return null;
  return keep ? list.filter(keep).length : list.length;
}
var notArchived = function (x) { return x && !x.archived; };
var SHELL_MODULES = [
  { key: 'ingredients',  label: 'Ingredients',        href: 'plume-ingredients.html',  icon: 'ingredients',
    count: function () { return countOf('aerie-ingredients-v2', notArchived); } },
  { key: 'formulations', label: 'Formulations',       href: 'plume-formulations.html', icon: 'formulations',
    count: function () { return countOf('aerie-formulations-v1', notArchived); } },
  { key: 'packaging',    label: 'Packaging',          href: 'plume-packaging.html',    icon: 'packaging',
    count: function () { return countOf('aerie-packaging-v2', notArchived); } },
  { key: 'costing',      label: 'Products & Costing', href: 'plume-costing.html',      icon: 'costing',
    count: function () { return countOf('plume-products-v1', notArchived); } },
  { key: 'batchlog',     label: 'Batches',            href: 'plume-batchlog.html',     icon: 'batches',
    count: function () { return countOf('aerie-batches-v1'); } }
];

// Line icons. The five module icons are the landing page's drawings.
var ICONS = {
  ingredients:  ['0 0 48 48', '<path d="M24 42 L24 14"/><path d="M24 22 C 18 22, 14 18, 14 12 C 20 12, 24 16, 24 22 Z"/><path d="M24 30 C 30 30, 34 26, 34 20 C 28 20, 24 24, 24 30 Z"/><path d="M24 36 C 18 36, 14 32, 14 26 C 20 26, 24 30, 24 36 Z"/>'],
  formulations: ['0 0 48 48', '<path d="M10 22 L 38 22 L 34 38 Q 24 42, 14 38 Z"/><path d="M14 22 Q 24 18, 34 22"/><path d="M28 22 L 36 8"/><circle cx="36" cy="8" r="2.5"/>'],
  packaging:    ['0 0 48 48', '<path d="M20 8 L 28 8 L 28 14 L 32 18 L 32 40 Q 24 43, 16 40 L 16 18 L 20 14 Z"/><path d="M19 26 L 29 26"/>'],
  costing:      ['0 0 48 48', '<path d="M24 10 L 24 38"/><path d="M16 38 L 32 38"/><path d="M10 18 L 24 14 L 38 18"/><path d="M6 26 Q 10 18, 14 26 Q 10 30, 6 26 Z"/><path d="M34 26 Q 38 18, 42 26 Q 38 30, 34 26 Z"/>'],
  batches:      ['0 0 48 48', '<path d="M10 28 L 10 42 L 22 42 L 22 28"/><path d="M12 24 L 20 24 L 20 28 L 12 28 Z"/><path d="M26 14 L 26 28 L 38 28 L 38 14"/><path d="M28 10 L 36 10 L 36 14 L 28 14 Z"/><path d="M26 30 L 38 30 L 38 42 L 26 42 Z"/>'],
  suppliers:    ['0 0 24 24', '<path d="M3 21h18"/><path d="M5 21V8l7-4 7 4v13"/><path d="M9 21v-6h6v6"/>'],
  settings:     ['0 0 24 24', '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>'],
  search:       ['0 0 24 24', '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'],
  plus:         ['0 0 24 24', '<path d="M12 5v14M5 12h14"/>'],
  more:         ['0 0 24 24', '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>'],
  close:        ['0 0 24 24', '<path d="M6 6l12 12M18 6 6 18"/>'],
  download:     ['0 0 24 24', '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 21h16"/>'],
  upload:       ['0 0 24 24', '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 21h16"/>'],
  print:        ['0 0 24 24', '<path d="M6 9V3h12v6"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14h10v7H7z"/>'],
  sparkle:      ['0 0 24 24', '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/>'],
  collapse:     ['0 0 24 24', '<path d="M15 6l-6 6 6 6"/><path d="M4 4v16"/>'],
  expand:       ['0 0 24 24', '<path d="M9 6l6 6-6 6"/><path d="M20 4v16"/>'],
  check:        ['0 0 24 24', '<path d="M5 12.5l4.5 4.5L19 7.5"/>'],
  copy:         ['0 0 24 24', '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'],
  trash:        ['0 0 24 24', '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>'],
  note:         ['0 0 24 24', '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 12h7M9 16h5"/>'],
  archive:      ['0 0 24 24', '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/>'],
  external:     ['0 0 24 24', '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>']
};
function icon(name, cls) {
  var d = ICONS[name]; if (!d) return '';
  return '<svg class="ps-i' + (cls ? ' ' + cls : '') + '" viewBox="' + d[0] + '" aria-hidden="true">' + d[1] + '</svg>';
}

var shellOpts = null;
function sideCollapsed() { try { return window.localStorage.getItem('plume-side-collapsed') === '1'; } catch (e) { return false; } }
function setSideCollapsed(on) {
  try { window.localStorage.setItem('plume-side-collapsed', on ? '1' : '0'); } catch (e) {}
  document.body.classList.toggle('ps-collapsed', !!on);
}

function shell(opts) {
  shellOpts = opts || {};
  var old = document.getElementById('ps-side');
  if (old) old.parentNode.removeChild(old);
  var nav = SHELL_MODULES.map(function (m) {
    var on = m.key === shellOpts.module;
    return '<a class="ps-nav' + (on ? ' on' : '') + '" href="' + m.href + '" target="plume-' + m.key + '"' +
      (on ? ' aria-current="page"' : '') + ' title="' + esc(m.label) + '">' + icon(m.icon) +
      '<span class="ps-nav-label">' + esc(m.label) + '</span><span class="ps-ct" data-ct="' + m.key + '"></span></a>';
  }).join('');
  var hasSuppliers = typeof window.openSuppliers === 'function';
  var html =
    '<aside class="ps-side" id="ps-side" aria-label="Modules">' +
      '<div class="ps-ws">' +
        '<a class="ps-ws-link" href="index.html" title="Home">' +
          '<span class="ps-ws-mark">' + esc(BRAND.mark) + '</span>' +
          '<span class="ps-ws-text"><span class="ps-ws-name">' + esc(BRAND.name) + '</span><span class="ps-ws-sub">' + esc(BRAND.sub) + '</span></span>' +
        '</a>' +
        '<button type="button" class="ps-icon-btn ps-collapse" onclick="Plume.toggleSide()" title="Collapse or expand the sidebar" aria-label="Collapse or expand the sidebar">' + icon('collapse', 'ps-when-open') + icon('expand', 'ps-when-closed') + '</button>' +
      '</div>' +
      '<nav class="ps-nav-list">' + nav + '</nav>' +
      '<div class="ps-nav-h">Library</div>' +
      (hasSuppliers
        ? '<button type="button" class="ps-nav" onclick="openSuppliers()" title="Suppliers">' + icon('suppliers') + '<span class="ps-nav-label">Suppliers</span><span class="ps-ct" data-ct="suppliers"></span></button>'
        : '<a class="ps-nav" href="plume-ingredients.html#suppliers" target="plume-ingredients" title="Suppliers">' + icon('suppliers') + '<span class="ps-nav-label">Suppliers</span><span class="ps-ct" data-ct="suppliers"></span></a>') +
      '<div class="ps-grow"></div>' +
      '<button type="button" class="ps-nav" onclick="if (typeof openSettings === \'function\') openSettings()" title="Settings">' + icon('settings') + '<span class="ps-nav-label">Settings</span></button>' +
    '</aside>';
  document.body.insertAdjacentHTML('afterbegin', html);
  document.body.classList.add('ps-shell');
  document.body.classList.toggle('ps-collapsed', sideCollapsed());
  refreshShell();
}
function toggleSide() { setSideCollapsed(!document.body.classList.contains('ps-collapsed')); }

// Counts in the sidebar. Modules call this after a save that changes one.
function refreshShell() {
  if (!shellOpts) return;
  var set = function (key, n) {
    var el = document.querySelector('.ps-ct[data-ct="' + key + '"]');
    if (el) el.textContent = (n === null || n === undefined) ? '' : String(n);
  };
  SHELL_MODULES.forEach(function (m) { set(m.key, m.count()); });
  set('suppliers', countOf('aerie-suppliers-v1'));
}

// The slide-in panel. One per page, created on first use. open() replaces
// what is showing; close() runs the onClose given to the last open().
var peekOnClose = null;
function peekEls() {
  var p = document.getElementById('ps-peek');
  if (p) return p;
  document.body.insertAdjacentHTML('beforeend',
    '<div class="ps-scrim" id="ps-scrim" onclick="Plume.peek.close()"></div>' +
    '<aside class="ps-peek" id="ps-peek" aria-hidden="true" role="dialog" aria-modal="false" aria-label="Details">' +
      '<div class="ps-peek-top"><button type="button" class="ps-icon-btn" onclick="Plume.peek.close()" aria-label="Close">' + icon('close') + '</button>' +
      '<span class="ps-peek-label" id="ps-peek-label"></span><span class="ps-grow"></span><span id="ps-peek-actions"></span></div>' +
      '<div class="ps-peek-body" id="ps-peek-body"></div>' +
    '</aside>');
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && peekIsOpen() && !document.querySelector('.plume-dlg-ov') && !anyModalOpen()) closePeek();
  });
  return document.getElementById('ps-peek');
}
function anyModalOpen() {
  var m = document.querySelectorAll('.modal-overlay.open, .modal-ov.open, .drawer-overlay.open');
  return m.length > 0;
}
function peekIsOpen() { var p = document.getElementById('ps-peek'); return !!(p && p.classList.contains('open')); }
function openPeek(html, opts) {
  opts = opts || {};
  var p = peekEls();
  document.getElementById('ps-peek-label').textContent = opts.label || '';
  document.getElementById('ps-peek-actions').innerHTML = opts.actions || '';
  document.getElementById('ps-peek-body').innerHTML = html;
  peekOnClose = opts.onClose || null;
  p.classList.add('open'); p.setAttribute('aria-hidden', 'false');
  document.getElementById('ps-scrim').classList.add('open');
}
function closePeek() {
  var p = document.getElementById('ps-peek');
  if (!p) return;
  var cb = peekOnClose; peekOnClose = null;
  p.classList.remove('open'); p.setAttribute('aria-hidden', 'true');
  document.getElementById('ps-scrim').classList.remove('open');
  document.getElementById('ps-peek-body').innerHTML = '';
  if (cb) cb();
}

// Overflow menus: <div class="ps-menu-wrap"><button data-ps-menu>...</button>
// <div class="ps-menu">...</div></div>. One delegated handler for all.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    var btn = t.closest('[data-ps-menu]');
    var openMenus = document.querySelectorAll('.ps-menu.open');
    for (var i = 0; i < openMenus.length; i++) {
      if (!btn || openMenus[i] !== btn.parentNode.querySelector('.ps-menu')) {
        openMenus[i].classList.remove('open');
        var b = openMenus[i].parentNode.querySelector('[data-ps-menu]');
        if (b) b.setAttribute('aria-expanded', 'false');
      }
    }
    if (btn) {
      var m = btn.parentNode.querySelector('.ps-menu');
      var on = !m.classList.contains('open');
      m.classList.toggle('open', on);
      btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    }
  });
}

// ══ Storage reporting ═════════════════════════════════
// Enumerates what is actually in storage rather than checking a list of
// expected key names. A hardcoded list silently misreports the moment a
// name drifts — which already happened once, hiding the largest consumer
// inside an unlabelled "Other" bucket.
function storLabel(k) {
  if (KEY_LABELS[k]) return KEY_LABELS[k];
  if (k.indexOf('plume-palette') === 0 || k.indexOf('plume-pricing-') === 0 || k === THEME_KEY || k === 'plume-side-collapsed') return null;
  return k;
}

function storageReport() {
  var rows = [], settings = 0, total = 0;
  var ks = Store.keys();
  for (var i = 0; i < ks.length; i++) {
    var k = ks[i], n = Store.bytes(k);
    total += n;
    var label = storLabel(k);
    if (label === null) { settings += n; continue; }
    rows.push({ key: k, label: label, bytes: n });
  }
  rows.sort(function (a, b) { return b.bytes - a.bytes; });
  return { rows: rows, settings: settings, total: total };
}

var STOR_LIMIT   = 5 * 1024 * 1024;
var STOR_WARN_AT = 0.75;
var storFailed   = false;
var storAlerted  = false;
var storHidden   = false;
var storDrillOpen = false;

function renderStorage() {
  var el = document.getElementById('storage-body');
  if (!el) return;
  var r   = storageReport();
  var pct = Math.min(100, (r.total / STOR_LIMIT) * 100);
  var bar = pct > 80 ? 'var(--clay)' : 'var(--sage)';

  var html = '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">';
  html += '<span style="color:var(--ink-light)">' + fmtBytes(r.total) + ' of about 5 MB</span>';
  html += '<span style="color:var(--ink-lighter)">' + pct.toFixed(0) + '%</span></div>';
  html += '<div style="height:6px;background:var(--cream-dark);border-radius:3px;overflow:hidden;margin-bottom:12px">';
  html += '<div style="height:100%;width:' + pct.toFixed(1) + '%;background:' + bar + '"></div></div>';

  r.rows.forEach(function (row) {
    if (row.bytes < 512) return;
    html += '<div style="display:flex;justify-content:space-between;font-size:11.5px;padding:3px 0;color:var(--ink-light)">';
    html += '<span>' + esc(row.label) + '</span><span>' + fmtBytes(row.bytes) + '</span></div>';
  });
  if (r.settings) {
    html += '<div style="display:flex;justify-content:space-between;font-size:11.5px;padding:3px 0;color:var(--ink-lighter)">';
    html += '<span>Settings</span><span>' + fmtBytes(r.settings) + '</span></div>';
  }
  html += '<div style="font-size:11px;color:var(--ink-lighter);line-height:1.5;margin-top:10px">';
  html += 'All Plume modules share one browser storage budget of about 5MB, which browsers do not allow to be raised.<br>' +
          '<span style="opacity:0.75">plume-core.js v' + VERSION + ' &middot; storage: ' + Store.driverName() + '</span></div>' +
          '<div id="plume-app-status" style="font-size:11px;color:var(--ink-lighter);line-height:1.6;margin-top:8px"></div>';
  if (r.rows.length) {
    html += '<button class="plume-link-btn" onclick="Plume.toggleStorDrill()">What is using the room?</button>';
    html += '<div id="stor-drill"></div>';
  }
  el.innerHTML = html;
  if (storDrillOpen) renderStorDrill();
  setTimeout(renderAppStatus, 0);
}

function toggleStorDrill() { storDrillOpen = !storDrillOpen; renderStorage(); }

function fieldBreakdown(raw) {
  var data;
  try { data = JSON.parse(raw); } catch (e) { return null; }
  var recs = Array.isArray(data) ? data : null;
  if (!recs) { for (var k in data) { if (Array.isArray(data[k])) { recs = data[k]; break; } } }
  if (!recs || !recs.length) return null;
  var tot = {}, sum = 0;
  recs.forEach(function (rec) {
    if (!rec || typeof rec !== 'object') return;
    for (var fl in rec) {
      var b = 0;
      try { b = JSON.stringify(rec[fl]).length; } catch (e) { b = 0; }
      tot[fl] = (tot[fl] || 0) + b;
      sum += b;
    }
  });
  var arr = [];
  for (var f2 in tot) arr.push({ field: f2, bytes: tot[f2] });
  arr.sort(function (a, b) { return b.bytes - a.bytes; });
  return { fields: arr, sum: sum, count: recs.length };
}

function renderStorDrill() {
  var el = document.getElementById('stor-drill');
  if (!el) return;
  var r = storageReport(), html = '', shown = 0;
  for (var i = 0; i < r.rows.length && shown < 2; i++) {
    var row = r.rows[i];
    if (row.bytes < 2048) break;
    var bd = fieldBreakdown(Store.get(row.key) || '');
    if (!bd) continue;
    shown++;
    html += '<div style="font-size:11px;color:var(--ink-lighter);margin:' + (shown === 1 ? '8px' : '14px') +
            ' 0 6px;line-height:1.5"><strong>' + esc(row.label) + '</strong> &mdash; ' +
            bd.count + ' records, ' + fmtBytes(row.bytes) + '. Biggest fields:</div>';
    bd.fields.slice(0, 5).forEach(function (fd) {
      var p = bd.sum ? (100 * fd.bytes / bd.sum) : 0;
      html += '<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;color:var(--ink-light)">';
      html += '<span>' + esc(fd.field) + '</span><span>' + fmtBytes(fd.bytes) + ' &middot; ' + p.toFixed(0) + '%</span></div>';
    });
  }
  if (!shown) { el.innerHTML = ''; return; }
  html += '<div style="font-size:11px;color:var(--ink-lighter);line-height:1.5;margin-top:8px">' +
          'A single field taking most of the space is usually reference text or an image, and is the cheapest thing to trim.</div>';
  el.innerHTML = html;
}

// The failure mode that matters: a save that silently doesn't happen.
function renderStorBanner() {
  var slot = document.getElementById('stor-banner-slot');
  if (!slot) return;

  if (storFailed) {
    slot.innerHTML = '<div class="stor-banner crit"><div><b>Storage is full &mdash; your changes are not being saved.</b><br>' +
      'Download a backup now so nothing is lost, then free up space. Packaging photos are usually the largest item; Settings shows the breakdown.' +
      (typeof window.exportData === 'function'
        ? '<br><button class="btn" onclick="exportData()">Download backup now</button>' : '') +
      '</div></div>';
    return;
  }
  if (storHidden) { slot.innerHTML = ''; return; }

  var pct = storageReport().total / STOR_LIMIT;
  if (pct < STOR_WARN_AT) { slot.innerHTML = ''; return; }

  slot.innerHTML = '<div class="stor-banner warn"><div><b>Browser storage is about ' +
    Math.round(pct * 100) + '% full.</b> Plume stores everything in this browser, and the limit is ' +
    'roughly 5MB for the whole app &mdash; it cannot be raised. Worth exporting a backup and checking ' +
    'Settings to see what is using the room.</div>' +
    '<button class="sb-x" onclick="Plume.dismissStorBanner()" title="Hide until next time">&times;</button></div>';
}

function dismissStorBanner() { storHidden = true; renderStorBanner(); }

function noteSaveFailed() {
  storFailed = true;
  renderStorBanner();
  if (!storAlerted) {
    storAlerted = true;
    tell('Nothing you do from here will be saved until space is freed. Use the red banner at the ' +
         'top to download a backup first, then see Settings for what is taking up room.',
         { title: 'Your changes could not be saved: browser storage is full' });
  }
}
function noteSaveOk() { storFailed = false; }

// ══ Shared styles ═════════════════════════════════════
// Injected so a module only has to provide the slot elements, not the CSS.
function injectStyles() {
  if (document.getElementById('plume-core-css')) return;
  var css =
  '.stor-banner{border-radius:6px;padding:12px 14px;margin-bottom:16px;font-size:12.5px;line-height:1.55;display:flex;gap:10px;align-items:flex-start}' +
  '.stor-banner.warn{background:var(--warning-bg,#FBF3E7);border:1px solid var(--warning-border,#E0C9A0);color:var(--warning,#6B5433)}' +
  '.stor-banner.crit{background:var(--danger-bg,#F9E9E4);border:1px solid var(--danger-border,#D9A695);color:var(--danger,#7A3F2C)}' +
  // Light / Dark / Match my computer, in Settings.
  '.plume-theme-row{display:inline-flex;border:1px solid var(--cream-border);border-radius:6px;overflow:hidden;margin:2px 0 8px}' +
  '.plume-theme-opt{font-family:inherit;font-size:12px;padding:6px 14px;border:none;border-right:1px solid var(--cream-border);background:var(--white);color:var(--ink-light);cursor:pointer}' +
  '.plume-theme-opt:last-child{border-right:none}.plume-theme-opt:hover{color:var(--ink)}' +
  '.plume-theme-opt.on{background:var(--cream-dark);color:var(--bark-dark);font-weight:500}' +
  '.plume-theme-note{font-size:12px;color:var(--ink-lighter);line-height:1.4;margin-bottom:6px}' +
  '.stor-banner b{font-weight:600}' +
  '.stor-banner .sb-x{margin-left:auto;background:none;border:none;font-size:16px;line-height:1;color:inherit;opacity:0.5;cursor:pointer;padding:0 2px;flex-shrink:0}' +
  '.stor-banner .sb-x:hover{opacity:1}' +
  '.stor-banner .btn{padding:4px 10px;font-size:11px;margin-top:8px}' +
  '.plume-link-btn{background:none;border:none;padding:0;font-family:inherit;font-size:10.5px;color:var(--ink-lighter);cursor:pointer;text-decoration:underline;text-underline-offset:2px;margin-top:6px}' +
  '.plume-link-btn:hover{color:var(--clay)}' +
  // pH readings: neutral by default; sage when within target, warning when
  // outside. Shared so a batch and a usage-log entry look alike.
  '.ph-badge{display:inline-flex;align-items:baseline;gap:4px;font-size:11.5px;padding:1px 8px;border-radius:10px;' +
    'background:var(--cream-dark,#F0EBE3);color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap}' +
  '.ph-badge .ph-m{font-size:10px;color:var(--ink-lighter)}' +
  '.ph-badge.ph-in{background:var(--sage-light);color:var(--sage-dark)}' +
  '.ph-badge.ph-low,.ph-badge.ph-high{background:var(--warning-bg);color:var(--warning);box-shadow:inset 0 0 0 1px var(--warning-border)}' +
  '.ph-badge .ph-dir{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em}' +
  '.ph-steps{display:inline-flex;flex-wrap:wrap;align-items:center;gap:4px 6px;line-height:1.7}' +
  '.ph-add{font-size:11.5px;color:var(--ink-light);font-style:italic}' +
  '.ph-arrow{color:var(--ink-lighter);font-size:11px}' +
  '.ph-next{display:inline-flex;align-items:center;gap:6px}' +
  // Labels are uppercased across Plume; pH must keep its own case.
  '.ph-word{text-transform:none!important;letter-spacing:0.02em}' +
  // In-page dialogs. Above every module's own modals (theirs top out near 1000).
  '.plume-dlg-ov{position:fixed;inset:0;background:rgba(30,32,26,0.42);z-index:5000;display:flex;align-items:center;justify-content:center;padding:16px}' +
  '.plume-dlg{background:var(--white,#fff);color:var(--ink,#222);border:1px solid var(--cream-border,#ccc);border-radius:6px;' +
    'box-shadow:0 10px 36px rgba(0,0,0,0.22);width:100%;max-width:440px;max-height:calc(100vh - 32px);overflow:auto;padding:20px 22px 16px;font-family:\'DM Sans\',sans-serif}' +
  '.plume-dlg-title{font-family:\'Cormorant Garamond\',Georgia,serif;font-size:21px;color:var(--bark-dark,#333);margin-bottom:8px;line-height:1.25}' +
  '.plume-dlg-msg{font-size:13.5px;line-height:1.55;color:var(--ink,#222)}' +
  '.plume-dlg-msg p{margin:0 0 10px}.plume-dlg-msg p:last-child{margin-bottom:0}' +
  '.plume-dlg-input{width:100%;box-sizing:border-box;margin-top:12px;font:inherit;font-size:14px;padding:8px 10px;border:1px solid var(--cream-border,#ccc);border-radius:3px;background:var(--white,#fff);color:var(--ink,#222)}' +
  '.plume-dlg-input:focus{outline:none;border-color:var(--bark-light,#888)}' +
  '.plume-dlg-btns{display:flex;justify-content:flex-end;gap:8px;margin-top:18px;flex-wrap:wrap}' +
  '.plume-dlg-btns button{font-family:inherit;font-size:13px;padding:7px 14px;border-radius:3px;cursor:pointer;border:1px solid var(--cream-border,#ccc);background:var(--white,#fff);color:var(--ink,#222)}' +
  '.plume-dlg-btns .plume-dlg-yes{background:var(--bark,#555);border-color:var(--bark,#555);color:var(--white,#fff)}' +
  '.plume-dlg-btns .plume-dlg-yes.danger{background:var(--danger,#a03020);border-color:var(--danger,#a03020)}' +
  '.plume-dlg-btns button:focus-visible{outline:2px solid var(--bark-light,#888);outline-offset:2px}';
  // The app shell's styles (see the App shell section).
  css += '/* ── App shell (2026-10-18). Main surface --white, sidebar --cream,' +
    '   accent --bark, in-stock tint --clay-light. ── */' +
    'body.ps-shell{background:var(--white);padding-left:236px;transition:padding-left .18s ease}' +
    'body.ps-shell.ps-collapsed{padding-left:60px}' +
    '.ps-i{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;flex:none}' +
    'svg.ps-i[viewBox="0 0 48 48"]{stroke-width:2.6}' +
    ".ps-side{position:fixed;top:0;left:0;bottom:0;width:236px;background:var(--cream);border-right:1px solid var(--cream-border);padding:14px 10px;display:flex;flex-direction:column;gap:2px;overflow-y:auto;z-index:50;transition:width .18s ease;font-family:'DM Sans',sans-serif}" +
    '.ps-collapsed .ps-side{width:60px}' +
    '.ps-ws{display:flex;align-items:center;gap:4px;padding:2px 2px 14px 6px}' +
    '.ps-ws-link{display:flex;align-items:center;gap:9px;text-decoration:none;color:var(--ink);min-width:0;flex:1}' +
    ".ps-ws-mark{width:28px;height:28px;border-radius:8px;background:var(--bark);color:var(--white);display:grid;place-items:center;font:500 18px/1 'Cormorant Garamond',Georgia,serif;flex:none}" +
    '.ps-ws-text{display:flex;flex-direction:column;min-width:0}' +
    ".ps-ws-name{font:500 21px/1.05 'Cormorant Garamond',Georgia,serif;letter-spacing:.04em;white-space:nowrap}" +
    '.ps-ws-sub{font-size:11px;color:var(--ink-lighter);white-space:nowrap}' +
    '.ps-nav-list{display:flex;flex-direction:column;gap:2px}' +
    '.ps-nav{display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:7px;color:var(--ink-light);text-decoration:none;font:inherit;font-size:14px;border:0;background:none;width:100%;text-align:left;cursor:pointer;transition:background .12s,color .12s;white-space:nowrap}' +
    '.ps-nav .ps-i{transition:color .12s}' +
    '.ps-nav:hover{background:color-mix(in srgb,var(--bark) 8%,transparent);color:var(--ink)}' +
    '.ps-nav:hover .ps-i{color:var(--bark)}' +
    '.ps-nav.on{background:color-mix(in srgb,var(--bark) 21%,transparent);color:var(--ink);font-weight:600}' +
    '.ps-nav.on:hover{background:color-mix(in srgb,var(--bark) 24%,transparent)}' +
    '.ps-nav.on .ps-i{color:var(--bark)}' +
    '.ps-ct{margin-left:auto;font-size:12px;color:var(--ink-lighter);font-variant-numeric:tabular-nums;font-weight:400}' +
    '.ps-nav.on .ps-ct{color:var(--bark);font-weight:600}' +
    '.ps-nav-h{font-size:11.5px;font-weight:500;color:var(--ink-lighter);padding:16px 8px 4px;white-space:nowrap}' +
    '.ps-grow{flex:1}' +
    '.ps-collapse{margin-left:auto;opacity:.55}' +
    '.ps-collapse:hover{opacity:1}' +
    '.ps-when-closed{display:none}' +
    '.ps-collapsed .ps-when-open{display:none}.ps-collapsed .ps-when-closed{display:block}' +
    '.ps-collapsed .ps-ws-text,.ps-collapsed .ps-nav-label,.ps-collapsed .ps-ct,.ps-collapsed .ps-nav-h{display:none}' +
    '.ps-collapsed .ps-ws{flex-direction:column;gap:8px;padding:2px 0 14px}' +
    '.ps-collapsed .ps-ws-link{flex:none}' +
    '.ps-collapsed .ps-collapse{margin:0}' +
    '.ps-collapsed .ps-nav{justify-content:center;padding:8px 0}' +
    '.ps-collapsed .ps-nav-h{display:block;height:12px;padding:0}' +
    '' +
    // The page head sits in a colour block (Heide, 2026-10-18): a wash of the
    // palette's accent, so it follows the palette and dark mode.
    '.ps-page-head{display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:4px;padding:22px 24px 20px;border-radius:14px;background:color-mix(in srgb,var(--bark) 11%,var(--white))}' +
    '.ps-title{display:flex;align-items:center;gap:12px}' +
    '.ps-title-icon{width:40px;height:40px;border-radius:10px;background:var(--white);color:var(--bark);display:grid;place-items:center;flex:none;box-shadow:0 1px 2px color-mix(in srgb,var(--bark-dark) 14%,transparent)}' +
    '.ps-title-icon .ps-i{width:26px;height:26px}' +
    ".ps-title h1{margin:0;font-family:'DM Sans',sans-serif;font-size:30px;font-weight:600;letter-spacing:-.01em;line-height:1.15;color:var(--ink)}" +
    '.ps-summary{color:var(--ink-light);font-size:13.5px;margin-top:6px;display:flex;gap:14px;flex-wrap:wrap}' +
    '.ps-summary b{color:var(--ink-light);font-weight:600;font-variant-numeric:tabular-nums}' +
    '' +
    '.ps-toolbar{display:flex;align-items:center;gap:8px;margin-top:20px;border-bottom:1px solid var(--cream-border);flex-wrap:wrap}' +
    '.ps-tab{font:inherit;font-size:14px;background:none;border:0;padding:8px 2px;margin-right:14px;color:var(--ink-lighter);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}' +
    '.ps-tab:hover{color:var(--ink-light)}' +
    '.ps-tab.on{color:var(--ink);border-bottom-color:var(--ink);font-weight:500}' +
    '.ps-tools{margin-left:auto;display:flex;gap:6px;align-items:center;padding-bottom:6px}' +
    '.ps-search{display:flex;align-items:center;gap:6px;border-radius:7px;padding:0 8px;color:var(--ink-lighter);transition:background .12s}' +
    '.ps-search:focus-within,.ps-search:hover{background:var(--cream-dark)}' +
    '.ps-search input{border:0;background:transparent;outline:none;color:var(--ink);font:inherit;font-size:14px;width:220px;padding:6px 0;box-shadow:none}' +
    '.ps-btn-primary{font:inherit;font-size:13.5px;border:0;background:var(--bark);color:var(--white);border-radius:7px;padding:6px 12px;font-weight:500;cursor:pointer;display:inline-flex;gap:6px;align-items:center;white-space:nowrap}' +
    '.ps-btn-primary:hover{filter:brightness(1.07)}' +
    '.ps-btn-primary .ps-i{width:16px;height:16px}' +
    '.ps-icon-btn{border:0;background:none;border-radius:7px;padding:6px;color:var(--ink-light);cursor:pointer;display:inline-grid;place-items:center;font:inherit}' +
    '.ps-icon-btn:hover{background:var(--cream-dark);color:var(--ink)}' +
    '.ps-shell :focus-visible{outline:2px solid var(--bark);outline-offset:2px}' +
    '.ps-menu-wrap{position:relative}' +
    '.ps-menu{position:absolute;right:0;top:calc(100% + 4px);background:var(--white);border:1px solid var(--cream-border);border-radius:9px;box-shadow:0 12px 40px rgba(20,20,15,.14),0 2px 6px rgba(20,20,15,.06);padding:5px;min-width:220px;white-space:nowrap;z-index:60;opacity:0;transform:translateY(-4px) scale(.98);pointer-events:none;transition:opacity .12s,transform .12s}' +
    '.ps-menu.open{opacity:1;transform:none;pointer-events:auto}' +
    '.ps-menu button{display:flex;gap:10px;align-items:center;width:100%;border:0;background:none;padding:7px 9px;border-radius:6px;cursor:pointer;text-align:left;color:var(--ink-light);font:inherit;font-size:13.5px}' +
    '.ps-menu button:hover{background:var(--cream-dark);color:var(--ink)}' +
    '.ps-menu hr{border:0;border-top:1px solid var(--cream-border);margin:4px 2px}' +
    '.ps-menu button.ps-menu-danger{color:var(--danger)}' +
    '' +
    '.ps-chips{display:flex;gap:6px;margin:12px 0 8px;flex-wrap:wrap;align-items:center}' +
    '.ps-chip{font:inherit;font-size:13px;border:1px solid var(--cream-border);background:transparent;border-radius:999px;padding:3px 11px;color:var(--ink-light);cursor:pointer;display:inline-flex;gap:6px;align-items:center;white-space:nowrap;transition:background .12s}' +
    '.ps-chip:hover{background:var(--cream-dark)}' +
    '.ps-chip.on,.ps-chip.active{background:var(--ink);color:var(--white);border-color:var(--ink)}' +
    'select.ps-chip{appearance:auto;padding-right:6px}' +
    'select.ps-chip.on{background:var(--ink);color:var(--white)}' +
    '.ps-dot{width:7px;height:7px;border-radius:50%;display:inline-block;flex:none}' +
    '.ps-swatch{width:11px;height:11px;border-radius:3px;display:inline-block;background:var(--clay-light);box-shadow:inset 0 0 0 1px var(--clay-hover);flex:none}' +
    '.ps-chip-sep{width:1px;height:18px;background:var(--cream-border);margin:0 2px}' +
    '' +
    '.ps-table-wrap{overflow-x:auto}' +
    'table.ps-table{width:100%;border-collapse:collapse;table-layout:auto;border:0;background:transparent}' +
    '.ps-table th{text-align:left;font-weight:500;font-size:12.5px;color:var(--ink-lighter);padding:9px 10px;border-bottom:1.5px solid var(--cream-border);white-space:nowrap;letter-spacing:0;text-transform:none;background:transparent}' +
    '.ps-table td{padding:10px 10px;border-bottom:1px solid var(--cream-border);vertical-align:middle;white-space:normal;overflow:visible;text-overflow:clip;color:var(--ink);font-size:14px}' +
    '.ps-table tbody tr{cursor:pointer;transition:background .1s}' +
    '.ps-table tbody tr:hover td{background:var(--cream-dark)}' +
    '.ps-table tbody tr.has-stock td{background:var(--clay-light)}' +
    '.ps-table tbody tr.has-stock:hover td,.ps-table tbody tr.has-stock.sel td{background:var(--clay-hover)}' +
    '.ps-table tbody tr.sel td{background:var(--cream-dark)}' +
    '.ps-table .ps-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}' +
    '.ps-name{font-weight:500}' +
    '.ps-sub{font-size:12.5px;color:var(--ink-lighter);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px}' +
    '.ps-muted{color:var(--ink-lighter)}' +
    '.ps-tag{display:inline-block;font-size:12px;padding:1px 8px;border-radius:5px;margin:1px 4px 1px 0;white-space:nowrap;background:color-mix(in srgb,var(--ink) 8%,transparent);color:var(--ink-light);line-height:1.6}' +
    '.ps-tag.ph-water{background:var(--ph-water-bg,#E4EEF8);color:var(--ph-water-fg,#2A5C8A)}' +
    '.ps-tag.ph-oil{background:var(--ph-oil-bg,#F5ECD8);color:var(--ph-oil-fg,#7A4E10)}' +
    '.ps-tag.ph-cool-down{background:var(--ph-cool-down-bg,#E4F0EA);color:var(--ph-cool-down-fg,#2A5C40)}' +
    '.ps-tag.ph-active{background:var(--ph-active-bg,#EDE8F8);color:var(--ph-active-fg,#4A3A8A)}' +
    '.ps-stock{display:inline-flex;gap:7px;align-items:center;white-space:nowrap;font-variant-numeric:tabular-nums}' +
    '' +
    '.ps-scrim{position:fixed;inset:0;background:rgba(20,22,17,.18);opacity:0;pointer-events:none;transition:opacity .2s;z-index:90}' +
    '.ps-scrim.open{opacity:1;pointer-events:auto}' +
    ".ps-peek{position:fixed;top:0;right:0;bottom:0;width:min(480px,100%);background:var(--white);box-shadow:0 12px 40px rgba(20,20,15,.18),0 2px 6px rgba(20,20,15,.06);z-index:91;transform:translateX(102%);transition:transform .24s cubic-bezier(.2,.8,.2,1);display:flex;flex-direction:column;font-family:'DM Sans',sans-serif;color:var(--ink)}" +
    '.ps-peek.open{transform:none}' +
    '.ps-peek-top{display:flex;gap:6px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--cream-border);color:var(--ink-lighter);font-size:13px}' +
    '.ps-peek-body{padding:22px 26px 30px;overflow-y:auto;flex:1}' +
    '.ps-link-btn{font:inherit;font-size:13px;border:1px solid var(--cream-border);background:transparent;border-radius:7px;padding:5px 11px;cursor:pointer;color:var(--ink-light);display:inline-flex;gap:6px;align-items:center;white-space:nowrap}' +
    '.ps-link-btn:hover{background:var(--cream-dark);color:var(--ink)}' +
    '' +
    '@media (max-width:760px){' +
    '  body.ps-shell,body.ps-shell.ps-collapsed{padding-left:0}' +
    '  .ps-side,.ps-collapsed .ps-side{position:sticky;top:0;width:auto;height:auto;flex-direction:row;align-items:center;overflow-x:auto;padding:8px 12px;border-right:0;border-bottom:1px solid var(--cream-border);gap:4px}' +
    '  .ps-ws{padding:0 6px 0 0}.ps-collapse,.ps-ws-sub,.ps-nav-h,.ps-grow,.ps-ct{display:none!important}' +
    '  .ps-nav-list{flex-direction:row;gap:4px}' +
    '  .ps-nav{width:auto}' +
    '  .ps-collapsed .ps-nav-label,.ps-collapsed .ps-ws-text{display:inline}' +
    '  .ps-search input{width:130px}' +
    '}' +
    '@media (prefers-reduced-motion:reduce){.ps-side,.ps-peek,.ps-scrim,.ps-menu,.ps-nav,body.ps-shell{transition:none}}';
  var st = document.createElement('style');
  st.id = 'plume-core-css';
  st.appendChild(document.createTextNode(css));
  document.head.appendChild(st);
}

// Fills every <span class="plume-version"> with the app version.
// Some pages (Ingredients, Packaging) put the footer AFTER their scripts,
// so it does not exist yet when boot runs; wait for it in that case.
function stampVersion() {
  if (typeof document === 'undefined' || !document.querySelectorAll) return;
  if (document.readyState === 'loading' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', stampVersion);
    return;
  }
  var els = document.querySelectorAll('.plume-version');
  for (var i = 0; i < els.length; i++) els[i].textContent = 'v' + VERSION;
}

// ══ In-page dialogs (2026-10-17) ═══════════════════════
// Replace the browser's alert(), confirm() and prompt(). Those are blocked
// silently in a sandboxed frame (the artifact previews, and any demo of the
// sellable version embedded in a web page), so an action behind one simply
// did nothing there. They also cannot hold more than a line of plain text.
//
//   Plume.tell(message, opts)              alert:   opts.title, opts.ok, opts.onClose
//   Plume.ask(message, onYes, opts)        confirm: opts.title, opts.yes, opts.no,
//                                                   opts.danger, opts.onNo
//   Plume.askValue(message, value, onOk, opts)  prompt: onOk(text); opts.onCancel
//
// THEY DO NOT BLOCK. confirm() stopped the script until answered; these
// return at once and call back later. Code that ran after `if (!confirm())
// return;` must move into the onYes callback, and a function that returned
// confirm()'s answer must take a callback instead.
//
// Messages are plain text: escaped, a blank line starts a new paragraph,
// a single newline is a line break. One dialog shows at a time; others
// queue behind it. Escape cancels; Enter confirms unless opts.danger, where
// Cancel holds the focus so a stray Enter cannot delete anything.
//
// TEST HOOK: if window.PLUME_TEST_DIALOGS is a function, it is called with
// (kind, message, opts) and its return value answers at once, synchronously:
// true/false for ask, a string (or null) for askValue. The test suites use
// it to read and answer dialogs. Nothing in the app sets it.
var dlgQueue = [], dlgOpen = null;

function dlgParas(msg) {
  if (msg == null || !String(msg).trim()) return '';   // a title-only question
  return String(msg).split(/\n{2,}/).map(function (p) {
    return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>';
  }).join('');
}

function dlgShow(d) {
  var hook = (typeof window !== 'undefined') && window.PLUME_TEST_DIALOGS;
  if (typeof hook === 'function') {
    var r = hook(d.kind, d.message, d.opts || {}, d.value);
    if (d.kind === 'value') d.done(r === null || r === undefined || r === false ? null : String(r));
    else d.done(d.kind === 'tell' ? true : !!r);
    return;
  }
  dlgQueue.push(d);
  if (!dlgOpen) dlgNext();
}

function dlgNext() {
  var d = dlgQueue.shift();
  if (!d) { dlgOpen = null; return; }
  dlgOpen = d;
  var o = d.opts || {};
  d.returnFocus = document.activeElement;
  var wrap = document.createElement('div');
  wrap.className = 'plume-dlg-ov';
  var isAsk = d.kind !== 'tell';
  wrap.innerHTML =
    '<div class="plume-dlg" role="' + (isAsk ? 'alertdialog' : 'dialog') + '" aria-modal="true" aria-labelledby="plume-dlg-t" aria-describedby="plume-dlg-m">' +
      (o.title ? '<div class="plume-dlg-title" id="plume-dlg-t">' + esc(o.title) + '</div>' : '<span id="plume-dlg-t" hidden>Plume</span>') +
      '<div class="plume-dlg-msg" id="plume-dlg-m">' + dlgParas(d.message) + '</div>' +
      (d.kind === 'value' ? '<input type="text" class="plume-dlg-input" value="' + esc(d.value == null ? '' : d.value) + '"' +
        (o.inputmode ? ' inputmode="' + esc(o.inputmode) + '"' : '') + '>' : '') +
      '<div class="plume-dlg-btns">' +
        (isAsk ? '<button type="button" class="plume-dlg-no">' + esc(o.no || 'Cancel') + '</button>' : '') +
        '<button type="button" class="plume-dlg-yes' + (o.danger ? ' danger' : '') + '">' +
          esc(isAsk ? (o.yes || 'OK') : (o.ok || 'OK')) + '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(wrap);
  var yes = wrap.querySelector('.plume-dlg-yes'), no = wrap.querySelector('.plume-dlg-no');
  var input = wrap.querySelector('.plume-dlg-input');
  var finish = function (ok) {
    if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    document.removeEventListener('keydown', onKey, true);
    try { if (d.returnFocus && d.returnFocus.focus) d.returnFocus.focus(); } catch (e) {}
    var val = input ? input.value : null;
    dlgOpen = null;
    if (d.kind === 'value') d.done(ok ? val : null);
    else d.done(d.kind === 'tell' ? true : ok);
    if (!dlgOpen) dlgNext();
  };
  var onKey = function (e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    else if (e.key === 'Enter' && document.activeElement !== no && !(o.danger && !input)) { e.preventDefault(); e.stopPropagation(); finish(true); }
    else if (e.key === 'Tab') {   // keep focus inside the dialog
      var f = Array.prototype.slice.call(wrap.querySelectorAll('button, input'));
      var i = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  };
  yes.onclick = function () { finish(true); };
  if (no) no.onclick = function () { finish(false); };
  // A click on the backdrop cancels a question but not a notice, so a
  // mis-click cannot lose a message she has not read.
  wrap.onclick = function (e) { if (e.target === wrap && isAsk) finish(false); };
  document.addEventListener('keydown', onKey, true);
  setTimeout(function () {
    if (input) { input.focus(); input.select(); }
    else if (o.danger && no) no.focus();
    else yes.focus();
  }, 0);
}

function tell(message, opts) {
  opts = opts || {};
  dlgShow({ kind: 'tell', message: message, opts: opts, done: function () { if (opts.onClose) opts.onClose(); } });
}

function ask(message, onYes, opts) {
  opts = opts || {};
  dlgShow({ kind: 'ask', message: message, opts: opts, done: function (ok) {
    if (ok) { if (onYes) onYes(); } else if (opts.onNo) opts.onNo();
  } });
}

function askValue(message, value, onOk, opts) {
  opts = opts || {};
  dlgShow({ kind: 'value', message: message, value: value, opts: opts, done: function (v) {
    if (v === null) { if (opts.onCancel) opts.onCancel(); } else if (onOk) onOk(v);
  } });
}

// ══ Installable app / offline (2026-10-17) ════════════
// sw.js keeps a saved copy of the app files (network first; see its header)
// and manifest.webmanifest makes Plume installable from Chrome. Registration
// only happens over http(s): a file:// page or a sandboxed preview cannot
// register a service worker, and Plume carries on normally without one.
var installPrompt = null;

function isInstalled() {
  if (typeof window === 'undefined') return false;
  if (window.PLUME_TEST_STANDALONE) return true;   // test hook, like PLUME_TEST_DIALOGS
  try {
    return !!(window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches ||
                                    window.matchMedia('(display-mode: window-controls-overlay)').matches)) ||
           window.navigator.standalone === true;
  } catch (e) { return false; }
}

function registerAppWorker() {
  try {
    if (!('serviceWorker' in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register('sw.js').catch(function () { /* runs fine without it */ });
  } catch (e) { /* sandboxed frame: no service worker, no problem */ }
}

// Chrome offers to install when it thinks the app qualifies; keep the offer
// so an "Install Plume" button can use it. Chrome's own install icon in the
// address bar keeps working either way.
function watchInstallOffer() {
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installPrompt = e;
    showInstallButtons(true);
  });
  window.addEventListener('appinstalled', function () {
    installPrompt = null;
    showInstallButtons(false);
  });
}
function showInstallButtons(on) {
  var els = document.querySelectorAll('.plume-install');
  for (var i = 0; i < els.length; i++) els[i].hidden = !on || isInstalled();
}
function install() {
  if (!installPrompt) {
    tell('In Chrome, use the install icon at the right of the address bar, or the menu (three dots) then "Cast, save and share" then "Install page as app".',
         { title: 'Install Plume as an app' });
    return;
  }
  installPrompt.prompt();
  installPrompt.userChoice.then(function () { installPrompt = null; showInstallButtons(false); });
}

// In the installed app, moving between modules stays in the one window, like
// sections of an app. In a browser tab, links keep their old behaviour (each
// module in its own named tab). Bonus: each page then loads fresh from
// storage, so one module can never save over another's newer data.
function keepLinksInWindow() {
  if (!isInstalled()) return;
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[target]') : null;
    if (!a || !a.href) return;
    var u;
    try { u = new URL(a.href, location.href); } catch (err) { return; }
    var here = location.pathname.replace(/[^\/]*$/, '');
    if (u.origin !== location.origin || u.pathname.indexOf(here) !== 0) return;
    if (!/(\.html|\/)$/.test(u.pathname)) return;
    e.preventDefault();
    location.href = u.href;
  }, true);
}

// Opens another Plume page: same window in the app, a new tab in a browser.
function openPage(url) {
  if (isInstalled()) { location.href = url; return; }
  window.open(url, '_blank', 'noopener');
}

// Settings -> Storage -> "Clear the saved app copy". Removes only the saved
// app files and the service worker; her data (localStorage) is untouched.
function resetAppCache() {
  ask('This removes the saved copy of Plume\'s files and reloads from the site. Your ingredients, formulations, batches and products are not touched.',
    function () {
      var jobs = [];
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
          jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
            return Promise.all(rs.map(function (r) { return r.unregister(); }));
          }));
        }
        if (window.caches && caches.keys) {
          jobs.push(caches.keys().then(function (ks) {
            return Promise.all(ks.filter(function (k) { return k.indexOf('plume-') === 0; })
              .map(function (k) { return caches.delete(k); }));
          }));
        }
      } catch (e) {}
      Promise.all(jobs).then(function () { location.reload(); }, function () { location.reload(); });
    }, { title: 'Clear the saved app copy?', yes: 'Clear and reload' });
}

// One line for Settings -> Storage: how Plume is running and whether the
// offline copy is ready. Filled in after the panel renders (it is async).
function renderAppStatus() {
  var el = document.getElementById('plume-app-status');
  if (!el) return;
  var mode = isInstalled() ? 'Running as an installed app.' : 'Running in a browser tab.';
  var set = function (offline) {
    el.innerHTML = esc(mode) + ' ' + esc(offline) +
      ' <button class="plume-link-btn" onclick="Plume.resetAppCache()">Clear the saved app copy</button>' +
      (isInstalled() ? '' : ' <button class="plume-link-btn plume-install" hidden onclick="Plume.install()">Install as an app</button>');
    showInstallButtons(!!installPrompt);
  };
  if (!window.caches || !caches.open || !/^https?:$/.test(location.protocol)) { set('Offline copy: not available here.'); return; }
  caches.open('plume-app-v1').then(function (c) { return c.keys(); }).then(function (keys) {
    set(keys.length ? 'Offline copy: ready.' : 'Offline copy: being saved.');
  }, function () { set('Offline copy: not available here.'); });
}

// Start-up for every page that loads core, the landing page included.
// (Guarded so the test suites that run core in a bare sandbox still load it.)
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' &&
    typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  watchInstallOffer();
  keepLinksInWindow();
  // Dark mode as early as possible (before data loads, so no light flash),
  // and kept in step with the computer, other open windows, and printing.
  applyTheme();
  try {
    var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (mq) {
      var onScheme = function () { if (themeChoice() === 'auto') { applyTheme(); renderPaletteSwatches(); } };
      if (mq.addEventListener) mq.addEventListener('change', onScheme); else if (mq.addListener) mq.addListener(onScheme);
    }
  } catch (e) {}
  window.addEventListener('storage', function (e) { if (e.key === THEME_KEY) { applyTheme(); renderPaletteSwatches(); } });
  window.addEventListener('beforeprint', function () { printing = true; applyTheme(); });
  window.addEventListener('afterprint', function () { printing = false; applyTheme(); });
  window.addEventListener('load', registerAppWorker);
}

// ══ Boot ══════════════════════════════════════════════
// The one asynchronous moment in a Plume page: hydrate, then render.
// When the driver becomes IndexedDB or an API, this is the only place
// that has to wait — everything downstream stays synchronous.
function boot(cb) {
  injectStyles();
  stampVersion();
  Store.onQuotaError(noteSaveFailed);
  Store.init(function () {
    applyPalette(loadPaletteChoice());
    if (cb) cb();
    renderStorBanner();
  });
}

// ══ Ingredient functions & lookup ═════════════════════
// The function vocabulary, once. It was hardcoded twice in
// plume-ingredients.html (the editor and the filter bar) and the cheat
// sheet will need it a third time -- same drift risk as the phase and
// product-type lists. Adding an entry is free; renaming one strands every
// ingredient that carries the old word.
var FUNCTION_CATEGORIES = [
  // 'Base / solvent' added 2026-10-17: water, hydrosols and aloe juice had no
  // function that fit and landed in "No function set" on the cheat sheet.
  'Emollient', 'Humectant', 'Base / solvent', 'Emulsifier', 'Preservative', 'Active',
  'pH Adjuster', 'Thickener', 'Solubilizer', 'Surfactant', 'Exfoliant',
  'Essential oil', 'Fragrance', 'Colorant', 'Other'
];

// functionCategory used to be ONE value, so a genuinely multipurpose
// ingredient (Sepinov: thickener AND emulsifier) vanished from every list
// but the one picked. It is now an array. Old records still hold a bare
// string, and the Formula Botanica import writes strings too, so every
// reader goes through this instead of touching the field directly.
function funcCats(ing) {
  var v = ing && ing.functionCategory;
  if (Array.isArray(v)) return v.filter(function (x) { return x && String(x).trim(); });
  if (v && String(v).trim()) return [String(v).trim()];
  return [];
}

// How well an ingredient matches a search. Lower is better; 0 is no match,
// so callers can keep treating the result as true/false. Returns:
//   1  the name STARTS with the query        ("ros" -> Rosehip seed oil)
//   2  a later word of the name starts with it ("seed" -> Rosehip seed oil)
//   3  a word of the INCI starts with it       ("shea" -> ...(Shea) Butter)
//   4  name or INCI contains it mid-word       ("na" -> Argania, Sodium)
//   5  function, function notes, secondary functions, purpose, or the
//      lowdown line (chooseWhen)
// Sort by this, then alphabetically, and typing narrows the way a person
// expects: the first letters typed decide the top of the list. Before
// 2026-10-16 bands 1-4 were one band and the Ingredients list ignored the
// rank altogether, so "na" opened on Activated charcoal (a notes match).
// Plain substring matching, deliberately: "serum" and "serums" both hit
// her purpose line with no tag vocabulary to maintain.
function ingMatchRank(ing, q) {
  if (!ing) return 0;
  q = String(q || '').toLowerCase().trim();
  if (!q) return 0;
  var low = function (x) { return x ? String(x).toLowerCase() : ''; };
  var has = function (x) { return low(x).indexOf(q) !== -1; };
  // True when q begins a word: at the start, or after anything that is not
  // a letter or digit (space, parenthesis, hyphen, slash).
  var wordStart = function (s) {
    var i = s.indexOf(q);
    while (i !== -1) {
      if (i === 0 || !/[a-z0-9]/.test(s.charAt(i - 1))) return true;
      i = s.indexOf(q, i + 1);
    }
    return false;
  };
  var name = low(ing.name), inci = low(ing.inci);
  if (name.indexOf(q) === 0) return 1;
  if (wordStart(name)) return 2;
  if (wordStart(inci)) return 3;
  if (name.indexOf(q) !== -1 || inci.indexOf(q) !== -1) return 4;
  if (funcCats(ing).some(has) || has(ing.function) || has(ing.function2) || has(ing.purpose) ||
      has(ing.chooseWhen)) return 5;
  return 0;
}


// ══ pH (added 2026-10-16) ═════════════════════════════
// Three places record pH, and they answer different questions:
//   - a version's TARGET range (Formulations, v.phMin / v.phMax), which
//     travels with the version like its method does;
//   - the usage log's STEPS (Formulations), how a test pour got there:
//     reading, what was added, next reading;
//   - a batch's FINAL pH (Batchlog), what that batch ended up at.
// Heide measures with strips for a ballpark and a meter to fine-tune, so
// every reading carries its method ('strip' | 'meter'), and a strip's "5"
// is never read back later as if it were a meter's "5.00".
//
// Readings are STORED AS THE STRING TYPED, after validation, so a meter's
// "5.20" keeps its second decimal. Compare with phNum().

// '' for blank, null for something that is not a pH, else the cleaned
// string. Accepts a comma decimal; 0-14, up to two decimals.
function parsePh(raw) {
  var s = String(raw == null ? '' : raw).trim().replace(',', '.');
  if (!s) return '';
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(s) && !/^\.\d{1,2}$/.test(s)) return null;
  var n = parseFloat(s);
  if (isNaN(n) || n < 0 || n > 14) return null;
  if (s.charAt(0) === '.') s = '0' + s;
  return s;
}

function phNum(s) {
  var p = parsePh(s);
  return (p === null || p === '') ? null : parseFloat(p);
}

// Where a reading sits against a target: 'in' | 'low' | 'high', or ''
// when there is no reading or no target to compare with. A target may be
// open on one side (min only, or max only).
function phRange(val, min, max) {
  var v = phNum(val), lo = phNum(min), hi = phNum(max);
  if (v === null || (lo === null && hi === null)) return '';
  if (lo !== null && v < lo) return 'low';
  if (hi !== null && v > hi) return 'high';
  return 'in';
}

function phTargetText(min, max) {
  var lo = parsePh(min), hi = parsePh(max);
  if (lo && hi) return lo + '–' + hi;
  if (lo) return '≥ ' + lo;
  if (hi) return '≤ ' + hi;
  return '';
}

// Does a formula have a water phase? pH only means something when there is
// water, so this decides whether pH fields appear at all -- a balm or an
// oil blend never shows them. Uses the per-line phase override first, same
// as the editor's effPhase; add-in lines sit outside the phases.
function isAqueous(lines, ings) {
  return (lines || []).some(function (l) {
    if (!l || l.addin) return false;
    var ing = findIngIn(ings, l.ingId);
    var ph = l.phase || (ing && ing.phase) || '';
    return String(ph).toLowerCase() === 'water';
  });
}

// One reading as a small pill, tinted by range when there is a target.
// Escaped throughout: method and value come from stored data.
function phBadge(val, method, min, max) {
  var p = parsePh(val);
  if (!p) return '';
  var st = phRange(p, min, max);
  var tip = st === 'in' ? 'Within the target pH' :
            st === 'low' ? 'Below the target pH (' + phTargetText(min, max) + ')' :
            st === 'high' ? 'Above the target pH (' + phTargetText(min, max) + ')' : '';
  return '<span class="ph-badge' + (st ? ' ph-' + st : '') + '"' +
    (tip ? ' title="' + esc(tip) + '"' : '') + '>pH ' + esc(p) +
    (method ? ' <span class="ph-m">' + esc(method) + '</span>' : '') +
    (st === 'low' ? ' <span class="ph-dir">low</span>' : st === 'high' ? ' <span class="ph-dir">high</span>' : '') +
    '</span>';
}

// A usage-log step sequence as one line:
//   pH 6.4 strip -> 4 drops 50% citric -> pH 5.6 meter
// Each step is { v: reading, m: method, add: what was added AFTER it }.
// The final reading is tinted against the target; earlier ones are not,
// since a starting pH outside the target is the point of adjusting.
function phStepsHtml(steps, min, max) {
  steps = (steps || []).filter(function (s) { return s && (parsePh(s.v) || (s.add && String(s.add).trim())); });
  if (!steps.length) return '';
  var lastReading = -1;
  steps.forEach(function (s, i) { if (parsePh(s.v)) lastReading = i; });
  var parts = [];
  steps.forEach(function (s, i) {
    if (parsePh(s.v)) parts.push(i === lastReading ? phBadge(s.v, s.m, min, max) : phBadge(s.v, s.m));
    if (s.add && String(s.add).trim()) parts.push('<span class="ph-add">' + esc(String(s.add).trim()) + '</span>');
  });
  // Each arrow travels with the item after it, so a wrapped line never
  // ends on a stranded arrow.
  return '<span class="ph-steps">' + parts.map(function (p, i) {
    return i ? '<span class="ph-next"><span class="ph-arrow">\u2192</span>' + p + '</span>' : p;
  }).join('') + '</span>';
}

function phFinal(steps) {
  var out = null;
  (steps || []).forEach(function (s) { if (s && parsePh(s.v)) out = s; });
  return out;
}


// ══ Product types ═════════════════════════════════════
// One list. It was duplicated across two <select> blocks in
// plume-formulations.html, and the soap test was written out a third time
// in plume-batchlog.html -- the same shape as the phase vocabulary that
// silently hid Heide's clays and exfoliants from the recipe area.
//
// THESE STRINGS ARE STORED DATA. A formulation records `f.type` as the
// display string itself, so:
//   - ADDING an entry is free.
//   - RENAMING or REMOVING one orphans every formulation that used it, and
//     needs a data migration rather than an edit here.
// The two soap strings are load-bearing beyond that: the entire soap UI
// branches on them through isSoapType. Never touch those two.
var PRODUCT_TYPES = [
  'Facial serum', 'Face cream', 'Face oil', 'Face balm', 'Eye cream',
  'Toner / mist', 'Cleanser', 'Exfoliant / scrub', 'Mask',
  'Body lotion', 'Body butter', 'Body oil', 'Lip balm',
  'Hair serum', 'Hair mask', 'Shampoo bar', 'Deodorant', 'Other',
  '---',
  'Cold Process Soap', 'Hot Process Soap'
];

function isSoapType(t) {
  return t === 'Cold Process Soap' || t === 'Hot Process Soap';
}

// Fills a <select> from PRODUCT_TYPES, preserving the current value if it
// is still in the list. A value NOT in the list (an older type, or one
// renamed out from under a formulation) is kept as an extra option rather
// than silently snapping to blank -- losing a formulation's type on open
// would be a quiet data loss.
function fillTypeSelect(el, current) {
  if (!el) return;
  var html = '<option value="">-- select --</option>';
  var found = false;
  PRODUCT_TYPES.forEach(function (t) {
    if (t === '---') { html += '<option disabled>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</option>'; return; }
    if (t === current) found = true;
    html += '<option>' + esc(t) + '</option>';
  });
  if (current && !found) {
    html += '<option disabled>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</option>';
    html += '<option>' + esc(current) + '</option>';
  }
  el.innerHTML = html;
  el.value = current || '';
}


// ══ Bench sheet ═══════════════════════════════════════
// The printable recipe card. Lives here rather than in Formulations
// because Batchlog prints the same sheet from the Make batch popup --
// two copies of this would drift the way the cost function did.
//
// Takes plain data, reads no DOM and no globals, so either module can
// call it. Formulations passes live editor values (which may be unsaved);
// Batchlog passes the stored formula.
//
// opts: { name, type, status, notes, instructions, variantTitle,
//         lines, ings, batchSize, isSoap, soapSettings }

// An empty square, sized for a dry-erase marker. Heide keeps sheets behind
// a plastic protector and ticks ingredients off as they go in, because oils
// and computers don't mix. Print colour adjust is forced on: some browsers
// drop borders on "background graphics off", and a missing box makes the
// column pointless.
var TICKBOX = '<span style="display:inline-block;width:15px;height:15px;' +
  'border:1.5px solid #333;border-radius:2px;vertical-align:middle;' +
  '-webkit-print-color-adjust:exact;print-color-adjust:exact"></span>';

var TICK_TH = '<th style="width:34px;text-align:center;padding-bottom:6px;' +
  'border-bottom:2px solid #333;font-size:11px">&#10003;</th>';

function tickTd() {
  return '<td style="text-align:center;padding:5px 0">' + TICKBOX + '</td>';
}

var SHEET_CSS =
  'body{font-family:Georgia,serif;max-width:720px;margin:40px auto;color:#222;font-size:13px;line-height:1.6}' +
  'h1{font-size:24px;font-weight:400;margin:0 0 4px}' +
  '.meta{color:#666;font-size:12px;margin-bottom:24px}' +
  'table{width:100%;border-collapse:collapse;margin-bottom:10px}td{vertical-align:top}' +
  '.sec{margin-bottom:20px}' +
  '.sec-title{font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;' +
  'color:#666;border-bottom:1px solid #ccc;padding-bottom:4px;margin-bottom:8px}' +
  '.inci{font-size:11px;color:#666;line-height:1.8}' +
  // % is a reference beside the name; Grams is what goes on the scale.
  'td.pc,th.pc{text-align:right;color:#777;font-size:11.5px;padding:5px 14px 5px 6px;white-space:nowrap;font-weight:400}' +
  'td.gr{text-align:right;font-size:15px;font-weight:700;padding:5px 10px 5px 12px;white-space:nowrap;color:#111}' +
  'th.gr{text-align:right;padding:0 10px 6px 12px}' +
  '@media print{body{margin:20px}tr{page-break-inside:avoid}}';

function findIngIn(ings, id) {
  for (var i = 0; i < (ings || []).length; i++) if (ings[i].id === id) return ings[i];
  return null;
}

function buildSoapSheet(o) {
  var ings = o.ings || [], lines = o.lines || [], bs = o.batchSize || 100;
  var s = o.soapSettings || {};
  var superfat  = parseFloat(s.superfat) || 5;
  var lyeType   = s.lyeType || 'naoh';
  var lyeLabel  = lyeType === 'koh' ? 'KOH' : 'NaOH';
  var lyeKey    = lyeType === 'koh' ? 'koh' : 'naoh';
  var kohPurity = lyeType === 'koh' ? (parseFloat(s.kohPurity) || 90) / 100 : 1;
  var lyeMethod = s.lyeMethod || 'concentration';

  var oils   = lines.filter(function (l) { return !l.soapAddin; });
  var addins = lines.filter(function (l) { return l.soapAddin; });
  var totalOilPct = oils.reduce(function (a, l) { return a + (parseFloat(l.pct) || 0); }, 0);
  var totalOilG   = totalOilPct / 100 * bs;

  var pureLye = 0;
  oils.forEach(function (l) {
    var ing = findIngIn(ings, l.ingId);
    var g   = (parseFloat(l.pct) || 0) / 100 * bs;
    if (!ing || !ing.soap || !ing.soap[lyeKey]) return;
    pureLye += g * ing.soap[lyeKey] * (1 - superfat / 100);
  });
  var actualLye = kohPurity > 0 ? pureLye / kohPurity : pureLye;

  var waterG;
  if (lyeMethod === 'concentration') {
    var lyeConc = parseFloat(s.lyeConc) || 33;
    waterG = pureLye > 0 ? pureLye * (100 - lyeConc) / lyeConc : 0;
  } else {
    var waterPct = parseFloat(s.waterPct) || 38;
    waterG = totalOilG * (waterPct / 100);
  }
  var totalBatch  = totalOilG + actualLye + waterG;
  var concActual  = (pureLye + waterG) > 0 ? (pureLye / (pureLye + waterG) * 100) : 0;
  var waterPctAct = totalOilG > 0 ? (waterG / totalOilG * 100) : 0;

  var sorted = oils.slice().sort(function (a, b) {
    return (parseFloat(b.pct) || 0) - (parseFloat(a.pct) || 0);
  });
  var rows = '';
  sorted.forEach(function (l) {
    var ing = findIngIn(ings, l.ingId); if (!ing) return;
    var pct = parseFloat(l.pct) || 0;
    var sap = ing.soap && ing.soap[lyeKey] ? ing.soap[lyeKey] : '\u2014';
    rows += '<tr><td style="padding:5px 0;font-weight:500">' + esc(ing.name) + '</td>' +
      '<td class="pc">' + pct.toFixed(2) + '%</td>' +
      '<td style="padding:5px 8px;color:#666;font-size:11px;font-style:italic">' + esc(ing.inci) + '</td>' +
      '<td style="padding:5px 8px;text-align:right;color:#888;font-size:11px">' + sap + '</td>' +
      '<td class="gr">' + (pct / 100 * bs).toFixed(1) + 'g</td>' +
      tickTd() + '</tr>';
  });
  rows += '<tr style="background:#f9f9f9"><td style="padding:5px 0;font-weight:500">' + lyeLabel +
    (lyeType === 'koh' ? ' (90% flakes)' : '') +
    ' <span style="font-size:10px;font-weight:400;color:#888">at ' + superfat + '% superfat</span></td>' +
    '<td class="pc">\u2014</td>' +
    '<td style="padding:5px 8px;color:#666;font-size:11px;font-style:italic">' +
    (lyeType === 'koh' ? 'Potassium Hydroxide' : 'Sodium Hydroxide') + '</td>' +
    '<td style="padding:5px 8px;text-align:right;color:#888;font-size:11px">\u2014</td>' +
    '<td class="gr">' + actualLye.toFixed(1) + 'g</td>' +
    tickTd() + '</tr>';
  rows += '<tr style="background:#f9f9f9"><td style="padding:5px 0;font-weight:500">Distilled water</td>' +
    '<td class="pc">\u2014</td>' +
    '<td style="padding:5px 8px;color:#666;font-size:11px;font-style:italic">Aqua</td>' +
    '<td style="padding:5px 8px;text-align:right;color:#888;font-size:11px">\u2014</td>' +
    '<td class="gr">' + waterG.toFixed(1) + 'g</td>' +
    tickTd() + '</tr>';
  rows += '<tr style="border-top:2px solid #333">' +
    '<td colspan="4" style="padding:7px 0;font-weight:600;font-size:12px">Total batch weight</td>' +
    '<td class="gr">' + totalBatch.toFixed(0) + 'g</td>' +
    '<td></td></tr>';

  var addinBlock = '';
  if (addins.length) {
    addinBlock = '<div class="sec"><div class="sec-title">Additives (not included in lye calc)</div>' +
      '<table><thead><tr>' +
      '<th style="text-align:left;padding-bottom:6px;border-bottom:2px solid #333">Additive</th>' +
      '<th class="pc" style="padding-bottom:6px;border-bottom:2px solid #333">% PPO</th>' +
      '<th style="text-align:left;padding-bottom:6px;border-bottom:2px solid #333">INCI</th>' +
      '<th class="gr" style="border-bottom:2px solid #333">Grams</th>' +
      TICK_TH + '</tr></thead><tbody>';
    addins.forEach(function (l) {
      var ing = findIngIn(ings, l.ingId); if (!ing) return;
      var g   = parseFloat(l.gramsFixed) || 0;
      var ppo = totalOilG > 0 && g > 0 ? (g / totalOilG * 100).toFixed(2) + '%' : '\u2014';
      addinBlock += '<tr><td style="padding:5px 0;font-weight:500">' + esc(ing.name) + '</td>' +
        '<td class="pc">' + ppo + '</td>' +
        '<td style="padding:5px 8px;color:#666;font-size:11px;font-style:italic">' + esc(ing.inci) + '</td>' +
        '<td class="gr">' + g.toFixed(1) + 'g</td>' +
        tickTd() + '</tr>';
    });
    addinBlock += '</tbody></table></div>';
  }

  var lyeSummary = '<div class="sec"><div class="sec-title">Lye water summary</div>' +
    '<table style="max-width:360px"><tbody>' +
    '<tr><td style="padding:4px 0;color:#555">' + lyeLabel + ' to weigh</td>' +
    '<td style="padding:4px 0;text-align:right;font-weight:600">' + actualLye.toFixed(2) + 'g</td></tr>' +
    (lyeType === 'koh' && kohPurity < 1
      ? '<tr><td style="padding:4px 0;color:#555;font-size:11px">Pure KOH needed</td>' +
        '<td style="padding:4px 0;text-align:right;font-size:11px">' + pureLye.toFixed(2) + 'g</td></tr>' : '') +
    '<tr><td style="padding:4px 0;color:#555">Distilled water</td>' +
    '<td style="padding:4px 0;text-align:right;font-weight:600">' + waterG.toFixed(2) + 'g</td></tr>' +
    '<tr><td style="padding:4px 0;color:#555;font-size:11px">Lye concentration</td>' +
    '<td style="padding:4px 0;text-align:right;font-size:11px">' + concActual.toFixed(1) + '%</td></tr>' +
    '<tr><td style="padding:4px 0;color:#555;font-size:11px">Water as % of oils</td>' +
    '<td style="padding:4px 0;text-align:right;font-size:11px">' + waterPctAct.toFixed(1) + '%</td></tr>' +
    '<tr><td style="padding:4px 0;color:#555;font-size:11px">Superfat</td>' +
    '<td style="padding:4px 0;text-align:right;font-size:11px">' + superfat + '%</td></tr>' +
    '</tbody></table>' +
    '<p style="font-size:11px;color:#888;margin-top:8px;border-top:1px solid #eee;padding-top:8px">' +
    'Always add lye to water \u2014 never water to lye. Wear gloves and eye protection.</p></div>';

  var inci = sorted.map(function (l) {
    var ing = findIngIn(ings, l.ingId); return ing ? ing.inci : '';
  }).filter(Boolean);
  addins.forEach(function (l) {
    var ing = findIngIn(ings, l.ingId); if (ing) inci.push(ing.inci);
  });

  return {
    table: '<div class="sec"><div class="sec-title">Oils &amp; lye water</div>' +
      '<table><thead><tr>' +
      '<th style="text-align:left;padding-bottom:6px;border-bottom:2px solid #333">Ingredient</th>' +
      '<th class="pc" style="padding-bottom:6px;border-bottom:2px solid #333">%</th>' +
      '<th style="text-align:left;padding-bottom:6px;border-bottom:2px solid #333">INCI</th>' +
      '<th style="text-align:right;padding-bottom:6px;border-bottom:2px solid #333">SAP</th>' +
      '<th class="gr" style="border-bottom:2px solid #333">Grams</th>' +
      TICK_TH + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      addinBlock + lyeSummary,
    inci: inci.join(', '),
    scaleLabel: 'Oil weight: ' + bs + 'g'
  };
}

function buildSkincareSheet(o) {
  var ings = o.ings || [], lines = o.lines || [], bs = o.batchSize || 100;
  var phases  = ['water', 'oil', 'cool-down', 'active', 'other'];
  var phNames = { water: 'Water phase', oil: 'Oil phase', 'cool-down': 'Cool-down phase',
                  active: 'Active phase', other: 'Other' };
  var grouped = {}; phases.forEach(function (p) { grouped[p] = []; });
  var addins  = [];

  lines.forEach(function (l) {
    if (l.addin) { addins.push(l); return; }
    var ing = findIngIn(ings, l.ingId);
    if (!ing) return;
    // Same normalisation as the editor: an unrecognised phase lands in
    // 'other' rather than being dropped from the printed sheet.
    var ph = l.phase || ing.phase || 'other';
    if (ph === 'add-in' || ph === 'addin' || phases.indexOf(ph) === -1) ph = 'other';
    grouped[ph].push({ l: l, ing: ing });
  });

  var rows = '';
  phases.forEach(function (p) {
    if (!grouped[p].length) return;
    rows += '<tr><td colspan="5" style="padding:8px 0 4px;font-size:10px;font-weight:600;' +
      'letter-spacing:0.1em;text-transform:uppercase;color:#666;border-bottom:1px solid #ccc">' +
      phNames[p] + '</td></tr>';
    grouped[p].forEach(function (r) {
      var pct = r.l.pinned
        ? (bs > 0 ? (parseFloat(r.l.gramsFixed) || 0) / bs * 100 : 0).toFixed(2)
        : (parseFloat(r.l.pct) || 0).toFixed(2);
      var g = r.l.pinned
        ? (parseFloat(r.l.gramsFixed) || 0).toFixed(2)
        : ((parseFloat(r.l.pct) || 0) / 100 * bs).toFixed(2);
      rows += '<tr><td style="padding:5px 0;font-weight:500">' + esc(r.ing.name) + '</td>' +
        '<td class="pc">' + pct + '%</td>' +
        '<td style="padding:5px 8px;color:#666;font-size:11px;font-style:italic">' + esc(r.ing.inci) + '</td>' +
        '<td class="gr">' + g + 'g</td>' +
        tickTd() + '</tr>';
    });
  });
  addins.forEach(function (l) {
    var ing = findIngIn(ings, l.ingId); if (!ing) return;
    var g  = parseFloat(l.gramsFixed) || 0;
    var dr = g > 0 ? Math.round(g * (l.dropsPerG || 20)) : 0;
    rows += '<tr><td style="padding:5px 0;font-weight:500">' + esc(ing.name) +
      ' <span style="font-size:10px;color:#888">(add-in)</span></td>' +
      '<td class="pc">\u2014</td>' +
      '<td style="padding:5px 8px;color:#666;font-size:11px;font-style:italic">' + esc(ing.inci) + '</td>' +
      '<td class="gr">' + g + 'g' + (dr ? ' <span style="font-size:11px;font-weight:400;color:#666">(~' + dr + ' drops)</span>' : '') + '</td>' +
      tickTd() + '</tr>';
  });

  var fl = lines.filter(function (l) { return !l.addin && findIngIn(ings, l.ingId); });
  fl.sort(function (a, b) { return (parseFloat(b.pct) || 0) - (parseFloat(a.pct) || 0); });

  return {
    table: '<div class="sec"><div class="sec-title">Ingredients</div>' +
      '<table><thead><tr>' +
      '<th style="text-align:left;padding-bottom:6px;border-bottom:2px solid #333">Ingredient</th>' +
      '<th class="pc" style="padding-bottom:6px;border-bottom:2px solid #333">%</th>' +
      '<th style="text-align:left;padding-bottom:6px;border-bottom:2px solid #333">INCI</th>' +
      '<th class="gr" style="border-bottom:2px solid #333">Grams</th>' +
      TICK_TH + '</tr></thead><tbody>' + rows + '</tbody></table></div>',
    inci: fl.map(function (l) { return findIngIn(ings, l.ingId).inci; }).join(', '),
    scaleLabel: 'Batch: ' + bs + 'g'
  };
}

// Blanks for the dry-erase workflow: the target (when set) and space to
// write readings and adjustments as she goes, then the final pH. Shown for
// any water-phase formula, target or not; never for soap or an anhydrous
// product. Both modules pass the same fields, so their sheets stay
// identical.
function phSheetBlock(o) {
  if (o.isSoap) return '';
  var target = phTargetText(o.phMin, o.phMax);
  if (!target && !isAqueous(o.lines, o.ings)) return '';
  var blank = '<span style="display:inline-block;min-width:70px;border-bottom:1px solid #333">&nbsp;</span>';
  var wide  = '<span style="display:inline-block;flex:1;border-bottom:1px solid #333">&nbsp;</span>';
  return '<div class="sec"><div class="sec-title"><span style="text-transform:none">pH</span></div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:6px 28px;margin-bottom:12px">' +
    '<span>Target: <strong>' + (target ? esc(target) : blank) + '</strong></span>' +
    '<span>Final: ' + blank + ' &nbsp;strip / meter</span></div>' +
    '<div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:8px">' +
    '<span style="white-space:nowrap">Readings &amp; adjustments:</span>' + wide + '</div>' +
    '<div style="display:flex;margin-bottom:4px">' + wide + '</div></div>';
}

function buildSheet(o) {
  o = o || {};
  var built  = o.isSoap ? buildSoapSheet(o) : buildSkincareSheet(o);
  var title  = (o.name || 'Formulation') + (o.variantTitle ? ' \u2014 ' + o.variantTitle : '');
  var meta   = [o.type || '', o.status || 'draft', built.scaleLabel,
                'Printed ' + fmtDate(todayISO())].filter(Boolean).join(' \u00b7 ');

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(title) +
    '</title><style>' + SHEET_CSS + '</style></head><body>' +
    '<h1>' + esc(title) + '</h1><div class="meta">' + esc(meta) + '</div>' +
    (o.notes ? '<div class="sec"><div class="sec-title">Intention</div><p>' + esc(o.notes) + '</p></div>' : '') +
    built.table +
    (o.instructions ? '<div class="sec"><div class="sec-title">' +
      (o.isSoap ? 'Process instructions' : 'Formulation instructions') +
      '</div><p style="white-space:pre-wrap">' + esc(o.instructions) + '</p></div>' : '') +
    phSheetBlock(o) +
    '<div class="sec"><div class="sec-title">INCI list (label order)</div>' +
    '<div class="inci">' + esc(built.inci) + '</div></div>' +
    '<scr' + 'ipt>window.onload=function(){window.print();};<\/scr' + 'ipt></body></html>';
}

function openSheet(o) {
  var win = window.open('', '_blank');
  if (!win) {
    tell('Allow pop-ups for this site in your browser, then try again.', { title: 'The print sheet was blocked' });
    return null;
  }
  win.document.write(buildSheet(o));
  win.document.close();
  return win;
}


// ══ INCI label lists ══════════════════════════════════
// An ingredient's INCI may name a blend. Suppliers write those three ways:
// comma-separated, "(and)"-separated, or with an ampersand.
//
// NOT split on a bare "and", deliberately: too many single INCI names
// contain the word, and a wrong split puts an invented substance on a
// label. A blend written that way lists as one entry, which is visibly
// odd and therefore fixable by editing the ingredient, rather than
// silently wrong.
//
// Parentheses are otherwise left alone, because they usually carry a
// synonym that belongs with its name: "Butyrospermum Parkii (Shea) Butter".
function inciSplit(s) {
  if (!s) return [];
  return String(s)
    .replace(/\(\s*and\s*\)/gi, ',')
    .split(/[,;]|\s&\s/)
    .map(function (x) { return x.replace(/\s+/g, ' ').trim(); })
    .filter(function (x) { return x.length > 0; });
}

// Takes the formula's lines already in label order (highest concentration
// first) and returns one entry per distinct component:
//
//   [{ name: 'Sodium Benzoate', sources: [item, item] }, ...]
//
// `sources` is every input item that contributed the component, so a caller
// can carry the restricted flag or the add-in tag across, and can tell the
// user which entries were merged.
//
// ORDERING CAVEAT, which callers should surface rather than hide: a
// component present in two blends has a true combined concentration that
// Plume cannot know, because a blend does not record its internal split.
// Keeping the first appearance places it at the position of the larger
// contributor, which is the right neighbourhood but may sit one notch low.
function inciMerge(items) {
  var out = [], seen = {};
  (items || []).forEach(function (it) {
    inciSplit(it && it.inci).forEach(function (name) {
      var key = name.toLowerCase();
      if (seen[key] !== undefined) { out[seen[key]].sources.push(it); return; }
      seen[key] = out.length;
      out.push({ name: name, sources: [it] });
    });
  });
  return out;
}

// The entries that came from more than one ingredient, for the note that
// tells the user what was merged.
function inciMerged(entries) {
  return (entries || []).filter(function (e) { return e.sources.length > 1; });
}

return {
  VERSION: VERSION,
  inciSplit: inciSplit, inciMerge: inciMerge, inciMerged: inciMerged,
  Store: Store, KEYS: KEYS, KEY_LABELS: KEY_LABELS,
  esc: esc, openModal: openModal, closeModal: closeModal,
  todayISO: todayISO, parseLocalDate: parseLocalDate, fmtDate: fmtDate, fmtBytes: fmtBytes,
  costPerG: costPerG, qtyToGrams: qtyToGrams, stockG: stockG,
  densityFor: densityFor, DENSITY_BY_INCI: DENSITY_BY_INCI, DENSITY_HINTS: DENSITY_HINTS,
  normDensityInci: normDensityInci,
  stockGOrNull: stockGOrNull, stockState: stockState,
  PALETTES: PALETTES, setModule: setModule, applyPalette: applyPalette,
  selectPalette: selectPalette, renderPaletteSwatches: renderPaletteSwatches,
  loadPaletteChoice: loadPaletteChoice, savePaletteChoice: savePaletteChoice,
  storageReport: storageReport, renderStorage: renderStorage,
  toggleStorDrill: toggleStorDrill, renderStorBanner: renderStorBanner,
  dismissStorBanner: dismissStorBanner,
  noteSaveFailed: noteSaveFailed, noteSaveOk: noteSaveOk,
  FUNCTION_CATEGORIES: FUNCTION_CATEGORIES, funcCats: funcCats, ingMatchRank: ingMatchRank,
  PRODUCT_TYPES: PRODUCT_TYPES, isSoapType: isSoapType, fillTypeSelect: fillTypeSelect,
  buildSheet: buildSheet, openSheet: openSheet, stampVersion: stampVersion,
  shell: shell, refreshShell: refreshShell, toggleSide: toggleSide, icon: icon, BRAND: BRAND,
  peek: { open: openPeek, close: closePeek, isOpen: peekIsOpen },
  isInstalled: isInstalled, install: install, openPage: openPage, resetAppCache: resetAppCache,
  setTheme: setTheme, isDark: isDark, themeChoice: themeChoice, darkValue: darkValue, applyTheme: applyTheme,
  tell: tell, ask: ask, askValue: askValue,
  parsePh: parsePh, phNum: phNum, phRange: phRange, phTargetText: phTargetText,
  isAqueous: isAqueous, phBadge: phBadge, phStepsHtml: phStepsHtml, phFinal: phFinal,
  boot: boot
};
})();

/* ── Global aliases ────────────────────────────────────
   Module code already calls these by name, and inline HTML onclick=""
   handlers resolve against the global scope. Aliasing here means a module
   converts by DELETING its local copies — no call sites change.

   bestCpg / ingCostPerG were two names for the same idea in different
   modules. Both now route to the one implementation, which is the whole
   point: they can no longer disagree.                                  */
var Store       = Plume.Store;
var PALETTES    = Plume.PALETTES;

function esc(s)                 { return Plume.esc(s); }
function openModal(id)          { return Plume.openModal(id); }
function closeModal(id)         { return Plume.closeModal(id); }
function todayISO()             { return Plume.todayISO(); }
function fmtDate(s, o)          { return Plume.fmtDate(s, o); }

function bestCpg(ing)           { return Plume.costPerG(ing); }
function ingCostPerG(ing)       { return Plume.costPerG(ing); }
function lotQtyToG(q, u, d)     { return Plume.qtyToGrams(q, u, d); }
function lotQtyToGrams(q, u, d) { return Plume.qtyToGrams(q, u, d); }
function calcIngStockG(ing)     { return Plume.stockGOrNull(ing); }
function stockG(ing)            { return Plume.stockG(ing); }
function stockState(ing, need)  { return Plume.stockState(ing, need); }
function fmtKB(b)               { return Plume.fmtBytes(b); }

function applyPalette(n)        { return Plume.applyPalette(n); }
function selectPalette(n)       { return Plume.selectPalette(n); }
function renderPaletteSwatches(){ return Plume.renderPaletteSwatches(); }
function loadPaletteChoice()    { return Plume.loadPaletteChoice(); }
function savePaletteChoice(n)   { return Plume.savePaletteChoice(n); }
