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
var VERSION = '1.50';

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
    },
    // One key as it is NOW in storage, which another window may have
    // changed since this page loaded. Optional for a driver.
    peek: function (k) {
      try { return localStorage.getItem(k); } catch (e) { return null; }
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

  // Re-read one key from storage into the cache, for data another window
  // may have written since boot (2026-10-20: the log reads batches made in
  // another window). A driver without peek keeps the cached copy.
  function refresh(key) {
    if (!DRIVER.peek) return;
    var v = DRIVER.peek(key);
    if (v === null || v === undefined) delete mem[key]; else mem[key] = String(v);
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
    remove: remove, refresh: refresh, keys: keys, bytes: bytes, totalBytes: totalBytes,
    useDriver: useDriver,
    onQuotaError: function (fn) { quotaFn = fn; },
    isReady:      function () { return ready; },
    driverName:   function () { return DRIVER.name; }
  };
})();

// ══ Saving a shared list without undoing another window (2026-10-24) ══
// Pages hold a list (ingredients, say) in memory and used to save it whole.
// A tab opened before a batch was made in another window would then write
// its old list back: a stock solution's new ingredient vanished, and stock
// a batch had taken came back. trackList remembers each record as this page
// last read or wrote it; saveList re-reads storage and writes back only the
// records this page changed, added or deleted, keeping everything another
// window did in the meantime. Two windows changing the SAME record: this
// page's copy wins, as before. A key never tracked saves whole, as before.
var listBase = {};
function recId(r) { return r && r.id != null ? String(r.id) : null; }
function trackList(key, arr) {
  var base = {};
  (arr || []).forEach(function (r) { var id = recId(r); if (id !== null) base[id] = JSON.stringify(r); });
  listBase[key] = base;
}
function mergeList(fresh, mem, base) {
  var memById = {}, used = {}, out = [];
  // First record per id; a second record with the same id (an import that
  // reused one) is kept as its own record below, never merged away.
  mem.forEach(function (r) { var id = recId(r); if (id !== null && !memById[id]) memById[id] = r; });
  fresh.forEach(function (f) {
    var id = recId(f);
    if (id === null) return;
    var m = memById[id];
    if (m) {
      used[id] = true;
      var mine = JSON.stringify(m), was = base[id];
      // Unchanged here and changed elsewhere: take theirs. Otherwise ours
      // (keeping our object, so references held by the page stay live).
      out.push((was !== undefined && mine === was && JSON.stringify(f) !== was) ? f : m);
    } else if (base[id] === undefined) {
      out.push(f);                      // added in another window
    }                                   // else: deleted on this page
  });
  mem.forEach(function (m) {
    var id = recId(m);
    if (id !== null && used[id] && memById[id] === m) return;
    if (id !== null && memById[id] !== m) { out.push(m); return; }
    // Not in storage: new on this page, or deleted elsewhere. Keep it unless
    // it was deleted elsewhere and this page never touched it.
    if (id !== null && base[id] !== undefined && JSON.stringify(m) === base[id]) return;
    out.push(m);
  });
  return out;
}
function saveList(key, arr) {
  var base = listBase[key];
  var out = arr;
  if (base) {
    Store.refresh(key);
    var fresh = Store.getJSON(key, []);
    out = mergeList(Array.isArray(fresh) ? fresh : [], arr || [], base);
  }
  if (!Store.setJSON(key, out)) return null;
  trackList(key, out);
  return out;
}

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
  shops:    'plume-shops-v1',
  brands:   'aerie-brands-v1'
};

