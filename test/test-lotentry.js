// Lot entry (2026-10-25 preview): Bought is a count x a size, the price is
// for all of them or each, and On hand is not typed. A new lot starts at what
// was bought and follows Bought until some is used; after that it changes
// only through a batch or Adjust, which keeps a dated note on the lot.
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const INGS = [
  // Bought 2 x 4 oz for $20 total, nothing used yet.
  { id: 'ia', name: 'Argan oil', inci: 'Argania Spinosa Kernel Oil', phase: 'oil', density: '0.91',
    lots: [{ id: 'L1', supplier: 'Lotioncrafter', purchaseCount: '2', purchaseSize: '4', purchaseUnit: 'oz', purchasePrice: '20',
             qtyPurchased: '8', qtyUnit: 'oz', costPerG: '0.0882', received: '2026-10-01' }], activeLotId: 'L1' },
  // Bought 500 g, a batch has used 120 g.
  { id: 'ig', name: 'Glycerin', inci: 'Glycerin', phase: 'water',
    lots: [{ id: 'L1', supplier: 'Lotioncrafter', purchaseSize: '500', purchaseUnit: 'g', purchasePrice: '10',
             qtyPurchased: '380', qtyUnit: 'g', costPerG: '0.02', received: '2026-09-01' }], activeLotId: 'L1' },
  // An old lot with no purchase size, only an amount on hand.
  { id: 'ix', name: 'Xanthan gum', inci: 'Xanthan Gum', phase: 'water',
    lots: [{ id: 'L1', supplier: 'Lotioncrafter', qtyPurchased: '90', qtyUnit: 'g', costPerG: '0.06' }], activeLotId: 'L1' }
];
const SEED = `
  localStorage.clear();
  localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(INGS))});
  localStorage.setItem('aerie-formulations-v1', '[]');
  localStorage.setItem('aerie-suppliers-v1', '[{"id":"s1","name":"Lotioncrafter"}]');
  localStorage.setItem('aerie-batches-v1', '[]');
  localStorage.setItem('aerie-packaging-v2', '[]');
  localStorage.setItem('plume-products-v1', '[]');
  localStorage.setItem('plume-theme', 'light');`;
