// On order and Compare (2026-10-25, v1.48).
// On order: a lot bought but not here yet. Priced like any purchase, never
// stock: nothing counts it as on hand and no batch can draw on it. Marking
// it arrived makes it stock, received today.
// Compare: a Compare ingredients button shows tick boxes; up to four picks
// open side by side.
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const here = (id, qty, cpg, extra) => Object.assign({ id: id, supplier: 'Lotioncrafter', qtyPurchased: String(qty), qtyUnit: 'g', costPerG: String(cpg), received: '2026-09-01' }, extra || {});
const INGS = [
  { id: 'iw', name: 'Distilled water', inci: 'Aqua', phase: 'water', functionCategory: ['Base / solvent'], lots: [here('L1', 5000, 0.001)], activeLotId: 'L1' },
  { id: 'io', name: 'Olivem 1000', inci: 'Cetearyl Olivate (and) Sorbitan Olivate', phase: 'oil', functionCategory: ['Emulsifier'], min: '3', max: '8',
    lots: [here('L1', 250, 0.064, { onOrder: true, received: '' })], activeLotId: 'L1' },
  { id: 'is', name: 'Squalane', inci: 'Squalane', phase: 'oil', functionCategory: ['Emollient'],
    lots: [here('L1', 20, 0.09), here('L2', 200, 0.08, { onOrder: true, received: '', buyLink: 'https://example.com/sq' })], activeLotId: 'L1' },
  { id: 'ij', name: 'Jojoba oil', inci: 'Simmondsia Chinensis Seed Oil', phase: 'oil', functionCategory: ['Emollient'], lots: [here('L1', 400, 0.04)], activeLotId: 'L1' },
  { id: 'ig', name: 'Glycerin', inci: 'Glycerin', phase: 'water', functionCategory: ['Humectant'], lots: [here('L1', 400, 0.015)], activeLotId: 'L1' },
  { id: 'ix', name: 'Xanthan gum', inci: 'Xanthan Gum', phase: 'water', functionCategory: ['Thickener'], lots: [here('L1', 90, 0.06)], activeLotId: 'L1' }
];
const LINES = [{ ingId: 'iw', pct: '79' }, { ingId: 'io', pct: '6' }, { ingId: 'is', pct: '15' }];
const FORMS = [{ id: 'f1', name: 'Day cream', type: 'Face cream', status: 'draft', lines: LINES,
  variants: [{ vid: 'v1', num: 1, label: '', status: 'draft', lines: LINES, batchSize: '200', usageLog: [], history: [] }], activeVariantId: 'v1' }];
const SEED = `
  localStorage.clear();
  localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(INGS))});
  localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});
  localStorage.setItem('aerie-suppliers-v1', '[{"id":"s1","name":"Lotioncrafter"}]');
  localStorage.setItem('aerie-batches-v1', '[]');
  localStorage.setItem('aerie-packaging-v2', '[]');
  localStorage.setItem('plume-products-v1', '[]');
  localStorage.setItem('plume-theme', 'light');`;