var KEY_LABELS = {
  'aerie-ingredients-v2':  'Ingredients',
  'aerie-suppliers-v1':    'Suppliers',
  'plume-shops-v1':        'Consignment shops',
  'aerie-brands-v1':       'Brands',
  'aerie-formulations-v1': 'Formulations',
  'aerie-packaging-v2':    'Packaging (incl. photos)',
  'aerie-batches-v1':      'Batches',
  'plume-products-v1':     'Products & costing',
  'plume-linesheet-v1':    'Line sheet (the last one made)',
  'plume-track-pkg':       'Setting: track packaging stock',
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
// Made in-house or free (2026-10-20, her call): an ingredient she makes
// herself (a hydrosol, a hyaluronic acid solution) may have no price she can
// put on it, and that must not hold anything up. With noCost set and no
// priced lot, it counts as $0 on purpose, so nothing flags it as missing.
// A priced lot still wins.
function costPerG(ing) {
  var c = costPerGFromLots(ing);
  // A stock solution she makes here is priced by its batches: once a batch
  // prices it, the free flag no longer applies (a batch with an unpriced
  // part stays unpriced, rather than quietly $0). A batch made only from
  // free things is $0. Stock she had before it was a stock solution keeps
  // the flag until its first batch.
  if (c === null && ing && ing.madeBy) {
    var al = (ing.lots || []).filter(function (l) { return l.id === ing.activeLotId; })[0];
    if (al && al.madeBatchId) return al.madeCost === 0 ? 0 : null;
  }
  return (c === null && ing && ing.noCost) ? 0 : c;
}
// The lot in use, by the same cascade as cost: the designated active lot,
// else the cheapest priced purchased lot, else the first purchased one.
// Labels read certifications from it (2026-10-24).
function activeLot(ing) {
  var lots = ((ing && ing.lots) || []).filter(function (l) { return !l.referenceOnly; });
  if (!lots.length) return null;
  if (ing.activeLotId) { var m = lots.filter(function (l) { return l.id === ing.activeLotId; })[0]; if (m) return m; }
  var priced = lots.filter(function (l) { var c = parseFloat(l.costPerG); return !isNaN(c) && c > 0; });
  if (!priced.length) return lots[0];
  priced.sort(function (a, b) { return parseFloat(a.costPerG) - parseFloat(b.costPerG); });
  return priced[0];
}
function costPerGFromLots(ing) {
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
// On order (2026-10-25, her ask): a lot paid for but not here yet. It is
// never stock (no batch can draw on it, nothing counts it as on hand), but
// it is priced like any purchase, and Formulations shows it as coming, so
// she can build the library and plan formulations before the parcel lands.
// Marking it arrived (received, with the date) makes it ordinary stock.
function lotHere(l) { return !!l && !l.referenceOnly && !l.onOrder; }
function onOrderG(ing) {
  if (!ing || !ing.lots) return 0;
  var total = 0;
  ing.lots.forEach(function (l) {
    if (!l || l.referenceOnly || !l.onOrder) return;
    var qty  = l.qtyPurchased || l.stock || '';
    var unit = l.qtyUnit      || l.stockUnit || 'g';
    if (qty) total += qtyToGrams(qty, unit, densityFor(ing).value);
  });
  return total;
}
function stockG(ing) {
  if (!ing || !ing.lots || !ing.lots.length) return 0;
  var total = 0;
  ing.lots.forEach(function (l) {
    if (!lotHere(l)) return;
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
    if (!lotHere(l)) return;
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
    // Most modules wrap the swatches in a div of their own; Products &
    // Costing puts them straight in the dialog, where inserting before the
    // wrapper put these choices outside the dialog (fixed 2026-10-20).
    if (host.classList && host.classList.contains('modal')) host.insertBefore(el, container);
    else host.parentNode.insertBefore(el, host);
  }
  var c = themeChoice();
  var opt = function (v, label) {
    return '<button type="button" class="plume-theme-opt' + (c === v ? ' on' : '') + '" onclick="Plume.setTheme(\'' + v + '\')">' + label + '</button>';
  };
  var on = tipsOn(), sz = sizeChoice();
  nextCss();
  var szOpt = function (v, label) {
    return '<button type="button" class="plume-theme-opt' + (sz === v ? ' on' : '') + '" onclick="Plume.setSize(\'' + v + '\')">' + label + '</button>';
  };
  el.innerHTML = '<div class="plume-theme-row">' + opt('light', 'Light') + opt('dark', 'Dark') + opt('auto', 'Match my computer') + '</div>' +
    '<div class="plume-theme-note">Light or dark applies to every module on this device, and so does the palette below.</div>' +
    '<div class="plume-set-lbl">Size</div><div class="plume-theme-row">' +
      szOpt('smaller', 'Smaller') + szOpt('standard', 'Standard') + szOpt('larger', 'Larger') + '</div>' +
    '<div class="plume-theme-note">For every page on this device. If your browser is zoomed in or out for Plume, set it back to 100%.</div>' +
    '<div class="plume-set-lbl">What\u2019s next pointers</div><div class="plume-theme-row">' +
      '<button type="button" class="plume-theme-opt' + (on ? ' on' : '') + '" onclick="Plume.setTips(true)">Show</button>' +
      '<button type="button" class="plume-theme-opt' + (on ? '' : ' on') + '" onclick="Plume.setTips(false)">Hide</button></div>' +
    '<div class="plume-theme-note">Short notes that point to the next step where it is not done yet.</div>' +
    '<div class="plume-set-lbl">Packaging stock</div><div class="plume-theme-row">' +
      '<button type="button" class="plume-theme-opt' + (pkgTracked() ? ' on' : '') + '" onclick="Plume.setPkgTracking(true)">Track it</button>' +
      '<button type="button" class="plume-theme-opt' + (pkgTracked() ? '' : ' on') + '" onclick="Plume.setPkgTracking(false)">Don\u2019t track</button></div>' +
    '<div class="plume-theme-note">When tracked, each fill takes its packaging from stock, and stops if stock is short. Turn it off if you don\u2019t enter packaging purchases.</div>';
}

// ══ Size (2026-10-20) ═════════════════════════════════
// One scale for the whole app, chosen in Settings and kept on this device.
// Plume sizes things in fixed pixels, so the scale is CSS zoom on the root.
// Standard is the original size (her call, 2026-10-20, after finding her
// side screen was the cause); Smaller is what she saw at 80% browser zoom;
// Larger is for anyone who wants it bigger, readers included. Chrome
// reports element boxes in zoomed pixels while positions set in CSS are
// zoomed again, so code that places a pop-up from a box divides by zoom()
// (core's packaging picker, Formulations' phase menu and ingredient list).
var SIZE_KEY = 'plume-size';
var SIZES = { smaller: 0.8, standard: 1, larger: 1.15 };
function sizeChoice() {
  try { var v = window.localStorage.getItem(SIZE_KEY); return SIZES[v] ? v : 'standard'; } catch (e) { return 'standard'; }
}
function zoom() { return SIZES[sizeChoice()] || 1; }
function applySize() {
  if (typeof document === 'undefined' || !document.documentElement) return;
  var z = zoom();
  document.documentElement.style.zoom = z === 1 ? '' : String(z);
}
function setSize(v) {
  try { window.localStorage.setItem(SIZE_KEY, SIZES[v] ? v : 'standard'); } catch (e) {}
  applySize();
  renderPaletteSwatches();
}
applySize();

// ══ What's next pointers (2026-10-20) ═════════════════
// A short note where the next step of the work is not done yet: an empty
// module, a formulation never made, a batch with no products, a product
// with no packaging list or no batch. Each goes away once that step is
// done. Heide's aim: the order of the work is clear without a course, for
// her and for Formula Finch buyers. Settings can turn them all off on this
// device ('plume-tips' = 'off'); then the page shows its plain fallback.
var TIPS_KEY = 'plume-tips';
function tipsOn() {
  try { return window.localStorage.getItem(TIPS_KEY) !== 'off'; } catch (e) { return true; }
}
function applyTips() {
  if (typeof document === 'undefined' || !document.documentElement) return;
  document.documentElement.classList.toggle('plume-no-tips', !tipsOn());
}
function setTips(on) {
  try { window.localStorage.setItem(TIPS_KEY, on ? 'on' : 'off'); } catch (e) {}
  applyTips();
  renderPaletteSwatches();
}
// Track packaging stock (2026-10-20): on unless turned off in Settings.
// Off is for someone who uses Plume without entering packaging purchases:
// fills then count units and grams, and never check or take packaging
// stock. Kept in Store, so it travels with a backup.
var TRACK_PKG_KEY = 'plume-track-pkg';
function pkgTracked() { return Store.get(TRACK_PKG_KEY) !== 'off'; }
function setPkgTracking(on) {
  Store.set(TRACK_PKG_KEY, on ? 'on' : 'off');
  renderPaletteSwatches();
  try { window.dispatchEvent(new Event('plume-settings')); } catch (e) {}
}

function nextCss() {
  if (document.getElementById('plume-next-css')) return;
  var css =
    '.next-step{display:flex;align-items:center;gap:12px;flex-wrap:wrap;border:1.5px dashed color-mix(in srgb,var(--bark) 45%,var(--cream-border));background:color-mix(in srgb,var(--bark) 6%,var(--white));border-radius:11px;padding:10px 14px;font-size:14px;line-height:1.5;color:var(--ink-light);text-align:left;font-family:\'DM Sans\',sans-serif}' +
    '.next-step .ns-ico{width:30px;height:30px;border-radius:8px;background:var(--white);display:grid;place-items:center;color:var(--bark);flex:none;box-shadow:0 1px 2px rgba(20,20,15,.08)}' +
    '.next-step .ns-ico .ps-i{width:18px;height:18px}' +
    '.next-step b{color:var(--ink);font-weight:600}' +
    '.next-step .ns-t{flex:1 1 260px;min-width:0}' +
    '.next-step .ns-go{font:inherit;font-size:13.5px;font-weight:500;border:0;background:var(--bark);color:var(--white);border-radius:7px;padding:6px 12px;cursor:pointer;white-space:nowrap;text-decoration:none;display:inline-block}' +
    '.next-step .ns-go:hover{filter:brightness(1.06)}' +
    'html.plume-no-tips .next-step{display:none}' +
    '.next-off{display:none}' +
    'html.plume-no-tips .next-off{display:block}' +
    '.plume-set-lbl{font-size:12.5px;font-weight:500;color:var(--ink-light);margin:16px 0 6px}';
  var s = document.createElement('style');
  s.id = 'plume-next-css';
  s.textContent = css;
  document.head.appendChild(s);
}
// o: { icon, title, text, go, href | onclick, off }. title and text are
// trusted HTML from the module; off is the plain line shown when the
// pointers are turned off (optional).
function nextStep(o) {
  nextCss();
  applyTips();
  var go = '';
  if (o.go) {
    go = o.href
      ? '<a class="ns-go" href="' + esc(o.href) + '">' + esc(o.go) + ' &rsaquo;</a>'
      : '<button type="button" class="ns-go" onclick="' + esc(o.onclick || '') + '">' + esc(o.go) + ' &rsaquo;</button>';
  }
  return '<div class="next-step"><span class="ns-ico">' + icon(o.icon || 'sparkle') + '</span><span class="ns-t">' +
    (o.title ? '<b>' + o.title + '</b> ' : '') + (o.text || '') + '</span>' + go + '</div>' +
    (o.off ? '<div class="next-off">' + o.off + '</div>' : '');
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
// In the order of the work (2026-10-20): the supplies, then design the
// formulation, make a batch, and set up and fill the products. The start
// page keeps this order. In the sidebar the supplies (lib: true) sit under
// Library with Suppliers, below the work itself (Heide, 2026-10-20).
var SHELL_MODULES = [
  { key: 'ingredients',  label: 'Ingredients',        href: 'plume-ingredients.html',  icon: 'ingredients', lib: true,
    count: function () { return countOf('aerie-ingredients-v2', notArchived); } },
  { key: 'packaging',    label: 'Packaging',          href: 'plume-packaging.html',    icon: 'packaging', lib: true,
    count: function () { return countOf('aerie-packaging-v2', notArchived); } },
  { key: 'formulations', label: 'Formulations',       href: 'plume-formulations.html', icon: 'formulations',
    count: function () { return countOf('aerie-formulations-v1', notArchived); } },
  { key: 'batchlog',     label: 'Batches',            href: 'plume-batchlog.html',     icon: 'batches',
    count: function () { return countOf('aerie-batches-v1'); } },
  { key: 'costing',      label: 'Products & Costing', href: 'plume-costing.html',      icon: 'costing',
    count: function () { return countOf('plume-products-v1', notArchived); } }
];

// Line icons. The five module icons are the landing page's drawings.
var ICONS = {
  ingredients:  ['0 0 48 48', '<path d="M24 42 L24 14"/><path d="M24 22 C 18 22, 14 18, 14 12 C 20 12, 24 16, 24 22 Z"/><path d="M24 30 C 30 30, 34 26, 34 20 C 28 20, 24 24, 24 30 Z"/><path d="M24 36 C 18 36, 14 32, 14 26 C 20 26, 24 30, 24 36 Z"/>'],
  formulations: ['0 0 48 48', '<path d="M10 22 L 38 22 L 34 38 Q 24 42, 14 38 Z"/><path d="M14 22 Q 24 18, 34 22"/><path d="M28 22 L 36 8"/><circle cx="36" cy="8" r="2.5"/>'],
  packaging:    ['0 0 48 48', '<path d="M20 8 L 28 8 L 28 14 L 32 18 L 32 40 Q 24 43, 16 40 L 16 18 L 20 14 Z"/><path d="M19 26 L 29 26"/>'],
  costing:      ['0 0 48 48', '<path d="M24 10 L 24 38"/><path d="M16 38 L 32 38"/><path d="M10 18 L 24 14 L 38 18"/><path d="M6 26 Q 10 18, 14 26 Q 10 30, 6 26 Z"/><path d="M34 26 Q 38 18, 42 26 Q 38 30, 34 26 Z"/>'],
  batches:      ['0 0 48 48', '<path d="M10 28 L 10 42 L 22 42 L 22 28"/><path d="M12 24 L 20 24 L 20 28 L 12 28 Z"/><path d="M26 14 L 26 28 L 38 28 L 38 14"/><path d="M28 10 L 36 10 L 36 14 L 28 14 Z"/><path d="M26 30 L 38 30 L 38 42 L 26 42 Z"/>'],
  history:      ['0 0 24 24', '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/>'],
  shop:         ['0 0 24 24', '<path d="M4 10v10h16V10"/><path d="M3 10 5 4h14l2 6"/><path d="M3 10c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3"/><path d="M10 20v-5h4v5"/>'],
  stock:        ['0 0 24 24', '<path d="M4 8h16v12H4z"/><path d="M7 8V5h10v3"/><path d="m9 14 2 2 4-4"/>'],
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
  external:     ['0 0 24 24', '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'],
  chevron:      ['0 0 24 24', '<path d="M6 9l6 6 6-6"/>']
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
  var link = function (m) {
    var on = m.key === shellOpts.module;
    return '<a class="ps-nav' + (on ? ' on' : '') + '" href="' + m.href + '" target="plume-' + m.key + '"' +
      (on ? ' aria-current="page"' : '') + ' title="' + esc(m.label) + '">' + icon(m.icon) +
      '<span class="ps-nav-label">' + esc(m.label) + '</span><span class="ps-ct" data-ct="' + m.key + '"></span></a>';
  };
  var nav = SHELL_MODULES.filter(function (m) { return !m.lib; }).map(link).join('');
  var lib = SHELL_MODULES.filter(function (m) { return m.lib; }).map(link).join('');
  var html =
    '<aside class="ps-side" id="ps-side" aria-label="Modules">' +
      '<div class="ps-ws">' +
        '<a class="ps-ws-link" href="index.html" title="Home">' +
          '<span class="ps-ws-mark">' + esc(BRAND.mark) + '</span>' +
          '<span class="ps-ws-text"><span class="ps-ws-name">' + esc(BRAND.name) + '</span><span class="ps-ws-sub">' + esc(BRAND.sub) + '</span></span>' +
        '</a>' +
        '<button type="button" class="ps-icon-btn ps-collapse" onclick="Plume.toggleSide()" title="Collapse or expand the sidebar" aria-label="Collapse or expand the sidebar">' + icon('collapse', 'ps-when-open') + icon('expand', 'ps-when-closed') + '</button>' +
      '</div>' +
      // Order (her call, 2026-10-20): Library, Actions, Stock.
      '<div class="ps-nav-h">Library</div>' +
      '<nav class="ps-nav-list" aria-label="Library">' + lib +
        '<button type="button" class="ps-nav" id="ps-nav-suppliers" onclick="Plume.suppliers.open()" title="Suppliers">' + icon('suppliers') + '<span class="ps-nav-label">Suppliers</span><span class="ps-ct" data-ct="suppliers"></span></button>' +
      '</nav>' +
      '<div class="ps-nav-h">Actions</div>' +
      '<nav class="ps-nav-list" aria-label="Actions">' + nav + '</nav>' +
      // Stock (2026-10-20): quick tasks from any page, as slide-in panels.
      '<div class="ps-nav-h">Stock</div>' +
      '<nav class="ps-nav-list" aria-label="Stock">' +
        '<button type="button" class="ps-nav" id="ps-nav-stock" onclick="Plume.stock.open()" title="Sold, gifted, marketing, damaged, returned, or reconcile to a count">' + icon('stock') + '<span class="ps-nav-label">Update stock</span></button>' +
        '<button type="button" class="ps-nav" id="ps-nav-history" onclick="Plume.stock.history()" title="Where your stock went: by market or event, month or product, and what it cost">' + icon('history') + '<span class="ps-nav-label">Stock history</span></button>' +
      '</nav>' +
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

// ── Suppliers: a slide-in panel on every page (2026-10-20) ─────────────
// It used to be a modal that only Ingredients had; every other page linked
// over there to open it. Saved suppliers are still {id, name, webLink,
// notes} under aerie-suppliers-v1. Ingredient lots and packaging items name
// their supplier as plain text (l.supplier, item.supplier), so "what it
// supplies" is matched by name, ignoring case and spacing.
var SUP_KEY = 'aerie-suppliers-v1';
var supEditId = null;   // a supplier's id while editing it, 'new' for a new one
var supDraft = null;    // a name to prefill when saving one found on lots
var supQuery = '';
var libListeners = [];
// Modules that hold ingredients or packaging in memory register here, so a
// rename made from the panel reaches what they will save next.
// Links into a page that is ALREADY OPEN in its own tab (2026-10-20). Module
// links open in named windows (target="plume-costing"), so when that tab is
// open a link like plume-costing.html#lot=<id> only changes its hash, which
// loads nothing: the tab came forward showing whatever it showed, and the
// lot sticker, fill, log entry or batch never opened. Every page now
// reloads on a new hash, so a link behaves as it does in a fresh tab, with
// fresh data. opts.save() runs first (a page that saves as it goes);
// opts.dirty() asks first when something is not saved. The hash is cleared
// while asking, so staying and clicking the same link again still works.
function followLinks(opts) {
  opts = opts || {};
  window.addEventListener('hashchange', function () {
    var h = location.hash;
    if (!h || h === '#') return;
    var target = location.pathname + location.search + h;
    var go = function () {
      try { history.replaceState(null, '', target); } catch (e) {}
      location.reload();
    };
    if (opts.save) { try { opts.save(); } catch (e) {} }
    if (opts.dirty && opts.dirty()) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
      ask('This page has changes that are not saved. Follow the link and lose them?', go,
        { title: 'Leave unsaved changes?', yes: 'Follow the link', no: 'Stay here', danger: true });
      return;
    }
    go();
  });
}

function onLibraryChange(fn) { if (typeof fn === 'function') libListeners.push(fn); }
function libChanged() { libListeners.forEach(function (fn) { try { fn(); } catch (e) {} }); refreshShell(); }

function supAll() { var l = Store.getJSON(SUP_KEY, []); return Array.isArray(l) ? l : []; }
function supNorm(n) { return String(n == null ? '' : n).replace(/\s+/g, ' ').trim().toLowerCase(); }
// Letters and digits only: "Lotion Crafter" and "Lotioncrafter" squash alike.
function supSquash(n) { return supNorm(n).replace(/[^a-z0-9]/g, ''); }
function supHref(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}
function supHost(u) {
  return String(u || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '');
}
// name (normalised) -> { name: as first written, ings: [names], pkgs: [names] }
function supUsage() {
  var map = {};
  var add = function (name, kind, what) {
    var k = supNorm(name);
    if (!k) return;
    if (!map[k]) map[k] = { name: String(name).trim(), ings: [], pkgs: [] };
    if (map[k][kind].indexOf(what) === -1) map[k][kind].push(what);
  };
  (Store.getJSON('aerie-ingredients-v2', []) || []).forEach(function (i) {
    if (!i || i.archived) return;
    (i.lots || []).forEach(function (l) { if (l) add(l.supplier, 'ings', i.name || 'Unnamed'); });
    if (!(i.lots || []).length && i.supplier) add(i.supplier, 'ings', i.name || 'Unnamed');
  });
  (Store.getJSON('aerie-packaging-v2', []) || []).forEach(function (it) {
    if (!it || it.archived) return;
    add(it.supplier, 'pkgs', pkDisplay(it));
  });
  return map;
}
function supUseText(u) {
  if (!u || (!u.ings.length && !u.pkgs.length)) return '';
  var parts = [];
  if (u.ings.length) parts.push(u.ings.length + ' ingredient' + (u.ings.length === 1 ? '' : 's'));
  if (u.pkgs.length) parts.push(u.pkgs.length + ' packaging item' + (u.pkgs.length === 1 ? '' : 's'));
  return parts.join(' · ');
}
function supUseTitle(u) {
  if (!u) return '';
  return u.ings.concat(u.pkgs).slice().sort().join(', ');
}

function supFormHtml(s, u) {
  var isNew = !s;
  s = s || { name: supDraft || '', webLink: '', notes: '' };
  return '<div class="sup-form" id="sup-form">' +
    '<div class="sup-form-h">' + (isNew ? 'New supplier' : 'Edit supplier') + '</div>' +
    '<label class="sup-f"><span>Name</span><input type="text" id="sup-name" value="' + esc(s.name || '') + '" placeholder="e.g. Lotioncrafter" autocomplete="off"' +
      (u ? ' data-was="' + esc(s.name) + '" oninput="Plume.suppliers.nameTyped(this)"' : '') + '></label>' +
    // Lots and items name a supplier as text, so a rename can follow it there.
    (u ? '<label class="sup-rename" id="sup-rename" hidden><input type="checkbox" id="sup-rename-on" checked> Also rename it on your lots and items (' + esc(supUseText(u)) + ')</label>' : '') +
    '<label class="sup-f"><span>Website</span><input type="text" id="sup-web" value="' + esc(s.webLink || '') + '" placeholder="lotioncrafter.com" autocomplete="off"></label>' +
    '<label class="sup-f"><span>Notes</span><textarea id="sup-notes" rows="2" placeholder="e.g. Good for bulk oils, ships fast">' + esc(s.notes || '') + '</textarea></label>' +
    '<div class="sup-err" id="sup-err"></div>' +
    '<div class="sup-form-btns">' +
      (isNew ? '' : '<button type="button" class="sup-del" onclick="Plume.suppliers.remove(\'' + esc(s.id) + '\')">Delete</button>') +
      '<span class="ps-grow"></span>' +
      '<button type="button" class="ps-link-btn" onclick="Plume.suppliers.cancel()">Cancel</button>' +
      '<button type="button" class="ps-btn-primary" onclick="Plume.suppliers.save()">Save</button>' +
    '</div></div>';
}

function supRowHtml(s, u) {
  var use = supUseText(u);
  var href = supHref(s.webLink);
  return '<div class="sup-row" role="button" tabindex="0" data-sup="' + esc(s.id) + '" title="Click to edit"' +
      ' onclick="Plume.suppliers.edit(\'' + esc(s.id) + '\')" onkeydown="if(event.key===\'Enter\'){Plume.suppliers.edit(\'' + esc(s.id) + '\')}">' +
    '<div class="sup-top"><span class="sup-name">' + esc(s.name) + '</span>' +
      (href ? '<a class="sup-web" href="' + esc(href) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' + esc(supHost(s.webLink)) + ' ↗</a>' : '') +
    '</div>' +
    (s.notes ? '<div class="sup-notes">' + esc(s.notes) + '</div>' : '') +
    '<div class="sup-use' + (use ? '' : ' none') + '"' + (use ? ' title="' + esc(supUseTitle(u)) + '"' : '') + '>' +
      (use ? esc(use) : 'Not on any lot or packaging item yet') + '</div>' +
  '</div>';
}

function supBodyHtml() {
  var list = supAll().slice().sort(function (a, b) { return supNorm(a.name).localeCompare(supNorm(b.name)); });
  var usage = supUsage();
  var q = supNorm(supQuery);
  var shown = list.filter(function (s) {
    return !q || supNorm(s.name).indexOf(q) !== -1 || supNorm(s.notes).indexOf(q) !== -1 || supNorm(s.webLink).indexOf(q) !== -1;
  });
  var html = '<div class="sup-head"><div class="sup-title">' + icon('suppliers') + '<h2>Suppliers</h2></div>' +
    '<p class="sup-intro">Saved suppliers are offered when you record an ingredient lot or a packaging item.</p></div>';
  html += '<div class="sup-tools">' +
    (list.length > 6 ? '<label class="ps-search sup-search">' + icon('search') + '<input type="search" id="sup-q" placeholder="Search suppliers" value="' + esc(supQuery) + '" oninput="Plume.suppliers.search(this.value)" aria-label="Search suppliers"></label>' : '<span class="ps-grow"></span>') +
    (supEditId === 'new' ? '' : '<button type="button" class="ps-btn-primary" onclick="Plume.suppliers.add()">' + icon('plus') + 'New supplier</button>') +
  '</div>';
  if (supEditId === 'new') html += supFormHtml(null);
  if (!list.length && supEditId !== 'new') {
    html += '<div class="sup-empty">No suppliers saved yet.</div>';
  } else if (!shown.length && supEditId !== 'new') {
    html += '<div class="sup-empty">No supplier matches “' + esc(supQuery) + '”.</div>';
  }
  html += '<div class="sup-list">' + shown.map(function (s) {
    if (supEditId === s.id) return supFormHtml(s, usage[supNorm(s.name)]);
    return supRowHtml(s, usage[supNorm(s.name)]);
  }).join('') + '</div>';

  // Names typed on lots or packaging items that are not saved here.
  var saved = {};
  list.forEach(function (s) { saved[supNorm(s.name)] = true; });
  var loose = Object.keys(usage).filter(function (k) { return !saved[k]; })
    .map(function (k) { return usage[k]; })
    .sort(function (a, b) { return supNorm(a.name).localeCompare(supNorm(b.name)); });
  // A spelling of a saved supplier ("Lotion Crafter" for "Lotioncrafter")
  // gets a one-click match instead of a second supplier.
  var bySquash = {};
  list.forEach(function (s) { bySquash[supSquash(s.name)] = s; });
  if (loose.length && !q) {
    html += '<div class="sup-loose"><div class="sup-loose-h">Named on your lots and items, not saved here</div>' +
      loose.map(function (u) {
        var twin = bySquash[supSquash(u.name)];
        return '<div class="sup-loose-row"><span class="sup-loose-name">' + esc(u.name) + '</span>' +
          '<span class="sup-use" title="' + esc(supUseTitle(u)) + '">' + esc(supUseText(u)) + '</span>' +
          (twin
            ? '<button type="button" class="ps-link-btn" title="Rename it on those lots and items to ' + esc(twin.name) + '" onclick="Plume.suppliers.match(' + esc(JSON.stringify(u.name)) + ',\'' + esc(twin.id) + '\')">Same as ' + esc(twin.name) + '</button>'
            : '<button type="button" class="ps-link-btn" onclick="Plume.suppliers.add(' + esc(JSON.stringify(u.name)) + ')">Save</button>') +
          '</div>';
      }).join('') + '</div>';
  }
  return html;
}

function supRender() {
  var body = document.getElementById('ps-peek-body');
  if (!body || !supOpen()) return;
  body.innerHTML = supBodyHtml();
  var f = document.getElementById('sup-name');
  if (f && !f.value) f.focus();
}
function supOpen() { return peekIsOpen() && document.getElementById('ps-peek').getAttribute('data-panel') === 'suppliers'; }

function openSuppliers() {
  supEditId = null; supDraft = null; supQuery = '';
  openPeek(supBodyHtml(), {
    label: 'Library',
    onClose: function () {
      var p = document.getElementById('ps-peek');
      if (p) p.removeAttribute('data-panel');
      supEditId = null;
      var b = document.getElementById('ps-nav-suppliers');
      if (b) b.classList.remove('on');
    }
  });
  document.getElementById('ps-peek').setAttribute('data-panel', 'suppliers');
  var b = document.getElementById('ps-nav-suppliers');
  if (b) b.classList.add('on');
}
function supAdd(name) { supEditId = 'new'; supDraft = name || null; supRender(); var f = document.getElementById('sup-name'); if (f) f.focus(); }
function supEdit(id) { supEditId = id; supDraft = null; supRender(); var f = document.getElementById('sup-name'); if (f) { f.focus(); f.select(); } }
function supCancel() { supEditId = null; supDraft = null; supRender(); }
function supSearch(v) {
  supQuery = v;
  supRender();
  var q = document.getElementById('sup-q');
  if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}

// Rename the supplier on every lot and packaging item that names it.
function supRenameEverywhere(oldName, newName) {
  var k = supNorm(oldName), n = 0;
  var ings = Store.getJSON('aerie-ingredients-v2', []) || [];
  ings.forEach(function (i) {
    (i.lots || []).forEach(function (l) { if (l && supNorm(l.supplier) === k) { l.supplier = newName; n++; } });
    if (supNorm(i.supplier) === k) { i.supplier = newName; n++; }
  });
  var pk = Store.getJSON('aerie-packaging-v2', []) || [];
  pk.forEach(function (it) { if (it && supNorm(it.supplier) === k) { it.supplier = newName; n++; } });
  var ok = Store.setJSON('aerie-ingredients-v2', ings) !== false && Store.setJSON('aerie-packaging-v2', pk) !== false;
  if (!ok) noteSaveFailed();
  return ok;
}

function supSave() {
  var name = (document.getElementById('sup-name').value || '').replace(/\s+/g, ' ').trim();
  var web = (document.getElementById('sup-web').value || '').trim();
  var notes = (document.getElementById('sup-notes').value || '').trim();
  var err = document.getElementById('sup-err');
  if (!name) { err.textContent = 'A supplier needs a name.'; document.getElementById('sup-name').focus(); return; }
  var list = supAll();
  var clash = list.filter(function (s) { return supNorm(s.name) === supNorm(name) && s.id !== supEditId; })[0];
  if (clash) { err.textContent = clash.name + ' is already saved.'; return; }
  var finish = function () {
    if (Store.setJSON(SUP_KEY, list) === false) { noteSaveFailed(); return; }
    supEditId = null; supDraft = null;
    libChanged();
    supRender();
  };
  if (supEditId === 'new' || !supEditId) {
    list.push({ id: String(Date.now()) + Math.random().toString(36).slice(2, 6), name: name, webLink: web, notes: notes });
    finish();
    return;
  }
  var s = list.filter(function (x) { return x.id === supEditId; })[0];
  if (!s) { supEditId = null; supRender(); return; }
  var oldName = s.name;
  s.name = name; s.webLink = web; s.notes = notes;
  var box = document.getElementById('sup-rename-on');
  if (oldName !== name && supUsage()[supNorm(oldName)] &&
      (supNorm(oldName) === supNorm(name) || (box && box.checked))) {
    if (!supRenameEverywhere(oldName, name)) return;
  }
  finish();
}
// Show the rename tick box only once the name differs from the saved one.
function supNameTyped(el) {
  var r = document.getElementById('sup-rename');
  if (!r) return;
  var was = el.getAttribute('data-was') || '';
  r.hidden = supNorm(el.value) === supNorm(was) || !el.value.trim();
}

// Put a saved supplier's name on the lots and items that spell it differently.
function supMatch(looseName, id) {
  var s = supAll().filter(function (x) { return x.id === id; })[0];
  if (!s) return;
  if (!supRenameEverywhere(looseName, s.name)) return;
  libChanged();
  supRender();
}

function supRemove(id) {
  var list = supAll();
  var s = list.filter(function (x) { return x.id === id; })[0];
  if (!s) return;
  var u = supUsage()[supNorm(s.name)];
  ask(u ? 'Your lots and items keep the name (' + supUseText(u) + '); it will show under “not saved here” at the bottom of this list.' : '',
    function () {
      list = list.filter(function (x) { return x.id !== id; });
      if (Store.setJSON(SUP_KEY, list) === false) { noteSaveFailed(); return; }
      supEditId = null;
      libChanged();
      supRender();
    }, { title: 'Delete ' + s.name + '?', yes: 'Delete', danger: true });
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
    // Headings in the palette's main colour (her call, 2026-10-20), same size.
    '.ps-nav-h{font-size:11.5px;font-weight:500;color:var(--bark);padding:16px 8px 4px;white-space:nowrap}' +
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
    /* A lot code (2026-10-20): the batch's code, in one look everywhere it shows. */
    '.ps-lot{display:inline-flex;align-items:baseline;gap:4px;font-size:12px;font-weight:600;letter-spacing:.03em;font-variant-numeric:tabular-nums;padding:1px 7px;border-radius:5px;white-space:nowrap;background:color-mix(in srgb,var(--bark) 12%,var(--white));color:var(--bark-dark);line-height:1.6;text-decoration:none}' +
    '.ps-lot small{font-size:10.5px;font-weight:500;letter-spacing:.06em;color:var(--ink-lighter)}' +
    'a.ps-lot:hover{background:color-mix(in srgb,var(--bark) 22%,var(--white))}' +
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
    // Suppliers panel (2026-10-20).
    '.sup-head{margin-bottom:14px}' +
    '.sup-title{display:flex;align-items:center;gap:10px;color:var(--bark)}' +
    '.sup-title .ps-i{width:24px;height:24px}' +
    ".sup-title h2{margin:0;font-family:'DM Sans',sans-serif;font-size:22px;font-weight:600;color:var(--ink);letter-spacing:-.01em}" +
    '.sup-intro{margin:6px 0 0;font-size:13px;color:var(--ink-light);line-height:1.45}' +
    '.sup-tools{display:flex;align-items:center;gap:8px;margin:0 0 12px}' +
    '.sup-search{flex:1;border:1px solid var(--cream-border)}.sup-search input{width:100%}' +
    '.sup-list{display:flex;flex-direction:column;border-top:1.5px solid var(--cream-border)}' +
    '.sup-row{padding:11px 10px;border-bottom:1px solid var(--cream-border);cursor:pointer;border-radius:0;transition:background .1s}' +
    '.sup-row:hover{background:var(--cream-dark)}' +
    '.sup-top{display:flex;align-items:baseline;gap:10px}' +
    '.sup-name{font-weight:600;color:var(--ink);font-size:14.5px}' +
    '.sup-web{margin-left:auto;font-size:12.5px;color:var(--bark);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:55%}' +
    '.sup-web:hover{text-decoration:underline}' +
    '.sup-notes{font-size:13px;color:var(--ink-light);margin-top:3px;line-height:1.4;white-space:pre-wrap}' +
    '.sup-use{font-size:12.5px;color:var(--ink-light);margin-top:4px;font-variant-numeric:tabular-nums}' +
    '.sup-use.none{color:var(--ink-lighter)}' +
    '.sup-empty{padding:22px 4px;color:var(--ink-lighter);font-size:13.5px}' +
    '.sup-form{border:1.5px solid var(--bark);border-radius:10px;padding:14px 14px 12px;margin:8px 0 10px;background:color-mix(in srgb,var(--bark) 5%,var(--white))}' +
    '.sup-form-h{font-size:12.5px;font-weight:600;color:var(--bark);margin-bottom:8px}' +
    '.sup-f{display:block;margin-bottom:9px}' +
    '.sup-f span{display:block;font-size:12.5px;color:var(--ink-light);margin-bottom:3px}' +
    '.sup-f input,.sup-f textarea{width:100%;box-sizing:border-box;font:inherit;font-size:14px;padding:7px 9px;border:1px solid var(--cream-border);border-radius:7px;background:var(--white);color:var(--ink)}' +
    '.sup-f textarea{resize:vertical}' +
    '.sup-rename{display:flex;gap:8px;align-items:flex-start;font-size:13px;color:var(--ink);margin:-2px 0 10px;line-height:1.4}' +
    '.sup-rename[hidden]{display:none}' +
    '.sup-err{color:var(--danger);font-size:13px;min-height:0}' +
    '.sup-err:not(:empty){margin-bottom:8px}' +
    '.sup-form-btns{display:flex;gap:8px;align-items:center}' +
    '.sup-del{font:inherit;font-size:13px;border:0;background:none;color:var(--danger);cursor:pointer;padding:5px 2px}' +
    '.sup-del:hover{text-decoration:underline}' +
    '.sup-loose{margin-top:22px}' +
    '.sup-loose-h{font-size:12.5px;font-weight:600;color:var(--ink-light);margin-bottom:6px}' +
    '.sup-loose-row{display:flex;align-items:center;gap:10px;padding:7px 10px;border-bottom:1px dashed var(--cream-border)}' +
    '.sup-loose-name{font-size:14px;color:var(--ink)}' +
    '.sup-loose-row .sup-use{margin:0 0 0 auto}' +
    '.sup-loose-row .ps-link-btn{padding:3px 10px}' +
    '' +
    // Update stock panel (2026-10-20).
    '.st-panel .st-modes{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0 10px;align-items:center}' +
    '.st-panel .st-mct{font-variant-numeric:tabular-nums;opacity:.75}' +
    '.st-panel .st-help{font-size:13px;color:var(--ink-light);margin:0 0 12px;line-height:1.45}' +
    '.st-panel .st-fields{display:grid;grid-template-columns:150px minmax(0,1fr);gap:10px;margin-bottom:12px}' +
    '.st-panel .st-fields label{display:block;font-size:12.5px;color:var(--ink-light);margin-bottom:3px}' +
    '.st-panel .st-fields input{width:100%;box-sizing:border-box;font:inherit;font-size:14px;padding:6px 8px;border:1px solid var(--cream-border);border-radius:7px;background:var(--white);color:var(--ink)}' +
    '.st-panel .st-search{border:1px solid var(--cream-border);margin-bottom:6px}.st-panel .st-search input{width:100%}' +
    '.st-panel .st-type{font-size:12.5px;font-weight:600;color:var(--white);background:var(--bark);border-radius:6px;padding:4px 10px;margin:14px 0 2px}' +
    '.st-panel .st-row,.st-panel .st-cols{display:grid;grid-template-columns:minmax(0,1fr) 64px 76px;gap:10px;align-items:center}' +
    '.st-panel .st-row{padding:7px 4px;border-bottom:1px solid var(--cream-border)}' +
    '.st-panel .st-row.on{background:var(--clay-light)}' +
    '.st-panel .st-row.over{background:color-mix(in srgb,var(--danger) 10%,var(--white))}' +
    '.st-panel .st-row.over input{border-color:var(--danger)}' +
    '.st-panel .st-rp{font-size:13px;color:var(--ink-light);margin:12px 0 0}.st-panel .st-rp a{color:var(--bark)}' +
    '.st-panel .st-over{margin-top:12px;font-size:13px;color:var(--danger);line-height:1.45}' +
    '.st-panel .st-name{font-size:14px;color:var(--ink);min-width:0}' +
    '.st-panel .st-name small{display:block;font-size:12px;color:var(--ink-lighter)}' +
    '.st-panel .st-nfs{display:inline-block;font-size:11.5px;padding:0 7px;border-radius:5px;margin-left:6px;background:color-mix(in srgb,var(--ink) 8%,transparent);color:var(--ink-light);white-space:nowrap}' +
    '.st-panel .st-have{text-align:right;font-variant-numeric:tabular-nums;font-size:13.5px;color:var(--ink-light)}' +
    '.st-panel .st-neg{color:var(--danger);font-weight:600}' +
    '.st-panel .st-row input{width:100%;box-sizing:border-box;font:inherit;font-size:14px;padding:5px 7px;border:1px solid var(--cream-border);border-radius:7px;text-align:right;background:var(--white);color:var(--ink)}' +
    '.st-panel .st-cols{font-size:12px;color:var(--ink-lighter);padding:0 4px 4px;text-align:right}' +
    '.st-panel .st-cols span:first-child{text-align:left}' +
    '.st-panel .st-empty{padding:14px 4px;color:var(--ink-lighter);font-size:13.5px}' +
    /* Consignment (2026-10-20) */
    '.st-panel .st-shop{display:flex;gap:10px;align-items:center;margin:0 0 10px}.st-panel .st-shop label{font-size:13px;color:var(--ink-light)}' +
    '.st-panel .st-shop select{font:inherit;font-size:14px;padding:6px 8px;border:1px solid var(--cream-border);border-radius:7px;background:var(--white);color:var(--ink);min-width:0;flex:1}' +
    '.cs-panel .cs-cards{display:flex;flex-direction:column;gap:8px;margin-top:6px}' +
    '.cs-panel .cs-card{display:grid;grid-template-columns:minmax(0,1fr) auto 18px;gap:12px;align-items:center;text-align:left;font:inherit;background:var(--white);border:1.5px solid var(--cream-border);border-radius:10px;padding:10px 12px;cursor:pointer;color:var(--ink)}' +
    '.cs-panel .cs-card:hover{background:var(--cream)}' +
    '.cs-panel .cs-name{font-size:15px;font-weight:600;min-width:0}.cs-panel .cs-name small{display:block;font-size:12.5px;font-weight:400;color:var(--ink-lighter)}' +
    '.cs-panel .cs-units{text-align:right;font-size:13px;color:var(--ink-light)}.cs-panel .cs-units b{font-size:16px;color:var(--ink);font-variant-numeric:tabular-nums}' +
    '.cs-panel .cs-units small{display:block;font-size:12px;color:var(--ink-lighter)}' +
    '.cs-panel .cs-chev .ps-i{width:16px;height:16px;transform:rotate(-90deg)}' +
    '.cs-panel .cs-add{margin-top:12px}' +
    '.cs-panel .cs-back .ps-i{transform:rotate(90deg)}' +
    '.cs-panel .cs-acts{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 4px}' +
    '.cs-panel .cs-h{font-size:15px;font-weight:600;margin:18px 0 6px;color:var(--ink)}.cs-panel .cs-h span{font-weight:400;font-size:12.5px;color:var(--ink-lighter);margin-left:6px}' +
    '.cs-panel .cs-row,.cs-panel .cs-cols{display:grid;grid-template-columns:minmax(0,1fr) 48px 64px 64px 44px;gap:8px;align-items:center}' +
    '.cs-panel .cs-row{padding:7px 4px;border-bottom:1px solid var(--cream-border)}' +
    '.cs-panel .cs-row.on{background:var(--clay-light)}' +
    '.cs-panel .cs-row.over{background:color-mix(in srgb,var(--danger) 10%,var(--white))}' +
    '.cs-panel .cs-row input{width:100%;box-sizing:border-box;font:inherit;font-size:14px;padding:5px 7px;border:1px solid var(--cream-border);border-radius:7px;text-align:right;background:var(--white);color:var(--ink)}' +
    '.cs-panel .cs-cols{font-size:12px;color:var(--ink-lighter);padding:0 4px 4px;text-align:right}.cs-panel .cs-cols span:first-child{text-align:left}' +
    '.cs-panel .cs-hist{border-top:1px solid var(--cream-border)}' +
    '.cs-panel .cs-ev{display:grid;grid-template-columns:96px minmax(0,1fr) auto;gap:10px;padding:6px 4px;border-bottom:1px solid var(--cream-border);font-size:13px;color:var(--ink-light)}' +
    '.st-panel .st-foot{position:sticky;bottom:-30px;background:var(--white);padding:12px 0 8px;display:flex;gap:10px;align-items:center;border-top:1px solid var(--cream-border);margin-top:12px}' +
    '.st-panel .st-ct{font-size:13px;color:var(--ink-light)}' +
    '' +
    // Stock history panel (2026-10-20).
    '.sh-panel .sh-ranges{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0 12px}' +
    '.sh-panel .sh-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}' +
    '.sh-panel .sh-tile{border:1.5px solid var(--cream-border);border-radius:10px;padding:9px 11px;background:var(--white);font:inherit;text-align:left;cursor:pointer;color:inherit;transition:border-color .12s,background .12s}' +
    '.sh-panel .sh-tile:hover{border-color:var(--bark)}' +
    '.sh-panel .sh-tile.on{border-color:var(--bark);background:color-mix(in srgb,var(--bark) 9%,var(--white))}' +
    '.sh-panel .sh-showing{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin:4px 0 8px;font-size:13.5px;color:var(--ink)}' +
    '.sh-panel .sh-showing .ps-link-btn{margin-left:auto;padding:3px 10px}' +
    '.sh-panel .sh-k{font-size:12.5px;color:var(--ink-light)}' +
    '.sh-panel .sh-n{font-size:21px;font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums}' +
    '.sh-panel .sh-c{font-size:12.5px;color:var(--ink-light);font-variant-numeric:tabular-nums}' +
    '.sh-panel .sh-give{display:block;width:100%;text-align:left;font:inherit;cursor:pointer;border:1.5px solid transparent;margin:10px 0 4px;padding:9px 11px;border-radius:9px;background:color-mix(in srgb,var(--bark) 9%,var(--white));font-size:13.5px;color:var(--ink)}' +
    '.sh-panel .sh-give:hover,.sh-panel .sh-give.on{border-color:var(--bark)}' +
    '.sh-panel .sh-bar{border-bottom:1px solid var(--cream-border);margin:14px 0 8px}' +
    '.sh-panel .sh-search{border:1px solid var(--cream-border);margin-bottom:8px}.sh-panel .sh-search input{width:100%}' +
    '.sh-panel .sh-grp{border-bottom:1px solid var(--cream-border)}' +
    '.sh-panel .sh-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;width:100%;text-align:left;border:0;background:none;padding:9px 4px;cursor:pointer;font:inherit;color:var(--ink);align-items:center}' +
    '.sh-panel .sh-head:hover{background:var(--cream-dark)}' +
    '.sh-panel .sh-title{font-size:14px;font-weight:600;min-width:0}' +
    '.sh-panel .sh-title small{display:block;font-weight:400;font-size:12px;color:var(--ink-lighter)}' +
    '.sh-panel .sh-chev{grid-row:1;grid-column:2;color:var(--ink-lighter);transition:transform .15s}' +
    '.sh-panel .sh-chev .ps-i{width:16px;height:16px}' +
    '.sh-panel .sh-grp.open .sh-chev{transform:rotate(180deg)}' +
    '.sh-panel .sh-sum{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:5px}' +
    '.sh-panel .sh-pill{font-size:12px;padding:1px 8px;border-radius:999px;background:color-mix(in srgb,var(--ink) 7%,transparent);color:var(--ink-light);font-variant-numeric:tabular-nums;white-space:nowrap}' +
    '.sh-panel .sh-pill b{color:var(--ink)}' +
    '.sh-panel .sh-detail{padding:2px 4px 10px}' +
    '.sh-panel .sh-line{display:grid;grid-template-columns:minmax(0,1fr) auto 64px;gap:10px;font-size:13px;padding:4px 0;color:var(--ink-light);border-top:1px dashed var(--cream-border)}' +
    '.sh-panel .sh-line span:last-child{text-align:right;font-variant-numeric:tabular-nums}' +
    '.sh-panel .sh-line b{color:var(--ink)}' +
    '.sh-panel .sh-foot{font-size:12px;color:var(--ink-lighter);line-height:1.5;margin:12px 0 0}' +
    '.sh-panel .sh-actions{margin-top:10px}' +
    '.sh-panel .st-empty{padding:14px 4px;color:var(--ink-lighter);font-size:13.5px}' +
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
  applyTips();
  applySize();
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
  // 'Chelator' added 2026-10-24 (her ask, now that she has several).
  'Emollient', 'Humectant', 'Base / solvent', 'Emulsifier', 'Preservative', 'Chelator', 'Active',
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

// ── Effective pH ranges (2026-10-20) ──
// An ingredient's "Effective pH range" (stored as optimalPh, label only
// changed: her point that optimal is not the same as functional) is free
// text, often from a reference: "4.0 – 5.5", "3 to 6, with better efficacy
// at lower pH", "Marketed between 3 – 8, but preferably below 5.5", "up to
// 5.5", "below 6", "4+". The FIRST range in it is the one used, so a
// "preferably" clause never tightens it. { min, max } with either null for
// an open side, or null when nothing reads as a range.
function effPhRange(str) {
  var s = String(str == null ? '' : str).toLowerCase().replace(/,(\d)/g, '.$1');
  var num = '(\\d{1,2}(?:\\.\\d+)?)';
  var ok = function (n) { return n >= 0 && n <= 14; };
  var m = new RegExp(num + '\\s*(?:-|\u2013|\u2014|to)\\s*' + num).exec(s);
  if (m) {
    var a = parseFloat(m[1]), b = parseFloat(m[2]);
    if (ok(a) && ok(b) && a <= b) return { min: a, max: b };
  }
  m = new RegExp('(?:up to|below|under|max(?:imum)?|<=?|\u2264)\\s*(?:ph\\s*)?' + num).exec(s);
  if (m && ok(parseFloat(m[1]))) return { min: null, max: parseFloat(m[1]) };
  m = new RegExp('(?:above|over|from|min(?:imum)?|>=?|\u2265)\\s*(?:ph\\s*)?' + num).exec(s);
  if (m && ok(parseFloat(m[1]))) return { min: parseFloat(m[1]), max: null };
  m = new RegExp(num + '\\s*\\+').exec(s);
  if (m && ok(parseFloat(m[1]))) return { min: parseFloat(m[1]), max: null };
  return null;
}
function effPhText(r) {
  if (!r) return '';
  if (r.min !== null && r.max !== null) return r.min + '\u2013' + r.max;
  return r.max !== null ? 'up to ' + r.max : 'from ' + r.min;
}
// An ingredient that is meant to preserve: its function says so.
function isPreservative(ing) {
  if (!ing) return false;
  if (funcCats(ing).some(function (c) { return /preserv/i.test(c); })) return true;
  return /^preservative|broad[- ]spectrum preserv/i.test(String(ing.function || ''));
}
// The ingredients in a formula whose effective range a pH falls outside.
// lo and hi are numbers or null (a target open on one side; a single
// reading passes the same number as both). Returns
// [{ ing, range, side: 'low' | 'high', at }]: at is the pH that falls out.
// Every ingredient with a range counts, not only preservatives: a thickener
// or an active outside its range fails too, if less dangerously.
function effPhIssues(lines, ings, lo, hi) {
  var out = [], seen = {};
  if (lo === null && hi === null) return out;
  (lines || []).forEach(function (l) {
    var id = l && (l.ingId || l.ingredientId);
    if (!id || seen[id]) return;
    seen[id] = true;
    var ing = findIngIn(ings, id), r = ing ? effPhRange(ing.optimalPh) : null;
    if (!r) return;
    var top = hi !== null ? hi : lo, bot = lo !== null ? lo : hi;
    if (r.max !== null && top > r.max) out.push({ ing: ing, range: r, side: 'high', at: top, via: l.via || null });
    else if (r.min !== null && bot < r.min) out.push({ ing: ing, range: r, side: 'low', at: bot, via: l.via || null });
  });
  return out;
}
// Preservatives in a formula with no effective range recorded, so the
// check above cannot see them.
function effPhUnknown(lines, ings) {
  var out = [], seen = {};
  (lines || []).forEach(function (l) {
    var id = l && (l.ingId || l.ingredientId);
    if (!id || seen[id]) return;
    seen[id] = true;
    var ing = findIngIn(ings, id);
    if (isPreservative(ing) && !effPhRange(ing.optimalPh)) out.push(ing);
  });
  return out;
}
// One sentence per issue. what: 'Target reaches pH 6' style lead-in given
// by the caller ('target' or 'final').
function effPhIssueText(x, what) {
  var lead = what === 'final' ? 'Final pH ' + x.at + ' is' : (x.side === 'high' ? 'Target reaches pH ' + x.at + ',' : 'Target starts at pH ' + x.at + ',');
  return lead + ' ' + (x.side === 'high' ? 'above' : 'below') + ' where ' + (x.ing.name || 'an ingredient') +
    (x.via ? ' (in ' + (x.via.name || 'a stock solution') + ')' : '') + ' is effective (' + effPhText(x.range) + ').';
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
  'Hair serum', 'Hair mask', 'Shampoo bar', 'Deodorant', 'Stock solution', 'Other',
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
  // Grams lead the row, beside the tick box (her order, 2026-10-18).
  'td.pc,th.pc{text-align:right;color:#777;font-size:11.5px;padding:5px 0 5px 14px;white-space:nowrap;font-weight:400}' +
  'td.gr{text-align:right;font-size:15px;font-weight:700;padding:5px 8px 5px 0;white-space:nowrap;color:#111;width:1%}' +
  'th.gr{text-align:right;padding:0 8px 6px 0;width:1%}' +
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
    rows += '<tr><td class="gr">' + (pct / 100 * bs).toFixed(1) + 'g</td>' + tickTd() +
      '<td style="padding:5px 8px 5px 10px;font-weight:500">' + esc(ing.name) + '</td>' +
      '<td style="padding:5px 8px;color:#666;font-size:11px;font-style:italic">' + esc(ing.inci) + '</td>' +
      '<td style="padding:5px 8px;text-align:right;color:#888;font-size:11px">' + sap + '</td>' +
      '<td class="pc">' + pct.toFixed(2) + '%</td></tr>';
  });
  rows += '<tr style="background:#f9f9f9"><td class="gr">' + actualLye.toFixed(1) + 'g</td>' + tickTd() +
    '<td style="padding:5px 8px 5px 10px;font-weight:500">' + lyeLabel +
    (lyeType === 'koh' ? ' (90% flakes)' : '') +
    ' <span style="font-size:10px;font-weight:400;color:#888">at ' + superfat + '% superfat</span></td>' +
    '<td style="padding:5px 8px;color:#666;font-size:11px;font-style:italic">' +
    (lyeType === 'koh' ? 'Potassium Hydroxide' : 'Sodium Hydroxide') + '</td>' +
    '<td style="padding:5px 8px;text-align:right;color:#888;font-size:11px">\u2014</td>' +
    '<td class="pc">\u2014</td></tr>';
  rows += '<tr style="background:#f9f9f9"><td class="gr">' + waterG.toFixed(1) + 'g</td>' + tickTd() +
    '<td style="padding:5px 8px 5px 10px;font-weight:500">Distilled water</td>' +
    '<td style="padding:5px 8px;color:#666;font-size:11px;font-style:italic">Aqua</td>' +
    '<td style="padding:5px 8px;text-align:right;color:#888;font-size:11px">\u2014</td>' +
    '<td class="pc">\u2014</td></tr>';
  rows += '<tr style="border-top:2px solid #333">' +
    '<td class="gr">' + totalBatch.toFixed(0) + 'g</td><td></td>' +
    '<td colspan="4" style="padding:7px 8px 7px 10px;font-weight:600;font-size:12px">Total batch weight</td></tr>';

  var addinBlock = '';
  if (addins.length) {
    addinBlock = '<div class="sec"><div class="sec-title">Additives (not included in lye calc)</div>' +
      '<table><thead><tr>' +
      '<th class="gr" style="border-bottom:2px solid #333">Grams</th>' + TICK_TH +
      '<th style="text-align:left;padding:0 8px 6px 10px;border-bottom:2px solid #333">Additive</th>' +
      '<th style="text-align:left;padding-bottom:6px;border-bottom:2px solid #333">INCI</th>' +
      '<th class="pc" style="padding-bottom:6px;border-bottom:2px solid #333">% PPO</th>' +
      '</tr></thead><tbody>';
    addins.forEach(function (l) {
      var ing = findIngIn(ings, l.ingId); if (!ing) return;
      var g   = parseFloat(l.gramsFixed) || 0;
      var ppo = totalOilG > 0 && g > 0 ? (g / totalOilG * 100).toFixed(2) + '%' : '\u2014';
      addinBlock += '<tr><td class="gr">' + g.toFixed(1) + 'g</td>' + tickTd() +
        '<td style="padding:5px 8px 5px 10px;font-weight:500">' + esc(ing.name) + '</td>' +
        '<td style="padding:5px 8px;color:#666;font-size:11px;font-style:italic">' + esc(ing.inci) + '</td>' +
        '<td class="pc">' + ppo + '</td></tr>';
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
      '<th class="gr" style="border-bottom:2px solid #333">Grams</th>' + TICK_TH +
      '<th style="text-align:left;padding:0 8px 6px 10px;border-bottom:2px solid #333">Ingredient</th>' +
      '<th style="text-align:left;padding-bottom:6px;border-bottom:2px solid #333">INCI</th>' +
      '<th style="text-align:right;padding-bottom:6px;border-bottom:2px solid #333">SAP</th>' +
      '<th class="pc" style="padding-bottom:6px;border-bottom:2px solid #333">%</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
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
      rows += '<tr><td class="gr">' + g + 'g</td>' + tickTd() +
        '<td style="padding:5px 8px 5px 10px;font-weight:500">' + esc(r.ing.name) + '</td>' +
        '<td style="padding:5px 8px;color:#666;font-size:11px;font-style:italic">' + esc(r.ing.inci) + '</td>' +
        '<td class="pc">' + pct + '%</td></tr>';
    });
  });
  addins.forEach(function (l) {
    var ing = findIngIn(ings, l.ingId); if (!ing) return;
    var g  = parseFloat(l.gramsFixed) || 0;
    var dr = g > 0 ? Math.round(g * (l.dropsPerG || 20)) : 0;
    rows += '<tr><td class="gr">' + g + 'g' + (dr ? '<div style="font-size:11px;font-weight:400;color:#666">~' + dr + ' drops</div>' : '') + '</td>' + tickTd() +
      '<td style="padding:5px 8px 5px 10px;font-weight:500">' + esc(ing.name) +
      ' <span style="font-size:10px;color:#888">(add-in)</span></td>' +
      '<td style="padding:5px 8px;color:#666;font-size:11px;font-style:italic">' + esc(ing.inci) + '</td>' +
      '<td class="pc">\u2014</td></tr>';
  });

  var fl = lines.filter(function (l) { return !l.addin && findIngIn(ings, l.ingId); });
  fl.sort(function (a, b) { return (parseFloat(b.pct) || 0) - (parseFloat(a.pct) || 0); });

  return {
    table: '<div class="sec"><div class="sec-title">Ingredients</div>' +
      '<table><thead><tr>' +
      '<th class="gr" style="border-bottom:2px solid #333">Grams</th>' + TICK_TH +
      '<th style="text-align:left;padding:0 8px 6px 10px;border-bottom:2px solid #333">Ingredient</th>' +
      '<th style="text-align:left;padding-bottom:6px;border-bottom:2px solid #333">INCI</th>' +
      '<th class="pc" style="padding-bottom:6px;border-bottom:2px solid #333">%</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>',
    // With the formulations at hand, a stock solution lists as its parts.
    // Add-ins follow the formula ingredients, as in the editor's INCI panel
    // (2026-10-25 scan: the printed list left them out).
    inci: o.forms
      ? inciMerge(stockLabelItems(fl.map(function (l) { return { ingId: l.ingId, w: parseFloat(l.pct) || 0 }; }), ings, o.forms)
          .concat(stockLabelItems(addins.filter(function (l) { return findIngIn(ings, l.ingId); })
            .map(function (l) { return { ingId: l.ingId, w: (parseFloat(l.gramsFixed) || 0) / (bs || 100) * 100 }; }), ings, o.forms)))
          .map(function (e) { return e.name; }).join(', ')
      : fl.concat(addins.filter(function (l) { return findIngIn(ings, l.ingId); }))
          .map(function (l) { return findIngIn(ings, l.ingId).inci; }).join(', '),
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
//
// A comma BETWEEN TWO DIGITS is part of a chemical name, not a break:
// "2,3-Butanediol", "1,2-Hexanediol", "1,3-Propanediol". Splitting there
// printed "2" and "3-butanediol" as two ingredients (found 2026-10-25 on
// her lotus extract, Nelumbo Nucifera Root Extract, 2,3-Butanediol).
var INCI_LOCANT = '\u0001';
function inciSplit(s) {
  if (!s) return [];
  return String(s)
    // No space: "2,3-Butanediol", "1,2-Hexanediol". With a space, only a
    // lone digit before a locant ("2, 3-Butanediol"), so "Polysorbate 20,
    // 1,2-Hexanediol" and "CI 77491, 77492" still split (2026-10-25 scan).
    .replace(/(\d),(?=\d)/g, '$1' + INCI_LOCANT)
    .replace(/(^|[^\w-])(\d),\s+(?=\d+-)/g, '$1$2' + INCI_LOCANT)
    .replace(/\(\s*and\s*\)/gi, ',')
    .split(/[,;]|\s&\s/)
    .map(function (x) { return x.split(INCI_LOCANT).join(',').replace(/\s+/g, ' ').trim(); })
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

// ══ Rich text (2026-10-24) ════════════════════════════
// Bold, italic and bulleted lists in the text-heavy ingredient fields (the
// lowdown, What I had in mind, formulating notes, expanded details, claims).
// Her call: she sees the formatting as she types; it is SAVED as plain text
// with simple marks, **bold**, *italic* and "- " at the start of a list line,
// so backups, search and exports stay readable and nothing stored is HTML.
// toHtml escapes first and only then adds its own tags, so a stored value
// can never inject markup.
function rtInline(t) {
  return t.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
          .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
}
function rtToHtml(md) {
  try { rtStyle(); } catch (e) {}
  var lines = esc(String(md == null ? '' : md)).split('\n'), out = '', list = false, para = [];
  var flush = function () { if (para.length) { out += para.map(rtInline).join('<br>'); para = []; } };
  lines.forEach(function (ln) {
    var m = /^\s*[-•]\s+(.*)$/.exec(ln);
    if (m) {
      if (!list) { flush(); out += (out ? '' : '') + '<ul class="rt-ul">'; list = true; }
      out += '<li>' + rtInline(m[1]) + '</li>';
    } else {
      if (list) { out += '</ul>'; list = false; }
      para.push(ln);
    }
  });
  if (list) out += '</ul>';
  flush();
  return out;
}
// The words alone, for one-line summaries and title attributes.
function rtPlain(md) {
  return String(md == null ? '' : md).replace(/\*\*([^*\n]+?)\*\*/g, '$1').replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1$2').replace(/^\s*[-•]\s+/gm, '');
}
// The marks back out of an edited box. Chrome's editing writes <b>/<strong>,
// <i>/<em>, <div> or <br> for new lines, and <ul><li> for lists.
function rtFromEl(root) {
  var lines = [], cur = '';
  var push = function () { lines.push(cur); cur = ''; };
  var walk = function (n, wrap) {
    if (n.nodeType === 3) { cur += n.nodeValue.replace(/ /g, ' '); return; }
    if (n.nodeType !== 1) return;
    var tag = n.nodeName.toLowerCase();
    if (tag === 'br') { push(); return; }
    var bold = tag === 'b' || tag === 'strong' || /bold|[6-9]00/.test(n.style && n.style.fontWeight || '');
    var ital = tag === 'i' || tag === 'em' || (n.style && n.style.fontStyle === 'italic');
    if (tag === 'ul' || tag === 'ol') {
      if (cur) push();
      Array.prototype.forEach.call(n.childNodes, function (li) {
        cur = '- '; Array.prototype.forEach.call(li.childNodes || [], function (c) { walk(c); }); push();
      });
      return;
    }
    var block = tag === 'div' || tag === 'p';
    if (block && cur) push();
    var start = cur.length;
    Array.prototype.forEach.call(n.childNodes, function (c) { walk(c); });
    if (bold || ital) {
      var inner = cur.slice(start), lead = inner.match(/^\s*/)[0], trail = inner.match(/\s*$/)[0], core = inner.trim();
      if (core) { var m = bold ? '**' : '*'; if (bold && ital) m = '***'; cur = cur.slice(0, start) + lead + m + core + (m === '***' ? '***' : m) + trail; }
    }
    if (block) push();
  };
  Array.prototype.forEach.call(root.childNodes, function (c) { walk(c); });
  if (cur) push();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join('\n').replace(/\*\*\*([^*]+)\*\*\*/g, '***$1***');
}
// An editing box with a small toolbar. opts.single: one line (Enter does not
// start a new one, no list button). Returns { wrap, ed, get, set, focus }.
var RT_ICONS = { b: '<b>B</b>', i: '<i style="font-family:Georgia,serif">I</i>', ul: '&bull;&thinsp;List' };
function rtEditor(value, opts) {
  opts = opts || {};
  rtStyle();
  var wrap = document.createElement('div');
  wrap.className = 'rt-wrap' + (opts.single ? ' rt-single' : '');
  var bar = document.createElement('div');
  bar.className = 'rt-bar';
  var btns = [['b', 'bold', 'Bold'], ['i', 'italic', 'Italic']];
  if (!opts.single) btns.push(['ul', 'insertUnorderedList', 'Bulleted list']);
  btns.forEach(function (b) {
    var x = document.createElement('button');
    x.type = 'button'; x.className = 'rt-btn'; x.innerHTML = RT_ICONS[b[0]]; x.title = b[2]; x.setAttribute('aria-label', b[2]);
    x.onmousedown = function (e) { e.preventDefault(); };   // keep the selection
    x.onclick = function (e) { e.preventDefault(); ed.focus(); try { document.execCommand(b[1], false, null); } catch (err) {} if (opts.onInput) opts.onInput(); };
    bar.appendChild(x);
  });
  var ed = document.createElement('div');
  ed.className = 'rt-ed';
  ed.contentEditable = 'true';
  ed.setAttribute('role', 'textbox');
  if (!opts.single) ed.setAttribute('aria-multiline', 'true');
  if (opts.label) ed.setAttribute('aria-label', opts.label);
  if (opts.placeholder) ed.setAttribute('data-ph', opts.placeholder);
  ed.innerHTML = rtToHtml(value);
  ed.addEventListener('input', function () { if (opts.onInput) opts.onInput(); });
  ed.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && opts.single) { e.preventDefault(); if (opts.onEnter) opts.onEnter(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'i')) { e.preventDefault(); try { document.execCommand(e.key === 'b' ? 'bold' : 'italic', false, null); } catch (err) {} if (opts.onInput) opts.onInput(); }
  });
  // Pasted text arrives as plain text, so a web page's styling never comes in.
  ed.addEventListener('paste', function (e) {
    var t = (e.clipboardData || window.clipboardData);
    if (!t) return;
    e.preventDefault();
    var txt = t.getData('text/plain') || '';
    if (opts.single) txt = txt.replace(/\s*\n\s*/g, ' ');
    try { document.execCommand('insertText', false, txt); } catch (err) {}
    if (opts.onInput) opts.onInput();
  });
  wrap.appendChild(bar); wrap.appendChild(ed);
  return {
    wrap: wrap, ed: ed,
    get: function () { return rtFromEl(ed); },
    set: function (v) { ed.innerHTML = rtToHtml(v); },
    focus: function () {
      ed.focus();
      try { var r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch (err) {}
    }
  };
}
// A form field made rich: the original input or textarea stays in the form,
// hidden, and always holds the marked-up text, so saving, loading and the
// unsaved-changes check read it exactly as before. refresh() after setting
// its value from code.
var rtAttached = {};
function rtAttach(id, opts) {
  var el = document.getElementById(id);
  if (!el || rtAttached[id]) return null;
  opts = opts || {};
  var r = rtEditor(el.value, {
    single: opts.single, placeholder: el.getAttribute('placeholder') || '', label: opts.label,
    onInput: function () { el.value = r.get(); el.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  el.style.display = 'none';
  el.parentNode.insertBefore(r.wrap, el.nextSibling);
  if (opts.tall) r.ed.style.minHeight = opts.tall;
  rtAttached[id] = r;
  return r;
}
function rtRefresh(id) { var r = rtAttached[id], el = document.getElementById(id); if (r && el) r.set(el.value); }
function rtRefreshAll() { Object.keys(rtAttached).forEach(rtRefresh); }
var RT_CSS = '.rt-wrap{border:1px solid var(--cream-border);border-radius:4px;background:var(--white)}' +
  '.rt-wrap:focus-within{border-color:var(--bark-light)}' +
  '.rt-bar{display:flex;gap:2px;padding:3px 4px;border-bottom:1px solid var(--cream-dark)}' +
  '.rt-btn{font:inherit;font-size:13px;min-width:30px;height:28px;padding:0 8px;border:0;border-radius:4px;background:none;color:var(--ink-light);cursor:pointer}' +
  '.rt-btn:hover{background:var(--cream);color:var(--ink)}' +
  '.rt-ed{font-family:"DM Sans",sans-serif;font-size:13px;line-height:1.55;color:var(--ink);padding:8px 10px;min-height:60px;outline:none;white-space:pre-wrap;word-wrap:break-word}' +
  '.rt-single .rt-ed{min-height:0;white-space:normal}' +
  '.rt-ed:empty:before{content:attr(data-ph);color:var(--ink-lighter)}' +
  '.rt-ed ul,.rt-ul{margin:4px 0;padding-left:20px}.rt-ul li,.rt-ed li{margin:1px 0}' +
  '.rt-text strong,.rt-ed b,.rt-ed strong{font-weight:600}';
// Injected the first time a box is made or rich text is shown.
function rtStyle() {
  if (typeof document === 'undefined' || !document.head || !document.getElementById || document.getElementById('plume-rt-css')) return;
  var st = document.createElement('style'); st.id = 'plume-rt-css'; st.textContent = RT_CSS; document.head.appendChild(st);
}

// Recommended % as shown beside its label: the number or range alone, since
// the label already says % (her call, 2026-10-24). "2–5%" reads "2–5".
// The starting % a new formula line takes from an ingredient's Recommended %
// (2026-10-24). The first number that is part of a percentage, else the
// first number: "2–5%" and "2 to 5 %" give 2, "pH 5: 2%" gives 2, ".5%" and
// "0,5" give 0.5. The old pattern skipped a leading dot, so ".5" started a
// line at 5%, ten times the amount. Blank when nothing in 0-100 is found.
function recStart(v) {
  var s = String(v == null ? '' : v).replace(/(\d),(\d)/g, '$1.$2');
  var m = s.match(/(\d*\.?\d+)\s*(?:(?:-|\u2013|\u2014|to)\s*\d*\.?\d+\s*)?%/i) || s.match(/(\d*\.?\d+)/);
  var n = m ? parseFloat(m[1]) : NaN;
  return isFinite(n) && n > 0 && n <= 100 ? String(n) : '';
}
function recText(v) { return String(v == null ? '' : v).replace(/\s*%\s*/g, '').trim(); }

// ══ Certifications (2026-10-24) ═══════════════════════
// Ticked on a lot (a purchase), not the ingredient: the same oil from two
// suppliers can differ. Each is a plain boolean on the lot, so the lot form's
// data-field read-back keeps them; 'organic' is the lot's original Organic
// tick. certOther holds anything else she types (Fair for Life, say).
var CERTS = [
  { key: 'organic', label: 'Organic' },
  // COSMOS keeps two lists (her point, 2026-10-24): Certified raw materials
  // have organic content; Approved ones meet the standard without it.
  { key: 'cosmosCert',     label: 'COSMOS Certified' },
  { key: 'cosmosApproved', label: 'COSMOS Approved' },
  { key: 'ecocert', label: 'Ecocert' },
  { key: 'natrue',  label: 'NATRUE' },
  // A classification (ISO 16128 natural origin) more than a certification;
  // on the lot because the same INCI can be plant-derived or synthetic.
  { key: 'natural', label: 'Naturally derived' }
];
function lotCerts(lot) {
  if (!lot) return [];
  var out = CERTS.filter(function (c) { return lot[c.key] === true || lot[c.key] === 'true'; }).map(function (c) { return c.label; });
  String(lot.certOther || '').split(',').forEach(function (t) { t = t.trim(); if (t) out.push(t); });
  return out;
}

// ══ Stock solutions (2026-10-21) ══════════════════════
// A stock solution (a 1% hyaluronic acid solution, say) is made as a batch
// and then used as an ingredient in other formulations. Its formulation has
// the type 'Stock solution'; the ingredient it makes carries
// madeBy: <formulation id>, set from the formulation's Stock solution panel.
// Each batch of it adds a lot to that ingredient (Batches does that), priced
// from what went into it and coded with the batch's lot code, so a serum's
// lot traces back through the stock to the supplier lots.
//
// Here: the link both ways, what a stock is made of, and opening it into
// its parts wherever a finished formula's make-up matters: the INCI list
// and its order, the effective pH check, and how much of each part the
// product really holds (10% of a 1% solution is 0.1%).
var STOCK_TYPE = 'Stock solution';
function isStockType(t) { return t === STOCK_TYPE; }
// The ingredient a stock-solution formulation makes, if one is linked.
function stockIngFor(formulaId, ings) {
  if (!formulaId) return null;
  for (var i = 0; i < (ings || []).length; i++) if (ings[i] && ings[i].madeBy === formulaId) return ings[i];
  return null;
}
// The formulation an ingredient is made from. Only while that formulation
// is still a stock solution: changing its type unlinks it in effect.
function stockFormFor(ing, forms) {
  if (!ing || !ing.madeBy) return null;
  for (var i = 0; i < (forms || []).length; i++) {
    var f = forms[i];
    if (f && f.id === ing.madeBy && isStockType(f.type)) return f;
  }
  return null;
}
// What a stock is made of, from the version in use, as shares of 100.
// Add-ins are left out: a stock solution is weighed by percentage.
function stockParts(f) {
  var out = [], tot = 0;
  ((f && f.lines) || []).forEach(function (l) {
    if (!l || l.addin || !l.ingId) return;
    var p = parseFloat(l.pct) || 0;
    if (p > 0) { out.push({ ingId: l.ingId, pct: p }); tot += p; }
  });
  if (!tot) return [];
  out.forEach(function (o) { o.pct = o.pct * 100 / tot; });
  return out;
}
// Opens every stock solution in a list of entries into its parts. Each
// entry is { ingId, w } (w: its share of the whole, in %) plus whatever the
// caller carries. A part comes back as a copy of its stock's entry with the
// part's ingId, w scaled to the whole, and via: the stock ingredient (the
// outermost one). A stock inside a stock opens too, four deep at most, and
// a stock that contains itself stops rather than looping.
function stockExpand(entries, ings, forms, depth, seen) {
  depth = depth || 0;
  var out = [];
  (entries || []).forEach(function (e) {
    var ing = findIngIn(ings, e && e.ingId);
    var f = depth < 4 ? stockFormFor(ing, forms) : null;
    var parts = f && !(seen && seen[f.id]) ? stockParts(f) : [];
    if (!parts.length) { out.push(e); return; }
    var s2 = {}; for (var k in (seen || {})) s2[k] = true; s2[f.id] = true;
    var sub = parts.map(function (p) {
      var c = {}; for (var key in e) c[key] = e[key];
      c.ingId = p.ingId; c.w = (parseFloat(e.w) || 0) * p.pct / 100; c.via = e.via || ing;
      return c;
    });
    out = out.concat(stockExpand(sub, ings, forms, depth + 1, s2));
  });
  return out;
}
// Label items for INCI with stock solutions opened. items are in label
// order, each { ingId, w, addin } plus anything else; inci, flag and label
// are filled in from the ingredient. A formula with no stock solution comes
// back in exactly the order given, so its list does not move. When a stock
// opens, the same ingredient arriving twice (water on its own and water in
// the stock) adds up, and the entries re-sort by their real share. Add-ins
// keep their place after the rest, unless mixAddins (add-ins counted in the
// total, so they sort in with everything else).
function stockLabelItems(items, ings, forms, mixAddins) {
  var opened = stockExpand(items, ings, forms);
  var any = opened.some(function (e) { return e.via; });
  if (any) {
    var by = {}, merged = [];
    opened.forEach(function (e) {
      var k = (e.addin ? 'a:' : 'f:') + e.ingId;
      var w = parseFloat(e.w) || 0;
      if (by[k]) {
        by[k].w += w;
        if (e.via && by[k].vias.indexOf(e.via) < 0) by[k].vias.push(e.via);
        if (!e.via) by[k].direct = true;
        return;
      }
      var c = {}; for (var key in e) c[key] = e[key];
      c.w = w; c.vias = e.via ? [e.via] : []; c.direct = !e.via;
      by[k] = c; merged.push(c);
    });
    var main = merged.filter(function (e) { return mixAddins || !e.addin; });
    var adds = merged.filter(function (e) { return !mixAddins && e.addin; });
    main.sort(function (a, b) { return b.w - a.w; });
    opened = main.concat(adds);
  }
  return opened.map(function (e) {
    var ing = findIngIn(ings, e.ingId), c = {};
    for (var key in e) c[key] = e[key];
    if (ing) { c.inci = ing.inci || ''; c.flag = ing.flag; c.label = ing.name || ''; }
    var vias = e.vias || (e.via ? [e.via] : []);
    if (vias.length) c.label = (c.label || 'an ingredient') + ' (in ' + vias.map(function (v) { return v.name || 'a stock solution'; }).join(' and ') + (e.direct ? ', and on its own' : '') + ')';
    return c;
  });
}
// What a stock solution's own ingredient is called on a label, read off its
// lines in label order (blends split, parts of a stock inside it opened).
function stockInci(lines, ings, forms) {
  var fl = (lines || []).filter(function (l) { return l && !l.addin && (parseFloat(l.pct) || 0) > 0 && findIngIn(ings, l.ingId); });
  fl.sort(function (a, b) { return (parseFloat(b.pct) || 0) - (parseFloat(a.pct) || 0); });
  return inciMerge(stockLabelItems(fl.map(function (l) { return { ingId: l.ingId, w: parseFloat(l.pct) || 0 }; }), ings, forms))
    .map(function (e) { return e.name; }).join(', ');
}
// The ingredient a stock solution makes, new: named for the formulation,
// its INCI read off its lines, in the phase of its largest part. Made by its
// first batch when none is linked (her call, 2026-10-21), so there is no
// separate step before the first batch.
function stockNewIng(f, ings, forms) {
  var top = ((f && f.lines) || []).filter(function (l) { return !l.addin; })
    .sort(function (a, b) { return (parseFloat(b.pct) || 0) - (parseFloat(a.pct) || 0); })[0];
  var topIng = top ? findIngIn(ings, top.ingId) : null;
  return {
    id:      Date.now().toString() + Math.random().toString(36).slice(2, 6),
    name:    (f && f.name) || 'Stock solution',
    inci:    stockInci(f && f.lines, ings, forms),
    phase:   (topIng && topIng.phase) || 'water',
    functionCategory: [],
    madeBy:  f.id,
    lots:    [],
    created: new Date().toISOString()
  };
}
// A formula's lines with the parts of its stock solutions added after them,
// for checks that ask "is X in this formula" (effective pH). Lines may use
// ingId or ingredientId (a batch's snapshot); parts always use ingId.
function stockWithParts(lines, ings, forms) {
  var out = (lines || []).slice();
  (lines || []).forEach(function (l) {
    var id = l && (l.ingId || l.ingredientId);
    var ing = findIngIn(ings, id);
    if (!stockFormFor(ing, forms)) return;
    stockExpand([{ ingId: id, w: 100 }], ings, forms).forEach(function (p) {
      if (p.via) out.push({ ingId: p.ingId, pct: p.w, via: p.via });
    });
  });
  return out;
}

// ── Packaging kinds, drawings, colors (core v1.22, 2026-10-18) ──────────
// An item's KIND is one pick that sets its name, its drawing and its type.
// Nothing to type, so "Dropper bottle" is always spelled the same way, and
// every list groups on it. Only "Other" asks for a name. Agreed with Heide
// in the "Packaging Redesign" preview (version 5); the backlog has the spec.
//
// Drawings stand in for photos: no upload, no storage. The colors are the
// packaging's own colors, written as literal hex in the SVG, because dark
// mode remaps every CSS variable by role and would shift them.
//
// Items saved before v1.22 have no kind. They keep working everywhere (the
// display falls back to their old name) and group under "Needs sorting"
// until the Tidy screen gives them one. item.name is still written on every
// save, as the display string, so any reader that only knows .name is fine.
var PK_COLORS = [
  { key: 'amber',  label: 'Amber',  fill: '#9A5B1E' },
  { key: 'blue',   label: 'Blue',   fill: '#2D4E8C' },
  { key: 'green',  label: 'Green',  fill: '#3E6B3A' },
  { key: 'red',    label: 'Red',    fill: '#A8322A' },
  { key: 'pink',   label: 'Pink',   fill: '#E3A3B5' },
  { key: 'purple', label: 'Purple', fill: '#6B4A8C' },
  { key: 'clear',  label: 'Clear',  fill: '#E8F1F4', clear: true },
  { key: 'frost',  label: 'Frost',  fill: '#DDE3E6' },
  { key: 'white',  label: 'White',  fill: '#FFFFFF' },
  { key: 'black',  label: 'Black',  fill: '#2A2A2A' },
  { key: 'silver', label: 'Silver', fill: '#B9BEC3' },
  { key: 'gold',   label: 'Gold',   fill: '#C9A445' },
  { key: 'kraft',  label: 'Kraft',  fill: '#B08A5A' }
];
var PK_MATERIALS = ['Glass', 'Plastic', 'Aluminum', 'Paperboard', 'Corrugated', 'Paper'];
var PK_PARTS = ['Front', 'Back', 'Top', 'Bottom', 'Wrap'];

// group decides which fields the form asks for; type is what the rest of
// the app already read before kinds existed (container / box / label ...).
var PK_GROUPS = [
  { key: 'bottles', label: 'Bottles, jars and tubes', short: 'Bottles and jars', type: 'container' },
  { key: 'boxes',   label: 'Boxes and bags',          short: 'Boxes and bags',   type: 'box' },
  { key: 'labels',  label: 'Labels and stickers',     short: 'Labels',           type: 'label' },
  { key: 'bands',   label: 'Bands and wraps',         short: 'Bands and wraps',  type: 'other' },
  { key: 'other',   label: 'Caps and other',          short: 'Caps and other',   type: 'closure' }
];
var PK_KINDS = [
  { key: 'dropper', label: 'Dropper bottle',      group: 'bottles' },
  { key: 'pump',    label: 'Pump bottle',         group: 'bottles' },
  { key: 'mist',    label: 'Spray bottle',        group: 'bottles' },
  { key: 'airless', label: 'Airless pump bottle', group: 'bottles' },
  { key: 'bottle',  label: 'Bottle with cap',     group: 'bottles' },
  { key: 'roller',  label: 'Roller bottle',       group: 'bottles' },
  { key: 'jar',     label: 'Jar',                 group: 'bottles' },
  { key: 'tin',     label: 'Tin',                 group: 'bottles' },
  { key: 'lipTube', label: 'Lip balm tube',       group: 'bottles' },
  { key: 'squeeze', label: 'Squeeze tube',        group: 'bottles' },
  { key: 'box',     label: 'Box',                 group: 'boxes' },
  { key: 'mailer',  label: 'Mailer box',          group: 'boxes' },
  { key: 'pouch',   label: 'Bag / pouch',         group: 'boxes' },
  { key: 'label',   label: 'Product label',       group: 'labels' },
  { key: 'square',  label: 'Square sticker',      group: 'labels' },
  { key: 'round',   label: 'Round sticker',       group: 'labels' },
  { key: 'barcode', label: 'Barcode sticker',     group: 'labels' },
  { key: 'shrink',  label: 'Shrink band',         group: 'bands' },
  { key: 'sleeve',  label: 'Soap sleeve',         group: 'bands' },
  { key: 'belly',   label: 'Belly band',          group: 'bands' },
  { key: 'cap',     label: 'Cap / closure',       group: 'other' },
  { key: 'other',   label: 'Other',               group: 'other', other: true }
];
var PK_LEGACY_GROUP = { container: 'bottles', box: 'boxes', label: 'labels', closure: 'other', other: 'other' };

function pkColor(c) {
  c = String(c || '').toLowerCase().trim();
  if (c === 'cobalt' || c === 'cobalt blue') c = 'blue';
  if (c === 'frosted') c = 'frost';
  for (var i = 0; i < PK_COLORS.length; i++) if (PK_COLORS[i].key === c) return PK_COLORS[i];
  return null;
}
function pkSwatch(c) {
  var k = pkColor(c);
  return k ? '<i class="pk-sw" style="background:' + k.fill + '"></i>' : '';
}
// A known kind, or null. pkKindOf(item) is the item's kind, or null for an
// item saved before kinds.
function pkKind(k) { for (var i = 0; i < PK_KINDS.length; i++) if (PK_KINDS[i].key === k) return PK_KINDS[i]; return null; }
function pkKindOf(it) { return it && it.kind ? pkKind(it.kind) : null; }
function pkGroupKey(it) {
  var k = pkKindOf(it);
  return k ? k.group : (PK_LEGACY_GROUP[it && it.type] || 'other');
}
function pkGroup(key) { for (var i = 0; i < PK_GROUPS.length; i++) if (PK_GROUPS[i].key === key) return PK_GROUPS[i]; return PK_GROUPS[4]; }
function pkTypeFor(kind) { var k = pkKind(kind); return k ? pkGroup(k.group).type : 'other'; }
// Labels and stickers are for a product and never take a color; bands and
// wraps may have both; bottles and boxes have a color and a material.
function pkForProduct(kind) { var k = pkKind(kind); return !!k && (k.group === 'labels' || k.group === 'bands'); }
function pkColored(kind) { var k = pkKind(kind); return !k || k.group !== 'labels'; }
function pkIsOther(kind) { var k = pkKind(kind); return !!(k && k.other); }

var PK_DARK = '#3A3A3A';   // caps, pumps, bulbs, sprayers
var PK_EDGE = '#4A4540';   // outline on every body
function pkBody(d, f, o) { return '<path d="' + d + '" fill="' + f + '" fill-opacity="' + o + '" stroke="' + PK_EDGE + '" stroke-width="1.2" stroke-linejoin="round"/>'; }
var PK_BOTTLE = 'M12 12.5h8v1.5c3 1 4.5 2.6 4.5 5v9a2 2 0 0 1-2 2H9.5a2 2 0 0 1-2-2v-9c0-2.4 1.5-4 4.5-5z';
var PK_DRAW = {
  dropper: function (f, o) { return '<ellipse cx="16" cy="5" rx="2.8" ry="3.2" fill="' + PK_DARK + '"/><rect x="12.5" y="7.6" width="7" height="4.9" rx="1" fill="' + PK_DARK + '"/>' + pkBody(PK_BOTTLE, f, o); },
  pump:    function (f, o) { return '<path d="M14.6 2.5h12.4v2.6h-9.8v4.4h-2.6z" fill="' + PK_DARK + '"/><rect x="12.5" y="9.5" width="7" height="3" rx="1" fill="' + PK_DARK + '"/>' + pkBody(PK_BOTTLE, f, o); },
  mist:    function (f, o) { return '<path d="M10.5 12V7.5a5.5 5.5 0 0 1 11 0V12z" fill="#EAF2F5" fill-opacity=".7" stroke="' + PK_EDGE + '" stroke-width="1" stroke-dasharray="1.6 1.2"/><rect x="13.5" y="6.5" width="5" height="3.5" rx=".8" fill="' + PK_DARK + '"/><rect x="12.5" y="10" width="7" height="2.5" rx=".8" fill="' + PK_DARK + '"/>' + pkBody(PK_BOTTLE, f, o); },
  airless: function (f, o) { return '<path d="M13 2.5h8v2.4h-4.5V7.5H13z" fill="' + PK_DARK + '"/><rect x="11" y="7.5" width="10" height="4" rx="1.2" fill="' + PK_DARK + '"/>' + pkBody('M10.5 11.5h11v16a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2z', f, o); },
  bottle:  function (f, o) { return '<rect x="12" y="4" width="8" height="6.5" rx="1.2" fill="' + PK_DARK + '"/>' + pkBody('M12.5 10.5h7v1.5c3 1 4.5 2.6 4.5 5v10.5a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V17c0-2.4 1.5-4 4.5-5z', f, o); },
  roller:  function (f, o) { return '<rect x="12.5" y="2.5" width="7" height="8" rx="1.5" fill="' + PK_DARK + '"/>' + pkBody('M12 10.5h8v17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2z', f, o); },
  jar:     function (f, o) { return '<rect x="6" y="9" width="20" height="5" rx="1.5" fill="' + PK_DARK + '"/>' + pkBody('M7 14h18v12a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3z', f, o); },
  tin:     function (f, o) { return pkBody('M4 15.5v6c0 2.5 5.4 4.5 12 4.5s12-2 12-4.5v-6', f, o) + '<ellipse cx="16" cy="15.5" rx="12" ry="4.5" fill="' + f + '" fill-opacity="' + o + '" stroke="' + PK_EDGE + '" stroke-width="1.2"/><ellipse cx="16" cy="15.5" rx="8" ry="2.4" fill="none" stroke="' + PK_EDGE + '" stroke-width=".8" opacity=".6"/>'; },
  lipTube: function (f, o) { return '<rect x="12" y="3" width="8" height="9" rx="1.6" fill="' + PK_DARK + '"/>' + pkBody('M12 12h8v16a1.6 1.6 0 0 1-1.6 1.6h-4.8A1.6 1.6 0 0 1 12 28z', f, o); },
  squeeze: function (f, o) { return pkBody('M9 4h14l-1.5 3H10.5z', f, o) + pkBody('M10.5 7h11l1.5 17h-14z', f, o) + '<rect x="12.5" y="24" width="7" height="5.5" rx="1" fill="' + PK_DARK + '"/>'; },
  box:     function (f, o) { return pkBody('M5 10l11-5.5L27 10v12.5L16 28 5 22.5z', f, o) + '<path d="M5 10l11 5.5L27 10M16 15.5V28" fill="none" stroke="' + PK_EDGE + '" stroke-width="1.2" stroke-linejoin="round"/>'; },
  mailer:  function (f, o) { return pkBody('M3.5 12h25v13a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 25z', f, o) + pkBody('M3.5 12l4-5h17l4 5', f, o) + '<path d="M12 17h8" stroke="' + PK_EDGE + '" stroke-width="1.2"/>'; },
  pouch:   function (f, o) { return pkBody('M8 6h16l1.5 21a2 2 0 0 1-2 2.2H8.5a2 2 0 0 1-2-2.2z', f, o) + '<path d="M8.5 10h15" stroke="' + PK_EDGE + '" stroke-width="1" stroke-dasharray="2 1.5"/>'; },
  label:   function () { return '<rect x="3" y="10" width="26" height="12" rx="2" fill="#FFFFFF" stroke="' + PK_EDGE + '" stroke-width="1.2"/><path d="M7 14.5h13M7 17.5h9" stroke="' + PK_EDGE + '" stroke-width="1.2"/>'; },
  square:  function () { return '<rect x="6" y="6" width="20" height="20" rx="2.5" fill="#FFFFFF" stroke="' + PK_EDGE + '" stroke-width="1.2"/><path d="M10 13h12M10 16.5h9M10 20h6" stroke="' + PK_EDGE + '" stroke-width="1.2"/>'; },
  round:   function () { return '<circle cx="16" cy="16" r="11" fill="#FFFFFF" stroke="' + PK_EDGE + '" stroke-width="1.2"/><path d="M11 14.5h10M12.5 17.5h7" stroke="' + PK_EDGE + '" stroke-width="1.2"/>'; },
  barcode: function () { return '<rect x="3" y="9" width="26" height="14" rx="2" fill="#FFFFFF" stroke="' + PK_EDGE + '" stroke-width="1.2"/><path d="M7 12v8M9 12v8M12 12v8M13.5 12v8M16 12v8M19 12v8M20.5 12v8M23 12v8M25 12v8" stroke="#222" stroke-width="1.1"/>'; },
  shrink:  function (f) { return '<rect x="12" y="5" width="8" height="6" rx="1" fill="#CFCAC2"/>' + pkBody('M12.5 11h7v1.5c3 1 4.5 2.6 4.5 5v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-10c0-2.4 1.5-4 4.5-5z', '#E7E3DC', 1) + '<rect x="10.8" y="4" width="10.4" height="10" rx="1.5" fill="' + f + '" fill-opacity=".75" stroke="' + PK_EDGE + '" stroke-width="1.2"/><path d="M11 6.5h10M11 9h10M11 11.5h10" stroke="' + PK_EDGE + '" stroke-width=".7" opacity=".6"/>'; },
  sleeve:  function (f, o) { return '<rect x="3" y="10" width="26" height="12" rx="3" fill="#E7E3DC" stroke="' + PK_EDGE + '" stroke-width="1"/>' + pkBody('M8 9h16v14H8z', f, o) + '<path d="M11 14h10M11 17h7" stroke="' + PK_EDGE + '" stroke-width="1"/>'; },
  belly:   function (f, o) { return '<rect x="6" y="7" width="20" height="4.5" rx="1.5" fill="' + PK_DARK + '"/>' + pkBody('M7 11.5h18v14a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3z', '#E7E3DC', 1) + pkBody('M6.5 16h19v5h-19z', f, o); },
  cap:     function (f, o) { return pkBody('M8 9h16v12.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 8 21.5z', f, o) + '<path d="M11 9v15M14 9v15M17 9v15M20 9v15" stroke="' + PK_EDGE + '" stroke-width=".8" opacity=".5"/>'; },
  other:   function (f, o) { return pkBody('M6 6h20v20H6z', f, o) + '<path d="M12 16h8M16 12v8" stroke="' + PK_EDGE + '" stroke-width="1.2"/>'; }
};
function pkIcon(kind, color) {
  var draw = PK_DRAW[kind] || PK_DRAW.other;
  var c = pkColored(kind) ? pkColor(color) : null;
  var fill = c ? c.fill : '#E7E3DC';
  var op = c && c.clear ? '0.55' : '1';
  return '<svg class="pk-svg" viewBox="0 0 32 32" aria-hidden="true">' + draw(fill, op) + '</svg>';
}
// The drawing for an item. One saved before kinds gets the drawing its old
// name suggests, so it is still recognisable before she tidies it.
function pkIconFor(it) {
  if (!it) return pkIcon('other', '');
  if (it.kind) return pkIcon(it.kind, it.color);
  var g = pkGuess(it.name);
  return pkIcon(g.kind, g.color);
}

// Product names for labels, read from Products & Costing's store. Cached
// for the current task only, so a list of 200 rows reads it once.
var pkProdCache = null;
function pkProducts() {
  if (!pkProdCache) {
    pkProdCache = (Store.getJSON('plume-products-v1', []) || []).filter(function (p) { return p && p.id; });
    setTimeout(function () { pkProdCache = null; }, 0);
  }
  return pkProdCache;
}
function pkProductName(id) {
  if (!id) return '';
  var list = pkProducts();
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].name || '';
  return '';
}

function pkKindName(it) {
  var k = pkKindOf(it);
  if (!k) return it && it.name ? it.name : '(unnamed)';
  return k.other ? (String(it.other || '').trim() || 'Other') : k.label;
}
// "Amber glass", "Clear plastic", "Kraft paperboard"
function pkLooks(it) {
  var s = [String(it.color || '').trim(), it.material ? String(it.material).toLowerCase() : ''].filter(Boolean).join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
// The one name used everywhere: "Dropper bottle · 1 oz · Blue glass", or
// "Product label · 3.5 × 1.25 in · Hydrating facial serum · Front".
function pkDisplay(it) {
  if (!it) return '';
  if (!it.kind) return it.name || '(unnamed)';
  var bits = [pkKindName(it), String(it.capacity || '').trim()];
  if (pkColored(it.kind)) bits.push(pkLooks(it));
  if (pkForProduct(it.kind)) { bits.push(pkProductName(it.forProduct)); bits.push(String(it.part || '').trim()); }
  return bits.filter(Boolean).join(' · ');
}
// The detail beside the size: swatch and looks, or product and part.
function pkDetailHtml(it) {
  if (!it.kind) return '<span class="pk-old">' + esc(it.name || '(unnamed)') + '</span>';
  var parts = [];
  if (pkColored(it.kind) && (it.color || it.material)) parts.push('<span class="pk-looks">' + pkSwatch(it.color) + esc(pkLooks(it)) + '</span>');
  if (pkForProduct(it.kind)) {
    var pn = pkProductName(it.forProduct);
    if (pn) parts.push('<span class="pk-for"><b>' + esc(pn) + '</b>' + (it.part ? '<span class="pk-part">' + esc(it.part) + '</span>' : '') + '</span>');
    else if (!pkColored(it.kind)) parts.push('<span class="pk-any">Any product</span>' + (it.part ? ' <span class="pk-part">' + esc(it.part) + '</span>' : ''));
  }
  if (pkIsOther(it.kind) && !parts.length && it.notes) parts.push('<span class="pk-any">' + esc(String(it.notes).slice(0, 60)) + '</span>');
  return parts.join('<span class="pk-dot">·</span>');
}
function pkStock(it) {
  var t = 0;
  ((it && it.purchases) || []).forEach(function (p) { t += parseInt(p.qty, 10) || 0; });
  ((it && it.adjustments) || []).forEach(function (a) { t += parseInt(a.qty, 10) || 0; });
  return t;
}
function pkSizeNum(s) { var m = String(s || '').match(/\d+(?:\.\d+)?|\.\d+/); return m ? parseFloat(m[0]) : 0; }
var PK_GROUP_ORDER = { bottles: 0, boxes: 1, labels: 2, bands: 3, other: 4, sort: 5 };
// Color order inside a kind: the swatch list's order (Amber, Blue, Green...),
// then any other color typed, alphabetically, then items with no color.
function pkColorRank(c) {
  var k = pkColor(c);
  if (k) for (var i = 0; i < PK_COLORS.length; i++) if (PK_COLORS[i] === k) return i;
  return String(c || '').trim() ? PK_COLORS.length : PK_COLORS.length + 1;
}
// Items grouped by kind, in section order: by color, then size small to
// large (Heide's call, 2026-10-18: all the amber droppers together).
// Labels sort by product, then size, then part. Items without a kind come
// last, under "Needs sorting".
function pkGroups(list) {
  var g = {}, order = [];
  list.forEach(function (it) {
    var sec = it.kind ? pkKindOf(it).group : 'sort';
    var name = it.kind ? pkKindName(it) : 'Needs sorting';
    var k = sec + '|' + name;
    if (!g[k]) { g[k] = { section: sec, name: name, kind: it.kind || '', items: [] }; order.push(k); }
    g[k].items.push(it);
  });
  var kindIdx = function (grp) {
    if (!grp.kind) return 999;
    for (var i = 0; i < PK_KINDS.length; i++) if (PK_KINDS[i].key === grp.kind) return i;
    return 998;
  };
  return order.map(function (k) { return g[k]; }).sort(function (a, b) {
    return (PK_GROUP_ORDER[a.section] - PK_GROUP_ORDER[b.section]) || (kindIdx(a) - kindIdx(b)) || a.name.localeCompare(b.name);
  }).map(function (grp) {
    grp.items.sort(function (a, b) {
      if (!a.kind) return String(a.name || '').localeCompare(String(b.name || ''));
      if (pkForProduct(a.kind) && !pkColored(a.kind)) {
        return pkProductName(a.forProduct).localeCompare(pkProductName(b.forProduct)) ||
               pkSizeNum(a.capacity) - pkSizeNum(b.capacity) || String(a.part || '').localeCompare(String(b.part || ''));
      }
      return pkColorRank(a.color) - pkColorRank(b.color) || String(a.color || '').toLowerCase().localeCompare(String(b.color || '').toLowerCase()) ||
             pkSizeNum(a.capacity) - pkSizeNum(b.capacity) || String(a.capacity || '').localeCompare(String(b.capacity || '')) ||
             String(a.material || '').localeCompare(String(b.material || ''));
    });
    return grp;
  });
}
// Every word typed must appear somewhere: kind, size (with or without its
// space, so "1oz" finds "1 oz"), color, material, product, part, supplier.
function pkMatches(it, q) {
  q = String(q || '').toLowerCase().trim();
  if (!q) return true;
  var hay = [pkKindName(it), it.capacity, String(it.capacity || '').replace(/\s/g, ''), it.color, it.material,
             pkProductName(it.forProduct), it.part, it.supplier, it.name, it.other].join(' ').toLowerCase();
  return q.split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1; });
}
// Same thing twice? Used to warn before saving a duplicate.
function pkSameKey(it) {
  return [it.kind, String(it.other || '').toLowerCase().trim(), String(it.capacity || '').replace(/\s/g, '').toLowerCase(),
          (pkColor(it.color) || {}).key || String(it.color || '').toLowerCase().trim(), String(it.material || '').toLowerCase(),
          it.forProduct || '', String(it.part || '').toLowerCase().trim()].join('|');
}

// Reading an old free-text name into fields, for the Tidy screen: a guess
// for her to confirm, never applied on its own.
var PK_KIND_RULES = [
  [/airless/i, 'airless'], [/dropper/i, 'dropper'], [/mist|spray|trigger/i, 'mist'],
  [/pump/i, 'pump'], [/roll(er|-on)/i, 'roller'], [/lip.*tube|balm tube/i, 'lipTube'], [/tube/i, 'squeeze'],
  [/jar/i, 'jar'], [/\btins?\b/i, 'tin'], [/barcode/i, 'barcode'], [/square/i, 'square'], [/round sticker|seal/i, 'round'],
  [/shrink/i, 'shrink'], [/sleeve/i, 'sleeve'], [/belly/i, 'belly'], [/sticker/i, 'round'], [/label/i, 'label'],
  [/mailer|shipper/i, 'mailer'], [/box|carton/i, 'box'], [/bag|pouch/i, 'pouch'], [/\bcaps?\b|\blids?\b|closure/i, 'cap'], [/bottle/i, 'bottle']
];
function pkGuess(oldName, products) {
  var s = String(oldName || '');
  var g = { kind: 'other', other: '', capacity: '', color: '', material: '', forProduct: '', part: '' };
  for (var i = 0; i < PK_KIND_RULES.length; i++) if (PK_KIND_RULES[i][0].test(s)) { g.kind = PK_KIND_RULES[i][1]; break; }
  if (g.kind === 'other') g.other = s.trim();
  var N = '(\\d+(?:\\.\\d+)?|\\.\\d+)';
  var z = function (v) { return v && v.charAt(0) === '.' ? '0' + v : v; };
  var dim = s.match(new RegExp(N + '\\s*(?:in|")?\\s*[x×]\\s*' + N + '(?:\\s*(?:in|")?\\s*[x×]\\s*' + N + ')?', 'i'));
  var vol = s.match(new RegExp(N + '\\s*(fl\\.?\\s*oz|oz|ml|mm|g|in)\\b', 'i'));
  if (dim) g.capacity = z(dim[1]) + ' × ' + z(dim[2]) + (dim[3] ? ' × ' + z(dim[3]) : '') + ' in';
  else if (vol) g.capacity = z(vol[1]) + ' ' + vol[2].toLowerCase().replace(/fl\.?\s*oz/, 'oz').replace(/^ml$/, 'ml');
  if (pkColored(g.kind)) {
    for (var k = 0; k < PK_COLORS.length; k++) if (new RegExp('\\b' + PK_COLORS[k].key + '\\b', 'i').test(s)) { g.color = PK_COLORS[k].label; break; }
    if (!g.color && /cobalt/i.test(s)) g.color = 'Blue';
    if (!g.color && /frosted/i.test(s)) g.color = 'Frost';
  }
  if (/glass/i.test(s)) g.material = 'Glass';
  else if (/plastic|\bpet\b|hdpe|\bpp\b/i.test(s)) g.material = 'Plastic';
  else if (/alumin|\btins?\b/i.test(s)) g.material = 'Aluminum';
  else if (/mailer|shipper|corrugated/i.test(s)) g.material = 'Corrugated';
  else if (/kraft|card|paper/i.test(s) && pkKind(g.kind).group === 'boxes') g.material = 'Paperboard';
  if (/\bfront\b/i.test(s)) g.part = 'Front'; else if (/\bback\b/i.test(s)) g.part = 'Back'; else if (/\bbottom\b/i.test(s)) g.part = 'Bottom';
  if (pkForProduct(g.kind)) {
    var best = null, bestScore = 0, low = s.toLowerCase();
    (products || pkProducts()).forEach(function (p) {
      var words = String(p.name || '').toLowerCase().split(/[\s,\-]+/).filter(function (w) { return w.length > 3; });
      var score = words.filter(function (w) { return low.indexOf(w) !== -1; }).length;
      if (score > bestScore) { best = p; bestScore = score; }
    });
    if (best) g.forProduct = best.id;
  }
  return g;
}

// ── The packaging picker ─────────────────────────────────────────────────
// Turns a plain <select> of packaging items into a button that opens a
// searchable list, grouped by kind, with the drawing, size, color or product
// and stock on each line. The <select> stays in the page (hidden) and keeps
// its value, and picking fires its change event, so the module's own
// onchange code runs exactly as before.
//   Plume.pkPicker(selectEl, items)            one select
//   Plume.pkPickers(rootEl, items)             every select[data-pk-pick] inside
function pkCss() {
  if (document.getElementById('plume-pk-css')) return;
  var css =
    '.pk-svg{width:100%;height:100%;display:block}' +
    '.pk-sw{width:12px;height:12px;border-radius:50%;display:inline-block;box-shadow:inset 0 0 0 1px rgba(0,0,0,.28);flex:none;vertical-align:-1px}' +
    '.pk-thumb{width:34px;height:34px;border-radius:7px;background:#F6F3EE;border:1px solid var(--cream-border);display:inline-grid;place-items:center;flex:none;padding:3px}' +
    '.pk-looks,.pk-for{display:inline-flex;align-items:center;gap:6px}' +
    '.pk-for b{font-weight:500}' +
    '.pk-part{font-size:11.5px;padding:0 7px;border-radius:5px;background:var(--cream-dark);color:var(--ink-light)}' +
    '.pk-any{color:var(--ink-lighter);font-style:italic}' +
    '.pk-old{color:var(--ink-light)}' +
    '.pk-dot{color:var(--ink-lighter);margin:0 7px}' +
    '.pk-size{font-weight:600;font-variant-numeric:tabular-nums}' +
    '.pk-pick-btn{font:inherit;font-size:13px;display:flex;align-items:center;gap:9px;width:100%;min-width:0;text-align:left;border:1px solid var(--cream-border);border-radius:7px;background:var(--white);color:var(--ink);padding:3px 8px 3px 4px;cursor:pointer;min-height:36px}' +
    '.pk-pick-btn:hover{border-color:var(--bark-light)}' +
    '.pk-pick-btn .pk-thumb{width:28px;height:28px;padding:2px}' +
    '.pk-pick-btn .pk-pb-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.pk-pick-btn .pk-pb-s{font-size:11.5px;color:var(--ink-lighter);white-space:nowrap}' +
    '.pk-pick-btn .pk-pb-c{color:var(--ink-lighter);flex:none}' +
    '.pk-pick-btn.empty .pk-pb-t{color:var(--ink-lighter)}' +
    '.pk-pop{position:fixed;z-index:400;background:var(--white);color:var(--ink);border:1px solid var(--cream-border);border-radius:12px;box-shadow:0 14px 44px rgba(20,20,15,.2),0 2px 6px rgba(20,20,15,.08);display:flex;flex-direction:column;overflow:hidden;font-family:\'DM Sans\',sans-serif;font-size:13.5px}' +
    '.pk-pop-search{display:flex;align-items:center;gap:6px;margin:8px;border-radius:7px;background:var(--cream);padding:0 10px;color:var(--ink-lighter)}' +
    '.pk-pop-search input{border:0;background:transparent;outline:none;color:var(--ink);font:inherit;width:100%;padding:7px 0;box-shadow:none}' +
    '.pk-pop-chips{display:flex;gap:5px;flex-wrap:wrap;padding:0 8px 8px}' +
    '.pk-pop-chips button{font:inherit;font-size:12px;border:1px solid var(--cream-border);background:transparent;border-radius:999px;padding:1px 9px;color:var(--ink-light);cursor:pointer}' +
    '.pk-pop-chips button.on{background:var(--ink);color:var(--white);border-color:var(--ink)}' +
    '.pk-pop-list{overflow-y:auto;border-top:1px solid var(--cream-border);flex:1}' +
    '.pk-pop-g{padding:7px 12px 3px;font-size:12px;font-weight:600;color:var(--ink-light);background:var(--cream);position:sticky;top:0}' +
    '.pk-pop-i{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:10px;align-items:center;padding:6px 12px;cursor:pointer;border-bottom:1px solid var(--cream-border)}' +
    '.pk-pop-i:hover,.pk-pop-i.hi{background:var(--cream-dark)}' +
    '.pk-pop-i.sel{background:color-mix(in srgb,var(--bark) 13%,var(--white))}' +
    '.pk-pop-i .l1{display:flex;gap:9px;align-items:center;flex-wrap:wrap;min-width:0}' +
    '.pk-pop-i .st{font-size:12px;color:var(--ink-lighter);text-align:right;white-space:nowrap}' +
    '.pk-pop-i .st b{color:var(--sage-dark);font-weight:600}' +
    '.pk-pop-i .st.out b{color:var(--warning)}' +
    '.pk-pop-none{padding:16px;color:var(--ink-lighter)}' +
    '.pk-pop-clear{font:inherit;font-size:12.5px;border:0;background:none;color:var(--ink-lighter);cursor:pointer;padding:8px 12px;text-align:left;border-top:1px solid var(--cream-border)}' +
    '.pk-pop-clear:hover{color:var(--ink)}';
  var st = document.createElement('style');
  st.id = 'plume-pk-css';
  st.appendChild(document.createTextNode(css));
  document.head.appendChild(st);
}

var pkPop = null;   // { el, select, items, group, hi }
function pkStockHtml(it) {
  var n = pkStock(it);
  return '<span class="st' + (n > 0 ? '' : ' out') + '"><b>' + n + '</b> in stock</span>';
}
function pkButtonHtml(select, items) {
  var it = null;
  for (var i = 0; i < items.length; i++) if (items[i].id === select.value) { it = items[i]; break; }
  if (!it) return '<span class="pk-thumb">' + pkIcon('other', '') + '</span><span class="pk-pb-t">Pick packaging</span><span class="pk-pb-c">' + icon('chevron') + '</span>';
  return '<span class="pk-thumb">' + pkIconFor(it) + '</span><span class="pk-pb-t">' + esc(pkDisplay(it)) + '</span>' +
         (select.__pkNoStock ? '' : '<span class="pk-pb-s">' + pkStock(it) + ' in stock</span>') + '<span class="pk-pb-c">' + icon('chevron') + '</span>';
}
// opts.stock === false leaves the stock count off the button and the list.
// Products & Costing does that (her call, 2026-10-19): a product's
// packaging list says what goes around each unit, not what is on hand.
function pkPicker(select, items, opts) {
  if (!select || select.getAttribute('data-pk-done')) return;
  if (opts && opts.stock === false) select.__pkNoStock = true;
  pkCss();
  items = items || [];
  select.setAttribute('data-pk-done', '1');
  select.style.display = 'none';
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'pk-pick-btn' + (select.value ? '' : ' empty');
  b.setAttribute('aria-haspopup', 'listbox');
  b.innerHTML = pkButtonHtml(select, items);
  b.onclick = function (e) { e.stopPropagation(); pkOpen(select, items, b); };
  select.parentNode.insertBefore(b, select.nextSibling);
  select.__pkBtn = b;
}
function pkPickers(root, items, opts) {
  var list = (root || document).querySelectorAll('select[data-pk-pick]');
  for (var i = 0; i < list.length; i++) pkPicker(list[i], items, opts);
}
function pkOpen(select, items, btn) {
  pkClose();
  var el = document.createElement('div');
  el.className = 'pk-pop';
  el.setAttribute('role', 'dialog');
  el.innerHTML =
    '<label class="pk-pop-search">' + icon('search') + '<input type="search" placeholder="Type to narrow: blue, 1 oz, serum…" aria-label="Search packaging"></label>' +
    '<div class="pk-pop-chips"></div><div class="pk-pop-list" role="listbox"></div>' +
    (select.value ? '<button type="button" class="pk-pop-clear">Clear the choice</button>' : '');
  document.body.appendChild(el);
  pkPop = { el: el, select: select, items: items, btn: btn, group: '', hi: -1 };
  // Below the button, or above it when the window has no room underneath.
  // Worked out in screen pixels, then divided by the zoom (see Size).
  var z = zoom(), r = btn.getBoundingClientRect();
  var vw = window.innerWidth, vh = window.innerHeight;
  var w = Math.min(Math.max(r.width, 380 * z), vw - 16);
  var left = Math.max(8, Math.min(r.left, vw - w - 8));
  var below = vh - r.bottom - 12, above = r.top - 12;
  var h = Math.min(440 * z, Math.max(below, above));
  el.style.width = (w / z) + 'px'; el.style.left = (left / z) + 'px'; el.style.maxHeight = (h / z) + 'px';
  if (below >= 260 * z || below >= above) el.style.top = ((r.bottom + 4) / z) + 'px';
  else el.style.bottom = ((vh - r.top + 4) / z) + 'px';
  var input = el.querySelector('input');
  input.oninput = function () { pkPop.hi = -1; pkRenderPop(); };
  input.onkeydown = pkPopKey;
  var clr = el.querySelector('.pk-pop-clear');
  if (clr) clr.onclick = function () { pkChoose(''); };
  el.addEventListener('click', function (e) { e.stopPropagation(); });
  pkRenderPop();
  setTimeout(function () { input.focus(); }, 0);
}
function pkRenderPop() {
  if (!pkPop) return;
  var p = pkPop, el = p.el;
  var q = el.querySelector('input').value;
  var present = {};
  p.items.forEach(function (it) { present[it.kind ? pkKindOf(it).group : 'sort'] = 1; });
  var ch = '<button type="button" data-g=""' + (p.group ? '' : ' class="on"') + '>All</button>';
  PK_GROUPS.forEach(function (g) {
    if (present[g.key]) ch += '<button type="button" data-g="' + g.key + '"' + (p.group === g.key ? ' class="on"' : '') + '>' + esc(g.short) + '</button>';
  });
  if (present.sort) ch += '<button type="button" data-g="sort"' + (p.group === 'sort' ? ' class="on"' : '') + '>Needs sorting</button>';
  el.querySelector('.pk-pop-chips').innerHTML = ch;
  var cb = el.querySelectorAll('.pk-pop-chips button');
  for (var c = 0; c < cb.length; c++) cb[c].onclick = function () { pkPop.group = this.getAttribute('data-g'); pkPop.hi = -1; pkRenderPop(); };
  var list = p.items.filter(function (it) {
    return (!p.group || (it.kind ? pkKindOf(it).group : 'sort') === p.group) && pkMatches(it, q);
  });
  var h = '', n = 0;
  pkGroups(list).forEach(function (g) {
    h += '<div class="pk-pop-g">' + esc(g.name) + '</div>';
    g.items.forEach(function (it) {
      h += '<div class="pk-pop-i' + (it.id === p.select.value ? ' sel' : '') + (n === p.hi ? ' hi' : '') + '" role="option" data-id="' + esc(it.id) + '" data-n="' + n + '">' +
        '<span class="pk-thumb">' + pkIconFor(it) + '</span>' +
        '<span class="l1">' + (it.kind && it.capacity ? '<span class="pk-size">' + esc(it.capacity) + '</span>' : '') + pkDetailHtml(it) + '</span>' +
        (p.select.__pkNoStock ? '' : pkStockHtml(it)) + '</div>';
      n++;
    });
  });
  var box = el.querySelector('.pk-pop-list');
  box.innerHTML = h || '<div class="pk-pop-none">' + (p.items.length ? 'Nothing matches.' : 'No packaging items yet. Add them in Packaging.') + '</div>';
  var rows = box.querySelectorAll('.pk-pop-i');
  for (var i = 0; i < rows.length; i++) rows[i].onclick = function () { pkChoose(this.getAttribute('data-id')); };
  var hi = box.querySelector('.pk-pop-i.hi');
  if (hi && hi.scrollIntoView) hi.scrollIntoView({ block: 'nearest' });
}
function pkPopKey(e) {
  if (!pkPop) return;
  var rows = pkPop.el.querySelectorAll('.pk-pop-i');
  if (e.key === 'ArrowDown') { e.preventDefault(); pkPop.hi = Math.min(rows.length - 1, pkPop.hi + 1); pkRenderPop(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); pkPop.hi = Math.max(0, pkPop.hi - 1); pkRenderPop(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    var r = rows[pkPop.hi >= 0 ? pkPop.hi : 0];
    if (r) pkChoose(r.getAttribute('data-id'));
  } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); var b = pkPop.btn; pkClose(); if (b) b.focus(); }
}
function pkChoose(id) {
  if (!pkPop) return;
  var s = pkPop.select, items = pkPop.items, b = pkPop.btn;
  pkClose();
  s.value = id;
  if (b && b.parentNode) { b.innerHTML = pkButtonHtml(s, items); b.classList.toggle('empty', !s.value); }
  var ev;
  try { ev = new Event('change', { bubbles: true }); } catch (x) { ev = document.createEvent('Event'); ev.initEvent('change', true, true); }
  s.dispatchEvent(ev);
}
function pkClose() {
  if (pkPop && pkPop.el.parentNode) pkPop.el.parentNode.removeChild(pkPop.el);
  pkPop = null;
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('click', function () { if (pkPop) pkClose(); });
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', function () { if (pkPop) pkClose(); });
    // A fixed list would drift from its button when the page scrolls.
    window.addEventListener('scroll', function (e) { if (pkPop && !pkPop.el.contains(e.target)) pkClose(); }, true);
  }
}

// ══ Fills (2026-10-19) ════════════════════════════════
// A batch is bulk: what was made, with the ingredients it took. A fill is
// production, logged on the product in Products & Costing's inline row. One
// fill counts the units, takes the product's packaging list (times the
// units) out of packaging stock, and takes the grams (units x net weight,
// per part for a sample pack) from the batch it came from. Reversing it
// puts both back. Batches only report: bulk left, and where it went.
// (Heide's model, settled 2026-10-19 after a slide-in fill panel in v1.29
// proved too much; v1.30 went back to the inline row she liked.)
//
// A fill is saved as one of the product's productionRuns (the old field
// name, so backups and older data still load), marked fill: true, with
//   draws:     [{ batchId, formulaId, grams }]   one per part; grams may be
//              0 when the product has no net weight, and the batch is still
//              recorded (v1.29 lost it in that case)
//   packaging: [{ packagingId, packagingName, quantity }]   what left stock
// Each packaging item it took from gets an adjustment carrying fillId, so
// reversing the fill removes exactly those. A batch's grams left are
// worked out from the fills every time, never stored.
//
// Runs logged before fills have no draws. One linked to a batch counts
// units x the product's net weight against it (her call). They never
// pulled packaging, so reversing one returns none.
function batchMadeG(b) {
  if (!b) return 0;
  return parseFloat(b.actualYield) || parseFloat(b.targetYield) || 0;
}
function fillDraws(run, p) {
  if (!run) return [];
  if (run.draws) return run.draws;
  if (run.batchId && p && p.productKind !== 'multi') {
    var g = (parseInt(run.units, 10) || 0) * (parseFloat(p.netWtG) || 0);
    return [{ batchId: run.batchId, grams: g }];
  }
  return [];
}
// Every fill (and older run) that drew on a batch, newest first:
// [{ product, run, grams }]. Grams are this batch's share only.
function batchFills(batchId, products) {
  var out = [];
  (products || []).forEach(function (p) {
    (p.productionRuns || []).forEach(function (r) {
      var g = 0, hit = r.batchId === batchId;
      fillDraws(r, p).forEach(function (d) {
        if (d.batchId === batchId) { g += parseFloat(d.grams) || 0; hit = true; }
      });
      if (hit) out.push({ product: p, run: r, grams: g });
    });
  });
  out.sort(function (a, b) {
    return (b.run.date || '').localeCompare(a.run.date || '') || (b.run.addedAt || '').localeCompare(a.run.addedAt || '');
  });
  return out;
}
function batchUsedG(batchId, products) {
  var t = 0;
  batchFills(batchId, products).forEach(function (f) { t += f.grams; });
  return t;
}
// Made less filled: the arithmetic. Can go below zero when more was filled
// than the yield says.
function batchNumbersG(b, products) { return batchMadeG(b) - batchUsedG(b && b.id, products); }
// What the page shows. A batch marked Used up reads 0 g whatever the
// arithmetic says: what is left is residue (her call).
function batchLeftG(b, products) {
  if (b && b.status === 'depleted') return 0;
  return batchNumbersG(b, products);
}
// The batches a fill can come from: the same formulation, not discarded
// or used up, OLDEST first (FIFO, her call; ingredient lots work the same).
function fillBatches(batches, formulaId) {
  return (batches || []).filter(function (b) {
    return b && formulaId && b.formulaId === formulaId && b.status !== 'discarded' && b.status !== 'depleted';
  }).sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
}
// The batch a new fill starts on: the oldest ready batch with bulk left,
// then the oldest curing one with bulk left, then the oldest of any. ''
// when there is none, which means "Not from a logged batch".
function fillDefaultBatch(batches, formulaId, products) {
  var list = fillBatches(batches, formulaId), i;
  for (i = 0; i < list.length; i++) if (list[i].status !== 'curing' && batchLeftG(list[i], products) > 0) return list[i].id;
  for (i = 0; i < list.length; i++) if (batchLeftG(list[i], products) > 0) return list[i].id;
  return list.length ? list[0].id : '';
}
function batchLabel(b) { return (b && (b.batchName || b.formulaName)) || 'Batch'; }

// ══ Lot codes and the formulation log (2026-10-20) ════
// The lot is the BATCH (her call). Its code is the date made as YYMMDD,
// with a letter only for a second batch that day: 261020, 261020B,
// 261020C. Plume assigns it when the batch is made; she can change it, but
// two batches may never share a code, since a shared code cannot be traced.
// Fills keep a copy of the code on each draw, so a fill still names its
// lot after the batch is gone. Changing a batch's date later does not
// change its code: a code already written on a jar must not move.
function lotBase(dateISO) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateISO || ''));
  return m ? m[1].slice(2) + m[2] + m[3] : '';
}
function lotNorm(code) { return String(code == null ? '' : code).toUpperCase().replace(/\s+/g, ''); }
// Every code in use: on batches (one may be left out, the one being
// edited) and on fills, which keep the codes of deleted batches too.
function lotsInUse(batches, products, exceptId) {
  var used = {};
  (batches || []).forEach(function (b) { if (b && b.lotCode && b.id !== exceptId) used[lotNorm(b.lotCode)] = b; });
  (products || []).forEach(function (p) {
    (p.productionRuns || []).forEach(function (r) {
      (r.draws || []).forEach(function (d) { if (d && d.lot && !used[lotNorm(d.lot)]) used[lotNorm(d.lot)] = true; });
    });
  });
  return used;
}
var LOT_LETTERS = 'BCDEFGHIJKLMNOPQRSTUVWXYZ';
function nextLotCode(dateISO, batches, products, exceptId) {
  var base = lotBase(dateISO || todayISO());
  var used = lotsInUse(batches, products, exceptId);
  if (!used[base]) return base;
  for (var i = 0; i < LOT_LETTERS.length; i++) if (!used[base + LOT_LETTERS[i]]) return base + LOT_LETTERS[i];
  for (var n = 27; ; n++) if (!used[base + '-' + n]) return base + '-' + n;
}
// { code } when it can be used, { code, error } when not. Letters, digits
// and dashes, up to 20; stored in capitals.
function lotCheck(code, batches, exceptId) {
  var c = lotNorm(code);
  if (!c) return { code: c, error: 'A batch needs a lot code.' };
  if (!/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(c)) return { code: c, error: 'A lot code is letters, digits and dashes, up to 20.' };
  for (var i = 0; i < (batches || []).length; i++) {
    var b = batches[i];
    if (b && b.id !== exceptId && lotNorm(b.lotCode) === c) {
      return { code: c, error: 'Lot ' + c + ' is already ' + batchLabel(b) + ' (' + fmtDate(b.date) + '). Two batches cannot share a lot code.' };
    }
  }
  return { code: c };
}
function batchLot(b) { return (b && b.lotCode) || ''; }
// Lot stickers (2026-10-20; moved here from the barcode tool the same day,
// her call: the sticker stays with the batch). Plain text, no barcode:
// "LOT 261020" as large as fits, an optional second line beneath. SVG in
// mils so it prints at exact size, one sticker per page like a sticker roll.
var LOT_STICKER_KEY = 'plume-lot-sticker';
function lotStickerSize() {
  var s = null;
  try { s = JSON.parse(localStorage.getItem(LOT_STICKER_KEY) || 'null'); } catch (e) {}
  return { w: (s && s.w) || 1.5, h: (s && s.h) || 0.5 };
}
function lotStickerRemember(w, h) {
  try { localStorage.setItem(LOT_STICKER_KEY, JSON.stringify({ w: w, h: h })); } catch (e) {}
}
function lotStickerSvg(code, line2, wIn, hIn) {
  var W = wIn * 1000, H = hIn * 1000, pad = Math.min(W, H) * 0.08;
  var main = 'LOT ' + code;
  var mainH = line2 ? (H - 2 * pad) * 0.62 : (H - 2 * pad) * 0.8;
  var mainSize = Math.min(mainH, (W - 2 * pad) / (main.length * 0.62));
  var subSize = line2 ? Math.min((H - 2 * pad) * 0.26, (W - 2 * pad) / (line2.length * 0.55)) : 0;
  var gap = line2 ? subSize * 0.35 : 0;
  var block = mainSize * 0.78 + (line2 ? gap + subSize * 0.78 : 0);
  var y0 = (H - block) / 2 + mainSize * 0.78;
  var out = '<text x="' + (W / 2).toFixed(1) + '" y="' + y0.toFixed(1) + '" font-family="Helvetica,Arial,sans-serif" font-size="' + mainSize.toFixed(1) +
    '" font-weight="700" text-anchor="middle" fill="#000" letter-spacing="' + (mainSize * 0.02).toFixed(1) + '">' + esc(main) + '</text>';
  if (line2) {
    out += '<text x="' + (W / 2).toFixed(1) + '" y="' + (y0 + gap + subSize * 0.78).toFixed(1) + '" font-family="Helvetica,Arial,sans-serif" font-size="' + subSize.toFixed(1) +
      '" text-anchor="middle" fill="#000">' + esc(line2) + '</text>';
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" class="bc-lot-svg" viewBox="0 0 ' + W.toFixed(1) + ' ' + H.toFixed(1) + '" width="' + wIn + 'in" height="' + hIn + 'in">' + out + '</svg>';
}
// Opens the print window. Returns false when the browser blocked it.
function printLotStickers(code, line2, wIn, hIn, copies) {
  copies = Math.max(1, Math.min(500, parseInt(copies, 10) || 1));
  var svg = lotStickerSvg(code, line2, wIn, hIn), labels = '';
  for (var i = 0; i < copies; i++) labels += '<div class="lbl">' + svg + '</div>';
  var css = '@page { size: ' + wIn + 'in ' + hIn + 'in; margin: 0; }' +
    'html, body { margin:0; padding:0; }' +
    '.lbl { width:' + wIn + 'in; height:' + hIn + 'in; display:flex; align-items:center; justify-content:center; overflow:hidden; ' +
      'page-break-after:always; break-after:page; box-sizing:border-box; }' +
    '.lbl:last-child { page-break-after:auto; break-after:auto; }' +
    '.lbl svg { display:block; }';
  var win = window.open('', '_blank');
  if (!win) return false;
  win.document.write('<!DOCTYPE html><html><head><title>' + esc('Lot ' + code + ' stickers') + '</title><style>' + css + '</style></head><body>' + labels +
    '<scr' + 'ipt>window.onload=function(){window.print();};<\/scr' + 'ipt></body></html>');
  win.document.close();
  return true;
}

// The chip: "LOT 261020", a link when href is given.
function lotChip(code, href) {
  if (!code) return '';
  var inner = '<small>LOT</small>' + esc(code);
  return href ? '<a class="ps-lot" href="' + esc(href) + '">' + inner + '</a>' : '<span class="ps-lot">' + inner + '</span>';
}
// A fill draw's lot: the batch's code while the batch exists, else the copy
// the fill kept.
function drawLot(d, batches) {
  if (!d) return '';
  var b = d.batchId ? fillFind(batches, d.batchId) : null;
  return (b && b.lotCode) || d.lot || '';
}
// A version's name as Formulations shows it: its label, else Version N.
function varTitle(v) { return v ? (v.label ? v.label : 'Version ' + (v.num || 1)) : ''; }
function findVariant(f, vid) {
  var vs = (f && f.variants) || [];
  for (var i = 0; i < vs.length; i++) if (vs[i].vid === vid) return vs[i];
  return null;
}
// The version a batch was made from, as text: "Sepinov", "Version 2", or
// '' when it was not recorded (batches made before 2026-10-20 from a
// formulation with more than one version).
function batchVersion(b) { return (b && b.variantLabel) || ''; }

// Gives older batches what new ones are made with. Lot codes in date order
// (made-time order within a day), and the version where the formulation
// has only one. Returns true when anything changed, so the page saves.
function migrateBatches(batches, forms, products) {
  var changed = false;
  var need = (batches || []).filter(function (b) { return b && !b.lotCode; });
  need.sort(function (a, b) {
    return (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || '') || String(a.id).localeCompare(String(b.id));
  });
  need.forEach(function (b) {
    b.lotCode = nextLotCode(b.date || (b.createdAt || '').slice(0, 10), batches, products, b.id);
    changed = true;
  });
  (batches || []).forEach(function (b) {
    if (!b || b.variantId) return;
    var f = fillFind(forms, b.formulaId);
    var vs = (f && f.variants) || [];
    if (vs.length === 1) { b.variantId = vs[0].vid; b.variantLabel = varTitle(vs[0]); changed = true; }
  });
  return changed;
}

// The formulation log entry for a batch, wherever it is: { form, variant,
// entry } or null. One entry per batch (her call, 2026-10-20): she links an
// entry to a batch by hand, and a batch that has one opens it rather than
// starting a second. Entries live on a version's usageLog (field name kept).
function logEntryFor(forms, batchId) {
  if (!batchId) return null;
  for (var i = 0; i < (forms || []).length; i++) {
    var vs = (forms[i] && forms[i].variants) || [];
    for (var j = 0; j < vs.length; j++) {
      var log = vs[j].usageLog || [];
      for (var k = 0; k < log.length; k++) if (log[k] && log[k].batchId === batchId) return { form: forms[i], variant: vs[j], entry: log[k] };
    }
  }
  return null;
}

// The parts a fill draws on: one for a single product, one per component
// of a sample pack. [{ formulaId, g, label }]
function fillParts(p, forms) {
  var nm = function (id) { for (var i = 0; i < (forms || []).length; i++) if (forms[i].id === id) return forms[i].name || ''; return ''; };
  if (!p) return [];
  if (p.productKind === 'multi') {
    return (p.components || []).filter(function (c) { return c.formulaId; })
      .map(function (c) { return { formulaId: c.formulaId, g: parseFloat(c.netWtG) || 0, label: c.label || nm(c.formulaId) }; });
  }
  return p.formulaId ? [{ formulaId: p.formulaId, g: parseFloat(p.netWtG) || 0, label: nm(p.formulaId) }] : [];
}
// The product's packaging list times the units, one line per item.
function fillPkgNeeds(p, units) {
  var need = {}, order = [];
  ((p && p.packagingRecipe) || []).forEach(function (r) {
    var q = (parseFloat(r.quantity) || 0) * units;
    if (!r.packagingId || q <= 0) return;
    if (!(r.packagingId in need)) { need[r.packagingId] = 0; order.push(r.packagingId); }
    need[r.packagingId] += q;
  });
  return order.map(function (id) { return { packagingId: id, quantity: Math.ceil(need[id] - 1e-9) }; });
}
function fillFind(list, id) {
  for (var i = 0; i < (list || []).length; i++) if (list[i] && list[i].id === id) return list[i];
  return null;
}
// Items a fill of `units` would take more of than is in stock. A fill is
// not allowed while any are short (her call: short means stock was not
// entered, entered wrong, or the wrong thing was picked).
function fillShortages(pkgs, p, units) {
  var out = [];
  if (!pkgTracked()) return out;
  fillPkgNeeds(p, units).forEach(function (n) {
    var it = fillFind(pkgs, n.packagingId), have = it ? pkStock(it) : 0;
    if (n.quantity > have) out.push({ packagingId: n.packagingId, name: it ? pkDisplay(it) : '(a deleted packaging item)', need: n.quantity, have: have });
  });
  return out;
}
// Takes the packaging out of stock and records it on the run.
function fillPull(pkgs, p, run, verb) {
  run.packaging = [];
  if (!pkgTracked()) { run.pkgUntracked = true; return; }
  fillPkgNeeds(p, parseInt(run.units, 10) || 0).forEach(function (n) {
    var it = fillFind(pkgs, n.packagingId);
    if (!it) return;
    if (!it.adjustments) it.adjustments = [];
    var why = (verb || 'Filled') + ': ' + (p.name || 'a product');
    it.adjustments.push({ id: 'fill-' + run.id + '-' + it.id, qty: -n.quantity, date: run.date, note: why, reason: why, productId: p.id, fillId: run.id });
    run.packaging.push({ packagingId: it.id, packagingName: pkDisplay(it), quantity: n.quantity });
  });
}
// Puts a fill's packaging back. Returns how many items it touched.
function fillReturn(pkgs, runId) {
  var n = 0;
  (pkgs || []).forEach(function (it) {
    if (!it || !it.adjustments) return;
    var before = it.adjustments.length;
    it.adjustments = it.adjustments.filter(function (a) { return a.fillId !== runId; });
    if (it.adjustments.length !== before) n++;
  });
  return n;
}
// f: { date, units, notes, draws: [{ batchId, formulaId, grams }] }
// batches (optional): each draw keeps its batch's lot code, so the fill
// still names its lot if the batch is deleted later.
function makeFill(p, f, pkgs, batches) {
  var draws = (f.draws || []).filter(function (d) { return d.batchId; });
  if (batches) draws.forEach(function (d) { var b = fillFind(batches, d.batchId); if (b && b.lotCode) d.lot = b.lotCode; });
  var run = {
    id:      Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    date:    f.date || todayISO(),
    units:   f.units,
    batchId: draws.length ? draws[0].batchId : null,
    notes:   f.notes || '',
    addedAt: new Date().toISOString(),
    fill:    true,
    draws:   draws
  };
  fillPull(pkgs, p, run);
  if (!p.productionRuns) p.productionRuns = [];
  p.productionRuns.push(run);
  p.updatedAt = run.addedAt;
  return run;
}
// Removes a fill (or an older run) from its product and returns its
// packaging to stock. The page asks first and saves after.
function undoFill(p, runId, pkgs) {
  var run = null;
  (p.productionRuns || []).forEach(function (r) { if (r.id === runId) run = r; });
  if (!run) return null;
  if (run.fill) fillReturn(pkgs, runId);
  p.productionRuns = p.productionRuns.filter(function (r) { return r.id !== runId; });
  p.updatedAt = new Date().toISOString();
  return run;
}
// What reversing says: the packaging that goes back, and the grams.
function undoFillText(p, run) {
  var bits = [];
  if (run.fill && run.packaging && run.packaging.length) {
    bits.push('This puts back into packaging stock:\n' + run.packaging.map(function (c) { return '  ' + c.quantity + ' x ' + c.packagingName; }).join('\n'));
  } else if (!run.fill) {
    bits.push('This was logged before packaging was taken for fills, so none goes back.');
  }
  var g = 0;
  fillDraws(run, p).forEach(function (d) { g += parseFloat(d.grams) || 0; });
  if (g > 0) bits.push('Its ' + fmtG(g) + ' go back to the batch it came from.');
  return bits.join('\n\n');
}
function fmtG(g) {
  g = Math.round((parseFloat(g) || 0) * 10) / 10;
  return (Math.abs(g) >= 1000 ? g.toLocaleString('en-US') : String(g)) + ' g';
}

// ══ Units on hand and kits (2026-10-20) ═══════════════
// Her way of working: fill products (minis included) from batches, then
// build kits from what is filled, adding the kit's own packaging. So a
// product has units on hand:
//   filled (every fill and older run; for a kit, every kit built)
//   + its stock log: taken out (sold, given away), counted (a recount, the
//     difference from what Plume thought), and units put into kits.
// Plume is not a point of sale; taking out is optional.
// p.stockLog: [{ id, date, qty (signed), kind: 'out' | 'count' | 'kit',
//   note, counted (count only), kitId and buildId (kit only) }]
// Why units left the shelf (her list, 2026-10-20). Each lowers on hand;
// the reason is kept so losses can be counted apart from sales later.
var STOCK_REASONS = [
  { key: 'sold',      label: 'Sold',      hint: 'at a market, a shop or online' },
  { key: 'gifted',    label: 'Gifted',    hint: 'given to friends or family' },
  { key: 'marketing', label: 'Marketing', hint: 'giveaways, demos, samples for shops' },
  { key: 'damaged',   label: 'Damaged',   hint: 'broken, spoiled or spilled' },
  // Adds units back (2026-10-20): consignment that did not sell, a return.
  { key: 'returned',  label: 'Returned',  hint: 'a customer return, or consignment from before shops were tracked here', back: true }
];
function reasonBack(k) { for (var i = 0; i < STOCK_REASONS.length; i++) if (STOCK_REASONS[i].key === k) return !!STOCK_REASONS[i].back; return false; }
function stockReasonLabel(k) {
  for (var i = 0; i < STOCK_REASONS.length; i++) if (STOCK_REASONS[i].key === k) return STOCK_REASONS[i].label;
  return 'Taken out';
}
// Consignment (2026-10-20): units moved to a shop leave the SHELF but are
// still hers. Entries with a shopId carry shopQty, the change at that shop:
//   kind 'move'  qty -n, shopQty +n   consigned to the shop
//   kind 'move'  qty +n, shopQty -n   came back from the shop
//   kind 'out'   qty 0,  shopQty -n   sold at the shop (reason 'sold')
// On hand is the shelf: what can be sold directly or built into kits.
function onHandParts(p) {
  var o = { filled: 0, out: 0, kits: 0, counted: 0, moved: 0, soldAtShops: 0, total: 0, byReason: {} };
  ((p && p.productionRuns) || []).forEach(function (r) { o.filled += parseInt(r.units, 10) || 0; });
  ((p && p.stockLog) || []).forEach(function (e) {
    var q = parseFloat(e.qty) || 0;
    if (e.kind === 'kit') o.kits += q; else if (e.kind === 'count') o.counted += q;
    else if (e.kind === 'move') o.moved += q;
    else if (e.shopId) o.soldAtShops += -(parseFloat(e.shopQty) || 0);
    else { o.out += q; var r = e.reason || 'out'; o.byReason[r] = (o.byReason[r] || 0) + q; }
  });
  o.total = o.filled + o.out + o.kits + o.counted + o.moved;
  return o;
}
// Units of a product at shops: { total, by: { shopId: units } }.
function atShops(p) {
  var o = { total: 0, by: {} };
  ((p && p.stockLog) || []).forEach(function (e) {
    if (!e.shopId) return;
    var q = parseFloat(e.shopQty) || 0;
    o.by[e.shopId] = (o.by[e.shopId] || 0) + q;
    o.total += q;
  });
  return o;
}
function onHand(p) { return onHandParts(p).total; }
function isKit(p) { return !!p && p.productKind === 'kit'; }
// What a product can go into a kit as: a product made from one
// formulation. Kits are not parts of kits; older formulation packs neither.
function kitPartOk(p) { return !!p && p.productKind !== 'kit' && p.productKind !== 'multi'; }
// [{ productId, qty, product }] with a positive whole qty.
function kitParts(kit, products) {
  return ((kit && kit.kitParts) || []).map(function (k) {
    return { productId: k.productId, qty: parseInt(k.qty, 10) || 0, product: fillFind(products, k.productId) };
  }).filter(function (k) { return k.productId && k.qty > 0; });
}
// Each part's units for `units` kits, added up per product.
function kitNeeds(kit, units, products) {
  var need = {}, order = [];
  kitParts(kit, products).forEach(function (k) {
    if (!(k.productId in need)) { need[k.productId] = 0; order.push(k.productId); }
    need[k.productId] += k.qty * units;
  });
  return order.map(function (id) {
    var pr = fillFind(products, id);
    return { productId: id, name: pr ? (pr.name || '(unnamed)') : '(a deleted product)', need: need[id], have: pr ? onHand(pr) : 0, missing: !pr };
  });
}
// A build is not allowed while a part is short (her rule, as for packaging:
// short means a fill was not logged).
function kitShortages(kit, units, products) {
  return kitNeeds(kit, units, products).filter(function (n) { return n.missing || n.need > n.have; });
}
// Builds `f.units` kits: takes each part's units from its product, the
// kit's packaging list from stock, and records the build on the kit.
// f: { date, units, notes }. Changes products and pkgs; the page saves.
function buildKit(products, kit, f, pkgs) {
  var run = {
    id:      Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    date:    f.date || todayISO(),
    units:   parseInt(f.units, 10) || 0,
    notes:   f.notes || '',
    addedAt: new Date().toISOString(),
    fill:    true,
    kit:     true,
    parts:   []
  };
  kitNeeds(kit, run.units, products).forEach(function (n) {
    var pr = fillFind(products, n.productId);
    if (!pr) return;
    if (!pr.stockLog) pr.stockLog = [];
    pr.stockLog.push({ id: 'kit-' + run.id + '-' + pr.id, date: run.date, qty: -n.need, kind: 'kit',
      note: 'Into kit: ' + (kit.name || 'a kit'), kitId: kit.id, buildId: run.id });
    run.parts.push({ productId: pr.id, productName: pr.name || '', quantity: n.need });
  });
  fillPull(pkgs, kit, run, 'Kit built');
  if (!kit.productionRuns) kit.productionRuns = [];
  kit.productionRuns.push(run);
  kit.updatedAt = run.addedAt;
  return run;
}
// Reverses a build: the parts' units come back, the packaging goes back
// to stock, the build leaves the kit. Returns the run, or null.
function undoKitBuild(products, kit, runId, pkgs) {
  var run = null;
  ((kit && kit.productionRuns) || []).forEach(function (r) { if (r.id === runId) run = r; });
  if (!run) return null;
  (products || []).forEach(function (pr) {
    if (pr && pr.stockLog) pr.stockLog = pr.stockLog.filter(function (e) { return e.buildId !== runId; });
  });
  fillReturn(pkgs, runId);
  kit.productionRuns = kit.productionRuns.filter(function (r) { return r.id !== runId; });
  return run;
}
function undoKitText(run) {
  var bits = [];
  if (run.parts && run.parts.length) bits.push('These go back on hand:\n' + run.parts.map(function (c) { return '  ' + c.quantity + ' x ' + c.productName; }).join('\n'));
  if (run.packaging && run.packaging.length) bits.push('This puts back into packaging stock:\n' + run.packaging.map(function (c) { return '  ' + c.quantity + ' x ' + c.packagingName; }).join('\n'));
  return bits.join('\n\n');
}
// Kits a product goes into (by id), for "Used in" notes and delete warnings.
function kitsUsing(productId, products) {
  return (products || []).filter(function (k) {
    return isKit(k) && (k.kitParts || []).some(function (x) { return x.productId === productId; });
  });
}
// The stock panel: one pass over many products. entries: [{ productId,
// value }]; opts: { mode: 'out' | 'count', date, note }. Taken out records
// -value; counted records the difference from on hand (kept even when it
// is 0, so the count shows in the history). Returns how many changed.
function stockPass(products, entries, opts) {
  opts = opts || {};
  var n = 0, stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  // What each unit cost on the day (her call): a report keeps that month's
  // prices, as batches keep theirs. Not for units into kits (not a loss).
  var cd = opts.costs === false ? null : costData({ products: products });
  (entries || []).forEach(function (en, i) {
    var pr = fillFind(products, en.productId);
    var v = parseFloat(en.value);
    if (!pr || isNaN(v) || v < 0) return;
    if (opts.mode === 'out' && v === 0) return;
    var e = { id: 'st-' + stamp + '-' + i, date: opts.date || todayISO(), kind: opts.mode === 'count' ? 'count' : 'out', note: opts.note || '' };
    if (e.kind === 'out' && opts.reason) e.reason = opts.reason;
    if (cd) { var uc = productUnitCost(pr, cd); if (uc > 0) e.unitCost = Math.round(uc * 10000) / 10000; }
    if (e.kind === 'count') { e.counted = v; e.qty = v - onHand(pr); }
    else e.qty = reasonBack(opts.reason) ? v : -v;
    if (!pr.stockLog) pr.stockLog = [];
    pr.stockLog.push(e);
    pr.updatedAt = new Date().toISOString();
    n++;
  });
  return n;
}
// Reversing a fill takes its units off hand again. Not allowed when that
// would leave the product below zero: some of those units already went
// into kits or off the shelf (her call, 2026-10-20).
function fillUndoBlock(p, run) {
  if (!p || !run || isKit(p)) return '';
  var after = onHand(p) - (parseInt(run.units, 10) || 0);
  if (after >= 0) return '';
  var o = onHandParts(p), went = [];
  if (o.kits) went.push((-o.kits) + ' into kits');
  if (o.out) went.push((-o.out) + ' off the shelf');
  if (o.moved < 0) went.push((-o.moved) + ' to shops');
  return 'Only ' + Math.max(0, onHand(p)) + ' of these are on hand' + (went.length ? ' (' + went.join(', ') + ')' : '') +
    ', so reversing this fill of ' + run.units + ' would leave ' + after + '. Reverse the kit builds that used them, or remove the stock changes, first.';
}
// ── A product's unit cost, from any page (2026-10-20) ─────────────────
// Transcribed from Products & Costing (formulationCostDetail, pkgUnitCost,
// computeProductCost) so Update stock can record what each unit cost when
// it left the shelf. test-kits.js checks the two agree on every product.
// d: { ings, forms, pkgs, products }; anything missing is read from Store.
function costData(d) {
  d = d || {};
  var g = function (k) { var l = Store.getJSON(k, []); return Array.isArray(l) ? l : []; };
  return { ings: d.ings || g('aerie-ingredients-v2'), forms: d.forms || g('aerie-formulations-v1'),
           pkgs: d.pkgs || g('aerie-packaging-v2'), products: d.products || g('plume-products-v1') };
}
// ── A formula line's share of the batch, in percent (2026-10-24) ──────
// Formulations keeps BOTH grams and a percent on a line once grams are typed
// (onGrams, onSoapGrams, togglePin), so a reader that takes gramsFixed when
// it is set and pct otherwise adds grams to percents. That priced a lotion
// with glycerin typed as 10 g at ~2.8 times its true cost per gram. This is
// the editor's own rule, in one place:
//   - pinned: its grams at the version's batch size (as the editor shows it)
//   - a percent line: its percent; grams only when it has no percent (old
//     all-gram soaps), converted at the batch size
//   - an add-in or soap additive: grams at the batch size, or 0 unless
//     opts.addins (cost leaves them out unless "add-ins in total" is on;
//     labels list them)
// The batch size is the active version's, else the type default (soap 1000,
// otherwise 100), as the editor opens it.
function formBatchSize(f) {
  var v = f ? findVariant(f, f.activeVariantId) : null;
  var bs = parseFloat((v && v.batchSize) || (f && f.batchSize));
  if (isFinite(bs) && bs > 0) return bs;
  return f && isSoapType(f.type) ? 1000 : 100;
}
function lineShare(line, f, opts) {
  if (!line) return 0;
  var bs = (opts && opts.bs) || formBatchSize(f);
  var g = parseFloat(line.gramsFixed), p = parseFloat(line.pct);
  g = isFinite(g) && g > 0 ? g : 0; p = isFinite(p) && p > 0 ? p : 0;
  if (line.addin || line.soapAddin) return (opts && opts.addins) ? g / bs * 100 : 0;
  if (line.pinned && g > 0) return g / bs * 100;
  if (p > 0) return p;
  return g / bs * 100;
}
function formCostPerG(f, d) {
  if (!f || !f.lines || !f.lines.length) return null;
  var cost = 0, mass = 0, any = false;
  f.lines.forEach(function (line) {
    if (line.soapAddin) return;
    var cpg = costPerG(fillFind(d.ings, line.ingId));
    var m = lineShare(line, f, { addins: !!f.addinsInTotal });
    if (m <= 0) return;
    mass += m;
    if (cpg !== null) { cost += cpg * m; any = true; }
  });
  return (any && mass > 0) ? cost / mass : null;
}
function pkgUnitCostOf(pkg) {
  if (!pkg || !(pkg.purchases || []).length) return null;
  var sorted = pkg.purchases.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  for (var i = 0; i < sorted.length; i++) {
    var total = parseFloat(sorted[i].totalCost) || 0, ship = parseFloat(sorted[i].shipping) || 0, qty = parseInt(sorted[i].qty, 10) || 0;
    if (qty > 0 && total > 0) return (total + ship) / qty;
  }
  return null;
}
function productUnitCost(p, d) {
  if (!p) return 0;
  d = costData(d);
  var c = 0;
  if (p.productKind === 'kit') {
    kitParts(p, d.products).forEach(function (k) {
      if (k.product && kitPartOk(k.product)) c += productUnitCost(k.product, d) * k.qty;
    });
  } else if (p.productKind === 'multi') {
    (p.components || []).forEach(function (cm) {
      var cpg = formCostPerG(fillFind(d.forms, cm.formulaId), d), wt = parseFloat(cm.netWtG) || 0;
      if (cpg !== null && wt > 0) c += cpg * wt;
    });
  } else {
    var cpg = formCostPerG(fillFind(d.forms, p.formulaId), d), nw = parseFloat(p.netWtG) || 0;
    if (cpg !== null && nw > 0) c += cpg * nw;
  }
  (p.packagingRecipe || []).forEach(function (r) {
    var qty = parseInt(r.quantity, 10) || 0, uc = pkgUnitCostOf(fillFind(d.pkgs, r.packagingId));
    if (qty > 0 && uc !== null) c += uc * qty;
  });
  return c;
}

// ── Update stock: a slide-in panel on every page (2026-10-20) ───────────
// From the sidebar, so it is a quick task from anywhere. Reasons lower on
// hand (Sold, Gifted, Marketing, Damaged); each keeps its own numbers while
// she switches between them, and one Save records them all. Reconcile is
// what is on the shelf now; in the same pass it is applied after the
// reasons. A date and a note cover the whole pass. Units go into kits by
// building the kit in Products & Costing, not here.
var stMode = 'sold', stQ = '', stVals = {};
function stProducts() { var l = Store.getJSON('plume-products-v1', []); return Array.isArray(l) ? l : []; }
function stTypeKey(p, forms) {
  if (p.productKind === 'multi' || p.productKind === 'kit') return 'Sample packs & kits';
  var f = fillFind(forms, p.formulaId);
  return f ? (f.type || 'No type set') : 'No formulation';
}
function stModes() {
  return STOCK_REASONS.concat([{ key: 'consign', label: 'Consign', hint: 'to a shop, to sell for you' }, { key: 'count', label: 'Reconcile', hint: 'how many are on the shelf now' }]);
}
var stShop = '';
function stLabel(m) { var l = stModes(); for (var i = 0; i < l.length; i++) if (l[i].key === m) return l[i]; return l[0]; }
function stRowsHtml() {
  var prods = stProducts(), forms = Store.getJSON('aerie-formulations-v1', []) || [];
  var q = stQ.toLowerCase().trim();
  var list = prods.filter(function (p) { return (p.status || 'active') !== 'discontinued'; })
    .filter(function (p) { return !q || ((p.name || '') + ' ' + (p.sku || '')).toLowerCase().indexOf(q) !== -1; });
  if (!list.length) return '<div class="st-empty">' + (q ? 'No product matches.' : 'No active products yet. They are set up in Products &amp; Costing.') + '</div>';
  var by = {}, order = [];
  list.forEach(function (p) { var t = stTypeKey(p, forms); if (!by[t]) { by[t] = []; order.push(t); } by[t].push(p); });
  order.sort(function (a, b) { return a === 'Sample packs & kits' ? 1 : b === 'Sample packs & kits' ? -1 : a.localeCompare(b); });
  var lbl = stLabel(stMode).label;
  return order.map(function (t) {
    return '<div class="st-type">' + esc(t) + '</div>' + by[t].map(function (p) {
      var oh = onHand(p);
      return '<div class="st-row" data-pid="' + esc(p.id) + '"><div class="st-name">' + esc(p.name || '(unnamed)') +
        (p.notForSale ? '<span class="st-nfs">not for sale</span>' : '') + (p.netWtDisplay ? '<small>' + esc(p.netWtDisplay) + '</small>' : '') + '</div>' +
        '<div class="st-have' + (oh < 0 ? ' st-neg' : '') + '">' + oh + '</div>' +
        '<input type="number" min="0" step="1" inputmode="numeric" data-pid="' + esc(p.id) + '" aria-label="' + esc(lbl + ': ' + (p.name || '')) + '" oninput="Plume.stock.typed()"></div>';
    }).join('');
  }).join('');
}
function stHtml() {
  var m = stLabel(stMode);
  return '<div class="st-panel"><div class="sup-title">' + icon('stock') + '<h2>Update stock</h2></div>' +
    '<div class="st-modes">' + STOCK_REASONS.map(function (r) {
      return '<button type="button" class="ps-chip' + (stMode === r.key ? ' on' : '') + '" onclick="Plume.stock.mode(\'' + r.key + '\')">' + r.label + '<span class="st-mct" data-m="' + r.key + '"></span></button>';
    }).join('') + '<span class="ps-chip-sep"></span>' +
      '<button type="button" class="ps-chip' + (stMode === 'consign' ? ' on' : '') + '" onclick="Plume.stock.mode(\'consign\')">Consign<span class="st-mct" data-m="consign"></span></button>' +
      '<span class="ps-chip-sep"></span>' +
      '<button type="button" class="ps-chip' + (stMode === 'count' ? ' on' : '') + '" onclick="Plume.stock.mode(\'count\')">Reconcile<span class="st-mct" data-m="count"></span></button></div>' +
    (stMode === 'consign' ? '<div class="st-shop"><label for="st-shop">To</label><select id="st-shop" onchange="Plume.stock.shop(this.value)">' + stShopOptions() + '</select></div>' : '') +
    '<p class="st-help">' + (stMode === 'consign'
      ? '<b>Consign</b>: units go from your shelf to the shop, still yours until they sell. <a href="#" id="st-cs-link" onclick="Plume.consign.open(); return false">Shops and settling up</a>'
      : stMode === 'count'
      ? 'How many are on the shelf now. Plume records the difference from what it had. Use this to set real numbers.'
      : '<b>' + m.label + '</b>: ' + m.hint + '. ' + (m.back ? 'These go back on hand.' : 'These come off what is on hand.') + ' Switch reasons to enter more; Save records them all.') + '</p>' +
    '<div class="st-fields"><div><label for="st-date">Date</label><input type="date" id="st-date"></div>' +
      '<div><label for="st-note">Note</label><input type="text" id="st-note" placeholder="e.g. Market, Oct 18"></div></div>' +
    '<label class="ps-search st-search">' + icon('search') + '<input type="search" id="st-q" placeholder="Search products" value="' + esc(stQ) + '" oninput="Plume.stock.search(this.value)" aria-label="Search products"></label>' +
    '<div class="st-cols"><span>Product</span><span>On hand</span><span>' + esc(m.label) + '</span></div>' +
    '<div id="st-rows">' + stRowsHtml() + '</div>' +
    '<div class="st-over" id="st-over" hidden></div>' +
    '<p class="st-rp"><a href="#" onclick="Plume.stock.history(); return false">Stock history</a>: where units went, by market, month or product, and what they cost. ' +
      '<a href="#" id="st-cs-foot" onclick="Plume.consign.open(); return false">Consignment</a>: shops and settling up.</p>' +
    '<div class="st-foot"><span class="st-ct" id="st-ct">Nothing entered yet</span><span class="ps-grow"></span>' +
      '<button type="button" class="ps-link-btn" onclick="Plume.peek.close()">Cancel</button>' +
      '<button type="button" class="ps-btn-primary" id="st-save" onclick="Plume.stock.save()" disabled>Save</button></div></div>';
}
function stShopOptions() {
  var shops = shopsAll().filter(function (x) { return !x.archived; });
  return '<option value="">' + (shops.length ? 'Pick a shop' : 'No shops yet') + '</option>' +
    shops.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === stShop ? ' selected' : '') + '>' + esc(x.name || 'A shop') + '</option>'; }).join('') +
    '<option value="__new">Add a shop…</option>';
}
function stockShop(v) {
  if (v !== '__new') { stShop = v; stTyped(); return; }
  var sel = document.getElementById('st-shop'); if (sel) sel.value = stShop;
  askValue('The name of the shop.', '', function (name) {
    var sh = shopAdd(name);
    if (!sh) return;
    stShop = sh.id;
    if (sel) { sel.innerHTML = stShopOptions(); sel.value = stShop; }
    stTyped();
  }, { title: 'Add a shop', yes: 'Add' });
}
function stKeep() {
  var vals = stVals[stMode] || (stVals[stMode] = {});
  [].forEach.call(document.querySelectorAll('#st-rows input[data-pid]'), function (i) { vals[i.getAttribute('data-pid')] = i.value; });
}
function stRestore() {
  var vals = stVals[stMode] || {};
  [].forEach.call(document.querySelectorAll('#st-rows input[data-pid]'), function (i) {
    var v = vals[i.getAttribute('data-pid')]; i.value = v != null ? v : '';
  });
  stTyped();
}
// { mode: [{ productId, value }] } for every mode with something typed.
function stEntries() {
  stKeep();
  var prods = stProducts(), out = {};
  Object.keys(stVals).forEach(function (m) {
    var list = Object.keys(stVals[m]).filter(function (id) { return String(stVals[m][id]).trim() !== '' && fillFind(prods, id); })
      .map(function (id) { return { productId: id, value: stVals[m][id] }; });
    if (list.length) out[m] = list;
  });
  return out;
}
// Products whose reasons add up to more than is on hand. Not allowed (her
// call): it means a fill was not logged, or the number is wrong. A product
// reconciled in the same pass is fine, since the count wins.
function stOver(en) {
  var prods = stProducts(), tot = {}, counted = {}, out = [];
  (en.count || []).forEach(function (e) { counted[e.productId] = true; });
  STOCK_REASONS.forEach(function (r) {
    (en[r.key] || []).forEach(function (e) { tot[e.productId] = (tot[e.productId] || 0) + (r.back ? -1 : 1) * (parseFloat(e.value) || 0); });
  });
  (en.consign || []).forEach(function (e) { tot[e.productId] = (tot[e.productId] || 0) + (parseFloat(e.value) || 0); });
  Object.keys(tot).forEach(function (id) {
    var p = fillFind(prods, id), have = p ? onHand(p) : 0;
    if (!counted[id] && tot[id] > have) out.push({ productId: id, name: p ? (p.name || '(unnamed)') : '', take: tot[id], have: have });
  });
  return out;
}
function stTyped() {
  var en = stEntries(), bits = [], any = false, over = stOver(en), overIds = {};
  over.forEach(function (o) { overIds[o.productId] = true; });
  [].forEach.call(document.querySelectorAll('#st-rows .st-row'), function (r) {
    var i = r.querySelector('input'); r.classList.toggle('on', !!i && i.value.trim() !== '');
    r.classList.toggle('over', !!overIds[r.getAttribute('data-pid')]);
  });
  stModes().forEach(function (m) {
    var list = en[m.key] || [], ct = document.querySelector('.st-mct[data-m="' + m.key + '"]');
    var n = 0; list.forEach(function (e) { n += parseFloat(e.value) || 0; });
    if (ct) ct.textContent = list.length ? (m.key === 'count' ? ' ' + list.length : ' ' + n) : '';
    if (!list.length) return;
    any = true;
    bits.push(m.key === 'count' ? list.length + ' to reconcile' : m.label + ' ' + n);
  });
  var el = document.getElementById('st-ct');
  if (el) el.textContent = any ? bits.join(' · ') : 'Nothing entered yet';
  var warn = document.getElementById('st-over');
  if (warn) {
    warn.hidden = !over.length;
    warn.textContent = over.length ? 'More than is on hand: ' + over.map(function (o) { return o.name + ' (' + o.take + ' of ' + o.have + ')'; }).join('; ') +
      '. Log the fill first, or reconcile to what is on the shelf.' : '';
  }
  var noShop = !!(en.consign && en.consign.length) && !stShop;
  if (warn && noShop && !over.length) { warn.hidden = false; warn.textContent = 'Pick the shop the consigned units go to.'; }
  var b = document.getElementById('st-save'); if (b) b.disabled = !any || !!over.length || noShop;
}
function stockOpen(mode, shopId) {
  stMode = mode || 'sold'; stQ = ''; stVals = {}; stShop = shopId || '';
  openPeek(stHtml(), {
    label: 'Update stock',
    onClose: function () {
      var p = document.getElementById('ps-peek'); if (p) p.removeAttribute('data-panel');
      var b = document.getElementById('ps-nav-stock'); if (b) b.classList.remove('on');
    }
  });
  document.getElementById('ps-peek').setAttribute('data-panel', 'stock');
  var b = document.getElementById('ps-nav-stock'); if (b) b.classList.add('on');
  var h = document.getElementById('ps-nav-history'); if (h) h.classList.remove('on');
  var c = document.getElementById('ps-nav-consign'); if (c) c.classList.remove('on');
  document.getElementById('st-date').value = todayISO();
  if (stMode !== 'sold') stTyped();
}
function stockMode(m) {
  stKeep();
  var d = document.getElementById('st-date').value, n = document.getElementById('st-note').value;
  stMode = m;
  document.getElementById('ps-peek-body').innerHTML = stHtml();
  document.getElementById('st-date').value = d; document.getElementById('st-note').value = n;
  stRestore();
}
function stockSearch(v) {
  stKeep(); stQ = v;
  document.getElementById('st-rows').innerHTML = stRowsHtml();
  stRestore();
}
function stockSave() {
  var en = stEntries(), bad = false;
  Object.keys(en).forEach(function (m) { en[m].forEach(function (e) { var v = parseFloat(e.value); if (isNaN(v) || v < 0 || Math.floor(v) !== v) bad = true; }); });
  if (bad) { tell('Use whole numbers of units, 0 or more.'); return; }
  if (stOver(en).length) { stTyped(); return; }
  var prods = stProducts(), date = document.getElementById('st-date').value || todayISO(), note = document.getElementById('st-note').value.trim(), n = 0;
  STOCK_REASONS.forEach(function (r) { if (en[r.key]) n += stockPass(prods, en[r.key], { mode: 'out', reason: r.key, date: date, note: note }); });
  if (en.consign) {
    if (!stShop) { stTyped(); return; }
    n += consignPass(prods, en.consign, stShop, { date: date, note: note });
  }
  if (en.count) n += stockPass(prods, en.count, { mode: 'count', date: date, note: note });
  if (!n) return;
  if (Store.setJSON('plume-products-v1', prods) === false) { noteSaveFailed(); return; }
  stVals = {};
  libChanged();
  closePeek();
  tell(n + ' stock change' + (n === 1 ? '' : 's') + ' saved.', { title: 'Stock updated' });
}

