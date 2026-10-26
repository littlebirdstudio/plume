// The 2026-10-24 sweep (v1.44). Each check here compares TWO places that must
// agree, because every bug it covers passed a suite that checked one place
// against itself:
//   1. Batches took pinned lines, add-ins and soap additives out of stock
//      scaled by yield / 100 (it read f.batchSize, which nothing writes),
//      while the bench sheet printed the grams as recorded.
//   2. Products & Costing and core priced a line by its grams when a line had
//      both grams and a percent, adding grams to percents.
//   3. Saving an ingredient erased a lot's supplier when that name was not a
//      saved supplier ("Made in-house", a Quick-add name).
//   4. A page saved its whole ingredient list, undoing what another window
//      had saved since it loaded.
//   5. Dates built from toISOString() are tomorrow after 4 pm in Alaska.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { ROOT, previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol || 1e-6);

const lot = (id, cpg, supplier) => ({ id: id, supplier: supplier || '', qtyPurchased: '5000', qtyUnit: 'g', costPerG: String(cpg) });
const INGS = [
  { id: 'iw', name: 'Distilled water', inci: 'Aqua', phase: 'water', lots: [lot('lw', 0.001)], activeLotId: 'lw' },
  { id: 'ig', name: 'Glycerin', inci: 'Glycerin', phase: 'water', lots: [lot('lg', 0.05)], activeLotId: 'lg' },
  { id: 'ie', name: 'Lavender essential oil', inci: 'Lavandula Angustifolia Oil', phase: 'cool-down', lots: [lot('le', 0.2)], activeLotId: 'le' },
  { id: 'io', name: 'Olive oil', inci: 'Olea Europaea Fruit Oil', phase: 'oil', lots: [lot('lo', 0.01)], activeLotId: 'lo', soap: { naoh: 0.134, koh: 0.188 } },
  { id: 'ic', name: 'Coconut oil', inci: 'Cocos Nucifera Oil', phase: 'oil', lots: [lot('lc', 0.02)], activeLotId: 'lc', soap: { naoh: 0.183, koh: 0.257 } },
  { id: 'iy', name: 'Sodium hydroxide', inci: 'Sodium Hydroxide', phase: 'water', lots: [lot('ly', 0.01)], activeLotId: 'ly' },
  // A stock solution's ingredient: its lot's supplier is not a saved supplier.
  { id: 'ih', name: 'HA solution', inci: 'Aqua, Sodium Hyaluronate', phase: 'water', madeBy: 'fha',
    lots: [{ id: 'L-made-b1', supplier: 'Made in-house', qtyPurchased: '200', qtyUnit: 'g', costPerG: '0.01', madeBatchId: 'b1', madeG: 200, madeCost: 0.01, lotNum: '261001', received: '2026-10-01' }],
    activeLotId: 'L-made-b1' },
  { id: 'iq', name: 'Rosehip oil', inci: 'Rosa Canina Seed Oil', phase: 'oil', lots: [lot('lq', 0.08, 'mountain rose herbs')], activeLotId: 'lq' }
];
const V = (vid, lines, bs, extra) => Object.assign({ vid: vid, num: 1, label: '', status: 'approved', lines: lines, instructions: '', batchSize: bs, usageLog: [], history: [] }, extra || {});
const F = (id, name, type, lines, bs, extra) => Object.assign({ id: id, name: name, type: type, status: 'approved', lines: lines,
  variants: [V('v' + id, lines, bs, extra)], activeVariantId: 'v' + id }, extra || {});