const getIng = (id) => `JSON.parse(localStorage.getItem('aerie-ingredients-v2')).filter(function (i) { return i.id === '${id}'; })[0]`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [], dialogs = [];
  page.on('pageerror', e => errors.push(String(e)));
  await trackDialogs(page, dialogs);
  await page.goto(previewUrl('ingredients')); await page.evaluate(SEED); await page.reload(); await page.waitForTimeout(500);

  const row = (n) => `document.querySelectorAll('#lots-container .lot-row')[${n || 0}]`;
  const rid = (n) => page.evaluate(`${row(n)}.id`);
  const field = (n, f) => page.evaluate(`${row(n)}.querySelector('[data-field="${f}"]').value`);
  const setF = async (n, f, v) => page.evaluate(`(function () { var el = ${row(n)}.querySelector('[data-field="${f}"]'); el.value = ${JSON.stringify(v)};
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`);
  const text = (sel) => page.evaluate(`(function () { var el = document.getElementById(${JSON.stringify(sel)}); return el ? el.textContent : null; })()`);

  // ── 1. A new lot ──────────────────────────────────────────────────
  console.log('\n1. A new lot: count x size, price total or each');
  await page.evaluate("openAdd(); addLotRow();"); await page.waitForTimeout(150);
  let id = await rid(0);
  ok('On hand is not a typed field', await page.evaluate(`${row(0)}.querySelector('[data-field="qtyPurchased"]').type === 'hidden'`));
  ok('before Bought is filled it says it will start there', /Fill in Bought/.test(await text(id + '-qty-note')));
  await setF(0, 'purchaseCount', '2'); await setF(0, 'purchaseSize', '4'); await setF(0, 'purchaseUnit', 'oz'); await setF(0, 'purchasePrice', '20');
  ok('on hand starts at 2 x 4 oz = 8 oz', await field(0, 'qtyPurchased') === '8' && await field(0, 'qtyUnit') === 'oz' && /^8 oz/.test(await text(id + '-qty-show')), [await field(0, 'qtyPurchased'), await text(id + '-qty-show')]);
  ok('cost per gram is the total over all of it ($20 / 226.8 g)', Math.abs(parseFloat(await field(0, 'costPerG')) - 20 / (8 * 28.3495)) < 0.0001, await field(0, 'costPerG'));
  ok('a line spells it out', /2 × 4 oz = 8 oz \(226\.8 g\) for \$20\.00/.test(await text(id + '-buy-sum')), await text(id + '-buy-sum'));
  await setF(0, 'priceIs', 'each');
  ok('"each" doubles what was paid', Math.abs(parseFloat(await field(0, 'costPerG')) - 40 / (8 * 28.3495)) < 0.0001 && /for \$40\.00 \(\$20\.00 each\)/.test(await text(id + '-buy-sum')), await text(id + '-buy-sum'));
  await setF(0, 'purchaseCount', '3');
  ok('changing the count moves on hand with it (not saved yet)', await field(0, 'qtyPurchased') === '12');
  ok('a blank count means 1', await page.evaluate("boughtCount('') === 1 && boughtCount('0') === 1 && boughtCount('2') === 2"));
  ok('a new lot has no Adjust button yet', await page.evaluate(`!${row(0)}.querySelector('.lot-adj-btn')`));

  // ── 2. Saved lots ─────────────────────────────────────────────────
  console.log('\n2. Saved lots: follow until used, then Adjust');
  await page.evaluate("closeModal('modal-add'); viewIngredient('ia'); editCurrent();"); await page.waitForTimeout(200);
  id = await rid(0);
  ok('a saved lot nothing has been used from still follows Bought', await page.evaluate(`${row(0)}.dataset.follows === '1'`) && /Starts at what you bought/.test(await text(id + '-qty-note')));
  await setF(0, 'purchaseCount', '3');
  ok('fixing its count fixes on hand too (12 oz)', await field(0, 'qtyPurchased') === '12');
  await setF(0, 'purchaseCount', '2');
  await page.evaluate("closeModal('modal-add'); viewIngredient('ig'); editCurrent();"); await page.waitForTimeout(200);
  id = await rid(0);
  ok('a lot a batch has used from does not follow', await page.evaluate(`${row(0)}.dataset.follows !== '1'`) && /use Adjust/.test(await text(id + '-qty-note')), await text(id + '-qty-note'));
  await setF(0, 'purchaseSize', '1000');
  ok('so changing Bought leaves on hand alone (380 g)', await field(0, 'qtyPurchased') === '380');
  await setF(0, 'purchaseSize', '500');
  ok('it has an Adjust button', await page.evaluate(`!!${row(0)}.querySelector('.lot-adj-btn')`));
  await page.evaluate(`openLotAdjust('${id}')`); await page.waitForTimeout(100);
  ok('Adjust opens with the current amount', await page.evaluate(`document.getElementById('${id}-adj-new').value`) === '380');
  await page.evaluate(`document.getElementById('${id}-adj-new').value = '-5'; saveLotAdjust('${id}')`);
  ok('it will not go below zero', /0 or more/.test(await text(id + '-adj-err')) && await field(0, 'qtyPurchased') === '380');
  await page.evaluate(`document.getElementById('${id}-adj-new').value = '380'; saveLotAdjust('${id}')`);
  ok('an unchanged amount is not recorded', /already/.test(await text(id + '-adj-err')));
  await page.evaluate(`document.getElementById('${id}-adj-new').value = '352.5'; document.getElementById('${id}-adj-why').value = 'Recount';
    document.getElementById('${id}-adj-note').value = 'weighed the jar'; saveLotAdjust('${id}')`);
  ok('saving it changes on hand and closes the form', await field(0, 'qtyPurchased') === '352.5' && await page.evaluate(`document.getElementById('${id}-adj-form').hidden`));
  ok('and lists it under the lot', /380 → 352\.5 g/.test(await text(id + '-adj-hist')) && /Recount: weighed the jar/.test(await text(id + '-adj-hist')), await text(id + '-adj-hist'));
  await page.evaluate("saveIngredient(false)"); await page.waitForTimeout(250);
  let g = await page.evaluate(getIng('ig'));
  ok('Save keeps the new amount and the note on the lot', g.lots[0].qtyPurchased === '352.5' && Array.isArray(g.lots[0].adjustments) && g.lots[0].adjustments.length === 1 &&
     g.lots[0].adjustments[0].from === 380 && g.lots[0].adjustments[0].to === 352.5 && g.lots[0].adjustments[0].reason === 'Recount' && /^\d{4}-\d\d-\d\d$/.test(g.lots[0].adjustments[0].date), g.lots[0]);
  ok('no empty fields are added to the lot', !('purchaseCount' in g.lots[0]) && !('priceIs' in g.lots[0]), g.lots[0]);
  await page.evaluate("viewIngredient('ig'); editCurrent();"); await page.waitForTimeout(200);
  id = await rid(0);
  ok('reopened, the history is there', /380 → 352\.5 g/.test(await text(id + '-adj-hist')));
  await page.evaluate("closeModal('modal-add'); viewIngredient('ix'); editCurrent();"); await page.waitForTimeout(200);
  id = await rid(0);
  ok('an old lot with no size shows its amount and can be adjusted', /^90 g/.test(await text(id + '-qty-show')) && await page.evaluate(`!!${row(0)}.querySelector('.lot-adj-btn')`), await text(id + '-qty-show'));

  // ── 3. Copy, reference only, the details page ─────────────────────
  console.log('\n3. Copy lot, Reference only, details');
  await page.evaluate("closeModal('modal-add'); viewIngredient('ig'); editCurrent();"); await page.waitForTimeout(200);
  await page.evaluate(`window.PLUME_TEST_ANSWER = false; duplicateLotRow(${row(0)}.id); window.PLUME_TEST_ANSWER = undefined;`); await page.waitForTimeout(200);
  id = await rid(1);
  ok('a copied lot is a new purchase: on hand is what was bought, no history', await field(1, 'qtyPurchased') === '500' && await text(id + '-adj-hist') === '' && await page.evaluate(`${row(1)}.dataset.follows === '1'`), [await field(1, 'qtyPurchased'), await text(id + '-adj-hist')]);
  await page.evaluate(`setLotState(${row(0)}.id, 'ref')`);
  ok('Reference only turns Adjust off', await page.evaluate(`${row(0)}.querySelector('.lot-adj-btn').disabled`));
  await page.evaluate("closeModal('modal-add'); viewIngredient('ia');"); await page.waitForTimeout(200);
  const det = await page.evaluate("document.body.innerText.replace(/\\s+/g, ' ')");
  ok('the details page shows 2 × 4 oz for $20.00', /2 × 4 oz for \$20\.00/.test(det), det.slice(0, 600));

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