// ── Consignment: shops and settling up (2026-10-20) ────────────────────
// Reached from Update stock (and a product's "at shop" links), not the
// sidebar: her call, something done a few times a year does not earn a
// permanent place there.
// Her shops settle up now and then, on no schedule, and pay what they pay:
// Plume records only WHERE units are (shelf, a shop, sold there, back home),
// not money (her call: no other selling prices are recorded here either).
// Shops: plume-shops-v1, [{ id, name, notes, archived }].
var SHOPS_KEY = 'plume-shops-v1';
function shopsAll() { var l = Store.getJSON(SHOPS_KEY, []); return Array.isArray(l) ? l : []; }
function shopsSave(l) { if (Store.setJSON(SHOPS_KEY, l) === false) { noteSaveFailed(); return false; } return true; }
function shopName(id) { var x = fillFind(shopsAll(), id); return x ? (x.name || 'A shop') : 'A removed shop'; }
function shopAdd(name, notes) {
  name = String(name || '').trim();
  if (!name) return null;
  var l = shopsAll();
  for (var i = 0; i < l.length; i++) if ((l[i].name || '').toLowerCase() === name.toLowerCase()) { if (l[i].archived) { delete l[i].archived; shopsSave(l); } return l[i]; }
  var sh = { id: 'sh' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: name, notes: notes || '' };
  l.push(sh);
  return shopsSave(l) ? sh : null;
}
// Moves units from the shelf to a shop. entries: [{ productId, value }].
function consignPass(products, entries, shopId, opts) {
  opts = opts || {};
  var n = 0, stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  (entries || []).forEach(function (en, i) {
    var pr = fillFind(products, en.productId), v = parseFloat(en.value);
    if (!pr || isNaN(v) || v <= 0) return;
    if (!pr.stockLog) pr.stockLog = [];
    pr.stockLog.push({ id: 'cs-' + stamp + '-' + i, date: opts.date || todayISO(), kind: 'move', qty: -v, shopId: shopId, shopQty: v,
      note: opts.note || '' });   // the list already says "Consigned to <shop>"
    pr.updatedAt = new Date().toISOString();
    n++;
  });
  return n;
}
// A settle-up: per product, how many sold at the shop and how many came
// back. entries: [{ productId, sold, returned }]. Sold units carry the unit
// cost on the day, like any sale. Returns how many changes it recorded.
function settlePass(products, shopId, entries, opts) {
  opts = opts || {};
  var n = 0, stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  var cd = costData({ products: products }), date = opts.date || todayISO(), note = opts.note || ('Settled up: ' + shopName(shopId));
  (entries || []).forEach(function (en, i) {
    var pr = fillFind(products, en.productId);
    if (!pr) return;
    var sold = parseFloat(en.sold) || 0, back = parseFloat(en.returned) || 0;
    if (!pr.stockLog) pr.stockLog = [];
    if (sold > 0) {
      var e = { id: 'ss-' + stamp + '-' + i, date: date, kind: 'out', reason: 'sold', qty: 0, shopId: shopId, shopQty: -sold, note: note };
      var uc = productUnitCost(pr, cd); if (uc > 0) e.unitCost = Math.round(uc * 10000) / 10000;
      pr.stockLog.push(e); n++;
    }
    if (back > 0) {
      pr.stockLog.push({ id: 'sr-' + stamp + '-' + i, date: date, kind: 'move', qty: back, shopId: shopId, shopQty: -back, note: note });
      n++;
    }
    if (sold > 0 || back > 0) pr.updatedAt = new Date().toISOString();
  });
  return n;
}
// What a shop holds: [{ p, units, since }] (since: the first consignment
// date of what is there), largest first within type order by name.
function shopStock(shopId, products) {
  var out = [];
  (products || []).forEach(function (p) {
    var units = atShops(p).by[shopId] || 0, since = '';
    ((p && p.stockLog) || []).forEach(function (e) { if (e.shopId === shopId && e.kind === 'move' && (parseFloat(e.shopQty) || 0) > 0 && (!since || e.date < since)) since = e.date; });
    if (units) out.push({ p: p, units: units, since: since });
  });
  out.sort(function (a, b) { return (a.p.name || '').localeCompare(b.p.name || ''); });
  return out;
}
// Everything that happened at a shop, newest first: [{ p, e, what, units }].
function shopEvents(shopId, products) {
  var out = [];
  (products || []).forEach(function (p) {
    ((p && p.stockLog) || []).forEach(function (e) {
      if (e.shopId !== shopId) return;
      var q = parseFloat(e.shopQty) || 0;
      out.push({ p: p, e: e, what: e.kind === 'out' ? 'Sold' : (q > 0 ? 'Consigned' : 'Came back'), units: Math.abs(q) });
    });
  });
  out.sort(function (a, b) { return (b.e.date || '').localeCompare(a.e.date || '') || String(b.e.id).localeCompare(String(a.e.id)); });
  return out;
}
var csView = '', csVals = {};
function csListHtml() {
  var prods = stProducts(), shops = shopsAll().filter(function (x) { return !x.archived; });
  var cards = shops.map(function (x) {
    var held = shopStock(x.id, prods), units = 0, last = '';
    held.forEach(function (h) { units += h.units; });
    shopEvents(x.id, prods).forEach(function (ev) { if (ev.what !== 'Consigned' && (!last || ev.e.date > last)) last = ev.e.date; });
    return '<button type="button" class="cs-card" onclick="Plume.consign.shop(' + esc(JSON.stringify(x.id)) + ')"><span class="cs-name">' + esc(x.name || 'A shop') +
      (x.notes ? '<small>' + esc(x.notes) + '</small>' : '') + '</span>' +
      '<span class="cs-units"><b>' + units + '</b> unit' + (units === 1 ? '' : 's') + ' there<small>' + held.length + ' product' + (held.length === 1 ? '' : 's') +
      (last ? ' · last settled ' + esc(fmtDate(last)) : '') + '</small></span><span class="cs-chev">' + icon('chevron') + '</span></button>';
  }).join('');
  return '<div class="st-panel cs-panel"><div class="sup-title">' + icon('shop') + '<h2>Consignment</h2></div>' +
    '<p class="st-help">Units at shops are still yours: they leave your shelf when you consign them and count as sold when the shop reports. Plume tracks units, not money.</p>' +
    (cards ? '<div class="cs-cards">' + cards + '</div>' : '<div class="st-empty">No shops yet. Add one, then consign units to it from here or from Update stock.</div>') +
    '<div class="cs-add"><button type="button" class="ps-link-btn" onclick="Plume.consign.add()">' + icon('plus') + 'Add a shop</button></div>' +
  '</div>';
}
function csShopHtml(id) {
  var x = fillFind(shopsAll(), id);
  if (!x) return csListHtml();
  var prods = stProducts(), held = shopStock(id, prods), evs = shopEvents(id, prods), total = 0;
  held.forEach(function (h) { total += h.units; });
  return '<div class="st-panel cs-panel"><button type="button" class="ps-link-btn cs-back" onclick="Plume.consign.list()">' + icon('chevron') + 'All shops</button>' +
    '<div class="sup-title">' + icon('shop') + '<h2>' + esc(x.name || 'A shop') + '</h2></div>' +
    (x.notes ? '<p class="st-help">' + esc(x.notes) + '</p>' : '') +
    '<div class="cs-acts"><button type="button" class="ps-link-btn" onclick="Plume.stock.open(\'consign\', ' + esc(JSON.stringify(id)) + ')">' + icon('plus') + 'Consign more</button>' +
      '<button type="button" class="ps-link-btn" onclick="Plume.consign.edit(' + esc(JSON.stringify(id)) + ')">' + icon('note') + 'Rename or notes</button></div>' +
    '<h3 class="cs-h">Settle up <span>' + total + ' unit' + (total === 1 ? '' : 's') + ' there now</span></h3>' +
    (held.length ? '<p class="st-help">Enter what sold and what came back. The rest stays at the shop.</p>' +
      '<div class="st-fields"><div><label for="cs-date">Date</label><input type="date" id="cs-date" value="' + todayISO() + '"></div>' +
        '<div><label for="cs-note">Note</label><input type="text" id="cs-note" placeholder="Settled up: ' + esc(x.name || '') + '"></div></div>' +
      '<div class="cs-cols"><span>Product</span><span>There</span><span>Sold</span><span>Back</span><span>Left</span></div>' +
      held.map(function (h) {
        var v = csVals[h.p.id] || {};
        return '<div class="cs-row" data-pid="' + esc(h.p.id) + '" data-have="' + h.units + '"><div class="st-name">' + esc(h.p.name || '(unnamed)') +
          (h.since ? '<small>since ' + esc(fmtDate(h.since)) + '</small>' : '') + '</div>' +
          '<div class="st-have">' + h.units + '</div>' +
          '<input type="number" min="0" step="1" inputmode="numeric" data-k="sold" value="' + esc(v.sold || '') + '" aria-label="' + esc('Sold: ' + (h.p.name || '')) + '" oninput="Plume.consign.typed()">' +
          '<input type="number" min="0" step="1" inputmode="numeric" data-k="returned" value="' + esc(v.returned || '') + '" aria-label="' + esc('Came back: ' + (h.p.name || '')) + '" oninput="Plume.consign.typed()">' +
          '<div class="st-have cs-left">' + h.units + '</div></div>';
      }).join('') +
      '<div class="st-over" id="cs-over" hidden></div>' +
      '<div class="st-foot"><span class="st-ct" id="cs-ct">Nothing entered yet</span><span class="ps-grow"></span>' +
        '<button type="button" class="ps-btn-primary" id="cs-save" onclick="Plume.consign.save(' + esc(JSON.stringify(id)) + ')" disabled>Save settle-up</button></div>'
      : '<div class="st-empty">Nothing at this shop now. Consign units to it with Consign more.</div>') +
    (evs.length ? '<h3 class="cs-h">History</h3><div class="cs-hist">' + evs.map(function (ev) {
      return '<div class="cs-ev"><span>' + esc(fmtDate(ev.e.date)) + '</span><span>' + esc(ev.p.name || '(unnamed)') + '</span><span>' + ev.what + ' <b>' + ev.units + '</b></span></div>';
    }).join('') + '</div>' : '') +
  '</div>';
}
function csRender() { var b = document.getElementById('ps-peek-body'); if (b) b.innerHTML = csView ? csShopHtml(csView) : csListHtml(); if (csView) csTyped(); }
function consignOpen(shopId) {
  csView = shopId || ''; csVals = {};
  openPeek(csView ? csShopHtml(csView) : csListHtml(), {
    label: 'Consignment',
    onClose: function () { var b = document.getElementById('ps-nav-consign'); if (b) b.classList.remove('on'); }
  });
  ['ps-nav-stock', 'ps-nav-history'].forEach(function (k) { var e = document.getElementById(k); if (e) e.classList.remove('on'); });
  var b = document.getElementById('ps-nav-consign'); if (b) b.classList.add('on');
}
function csShow(id) { csView = id; csVals = {}; csRender(); }
function csList() { csView = ''; csVals = {}; csRender(); }
function csAdd() {
  askValue('The name of the shop. You can add notes after.', '', function (name) {
    var sh = shopAdd(name);
    if (sh) csShow(sh.id);
  }, { title: 'Add a shop', yes: 'Add' });
}
function csEdit(id) {
  var l = shopsAll(), x = fillFind(l, id);
  if (!x) return;
  askValue('Rename the shop. Its history keeps up.', x.name || '', function (name) {
    name = String(name || '').trim();
    if (!name) return;
    x.name = name;
    askValue('Notes: who to contact, the split, anything to remember.', x.notes || '', function (notes) {
      x.notes = String(notes || '').trim();
      shopsSave(l); csRender();
    }, { title: 'Notes for ' + name, yes: 'Save' });
    shopsSave(l); csRender();
  }, { title: 'Rename ' + (x.name || 'the shop'), yes: 'Next' });
}
function csTyped() {
  var rows = document.querySelectorAll('.cs-row'), any = 0, sold = 0, back = 0, over = [];
  [].forEach.call(rows, function (r) {
    var have = parseFloat(r.getAttribute('data-have')) || 0;
    var s = parseFloat(r.querySelector('[data-k="sold"]').value) || 0, b = parseFloat(r.querySelector('[data-k="returned"]').value) || 0;
    csVals[r.getAttribute('data-pid')] = { sold: r.querySelector('[data-k="sold"]').value, returned: r.querySelector('[data-k="returned"]').value };
    var left = have - s - b;
    r.querySelector('.cs-left').textContent = left;
    r.classList.toggle('on', s > 0 || b > 0);
    r.classList.toggle('over', left < 0);
    if (left < 0) over.push(r.querySelector('.st-name').firstChild.textContent);
    if (s > 0 || b > 0) any++;
    sold += s; back += b;
  });
  var ct = document.getElementById('cs-ct');
  if (ct) ct.textContent = any ? [sold ? sold + ' sold' : '', back ? back + ' back' : ''].filter(function (x) { return x; }).join(' · ') : 'Nothing entered yet';
  var w = document.getElementById('cs-over');
  if (w) { w.hidden = !over.length; w.textContent = over.length ? 'More than the shop has: ' + over.join(', ') + '.' : ''; }
  var btn = document.getElementById('cs-save'); if (btn) btn.disabled = !any || !!over.length;
}
function csSave(id) {
  csTyped();
  var entries = [], bad = false;
  [].forEach.call(document.querySelectorAll('.cs-row'), function (r) {
    var s = r.querySelector('[data-k="sold"]').value.trim(), b = r.querySelector('[data-k="returned"]').value.trim();
    [s, b].forEach(function (v) { if (v !== '' && (isNaN(+v) || +v < 0 || Math.floor(+v) !== +v)) bad = true; });
    if (s || b) entries.push({ productId: r.getAttribute('data-pid'), sold: s, returned: b });
  });
  if (bad) { tell('Use whole numbers of units, 0 or more.'); return; }
  if (document.getElementById('cs-save').disabled) return;
  var prods = stProducts();
  var n = settlePass(prods, id, entries, { date: document.getElementById('cs-date').value || todayISO(), note: document.getElementById('cs-note').value.trim() });
  if (!n) return;
  if (Store.setJSON('plume-products-v1', prods) === false) { noteSaveFailed(); return; }
  csVals = {};
  libChanged();
  csRender();
  tell('Settle-up saved: ' + n + ' change' + (n === 1 ? '' : 's') + '.', { title: 'Saved' });
}