// As Formulations stores them: typing 10 g at a 500 g batch writes grams AND 2%.
const LOTION = [
  { ingId: 'iw', pct: '98', gramsFixed: '' },
  { ingId: 'ig', pct: '2.00', gramsFixed: '10', pinned: false }
];
// Pinned at 500 g, plus a drops add-in. Totals 100%: Formulations divides
// by the batch size and Costing by the formula total, which agree only then.
const PINNED = [
  { ingId: 'iw', pct: '98', gramsFixed: '' },
  { ingId: 'ig', pct: '2.0000', gramsFixed: '10.0000', pinned: true },
  { ingId: 'ie', pct: '', gramsFixed: '5', addin: true }
];
// Soap: one oil typed in grams at 1000 g (grams AND percent), one in percent
// only, and a 30 g additive.
const SOAP = [
  { ingId: 'io', pct: '70.0000', gramsFixed: '700' },
  { ingId: 'ic', pct: '30', gramsFixed: '' },
  { ingId: 'ie', gramsFixed: '30', soapAddin: true }
];
const FORMS = [
  F('fl', 'Lotion', 'Body lotion', LOTION, '500'),
  F('fp', 'Toner', 'Toner / mist', PINNED, '500'),
  F('fs', 'Lavender bar', 'Cold Process Soap', SOAP, '1000', { soapSettings: { superfat: 5, lyeType: 'naoh', waterRatio: 2.5 } })
];
const PRODUCTS = [
  { id: 'pl', name: 'Lotion 100 g', status: 'active', formulaId: 'fl', netWtG: 100, retail: 20, packagingRecipe: [], productionRuns: [] },
  { id: 'pp', name: 'Toner 100 g', status: 'active', formulaId: 'fp', netWtG: 100, retail: 20, packagingRecipe: [], productionRuns: [] },
  { id: 'ps', name: 'Lavender bar', status: 'active', formulaId: 'fs', netWtG: 120, retail: 9, packagingRecipe: [], productionRuns: [] }
];
const SUPPLIERS = [{ id: 's1', name: 'Mountain Rose Herbs', webLink: '', notes: '' },
                   { id: 's2', name: '<img src=x onerror="window.PWN=1">', webLink: '', notes: '' }];
const SEED = `
  localStorage.clear();
  localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(INGS))});
  localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});
  localStorage.setItem('aerie-suppliers-v1', ${JSON.stringify(JSON.stringify(SUPPLIERS))});
  localStorage.setItem('aerie-packaging-v2', '[]');
  localStorage.setItem('aerie-batches-v1', '[]');
  localStorage.setItem('plume-products-v1', ${JSON.stringify(JSON.stringify(PRODUCTS))});
  localStorage.setItem('plume_costing_listorder_v1', '1');
  localStorage.setItem('plume-theme', 'light');`;