const getIngs = "JSON.parse(localStorage.getItem('aerie-ingredients-v2'))";

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Anchorage' });
  const errors = [], dialogs = [];
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await trackDialogs(page, dialogs);

  console.log('\n1. Core: on order is priced, never stock');
  await page.goto(previewUrl('ingredients')); await page.evaluate(SEED); await page.reload(); await page.waitForTimeout(500);
  const core = await page.evaluate(`(function () {
    var o = ingredients.find(function (i) { return i.id === 'io'; }), s = ingredients.find(function (i) { return i.id === 'is'; });
    return { oStock: Plume.stockG(o), oNull: Plume.stockGOrNull(o), oOrd: Plume.onOrderG(o), oCost: Plume.costPerG(o),
             sStock: Plume.stockG(s), sOrd: Plume.onOrderG(s), listO: calcTotalStockG(o), hasO: hasStock(o) };
  })()`);
  ok('an on-order lot is not stock (stockG 0, stockGOrNull null, list none)', core.oStock === 0 && core.oNull === null && !core.hasO && core.listO === null, core);
  ok('it counts as on order, in grams', core.oOrd === 250 && core.sOrd === 200, core);
  ok('it is still priced, so recipes cost', core.oCost === 0.064, core);
  ok('a lot that is here beside one on order counts only what is here', core.sStock === 20, core);

  console.log('\n2. The list and the quick look');
  ok('the stock cell shows the on-order tag', /250 g on order/.test(await page.evaluate("document.querySelector('#tbody tr[data-ing=\"io\"]').innerText")));
  ok('a stocked ingredient with more on order shows both', await page.evaluate("(function(){ var t = document.querySelector('#tbody tr[data-ing=\"is\"]').innerText; return /20g/.test(t) && /200 g on order/.test(t); })()"));
  await page.evaluate("toggleOnOrder()");
  ok('the On order chip lists only those', JSON.stringify(await page.evaluate("Array.from(document.querySelectorAll('#tbody tr[data-ing]')).map(function(r){return r.getAttribute('data-ing');})")) === '["io","is"]');
  await page.evaluate("toggleOnOrder(); toggleQuickLook('io')");
  ok('the quick look has Mark arrived', await page.evaluate("!!document.querySelector('tr.ql-row .ord-arrive')"));
  await page.evaluate("markArrived(null, 'io')"); await page.waitForTimeout(150);
  let io = (await page.evaluate(getIngs)).find(i => i.id === 'io');
  ok('Mark arrived makes it stock, received today', !io.lots[0].onOrder && io.lots[0].received === await page.evaluate('todayISO()'), io.lots[0]);
  ok('and the tag and button are gone', await page.evaluate("!/on order/.test(document.querySelector('#tbody tr[data-ing=\"io\"]').innerText) && !document.querySelector('tr.ql-row .ord-arrive')"));

  console.log('\n3. The lot editor and Quick add');
  await page.evaluate("viewIngredient('is'); editCurrent()"); await page.waitForTimeout(150);
  ok('the lot editor has an On order tick, ticked on the lot that is coming', await page.evaluate("Array.from(document.querySelectorAll('#lots-container [data-field=\"onOrder\"]')).map(function(c){return c.checked;}).join() === 'false,true'"));
  await page.evaluate("document.querySelectorAll('#lots-container [data-field=\"onOrder\"]')[1].checked = false; saveIngredient(false)"); await page.waitForTimeout(150);
  let is = (await page.evaluate(getIngs)).find(i => i.id === 'is');
  ok('unticking it and saving marks it arrived, dated today', !is.lots[1].onOrder && is.lots[1].received === await page.evaluate('todayISO()'), is.lots[1]);
  ok('the other lot keeps its date and no onOrder key is stored', is.lots[0].received === '2026-09-01' && !('onOrder' in is.lots[0]), is.lots[0]);
  await page.evaluate(`(function () { showList(); openQuickAdd();
    document.getElementById('qa-name').value = 'Sepimax Zen'; document.getElementById('qa-inci').value = 'Polyacrylate Crosspolymer-6';
    document.getElementById('qa-size').value = '100'; document.getElementById('qa-price').value = '15';
    document.getElementById('qa-onorder').checked = true; qaOnOrder(); qaCost(); qaSave(true); })()`);
  await page.waitForTimeout(200);
  const sz = (await page.evaluate(getIngs)).find(i => i.name === 'Sepimax Zen');
  ok('Quick add "Not here yet" saves the lot on order with no received date', sz && sz.lots[0].onOrder === true && sz.lots[0].received === '' && sz.lots[0].costPerG === '0.1500', sz && sz.lots[0]);
  ok('"Save & add another" keeps the tick for the next item of the same order', await page.evaluate("document.getElementById('qa-onorder').checked && document.getElementById('qa-received').disabled"));
  await page.evaluate("closeModal('modal-quick')");

  console.log('\n4. Formulations and Batches');
  await page.evaluate(SEED);
  await page.goto(previewUrl('formulations')); await page.waitForTimeout(500);
  await page.evaluate("openFormula('f1')"); await page.waitForTimeout(200);
  const notes = await page.evaluate("Array.from(document.querySelectorAll('.order-note')).map(function(n){return n.textContent;})");
  ok('recipe lines say what is on order (and what is short anyway)', notes.length === 2 && /250g on order/.test(notes.join()) && /20g on hand · 200g on order/.test(notes.join()), notes);
  await page.goto(previewUrl('batchlog')); await page.waitForTimeout(500);
  await page.evaluate("openNewBatch(); document.getElementById('f-formula').value = 'f1'; onFormulaChange(); document.getElementById('f-yield').value = '200'; recalcPreview(); saveBatch();");
  await page.waitForTimeout(300);
  const blocked = await page.evaluate("({ n: batches.length, msg: document.getElementById('new-commit-msg').innerText, link: (document.querySelector('#new-commit-msg a[href*=\"#ql=\"]') || {}).getAttribute ? document.querySelector('#new-commit-msg a[href*=\"#ql=\"]').getAttribute('href') : '' })");
  ok('a batch needing an on-order ingredient is not made', blocked.n === 0, blocked);
  ok('the message says it is on order, not here yet', /Olivem 1000.*250g is on order, not here yet/.test(blocked.msg.replace(/\s+/g, ' ')), blocked.msg);
  ok('"mark it arrived" links to the list with that ingredient open', blocked.link === 'plume-ingredients.html#ql=io', blocked.link);
  ok('the stock column shows it as coming', /250g on order/.test(await page.evaluate("document.getElementById('preview-body').innerText")));
  const plan = await page.evaluate("(function(){ var s = ings.find(function(i){return i.id==='is';}); return planIngredientDraw(s, 15); })()");
  ok('a batch never draws on an on-order lot, even with enough coming', plan.ok && plan.draws.length === 1 && plan.draws[0].lotId === 'L1', plan);

  console.log('\n5. The #ql= link');
  await page.goto(previewUrl('ingredients') + '#ql=io'); await page.waitForTimeout(700);
  ok('it opens the list with that ingredient\'s quick look open and Mark arrived there', await page.evaluate("qlOpenId === 'io' && !!document.querySelector('tr.ql-row .ord-arrive') && getComputedStyle(document.getElementById('list-view')).display !== 'none'"));

  console.log('\n6. Compare');
  await page.evaluate("try { localStorage.removeItem('plume-compare'); } catch (e) {}"); await page.reload(); await page.waitForTimeout(500);
  ok('no tick boxes and no tray until asked', await page.evaluate("document.querySelectorAll('.cmp-pick').length === 0 && document.getElementById('cmp-tray').hidden && getComputedStyle(document.getElementById('cmp-tray')).display === 'none'"));
  await page.click('#cmp-mode-btn'); await page.waitForTimeout(150);
  ok('Compare ingredients shows a box on every row and the tray', await page.evaluate("document.querySelectorAll('.cmp-pick').length === document.querySelectorAll('#tbody tr[data-ing]').length && !document.getElementById('cmp-tray').hidden"));
  await page.evaluate("['ij','is','ig','iw'].forEach(function(id){ toggleCompare(id, true); })"); dialogs.length = 0;
  await page.evaluate("toggleCompare('ix', true)"); await page.waitForTimeout(100);
  ok('a fifth is refused, with a note', await page.evaluate("cmpIds.length") === 4 && dialogs.some(d => /up to 4/.test(d)), dialogs);
  await page.evaluate("openCompare()"); await page.waitForTimeout(150);
  ok('Compare opens them side by side, one column each', await page.evaluate("document.querySelectorAll('#cmp-body thead th').length === 5"));
  const rows = await page.evaluate("Array.from(document.querySelectorAll('#cmp-body tbody th')).map(function(t){return t.textContent;})");
  ok('only rows with something filled in', rows.indexOf('Function') !== -1 && rows.indexOf('Cost per gram') !== -1 && rows.indexOf('Scent') === -1, rows);
  await page.evaluate("document.getElementById('cmp-diff').checked = true; renderCompare()");
  const diffRows = await page.evaluate("Array.from(document.querySelectorAll('#cmp-body tbody th')).map(function(t){return t.textContent;})");
  ok('"Only rows that differ" hides rows where all agree', diffRows.indexOf('Supplier') === -1 && diffRows.indexOf('Cost per gram') !== -1 && /all agree/.test(await page.evaluate("document.querySelector('.cmp-foot').textContent")), diffRows);
  await page.evaluate("closeModal('modal-compare'); toggleCmpMode(false)");
  ok('Done hides the boxes and tray but keeps the picks', await page.evaluate("document.querySelectorAll('.cmp-pick').length === 0 && document.getElementById('cmp-tray').hidden && cmpIds.length === 4"));
  await page.evaluate("clearCompare(); toggleQuickLook('ix')");
  await page.evaluate("Array.from(document.querySelectorAll('tr.ql-row .ql-actions a')).find(function(a){return /Add to compare/.test(a.textContent);}).click()");
  ok('"Add to compare" in the quick look turns compare on with that pick', await page.evaluate("cmpMode && cmpIds.join() === 'ix'"));

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