// ── Stock history: a slide-in panel on every page (2026-10-20) ─────────
// What Update stock recorded, read back: how much sold at a market or in a
// month, and what giveaways and marketing cost over a period. Each change
// carries the unit cost on the day it was saved; one saved before that
// uses today's unit cost and is marked ~. Reconcile differences count as
// Unaccounted (fewer on the shelf than Plume had). Units built into kits
// are not here: they are still stock, inside the kit.
var shRange = 'year', shGroup = 'event', shQ = '', shOpen = {}, shReason = '';
// shReason: '' (everything), a reason key, or 'give' (gifted and marketing):
// a block clicked to see what made up its number (her ask, 2026-10-20).
function shPick(k) { return !shReason || k === shReason || (shReason === 'give' && (k === 'gifted' || k === 'marketing')); }
var SH_RANGES = [['month', 'This month'], ['last', 'Last month'], ['year', 'This year'], ['12', 'Last 12 months'], ['all', 'All time']];
function shBounds() {
  var d = new Date(), y = d.getFullYear(), m = d.getMonth();
  var iso = function (Y, M) { var x = new Date(Y, M, 1); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-01'; };
  if (shRange === 'month') return [iso(y, m), ''];
  if (shRange === 'last') return [iso(y, m - 1), iso(y, m)];
  if (shRange === 'year') return [y + '-01-01', ''];
  if (shRange === '12') return [iso(y, m - 11), ''];
  return ['', ''];
}
function shKeys() { return STOCK_REASONS.map(function (r) { return r.key; }).concat(['out', 'count']); }
function shLabel(k) { return k === 'count' ? 'Unaccounted' : k === 'out' ? 'Other' : stockReasonLabel(k); }
// Every change in range: { p, e, key, units, cost, est }. Units are always
// counted in the reason's own direction (12 sold, 2 returned).
function shRows() {
  var b = shBounds(), q = shQ.toLowerCase().trim(), d = costData(), out = [];
  d.products.forEach(function (p) {
    ((p && p.stockLog) || []).forEach(function (e) {
      if (e.kind === 'kit' || e.kind === 'move') return;   // still hers: inside a kit, or at a shop
      if (b[0] && (e.date || '') < b[0]) return;
      if (b[1] && (e.date || '') >= b[1]) return;
      if (q && ((e.note || '') + ' ' + (p.name || '') + ' ' + (p.sku || '')).toLowerCase().indexOf(q) === -1) return;
      var key = e.kind === 'count' ? 'count' : (e.reason || 'out');
      var qty = parseFloat(e.qty) || 0;
      var units = e.shopId ? -(parseFloat(e.shopQty) || 0) : (reasonBack(key) ? qty : -qty);
      var est = !(e.unitCost > 0);
      var uc = est ? productUnitCost(p, d) : e.unitCost;
      out.push({ p: p, e: e, key: key, units: units, cost: units * uc, est: est && units !== 0 });
    });
  });
  return out;
}
function shBlank() { var o = {}; shKeys().forEach(function (k) { o[k] = { units: 0, cost: 0, est: false }; }); return o; }
function shAdd(t, r) { t.units += r.units; t.cost += r.cost; t.est = t.est || r.est; }
// The dollar sign is written as \u0024: a literal $ next to a quote is
// read as a special pattern when a page or preview inlines this file with
// String.replace, which garbles the script.
function shMoney(v, est) { return (est ? '~' : '') + (v < 0 ? '-' : '') + '\u0024' + Math.abs(v).toFixed(2); }
function shSummary(t) {
  return shKeys().filter(function (k) { return t[k].units; }).map(function (k) {
    return '<span class="sh-pill sh-' + k + '">' + esc(shLabel(k)) + ' <b>' + t[k].units + '</b> ' + shMoney(t[k].cost, t[k].est) + '</span>';
  }).join('');
}
function shMonthName(m) { var a = m.split('-'); return a.length === 2 ? new Date(+a[0], +a[1] - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : m; }
function shGroups(rows) {
  var g = {}, order = [];
  rows.forEach(function (r) {
    var k, title, sub, sort;
    if (shGroup === 'month') { k = (r.e.date || '').slice(0, 7) || 'none'; title = k === 'none' ? 'No date' : shMonthName(k); sub = ''; sort = k; }
    else if (shGroup === 'product') { k = r.p.id; title = r.p.name || '(unnamed)'; sub = r.p.netWtDisplay || ''; sort = title.toLowerCase(); }
    else if (shGroup === 'shop') { k = r.e.shopId || ''; title = r.e.shopId ? shopName(r.e.shopId) : 'Not through a shop'; sub = r.e.shopId ? 'consignment' : 'markets, online, in person'; sort = (r.e.shopId ? '0' : '1') + title.toLowerCase(); }
    else { k = (r.e.date || '') + '|' + (r.e.note || ''); title = r.e.note || 'No note'; sub = r.e.date ? fmtDate(r.e.date) : ''; sort = (r.e.date || '') + '|' + (r.e.note || ''); }
    if (!g[k]) { g[k] = { key: k, title: title, sub: sub, sort: sort, t: shBlank(), rows: [] }; order.push(k); }
    shAdd(g[k].t[r.key], r);
    g[k].rows.push(r);
  });
  var list = order.map(function (k) { return g[k]; });
  list.sort(function (a, b) { return (shGroup === 'product' || shGroup === 'shop') ? a.sort.localeCompare(b.sort) : b.sort.localeCompare(a.sort); });
  return list;
}
function shDetail(gr) {
  // Inside an event or a month: one line per product and reason. Inside a
  // product: one line per change.
  if (shGroup === 'product') {
    return gr.rows.slice().sort(function (a, b) { return (b.e.date || '').localeCompare(a.e.date || ''); }).map(function (r) {
      return '<div class="sh-line"><span>' + (r.e.date ? fmtDate(r.e.date) : '') + (r.e.note ? ' · ' + esc(r.e.note) : '') + '</span><span>' + esc(shLabel(r.key)) + ' <b>' + r.units + '</b></span><span>' + shMoney(r.cost, r.est) + '</span></div>';
    }).join('');
  }
  var m = {}, order = [];
  gr.rows.forEach(function (r) {
    var k = r.p.id + '|' + r.key;
    if (!m[k]) { m[k] = { p: r.p, key: r.key, units: 0, cost: 0, est: false }; order.push(k); }
    shAdd(m[k], r);
  });
  return order.map(function (k) { return m[k]; }).sort(function (a, b) { return (a.p.name || '').localeCompare(b.p.name || ''); }).map(function (x) {
    return '<div class="sh-line"><span>' + esc(x.p.name || '(unnamed)') + '</span><span>' + esc(shLabel(x.key)) + ' <b>' + x.units + '</b></span><span>' + shMoney(x.cost, x.est) + '</span></div>';
  }).join('');
}
function shHtml() {
  var rows = shRows(), tot = shBlank();
  rows.forEach(function (r) { shAdd(tot[r.key], r); });
  var shown = shKeys().filter(function (k) { return ['sold', 'gifted', 'marketing', 'damaged'].indexOf(k) !== -1 || tot[k].units; });
  var give = { units: tot.gifted.units + tot.marketing.units, cost: tot.gifted.cost + tot.marketing.cost, est: tot.gifted.est || tot.marketing.est };
  var picked = rows.filter(function (r) { return shPick(r.key); });
  var groups = shGroups(picked);
  var pt = { units: 0, cost: 0, est: false };
  picked.forEach(function (r) { shAdd(pt, r); });
  var pName = shReason === 'give' ? 'Giveaways and marketing' : shReason ? shLabel(shReason) : '';
  return '<div class="sh-panel"><div class="sup-title">' + icon('history') + '<h2>Stock history</h2></div>' +
    '<div class="sh-ranges">' + SH_RANGES.map(function (r) {
      return '<button type="button" class="ps-chip' + (shRange === r[0] ? ' on' : '') + '" onclick="Plume.stock.range(\'' + r[0] + '\')">' + r[1] + '</button>';
    }).join('') + '</div>' +
    '<div class="sh-tiles">' + shown.map(function (k) {
      return '<button type="button" class="sh-tile' + (shReason === k ? ' on' : '') + '" aria-pressed="' + (shReason === k) + '" title="See what made up this number" onclick="Plume.stock.reason(\'' + k + '\')"><div class="sh-k">' + esc(shLabel(k)) + '</div><div class="sh-n">' + tot[k].units + '</div><div class="sh-c">' + shMoney(tot[k].cost, tot[k].est) + ' at cost</div></button>';
    }).join('') + '</div>' +
    '<button type="button" class="sh-give' + (shReason === 'give' ? ' on' : '') + '" aria-pressed="' + (shReason === 'give') + '" title="See what was given away or used for marketing" onclick="Plume.stock.reason(\'give\')"><b>Giveaways and marketing:</b> ' + give.units + ' unit' + (give.units === 1 ? '' : 's') + ', ' + shMoney(give.cost, give.est) + ' at cost</button>' +
    '<div class="sh-bar"><div class="sh-tabs">' + [['event', 'By event'], ['month', 'By month'], ['product', 'By product']].concat(shopsAll().length ? [['shop', 'By shop']] : []).map(function (t) {
      return '<button type="button" class="ps-tab' + (shGroup === t[0] ? ' on' : '') + '" onclick="Plume.stock.group(\'' + t[0] + '\')">' + t[1] + '</button>';
    }).join('') + '</div></div>' +
    '<label class="ps-search sh-search">' + icon('search') + '<input type="search" id="sh-q" placeholder="Search notes or products, e.g. market" value="' + esc(shQ) + '" oninput="Plume.stock.find(this.value)" aria-label="Search stock history"></label>' +
    (shReason ? '<div class="sh-showing" id="sh-showing"><span>Showing <b>' + esc(pName) + '</b>: ' + pt.units + ' unit' + (pt.units === 1 ? '' : 's') + ', ' + shMoney(pt.cost, pt.est) + ' at cost</span>' +
      '<button type="button" class="ps-link-btn" onclick="Plume.stock.reason(\'\')">Show everything</button></div>' : '') +
    '<div class="sh-list">' + (groups.length ? groups.map(function (gr) {
      // While a block is picked, every row starts open: the point is to see what is in it.
      var ok = shGroup + ':' + gr.key, open = shOpen[ok] === undefined ? !!shReason : !!shOpen[ok];
      return '<div class="sh-grp' + (open ? ' open' : '') + '"><button type="button" class="sh-head" aria-expanded="' + open + '" onclick="Plume.stock.toggle(' + esc(JSON.stringify(shGroup + ':' + gr.key)) + ')">' +
        '<span class="sh-title">' + esc(gr.title) + (gr.sub ? '<small>' + esc(gr.sub) + '</small>' : '') + '</span>' +
        '<span class="sh-sum">' + shSummary(gr.t) + '</span><span class="sh-chev">' + icon('chevron') + '</span></button>' +
        (open ? '<div class="sh-detail">' + shDetail(gr) + '</div>' : '') + '</div>';
    }).join('') : '<div class="st-empty">' + (shReason && !shQ ? 'No ' + esc(pName.toLowerCase()) + ' in this range.' : shQ ? 'Nothing matches “' + esc(shQ) + '” in this range.' : 'Nothing recorded in this range. Update stock records sales, giveaways and returns.') + '</div>') + '</div>' +
    '<p class="sh-foot">Costs are each product’s unit cost on the day the change was saved' + (rows.some(function (r) { return r.est; }) ? '; ~ marks changes from before costs were recorded, which use today’s unit cost' : '') +
      '. Units built into kits are not counted here; the kit carries them. Units at shops count when they sell.' + (tot.count.units ? ' Unaccounted is what reconciling found missing (negative: found extra).' : '') + '</p>' +
    (rows.length ? '<div class="sh-actions"><button type="button" class="ps-link-btn" onclick="Plume.stock.copy()">' + icon('copy') + 'Copy as a table</button></div>' : '') +
  '</div>';
}
function shRender() { var b = document.getElementById('ps-peek-body'); if (b) b.innerHTML = shHtml(); }
function stockHistory() {
  shRange = 'year'; shGroup = 'event'; shQ = ''; shOpen = {}; shReason = '';
  openPeek(shHtml(), {
    label: 'Stock history',
    onClose: function () { var b = document.getElementById('ps-nav-history'); if (b) b.classList.remove('on'); }
  });
  var b = document.getElementById('ps-nav-history'); if (b) b.classList.add('on');
  var s = document.getElementById('ps-nav-stock'); if (s) s.classList.remove('on');
}
function shRangeSet(r) { shRange = r; shRender(); }
function shGroupSet(g) { shGroup = g; shRender(); }
function shToggle(k) {
  var was = shOpen[k] === undefined ? !!shReason : !!shOpen[k];
  shOpen[k] = !was; shRender();
}
function shReasonSet(k) {
  shReason = (k && k === shReason) ? '' : (k || ''); shOpen = {}; shRender();
  // The details sit below the blocks; bring them into view.
  var el = document.getElementById('sh-showing');
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function shFind(v) {
  shQ = v; shRender();
  var i = document.getElementById('sh-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}
// Every change in range, one per line, for a spreadsheet or the books.
function shCopy() {
  var lines = [['Date', 'Note', 'Product', 'Reason', 'Shop', 'Units', 'Unit cost', 'Cost'].join('\t')];
  shRows().filter(function (r) { return shPick(r.key); }).sort(function (a, b) { return (a.e.date || '').localeCompare(b.e.date || ''); }).forEach(function (r) {
    lines.push([r.e.date || '', r.e.note || '', r.p.name || '', shLabel(r.key), r.e.shopId ? shopName(r.e.shopId) : '', r.units, (r.units ? Math.abs(r.cost / r.units) : 0).toFixed(2), r.cost.toFixed(2)].join('\t'));
  });
  var text = lines.join('\n'), done = function () { tell('Copied ' + (lines.length - 1) + ' line' + (lines.length === 2 ? '' : 's') + '. Paste into a spreadsheet.', { title: 'Copied' }); };
  try { navigator.clipboard.writeText(text).then(done, function () { tell(text, { title: 'Copy these lines' }); }); }
  catch (e) { tell(text, { title: 'Copy these lines' }); }
}

// Why a stock change cannot be removed, or ''. Removing a consignment
// that the shop has since sold or returned would leave it below zero there.
function undoStockBlock(p, id) {
  var e = null;
  ((p && p.stockLog) || []).forEach(function (x) { if (x.id === id) e = x; });
  if (!e || !e.shopId) return '';
  var q = parseFloat(e.shopQty) || 0, have = atShops(p).by[e.shopId] || 0;
  if (have - q < 0) return 'The shop has ' + have + ' of these now, so removing this would leave it below zero. Remove the later sale or return from ' + shopName(e.shopId) + ' first.';
  return '';
}
// Removes one taken-out or counted entry. Kit entries go with their build.
function undoStock(p, id) {
  if (!p || !p.stockLog) return false;
  var before = p.stockLog.length;
  p.stockLog = p.stockLog.filter(function (e) { return e.id !== id || e.kind === 'kit'; });
  return p.stockLog.length !== before;
}

return {
  VERSION: VERSION,
  inciSplit: inciSplit, inciMerge: inciMerge, inciMerged: inciMerged,
  CERTS: CERTS, lotCerts: lotCerts, activeLot: activeLot, recText: recText, recStart: recStart,
  rt: { toHtml: rtToHtml, plain: rtPlain, fromEl: rtFromEl, editor: rtEditor, attach: rtAttach, refresh: rtRefresh, refreshAll: rtRefreshAll },
  STOCK_TYPE: STOCK_TYPE, isStockType: isStockType, stockIngFor: stockIngFor, stockFormFor: stockFormFor,
  stockParts: stockParts, stockExpand: stockExpand, stockLabelItems: stockLabelItems, stockWithParts: stockWithParts, stockInci: stockInci, stockNewIng: stockNewIng,
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
  suppliers: { open: openSuppliers, add: supAdd, edit: supEdit, cancel: supCancel, save: supSave,
               remove: supRemove, match: supMatch, search: supSearch, nameTyped: supNameTyped, usage: supUsage, list: supAll },
  onLibraryChange: onLibraryChange, followLinks: followLinks,
  isInstalled: isInstalled, install: install, openPage: openPage, resetAppCache: resetAppCache,
  zoom: zoom, setSize: setSize, sizeChoice: sizeChoice, applySize: applySize,
  tipsOn: tipsOn, setTips: setTips, applyTips: applyTips, nextStep: nextStep,
  pkgTracked: pkgTracked, setPkgTracking: setPkgTracking,
  setTheme: setTheme, isDark: isDark, themeChoice: themeChoice, darkValue: darkValue, applyTheme: applyTheme,
  tell: tell, ask: ask, askValue: askValue,
  parsePh: parsePh, phNum: phNum, phRange: phRange, phTargetText: phTargetText,
  effPhRange: effPhRange, effPhText: effPhText, isPreservative: isPreservative, effPhIssues: effPhIssues, effPhUnknown: effPhUnknown, effPhIssueText: effPhIssueText,
  isAqueous: isAqueous, phBadge: phBadge, phStepsHtml: phStepsHtml, phFinal: phFinal,
  PK_COLORS: PK_COLORS, PK_MATERIALS: PK_MATERIALS, PK_PARTS: PK_PARTS, PK_GROUPS: PK_GROUPS, PK_KINDS: PK_KINDS,
  pkColor: pkColor, pkSwatch: pkSwatch, pkKind: pkKind, pkKindOf: pkKindOf, pkGroup: pkGroup, pkGroupKey: pkGroupKey,
  onHand: onHand, onHandParts: onHandParts, isKit: isKit, kitPartOk: kitPartOk, kitParts: kitParts,
  kitNeeds: kitNeeds, kitShortages: kitShortages, buildKit: buildKit, undoKitBuild: undoKitBuild,
  undoKitText: undoKitText, kitsUsing: kitsUsing, stockPass: stockPass, undoStock: undoStock,
  STOCK_REASONS: STOCK_REASONS, productUnitCost: productUnitCost, stockReasonLabel: stockReasonLabel, fillUndoBlock: fillUndoBlock,
  consign: { open: consignOpen, shop: csShow, list: csList, add: csAdd, edit: csEdit, typed: csTyped, save: csSave },
  shopsAll: shopsAll, shopAdd: shopAdd, shopName: shopName, atShops: atShops, consignPass: consignPass, settlePass: settlePass,
  shopStock: shopStock, shopEvents: shopEvents, undoStockBlock: undoStockBlock,
  stock: { open: stockOpen, mode: stockMode, search: stockSearch, typed: stTyped, save: stockSave, entries: stEntries, shop: stockShop,
           history: stockHistory, range: shRangeSet, group: shGroupSet, toggle: shToggle, reason: shReasonSet, find: shFind, copy: shCopy, rows: shRows },
  pkTypeFor: pkTypeFor, pkForProduct: pkForProduct, pkColored: pkColored, pkIsOther: pkIsOther,
  pkIcon: pkIcon, pkIconFor: pkIconFor, pkProducts: pkProducts, pkProductName: pkProductName,
  pkKindName: pkKindName, pkLooks: pkLooks, pkDisplay: pkDisplay, pkDetailHtml: pkDetailHtml, pkStock: pkStock,
  pkGroups: pkGroups, pkMatches: pkMatches, pkSameKey: pkSameKey, pkGuess: pkGuess, pkCss: pkCss,
  pkPicker: pkPicker, pkPickers: pkPickers, pkClose: pkClose,
  batchMadeG: batchMadeG, batchLeftG: batchLeftG, batchNumbersG: batchNumbersG, batchUsedG: batchUsedG, batchFills: batchFills, batchLabel: batchLabel,
  fillDraws: fillDraws, fillBatches: fillBatches, fillDefaultBatch: fillDefaultBatch, fillParts: fillParts, fillPkgNeeds: fillPkgNeeds,
  fillShortages: fillShortages, fillPull: fillPull, fillReturn: fillReturn,
  makeFill: makeFill, undoFill: undoFill, undoFillText: undoFillText, fmtG: fmtG,
  lotBase: lotBase, lotNorm: lotNorm, lotsInUse: lotsInUse, nextLotCode: nextLotCode, lotCheck: lotCheck,
  batchLot: batchLot, lotChip: lotChip, lotStickerSvg: lotStickerSvg, printLotStickers: printLotStickers, lotStickerSize: lotStickerSize, lotStickerRemember: lotStickerRemember, drawLot: drawLot, varTitle: varTitle, findVariant: findVariant, batchVersion: batchVersion, trackList: trackList, saveList: saveList, lotHere: lotHere, onOrderG: onOrderG, mergeList: mergeList, lineShare: lineShare, formBatchSize: formBatchSize,
  migrateBatches: migrateBatches, logEntryFor: logEntryFor,
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