const getIngs = "JSON.parse(localStorage.getItem('aerie-ingredients-v2'))";

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Anchorage' });
  const errors = [], dialogs = [];
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await trackDialogs(page, dialogs);

  // ── 1. Batches takes what the bench sheet prints ──────────────────
  console.log('\n1. Batches: grams taken match the bench sheet');
  await page.goto(previewUrl('batchlog')); await page.evaluate(SEED); await page.reload(); await page.waitForTimeout(400);
  const batchGrams = (fid, y) => page.evaluate(`(function () {
    openNewBatch();
    document.getElementById('f-formula').value = '${fid}'; onFormulaChange();
    document.getElementById('f-yield').value = '${y}'; recalcPreview();
    var out = {}; newPreview.forEach(function (r) { out[r.ingredientId] = Math.round(r.grams * 1000) / 1000; });
    var opts = null, real = Plume.openSheet; Plume.openSheet = function (o) { opts = o; };
    printNewBatchSheet(); Plume.openSheet = real;
    return { take: out, sheet: Plume.buildSheet(opts) };
  })()`);
  let r = await batchGrams('fs', 1000);
  ok('a 30 g soap additive is taken as 30 g at the recipe size (was 300 g)', r.take.ie === 30, r.take);
  ok('the bench sheet prints the same 30 g', /30\.0g/.test(r.sheet));
  ok('soap oils still scale by percent', r.take.io === 700 && r.take.ic === 300, r.take);
  r = await batchGrams('fp', 500);
  ok('a pinned 10 g line is taken as 10 g (was 50 g)', r.take.ig === 10, r.take);
  ok('a 5 g add-in is taken as 5 g (was 25 g)', r.take.ie === 5, r.take);
  ok('percent lines scale with the yield', r.take.iw === 490, r.take);
  ok('the sheet prints 10.00g and 5g for them, the same amounts', /10\.00g/.test(r.sheet) && />5g/.test(r.sheet));
  r = await batchGrams('fp', 1000);
  ok('at another yield pinned and add-in grams stay fixed, as on the sheet and in the editor', r.take.ig === 10 && r.take.ie === 5 && r.take.iw === 980 && /10\.00g/.test(r.sheet), r.take);
  const src = fs.readFileSync(path.join(ROOT, 'plume-batchlog.html'), 'utf8');
  ok('nothing in Batches reads the never-written f.batchSize', !/newFormula\.batchSize/.test(src));

  // ── 2. One cost per gram, on every screen ─────────────────────────
  console.log('\n2. Cost per gram: Formulations, Products & Costing and core agree');
  await page.goto(previewUrl('formulations')); await page.waitForTimeout(400);
  const formPerG = (fid) => page.evaluate(`(function () {
    openFormula('${fid}');
    var t = document.getElementById('cost-panel').innerText.replace(/\\s+/g, ' ');
    var m = t.match(/Per gram \\$([0-9.]+)/); return m ? parseFloat(m[1]) : null;
  })()`);
  const fLotion = await formPerG('fl'), fPinned = await formPerG('fp');
  await page.goto(previewUrl('costing')); await page.waitForTimeout(400);
  const cost = await page.evaluate(`(function () {
    var d = { ings: ings, forms: forms, pkgs: pkgs, products: products };
    return ['fl', 'fp', 'fs'].map(function (id) {
      var p = products.filter(function (x) { return x.formulaId === id; })[0];
      return { perG: formulationCostDetail(findForm(id)).perG,
               unit: computeProductCost(p).totalCost, core: Plume.productUnitCost(p, d), net: p.netWtG };
    });
  })()`);
  ok('typed grams: Formulations shows $0.0020/g', fLotion === 0.002, fLotion);
  ok('typed grams: Products & Costing agrees (was ~2.8x high)', near(cost[0].perG, 0.00198), cost[0]);
  ok('pinned: Products & Costing agrees with Formulations (was ~8x high)', fPinned !== null && near(cost[1].perG, fPinned, 0.00006), { form: fPinned, cost: cost[1] });
  ok('soap typed half in grams: priced by its percents ($0.013/g, was $0.0104)', near(cost[2].perG, 0.013), cost[2]);
  ok('core\'s unit cost agrees with Products & Costing on all three', cost.every(c => near(c.core, c.unit, 1e-9)), cost);
  const label = await page.evaluate("buildIngredientList(findProduct('pp'), 'common', [])");
  ok('the label lists by real share: water, glycerin, then the 5 g add-in', /Distilled water.*Glycerin.*Lavender/.test(String(label)), label);
  const share = await page.evaluate(`[
    Plume.lineShare({ pct: '2.00', gramsFixed: '10' }, findForm('fl')),
    Plume.lineShare({ pct: '2', gramsFixed: '10', pinned: true }, findForm('fl')),
    Plume.lineShare({ gramsFixed: '5', addin: true }, findForm('fl')),
    Plume.lineShare({ gramsFixed: '5', addin: true }, findForm('fl'), { addins: true }),
    Plume.lineShare({ gramsFixed: '300' }, { type: 'Cold Process Soap', lines: [] })
  ]`);
  ok('lineShare: percent wins; pinned grams at the batch size; add-ins only when asked; old all-gram soap at 1000 g',
    share[0] === 2 && share[1] === 2 && share[2] === 0 && share[3] === 1 && share[4] === 30, share);

  // ── 3. A lot keeps its supplier through an editor save ────────────
  console.log('\n3. Ingredients: the editor keeps a lot\'s own supplier');
  await page.goto(previewUrl('ingredients')); await page.waitForTimeout(400);
  const saveUntouched = (id) => page.evaluate(`(function () { viewIngredient('${id}'); editCurrent(); saveIngredient(false); })()`);
  await saveUntouched('ih'); await page.waitForTimeout(200);
  let ih = (await page.evaluate(getIngs)).find(i => i.id === 'ih');
  ok('"Made in-house" survives saving a stock solution\'s ingredient', ih.lots[0].supplier === 'Made in-house', ih.lots[0]);
  ok('so does its batch link', ih.lots[0].madeBatchId === 'b1');
  await saveUntouched('iq'); await page.waitForTimeout(200);
  let iq = (await page.evaluate(getIngs)).find(i => i.id === 'iq');
  ok('a name that differs from a saved supplier only by case survives too', iq.lots[0].supplier === 'mountain rose herbs', iq.lots[0]);
  await page.evaluate("viewIngredient('iq'); editCurrent();");
  const optText = await page.evaluate("document.querySelector('.lot-supplier-select').selectedOptions[0].textContent");
  ok('the select shows it, marked as not in Suppliers', /mountain rose herbs \(not in Suppliers\)/.test(optText), optText);
  ok('a supplier name with markup is shown as text, never run', await page.evaluate("window.PWN === undefined && Array.from(document.querySelectorAll('.lot-supplier-select option')).some(function (o) { return o.textContent.indexOf('<img') === 0; })"));
  await page.evaluate("closeModal('modal-add')");

  // ── 4. Two windows, one library ───────────────────────────────────
  console.log('\n4. A page saves only what it changed');
  await page.evaluate(SEED); await page.reload(); await page.waitForTimeout(400);
  const other = await ctx.newPage();
  other.on('pageerror', e => errors.push(String(e)));
  await trackDialogs(other, dialogs);
  await other.goto(previewUrl('batchlog')); await other.waitForTimeout(600);   // opened now: same library
  // Another window adds an ingredient and edits one, after this page loaded.
  await other.evaluate(`(function () {
    var list = JSON.parse(localStorage.getItem('aerie-ingredients-v2'));
    list.push({ id: 'inew', name: 'Made in another window', inci: 'X', phase: 'water', lots: [] });
    list.filter(function (i) { return i.id === 'io'; })[0].name = 'Olive oil (renamed elsewhere)';
    localStorage.setItem('aerie-ingredients-v2', JSON.stringify(list));
  })()`);
  // Two windows share storage, but a write reaches the other window's view a
  // moment later, not instantly. Wait a beat after each cross-window write.
  await page.waitForTimeout(400);
  // This page, still holding the old list, edits a different ingredient and deletes one.
  await page.evaluate(`(function () {
    ingredients.filter(function (i) { return i.id === 'ig'; })[0].purpose = 'Humectant for toners';
    ingredients = ingredients.filter(function (i) { return i.id !== 'iq'; });
    saveData();
  })()`);
  await page.waitForTimeout(400);
  let ings = await page.evaluate(getIngs);
  ok('the ingredient added in the other window is kept (was deleted)', ings.some(i => i.id === 'inew'));
  ok('the other window\'s edit to a different ingredient is kept', ings.find(i => i.id === 'io').name === 'Olive oil (renamed elsewhere)');
  ok('this page\'s own edit is saved', ings.find(i => i.id === 'ig').purpose === 'Humectant for toners');
  ok('this page\'s delete is saved', !ings.some(i => i.id === 'iq'));
  ok('the page now holds the merged list', await page.evaluate("ingredients.some(function (i) { return i.id === 'inew'; })"));
  // Batches, opened before both of those, takes stock from one ingredient.
  await other.evaluate(`(function () {
    ings.filter(function (i) { return i.id === 'iw'; })[0].lots[0].qtyPurchased = '4000';
    saveIngredients();
  })()`);
  await page.waitForTimeout(400);
  ings = await page.evaluate(getIngs);
  ok('Batches\' stock change lands without undoing Ingredients\' edits or delete',
    ings.find(i => i.id === 'iw').lots[0].qtyPurchased === '4000' && ings.find(i => i.id === 'ig').purpose === 'Humectant for toners'
    && !ings.some(i => i.id === 'iq') && ings.some(i => i.id === 'inew'),
    { ids: ings.map(i => i.id), qty: ings.find(i => i.id === 'iw').lots[0].qtyPurchased, purpose: (ings.find(i => i.id === 'ig') || {}).purpose });
  // Coming back to the Ingredients tab shows what the other window saved.
  await other.evaluate(`(function () {
    var list = JSON.parse(localStorage.getItem('aerie-ingredients-v2'));
    list.push({ id: 'inew2', name: 'Stock solution from a batch', inci: 'Y', phase: 'water', lots: [] });
    localStorage.setItem('aerie-ingredients-v2', JSON.stringify(list));
  })()`);
  await page.waitForTimeout(400);
  await page.evaluate("freshenFromStorage()");
  ok('returning to the tab rereads the library', await page.evaluate("ingredients.some(function (i) { return i.id === 'inew2'; }) && /Stock solution from a batch/.test(document.getElementById('tbody').innerText)"),
    await page.evaluate("({ hidden: document.hidden, has: ingredients.some(function (i) { return i.id === 'inew2'; }), open: !!document.querySelector('.modal-overlay.open') })"));
  const m = await page.evaluate(`(function () {
    var base = {}; [{ id: 'a', v: 1 }, { id: 'b', v: 1 }].forEach(function (r) { base[r.id] = JSON.stringify(r); });
    // Both changed 'a': this page wins. 'b' deleted elsewhere, untouched here: stays deleted.
    return Plume.mergeList([{ id: 'a', v: 2 }], [{ id: 'a', v: 3 }, { id: 'b', v: 1 }], base);
  })()`);
  ok('same record changed in both: this page\'s copy wins; a record deleted elsewhere and untouched here stays deleted',
    m.length === 1 && m[0].v === 3, m);
  await other.close();

  // ── 5. Local dates ────────────────────────────────────────────────
  console.log('\n5. Dates');
  const app = ['plume-core.js', 'plume-ingredients.html', 'plume-formulations.html', 'plume-batchlog.html',
               'plume-costing.html', 'plume-packaging.html', 'index.html'];
  const utcDays = app.filter(f => /toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  ok('no app file makes a date from toISOString() (UTC: tomorrow after 4 pm in Alaska)', utcDays.length === 0, utcDays);

  // ── 6. Recommended % starts a line at the right amount ──────────
  console.log('\n6. Recommended % (v1.45)');
  await page.goto(previewUrl('formulations')); await page.waitForTimeout(400);
  const CASES = [
    ['.5%', '0.5'], ['.5', '0.5'], ['0.5%', '0.5'], ['0,5 %', '0.5'], ['0.1-0.5%', '0.1'],
    ['2-5%', '2'], ['2–5%', '2'], ['1 to 3 %', '1'], ['up to 1%', '1'], ['pH 5: 2%', '2'],
    ['10%', '10'], ['5', '5'], ['', ''], ['as needed', ''], ['150%', ''], ['0%', '']
  ];
  const got = await page.evaluate('(' + JSON.stringify(CASES) + ').map(function (c) { return Plume.recStart(c[0]); })');
  CASES.forEach((c, i) => ok('"' + c[0] + '" starts at ' + (c[1] ? c[1] + '%' : 'blank'), got[i] === c[1], got[i]));
  ok('Formulations uses it for a new line', await page.evaluate("recStartPct({ useRate: '.5%' }) === '0.5'"));

  // ── 7. Cost per gram while formulating ─────────────────────────────
  console.log('\n7. Formulations shows cost per gram (v1.47)');
  await page.evaluate(SEED); await page.reload(); await page.waitForTimeout(400);
  await page.evaluate("openFormula('fl')"); await page.waitForTimeout(200);
  await page.evaluate("var s = document.getElementById('ing-search'); s.value = 'lav'; s.dispatchEvent(new Event('input', { bubbles: true }))");
  await page.waitForTimeout(200);
  const dd = await page.evaluate("Array.from(document.querySelectorAll('#ing-dd .dd-item')).map(function (r) { return r.innerText.replace(/\\s+/g, ' '); })");
  ok('the search dropdown shows each ingredient\'s cost per gram', dd.some(t => /Lavender/.test(t) && /\$0\.200\/g/.test(t)), dd);
  await page.evaluate("showIngDetail('ig')"); await page.waitForTimeout(150);
  const pop = await page.evaluate("document.getElementById('id-body').innerText.replace(/\\s+/g, ' ')");
  ok('the ingredient popup shows it beside stock on hand', /STOCK ON HAND [^ ]+ COST PER GRAM \$0\.050\/g/i.test(pop), pop);
  ok('and agrees with the cost used for the line', await page.evaluate("cpgText(ings.find(function (i) { return i.id === 'ig'; })) === '$' + bestCpg(ings.find(function (i) { return i.id === 'ig'; })).toFixed(3) + '/g'"));
  ok('an unpriced ingredient says so', await page.evaluate("cpgText({ lots: [] }) === ''") && /No price yet/.test(await page.evaluate("(function(){ ings.push({ id: 'zz', name: 'Unpriced', inci: 'X', phase: 'water', lots: [] }); showIngDetail('zz'); return document.getElementById('id-body').innerText; })()")));

  // ── 8. From the 2026-10-25 click-through (v1.50) ─────────────────
  console.log('\n8. Click-through fixes (v1.50)');
  await page.evaluate(SEED); await page.goto(previewUrl('formulations')); await page.waitForTimeout(500);
  const fcost = () => page.evaluate(`(function () {
    openFormula('fp');
    var t = document.getElementById('cost-panel').innerText.replace(/\\s+/g, ' ');
    var ed = parseFloat((t.match(/Per 100g \\$([0-9.]+)/) || [])[1]);
    goList();
    var card = Array.from(document.querySelectorAll('.fcard')).find(function (c) { return /Toner/.test(c.innerText); });
    var cd = parseFloat(((card ? card.innerText : '').match(/\\$([0-9.]+)/) || [])[1]);
    return { editor: ed, card: cd };
  })()`);
  let fc = await fcost();
  ok('the formulation card and the editor give the same cost per 100 g (pinned grams at the formula\'s own size)', fc.editor === 0.2 && fc.card === 0.2, fc);
  await page.evaluate(`(function () {
    var f = forms.find(function (x) { return x.id === 'fp'; }); f.addinsInTotal = true; f.variants[0].addinsInTotal = true; saveAll(); renderCards();
  })()`);
  fc = await fcost();
  ok('with add-ins counted, the 5 g add-in is priced in both (was 0 g)', fc.editor === 0.4 && fc.card === 0.4, fc);
  await page.evaluate("openFormula('fp')"); await page.waitForTimeout(150);
  ok('Copy INCI includes the add-in', await page.evaluate("(curInciNames || []).join(', ').indexOf('Lavandula') !== -1"), await page.evaluate("curInciNames"));
  const sheet = await page.evaluate("(function () { var o = null, r = Plume.openSheet; Plume.openSheet = function (x) { o = x; }; printFormula(); Plume.openSheet = r; return Plume.buildSheet(o); })()");
  ok('the printed INCI list includes the add-in, after the formula ingredients',
    /INCI list[\s\S]*Aqua[\s\S]*Glycerin[\s\S]*Lavandula/.test(sheet.replace(/<[^>]+>/g, ' ')));
  await page.goto(previewUrl('ingredients')); await page.waitForTimeout(400);
  await page.evaluate(`(function () {
    var i = ingredients.find(function (x) { return x.id === 'ig'; });
    i.links = [{ label: 'SDS', url: 'https://example.com/sds"onmouseover="window.PWN=1' }, { label: 'Not a web link', url: 'javascript:alert(1)' }];
    saveData(); viewIngredient('ig');
  })()`);
  ok('a link with a quote in it cannot add attributes to the page', await page.evaluate("!document.querySelector('#d-body [onmouseover]') && window.PWN === undefined && Array.from(document.querySelectorAll('#d-body a.detail-link')).some(function (a) { return a.getAttribute('href').indexOf('\"onmouseover') !== -1; })"));
  ok('and only web links become links', await page.evaluate("!document.querySelector('#d-body a[href^=javascript]')"));

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
