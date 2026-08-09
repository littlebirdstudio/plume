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

   WHAT STAYS PER-MODULE
   The palette *choice* is stored per module ('plume-palette-formulations',
   'plume-palette-packaging', ...), so each page still remembers its own
   colour scheme. Only the code that draws and applies them is shared.

   ES5 only. No build step. No dependencies.
   ═══════════════════════════════════════════════════════════════════ */

var Plume = (function () {
'use strict';

// Bump when core changes. Shown in every module's Settings panel, so
// "is core loaded, and is it the one I just uploaded?" is answerable by
// looking rather than guessing -- browsers cache .js files stubbornly.
var VERSION = '1.5';

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
    if (qty) total += qtyToGrams(qty, unit, ing.density);
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
    if (qty) { total += qtyToGrams(qty, unit, ing.density); any = true; }
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
var PALETTES = {
  'coastal': { label:'Coastal', family:'blue', vars: {
    '--cream':'#F4F6F8','--cream-dark':'#E7ECF1','--cream-border':'#C9D3DC','--white':'#FCFDFE',
    '--bark':'#506880','--bark-light':'#7A92A8','--bark-dark':'#2E4256',
    '--sage':'#6E8C8A','--sage-light':'#E2EBEA','--sage-dark':'#3F5856','--sage-border':'#B8CACA',
    '--clay':'#C9A074','--clay-light':'#F2E8DA','--clay-dark':'#8A6432','--clay-hover':'#EBD9BE',
    '--ink':'#1F2A36','--ink-light':'#5A6776','--ink-lighter':'#8E99A6',
    '--warning':'#B07020','--warning-bg':'#FDF3E3','--warning-border':'#E8D0A0',
    '--danger':'#A03020','--danger-bg':'#FCE8E4','--danger-border':'#E8C0B8','--success':'#3F5856'
  }},
  'indigo': { label:'Indigo', family:'blue', vars: {
    '--cream':'#F1F1F6','--cream-dark':'#E4E4EC','--cream-border':'#C6C6D4','--white':'#FBFBFD',
    '--bark':'#3E4768','--bark-light':'#6970A0','--bark-dark':'#1F2546',
    '--sage':'#7480A0','--sage-light':'#E5E8F0','--sage-dark':'#454E68','--sage-border':'#BFC5D4',
    '--clay':'#A88BB8','--clay-light':'#EDE2F2','--clay-dark':'#6E527C','--clay-hover':'#E0CFE8',
    '--ink':'#1A1D2E','--ink-light':'#525870','--ink-lighter':'#8A8FA4',
    '--warning':'#B07020','--warning-bg':'#FDF3E3','--warning-border':'#E8D0A0',
    '--danger':'#A03020','--danger-bg':'#FCE8E4','--danger-border':'#E8C0B8','--success':'#454E68'
  }},
  'mist': { label:'Mist', family:'blue', vars: {
    '--cream':'#F2F4F4','--cream-dark':'#E5E9E9','--cream-border':'#CAD2D2','--white':'#FBFCFC',
    '--bark':'#5C7274','--bark-light':'#869A9C','--bark-dark':'#34484A',
    '--sage':'#6E9290','--sage-light':'#E2EDEC','--sage-dark':'#3F5C5A','--sage-border':'#BAD0CE',
    '--clay':'#C29A8A','--clay-light':'#F0E4DE','--clay-dark':'#82584A','--clay-hover':'#E7D3C9',
    '--ink':'#222B2E','--ink-light':'#5C696C','--ink-lighter':'#909A9D',
    '--warning':'#B07020','--warning-bg':'#FDF3E3','--warning-border':'#E8D0A0',
    '--danger':'#A03020','--danger-bg':'#FCE8E4','--danger-border':'#E8C0B8','--success':'#3F5C5A'
  }},
  'blush': { label:'Blush', family:'pink', vars: {
    '--cream':'#F9F2F1','--cream-dark':'#F0E4E2','--cream-border':'#DCC8C6','--white':'#FEFBFB',
    '--bark':'#8A5868','--bark-light':'#AE7E8C','--bark-dark':'#5A3240',
    '--sage':'#8A8898','--sage-light':'#ECE9EE','--sage-dark':'#52505E','--sage-border':'#CFCCD6',
    '--clay':'#D08C82','--clay-light':'#F5E2DE','--clay-dark':'#92524A','--clay-hover':'#EDCEC7',
    '--ink':'#2C2024','--ink-light':'#6D5860','--ink-lighter':'#A08A91',
    '--warning':'#B07020','--warning-bg':'#FDF3E3','--warning-border':'#E8D0A0',
    '--danger':'#A03020','--danger-bg':'#FCE8E4','--danger-border':'#E8C0B8','--success':'#52505E'
  }},
  'petal': { label:'Petal', family:'pink', vars: {
    '--cream':'#FAF3EE','--cream-dark':'#F2E5DC','--cream-border':'#DCC8B9','--white':'#FEFCFA',
    '--bark':'#A0584C','--bark-light':'#C68074','--bark-dark':'#6E2E22',
    '--sage':'#8C8478','--sage-light':'#EDE8E1','--sage-dark':'#544D43','--sage-border':'#CCC5BA',
    '--clay':'#E89A82','--clay-light':'#FAE3D8','--clay-dark':'#A85A40','--clay-hover':'#F4CFBE',
    '--ink':'#2E2018','--ink-light':'#705A4E','--ink-lighter':'#A28B7E',
    '--warning':'#B07020','--warning-bg':'#FDF3E3','--warning-border':'#E8D0A0',
    '--danger':'#A03020','--danger-bg':'#FCE8E4','--danger-border':'#E8C0B8','--success':'#544D43'
  }},
  'mulberry': { label:'Mulberry', family:'pink', vars: {
    '--cream':'#F4EDEF','--cream-dark':'#E8DCDF','--cream-border':'#CDB8BE','--white':'#FBF8F9',
    '--bark':'#7A3E5A','--bark-light':'#9E6480','--bark-dark':'#4E1A30',
    '--sage':'#857482','--sage-light':'#E7E0E4','--sage-dark':'#4E424B','--sage-border':'#C5B8BF',
    '--clay':'#B07088','--clay-light':'#EBD8DE','--clay-dark':'#783E50','--clay-hover':'#DEBFC8',
    '--ink':'#26181E','--ink-light':'#5E4E55','--ink-lighter':'#94808A',
    '--warning':'#B07020','--warning-bg':'#FDF3E3','--warning-border':'#E8D0A0',
    '--danger':'#A03020','--danger-bg':'#FCE8E4','--danger-border':'#E8C0B8','--success':'#4E424B'
  }},
  'lavender': { label:'Lavender', family:'purple', vars: {
    '--cream':'#F5F3F7','--cream-dark':'#EAE5EF','--cream-border':'#D0C8DA','--white':'#FCFBFD',
    '--bark':'#6E5C8A','--bark-light':'#928AAE','--bark-dark':'#3F3258',
    '--sage':'#8C8AA0','--sage-light':'#EAE8EE','--sage-dark':'#54526A','--sage-border':'#CECCDA',
    '--clay':'#B89AC4','--clay-light':'#EEE2F1','--clay-dark':'#7C5A8A','--clay-hover':'#E0CDEA',
    '--ink':'#221E2E','--ink-light':'#5E5670','--ink-lighter':'#928CA4',
    '--warning':'#B07020','--warning-bg':'#FDF3E3','--warning-border':'#E8D0A0',
    '--danger':'#A03020','--danger-bg':'#FCE8E4','--danger-border':'#E8C0B8','--success':'#54526A'
  }},
  'slate': { label:'Slate', family:'purple', vars: {
    '--cream':'#F1F2F5','--cream-dark':'#E4E6EC','--cream-border':'#C6CBD4','--white':'#FBFBFD',
    '--bark':'#525C72','--bark-light':'#7C8598','--bark-dark':'#2E3648',
    '--sage':'#76808E','--sage-light':'#E5E8EC','--sage-dark':'#444C58','--sage-border':'#C2C8D0',
    '--clay':'#A88AA0','--clay-light':'#ECE2E8','--clay-dark':'#6E5468','--clay-hover':'#DCCBD6',
    '--ink':'#1E222C','--ink-light':'#555C6C','--ink-lighter':'#8C92A0',
    '--warning':'#B07020','--warning-bg':'#FDF3E3','--warning-border':'#E8D0A0',
    '--danger':'#A03020','--danger-bg':'#FCE8E4','--danger-border':'#E8C0B8','--success':'#444C58'
  }},
  'wisteria': { label:'Wisteria', family:'purple', vars: {
    '--cream':'#F4F2F4','--cream-dark':'#E8E5E9','--cream-border':'#CCC4D0','--white':'#FBFAFC',
    '--bark':'#7A6A8C','--bark-light':'#9E8FAE','--bark-dark':'#4A3A5C',
    '--sage':'#84927E','--sage-light':'#E5EAE2','--sage-dark':'#4E5A48','--sage-border':'#BDC8B8',
    '--clay':'#AE8AB8','--clay-light':'#E8DCE8','--clay-dark':'#724E7C','--clay-hover':'#D8C2DC',
    '--ink':'#24202C','--ink-light':'#5E566C','--ink-lighter':'#928BA0',
    '--warning':'#B07020','--warning-bg':'#FDF3E3','--warning-border':'#E8D0A0',
    '--danger':'#A03020','--danger-bg':'#FCE8E4','--danger-border':'#E8C0B8','--success':'#4E5A48'
  }},
  'forest': { label:'Forest', family:'green', vars: {
    '--cream':'#F2F4F0','--cream-dark':'#E4E8DE','--cream-border':'#C5CDBE','--white':'#FBFCFA',
    '--bark':'#4E6A4A','--bark-light':'#789078','--bark-dark':'#2A3E28',
    '--sage':'#6A8A60','--sage-light':'#E0EAD8','--sage-dark':'#3E5638','--sage-border':'#B5C8AC',
    '--clay':'#B88858','--clay-light':'#ECDDC8','--clay-dark':'#7A5430','--clay-hover':'#E0CAA8',
    '--ink':'#1E281C','--ink-light':'#56624E','--ink-lighter':'#8A9282',
    '--warning':'#B07020','--warning-bg':'#FDF3E3','--warning-border':'#E8D0A0',
    '--danger':'#A03020','--danger-bg':'#FCE8E4','--danger-border':'#E8C0B8','--success':'#3E5638'
  }},
  'sage-green': { label:'Sage', family:'green', vars: {
    '--cream':'#F4F5F1','--cream-dark':'#E7E9E2','--cream-border':'#C9CEC0','--white':'#FBFCFA',
    '--bark':'#6E7A5E','--bark-light':'#929E84','--bark-dark':'#404834',
    '--sage':'#869A78','--sage-light':'#E8EDE0','--sage-dark':'#4E5C40','--sage-border':'#C2CCB4',
    '--clay':'#B89A82','--clay-light':'#EBE2D8','--clay-dark':'#7A604E','--clay-hover':'#DDCEC0',
    '--ink':'#23271E','--ink-light':'#5C624E','--ink-lighter':'#8E9482',
    '--warning':'#B07020','--warning-bg':'#FDF3E3','--warning-border':'#E8D0A0',
    '--danger':'#A03020','--danger-bg':'#FCE8E4','--danger-border':'#E8C0B8','--success':'#4E5C40'
  }},
  'eucalyptus': { label:'Eucalyptus', family:'green', vars: {
    '--cream':'#F1F4F2','--cream-dark':'#E4E9E5','--cream-border':'#C5CFC8','--white':'#FBFCFB',
    '--bark':'#5E7872','--bark-light':'#8AA09A','--bark-dark':'#324842',
    '--sage':'#7AA098','--sage-light':'#E0EDE7','--sage-dark':'#436258','--sage-border':'#B6CDC4',
    '--clay':'#A8B8A0','--clay-light':'#E2EAE0','--clay-dark':'#688070','--clay-hover':'#CFD8C8',
    '--ink':'#1E2A26','--ink-light':'#566A62','--ink-lighter':'#8C9A92',
    '--warning':'#B07020','--warning-bg':'#FDF3E3','--warning-border':'#E8D0A0',
    '--danger':'#A03020','--danger-bg':'#FCE8E4','--danger-border':'#E8C0B8','--success':'#436258'
  }}
};

var DEFAULT_PALETTE = 'sage-green';
var MODULE_NAME     = 'module';

function setModule(name) { MODULE_NAME = String(name || 'module'); }
function paletteKey()    { return 'plume-palette-' + MODULE_NAME; }

function applyPalette(name) {
  var p = PALETTES[name];
  if (!p) { p = PALETTES[DEFAULT_PALETTE]; name = DEFAULT_PALETTE; }
  var root = document.documentElement;
  for (var k in p.vars) {
    if (Object.prototype.hasOwnProperty.call(p.vars, k)) root.style.setProperty(k, p.vars[k]);
  }
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
  var current = loadPaletteChoice();
  container.innerHTML = Object.keys(PALETTES).map(function (name) {
    var p = PALETTES[name], v = p.vars, isActive = (name === current);
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

// ══ Storage reporting ═════════════════════════════════
// Enumerates what is actually in storage rather than checking a list of
// expected key names. A hardcoded list silently misreports the moment a
// name drifts — which already happened once, hiding the largest consumer
// inside an unlabelled "Other" bucket.
function storLabel(k) {
  if (KEY_LABELS[k]) return KEY_LABELS[k];
  if (k.indexOf('plume-palette-') === 0 || k.indexOf('plume-pricing-') === 0) return null;
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
          '<span style="opacity:0.75">plume-core.js v' + VERSION + ' &middot; storage: ' + Store.driverName() + '</span></div>';
  if (r.rows.length) {
    html += '<button class="plume-link-btn" onclick="Plume.toggleStorDrill()">What is using the room?</button>';
    html += '<div id="stor-drill"></div>';
  }
  el.innerHTML = html;
  if (storDrillOpen) renderStorDrill();
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
    alert('Your changes could NOT be saved — browser storage is full.\n\n' +
          'Nothing you do from here will be saved until space is freed. Use the red banner at the ' +
          'top to download a backup first, then see Settings for what is taking up room.');
  }
}
function noteSaveOk() { storFailed = false; }

// ══ Shared styles ═════════════════════════════════════
// Injected so a module only has to provide the slot elements, not the CSS.
function injectStyles() {
  if (document.getElementById('plume-core-css')) return;
  var css =
  '.stor-banner{border-radius:6px;padding:12px 14px;margin-bottom:16px;font-size:12.5px;line-height:1.55;display:flex;gap:10px;align-items:flex-start}' +
  '.stor-banner.warn{background:#FBF3E7;border:1px solid #E0C9A0;color:#6B5433}' +
  '.stor-banner.crit{background:#F9E9E4;border:1px solid #D9A695;color:#7A3F2C}' +
  '.stor-banner b{font-weight:600}' +
  '.stor-banner .sb-x{margin-left:auto;background:none;border:none;font-size:16px;line-height:1;color:inherit;opacity:0.5;cursor:pointer;padding:0 2px;flex-shrink:0}' +
  '.stor-banner .sb-x:hover{opacity:1}' +
  '.stor-banner .btn{padding:4px 10px;font-size:11px;margin-top:8px}' +
  '.plume-link-btn{background:none;border:none;padding:0;font-family:inherit;font-size:10.5px;color:var(--ink-lighter);cursor:pointer;text-decoration:underline;text-underline-offset:2px;margin-top:6px}' +
  '.plume-link-btn:hover{color:var(--clay)}';
  var st = document.createElement('style');
  st.id = 'plume-core-css';
  st.appendChild(document.createTextNode(css));
  document.head.appendChild(st);
}

// ══ Boot ══════════════════════════════════════════════
// The one asynchronous moment in a Plume page: hydrate, then render.
// When the driver becomes IndexedDB or an API, this is the only place
// that has to wait — everything downstream stays synchronous.
function boot(cb) {
  injectStyles();
  Store.onQuotaError(noteSaveFailed);
  Store.init(function () {
    applyPalette(loadPaletteChoice());
    if (cb) cb();
    renderStorBanner();
  });
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
      '<td style="padding:5px 8px;color:#666;font-size:11px;font-style:italic">' + esc(ing.inci) + '</td>' +
      '<td style="padding:5px 8px;text-align:right;color:#888;font-size:11px">' + sap + '</td>' +
      '<td style="padding:5px 8px;text-align:right">' + pct.toFixed(2) + '%</td>' +
      '<td style="padding:5px 8px;text-align:right;font-weight:500">' + (pct / 100 * bs).toFixed(1) + 'g</td>' +
      tickTd() + '</tr>';
  });
  rows += '<tr style="background:#f9f9f9"><td style="padding:5px 0;font-weight:500">' + lyeLabel +
    (lyeType === 'koh' ? ' (90% flakes)' : '') +
    ' <span style="font-size:10px;font-weight:400;color:#888">at ' + superfat + '% superfat</span></td>' +
    '<td style="padding:5px 8px;color:#666;font-size:11px;font-style:italic">' +
    (lyeType === 'koh' ? 'Potassium Hydroxide' : 'Sodium Hydroxide') + '</td>' +
    '<td style="padding:5px 8px;text-align:right;color:#888;font-size:11px">\u2014</td>' +
    '<td style="padding:5px 8px;text-align:right">\u2014</td>' +
    '<td style="padding:5px 8px;text-align:right;font-weight:500">' + actualLye.toFixed(1) + 'g</td>' +
    tickTd() + '</tr>';
  rows += '<tr style="background:#f9f9f9"><td style="padding:5px 0;font-weight:500">Distilled water</td>' +
    '<td style="padding:5px 8px;color:#666;font-size:11px;font-style:italic">Aqua</td>' +
    '<td style="padding:5px 8px;text-align:right;color:#888;font-size:11px">\u2014</td>' +
    '<td style="padding:5px 8px;text-align:right">\u2014</td>' +
    '<td style="padding:5px 8px;text-align:right;font-weight:500">' + waterG.toFixed(1) + 'g</td>' +
    tickTd() + '</tr>';
  rows += '<tr style="border-top:2px solid #333">' +
    '<td colspan="4" style="padding:7px 0;font-weight:600;font-size:12px">Total batch weight</td>' +
    '<td style="padding:7px 8px;text-align:right;font-weight:600;font-size:14px">' + totalBatch.toFixed(0) + 'g</td>' +
    '<td></td></tr>';

  var addinBlock = '';
  if (addins.length) {
    addinBlock = '<div class="sec"><div class="sec-title">Additives (not included in lye calc)</div>' +
      '<table><thead><tr>' +
      '<th style="text-align:left;padding-bottom:6px;border-bottom:2px solid #333">Additive</th>' +
      '<th style="text-align:left;padding-bottom:6px;border-bottom:2px solid #333">INCI</th>' +
      '<th style="text-align:right;padding-bottom:6px;border-bottom:2px solid #333">% PPO</th>' +
      '<th style="text-align:right;padding-bottom:6px;border-bottom:2px solid #333">Grams</th>' +
      TICK_TH + '</tr></thead><tbody>';
    addins.forEach(function (l) {
      var ing = findIngIn(ings, l.ingId); if (!ing) return;
      var g   = parseFloat(l.gramsFixed) || 0;
      var ppo = totalOilG > 0 && g > 0 ? (g / totalOilG * 100).toFixed(2) + '%' : '\u2014';
      addinBlock += '<tr><td style="padding:5px 0;font-weight:500">' + esc(ing.name) + '</td>' +
        '<td style="padding:5px 8px;color:#666;font-size:11px;font-style:italic">' + esc(ing.inci) + '</td>' +
        '<td style="padding:5px 8px;text-align:right">' + ppo + '</td>' +
        '<td style="padding:5px 8px;text-align:right">' + g.toFixed(1) + 'g</td>' +
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
      '<th style="text-align:left;padding-bottom:6px;border-bottom:2px solid #333">INCI</th>' +
      '<th style="text-align:right;padding-bottom:6px;border-bottom:2px solid #333">SAP</th>' +
      '<th style="text-align:right;padding-bottom:6px;border-bottom:2px solid #333">%</th>' +
      '<th style="text-align:right;padding-bottom:6px;border-bottom:2px solid #333">Grams</th>' +
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
        '<td style="padding:5px 8px;color:#666;font-size:11px;font-style:italic">' + esc(r.ing.inci) + '</td>' +
        '<td style="padding:5px 8px;text-align:right">' + pct + '%</td>' +
        '<td style="padding:5px 8px;text-align:right">' + g + 'g</td>' +
        tickTd() + '</tr>';
    });
  });
  addins.forEach(function (l) {
    var ing = findIngIn(ings, l.ingId); if (!ing) return;
    var g  = parseFloat(l.gramsFixed) || 0;
    var dr = g > 0 ? Math.round(g * (l.dropsPerG || 20)) : 0;
    rows += '<tr><td style="padding:5px 0;font-weight:500">' + esc(ing.name) +
      ' <span style="font-size:10px;color:#888">(add-in)</span></td>' +
      '<td style="padding:5px 8px;color:#666;font-size:11px;font-style:italic">' + esc(ing.inci) + '</td>' +
      '<td style="padding:5px 8px;text-align:right">\u2014</td>' +
      '<td style="padding:5px 8px;text-align:right">' + g + 'g' + (dr ? ' (~' + dr + ' drops)' : '') + '</td>' +
      tickTd() + '</tr>';
  });

  var fl = lines.filter(function (l) { return !l.addin && findIngIn(ings, l.ingId); });
  fl.sort(function (a, b) { return (parseFloat(b.pct) || 0) - (parseFloat(a.pct) || 0); });

  return {
    table: '<div class="sec"><div class="sec-title">Ingredients</div>' +
      '<table><thead><tr>' +
      '<th style="text-align:left;padding-bottom:6px;border-bottom:2px solid #333">Ingredient</th>' +
      '<th style="text-align:left;padding-bottom:6px;border-bottom:2px solid #333">INCI</th>' +
      '<th style="text-align:right;padding-bottom:6px;border-bottom:2px solid #333">%</th>' +
      '<th style="text-align:right;padding-bottom:6px;border-bottom:2px solid #333">Grams</th>' +
      TICK_TH + '</tr></thead><tbody>' + rows + '</tbody></table></div>',
    inci: fl.map(function (l) { return findIngIn(ings, l.ingId).inci; }).join(', '),
    scaleLabel: 'Batch: ' + bs + 'g'
  };
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
    '<div class="sec"><div class="sec-title">INCI list (label order)</div>' +
    '<div class="inci">' + esc(built.inci) + '</div></div>' +
    '<scr' + 'ipt>window.onload=function(){window.print();};<\/scr' + 'ipt></body></html>';
}

function openSheet(o) {
  var win = window.open('', '_blank');
  if (!win) {
    alert('The print sheet was blocked by a popup blocker. Allow popups for this site and try again.');
    return null;
  }
  win.document.write(buildSheet(o));
  win.document.close();
  return win;
}


return {
  VERSION: VERSION,
  Store: Store, KEYS: KEYS, KEY_LABELS: KEY_LABELS,
  esc: esc, openModal: openModal, closeModal: closeModal,
  todayISO: todayISO, parseLocalDate: parseLocalDate, fmtDate: fmtDate, fmtBytes: fmtBytes,
  costPerG: costPerG, qtyToGrams: qtyToGrams, stockG: stockG,
  stockGOrNull: stockGOrNull, stockState: stockState,
  PALETTES: PALETTES, setModule: setModule, applyPalette: applyPalette,
  selectPalette: selectPalette, renderPaletteSwatches: renderPaletteSwatches,
  loadPaletteChoice: loadPaletteChoice, savePaletteChoice: savePaletteChoice,
  storageReport: storageReport, renderStorage: renderStorage,
  toggleStorDrill: toggleStorDrill, renderStorBanner: renderStorBanner,
  dismissStorBanner: dismissStorBanner,
  noteSaveFailed: noteSaveFailed, noteSaveOk: noteSaveOk,
  PRODUCT_TYPES: PRODUCT_TYPES, isSoapType: isSoapType, fillTypeSelect: fillTypeSelect,
  buildSheet: buildSheet, openSheet: openSheet,
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
