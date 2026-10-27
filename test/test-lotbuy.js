// What was bought (2026-10-26, her ask): How many, Size of each and Price
// each / total in plain view on a new purchase; a saved lot shows what was
// bought as text with "Correct it", so new stock goes in as a new purchase
// (Beeswax: typing 30 g into a used lot's Bought dropped on hand to 0).
// The lots sit in the editor's Stock & cost tab. kg, L and gal added.
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}
const INGS = [
  { id: 'ib', name: 'Beeswax', inci: 'Cera Alba', phase: 'oil',
    lots: [{ id: 'L1', supplier: 'Lotioncrafter', purchaseSize: '454', purchaseUnit: 'g', purchasePrice: '12', costPerG: '0.0264',
             qtyPurchased: '300', qtyUnit: 'g', received: '2026-06-15' }], activeLotId: 'L1' }
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
const getIng = (name) => `JSON.parse(localStorage.getItem('aerie-ingredients-v2')).filter(function (i) { return i.name === '${name}'; })[0]`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [], dialogs = [];
  page.on('pageerror', e => errors.push(String(e)));
  await trackDialogs(page, dialogs);
  await page.goto(previewUrl('ingredients')); await page.evaluate(SEED); await page.reload(); await page.waitForTimeout(500);
  const rows = () => page.evaluate("document.querySelectorAll('#lots-container .lot-row').length");
  const lastId = () => page.evaluate("Array.from(document.querySelectorAll('#lots-container .lot-row')).pop().id");
  const vis = (sel) => page.evaluate(`(function () { var e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.offsetParent !== null; })()`);
  const txt = (sel) => page.evaluate(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);

  console.log('\n1. The lots are right in the Stock & cost tab');
  await page.evaluate("viewIngredient('ib'); editCurrent('stock');"); await page.waitForTimeout(250);
  ok('the purchase cards show without another button', await vis('#lots-container .lot-row') && !(await page.evaluate("Array.from(document.querySelectorAll('#modal-add button')).some(function (b) { return /Manage lots/.test(b.textContent); })")));
  ok('and the add button reads + Add a purchase', await vis('#lots-block .add-lot-btn') && (await txt('#lots-block .add-lot-btn')) === '+ Add a purchase');

  console.log('\n2. A saved lot shows what was bought as text');
  const bid = await page.evaluate("document.querySelector('#lots-container .lot-row').id");
  ok('Bought reads "454 g for $12.00", the boxes are not shown', (await txt('#' + bid + '-fixed')) === '454 g for $12.00' && !(await vis('#' + bid + '-bsize')), await txt('#' + bid + '-fixed'));
  ok('on hand is 300 g, from batches, with Adjust for a count', /300 g/.test(await txt('#' + bid + '-qty-show')) && /Batches take from it/.test(await txt('#' + bid + '-qty-note')));

  console.log('\n3. New stock is a new purchase (her Beeswax case)');
  await page.click('#lots-block .add-lot-btn'); await page.waitForTimeout(100);
  const nid = await lastId();
  ok('a new card asks How many (1), Size of each, and the price each or total', (await page.inputValue('#' + nid + '-bcount')) === '1' && await vis('#' + nid + '-bsize') && await vis('#' + nid + '-bprice') &&
    (await page.evaluate(`document.getElementById('${nid}-bpis').value`)) === 'each');
  await page.fill('#' + nid + '-bsize', '30'); await page.fill('#' + nid + '-bprice', '2');
  ok('30 g at $2.00: on hand for this purchase starts at 30 g', /^30 g/.test(await txt('#' + nid + '-qty-show')) && /^30 g for \$2\.00, \$0\.0667\/g$/.test(await txt('#' + nid + '-buy-sum')), await txt('#' + nid + '-buy-sum'));
  ok('and the first purchase still has 300 g', /300 g/.test(await txt('#' + bid + '-qty-show')));
  await page.evaluate("saveIngredient(true)"); await page.waitForTimeout(250);
  let ing = await page.evaluate(getIng('Beeswax'));
  ok('saved: two purchases, 300 g + 30 g = 330 g on hand', ing.lots.length === 2 && ing.lots[0].qtyPurchased === '300' && ing.lots[1].qtyPurchased === '30' &&
    Math.abs(await page.evaluate(`Plume.stockG(${getIng('Beeswax')})`) - 330) < 1e-9, ing.lots.map(l => l.qtyPurchased));

  console.log('\n4. Several of the same');
  await page.click('#lots-block .add-lot-btn'); await page.waitForTimeout(100);
  const mid = await lastId();
  await page.fill('#' + mid + '-bcount', '2'); await page.fill('#' + mid + '-bsize', '4'); await page.selectOption('#' + mid + '-punit', 'oz'); await page.fill('#' + mid + '-bprice', '9.99');
  ok('2 × 4 oz at $9.99 each: 8 oz for $19.98, spelled out', /^2 × 4 oz = 8 oz \(226\.8 g\) for 2 × \$9\.99 = \$19\.98, \$0\.0881\/g$/.test(await txt('#' + mid + '-buy-sum')), await txt('#' + mid + '-buy-sum'));
  ok('the lot keeps the totals (8 oz, $19.98) and on hand starts at 8 oz', (await page.evaluate(`[document.getElementById('${mid}-psize').value, document.getElementById('${mid}-pprice').value, document.getElementById('${mid}-qty').value].join('|')`)) === '8|19.98|8');
  await page.click('#' + mid + ' .lot-is-b[data-is="total"]');
  ok('switching the price to total: $9.99 for both', /for \$9\.99, \$0\.0440\/g$/.test(await txt('#' + mid + '-buy-sum')) && (await page.evaluate(`document.getElementById('${mid}-pprice').value`)) === '9.99', await txt('#' + mid + '-buy-sum'));
  await page.click('#' + mid + ' .lot-is-b[data-is="each"]');
  await page.evaluate("saveIngredient(true)"); await page.waitForTimeout(250);
  ing = await page.evaluate(getIng('Beeswax'));
  const l3 = ing.lots[2];
  ok('saved with the totals and how it was bought', l3 && l3.purchaseSize === '8' && l3.purchasePrice === '19.98' && l3.buyCount === '2' && l3.buySize === '4' && l3.buyPrice === '9.99' && l3.buyPriceIs === 'each', l3);
  const lid3 = await page.evaluate("document.querySelectorAll('#lots-container .lot-row')[2].id");
  ok('reopened, it reads "2 × 4 oz = 8 oz for 2 × $9.99 = $19.98"', (await txt('#' + lid3 + '-fixed')) === '2 × 4 oz = 8 oz for 2 × $9.99 = $19.98', await txt('#' + lid3 + '-fixed'));

  console.log('\n5. Correct it');
  const bid2 = await page.evaluate("document.querySelector('#lots-container .lot-row').id");
  await page.click('#' + bid2 + ' .lot-link');
  ok('opens the boxes for that purchase, with a note on what it does', await vis('#' + bid2 + '-bsize') && /New stock goes in with \+ Add a purchase/.test(await txt('#' + bid2 + '-correct-note')));
  ok('an older lot opens as 1 × 454 g at $12.00 total', (await page.inputValue('#' + bid2 + '-bcount')) === '1' && (await page.inputValue('#' + bid2 + '-bsize')) === '454' && (await page.inputValue('#' + bid2 + '-bprice')) === '12' &&
    (await page.evaluate(`document.getElementById('${bid2}-bpis').value`)) === 'total');
  await page.fill('#' + bid2 + '-bsize', '500');
  ok('correcting 454 g to 500 g moves on hand by the difference (346 g)', (await page.evaluate(`document.getElementById('${bid2}-qty').value`)) === '346');
  await page.fill('#' + bid2 + '-bsize', '454');

  console.log('\n6. Gallons, liters, kilograms');
  ok('the units: g, kg, oz, lb, mL, L, fl oz, gal', (await page.evaluate(`Array.from(document.querySelector('#lots-container .lot-row [data-field="purchaseUnit"]').options).map(function (o) { return o.value; }).join(',')`)) === 'g,kg,oz,lb,mL,L,fl oz,gal');
  ok('in grams: kg exact, L and a US gallon at the density', await page.evaluate("Plume.qtyToGrams(2, 'kg', 1) === 2000 && Plume.qtyToGrams(1, 'L', 0.92) === 920 && Math.abs(Plume.qtyToGrams(1, 'gal', 1) - 3785.41) < 1e-9"));
  await page.evaluate("closeModal('modal-add'); openAdd(); document.getElementById('f-name').value = 'Distilled water'; document.getElementById('f-inci').value = 'Aqua'; setIngTab('stock');"); await page.waitForTimeout(150);
  const wid = await lastId();
  await page.fill('#' + wid + '-bcount', '3'); await page.selectOption('#' + wid + '-punit', 'gal'); await page.fill('#' + wid + '-bsize', '1'); await page.fill('#' + wid + '-bprice', '1.29');
  ok('3 gallons at $1.29 each', /^3 × 1 gal = 3 gal \(11356\.23 g\) for 3 × \$1\.29 = \$3\.87/.test(await txt('#' + wid + '-buy-sum')), await txt('#' + wid + '-buy-sum'));

  console.log('\n7. Quick add asks the same way');
  await page.evaluate("closeModal('modal-add'); openQuickAdd();"); await page.waitForTimeout(150);
  await page.fill('#qa-name', 'Rice protein'); await page.fill('#qa-inci', 'Hydrolyzed Rice Protein');
  await page.fill('#qa-count', '2'); await page.fill('#qa-size', '4'); await page.selectOption('#qa-unit', 'oz'); await page.fill('#qa-price', '9.99');
  const qn = await page.evaluate("document.getElementById('qa-cpg').textContent + ' | ' + document.getElementById('qa-cpg-note').textContent");
  ok('cost per gram and the sum spelled out', /^\$0\.0881 \| 2 × 4 oz = 8 oz for \$19\.98$/.test(qn), qn);
  await page.evaluate("qaSave(true)"); await page.waitForTimeout(250);
  const rp = (await page.evaluate(getIng('Rice protein'))).lots[0];
  ok('saved as 8 oz, $19.98, 8 oz on hand, and how it was bought', rp.purchaseSize === '8' && rp.purchasePrice === '19.98' && rp.qtyPurchased === '8' && rp.buyCount === '2' && rp.buyPriceIs === 'each', rp);
  ok('the form starts over at 1, price each', (await page.inputValue('#qa-count')) === '1' && (await page.evaluate("document.getElementById('qa-price-is').value")) === 'each');
  await page.evaluate("closeQuickAdd()");

  console.log('\n8. The drawer from the list still works');
  await page.evaluate("openLotsFromList(null, 'ib')"); await page.waitForTimeout(250);
  ok('it borrows the lots and shows them', await vis('#lots-drawer-slot #lots-container .lot-row'));
  await page.evaluate("closeLotsDrawer()"); await page.waitForTimeout(250);
  ok('and gives them back to the Stock & cost tab when it closes', await page.evaluate("document.getElementById('lots-block').parentNode.id === 'lots-home'"));

  console.log('\n9. Batches take from new units in those units');
  await page.goto(previewUrl('batchlog')); await page.waitForTimeout(500);
  ok('1,000 g of water is 0.264 gal; 500 g is 0.5 L or 0.5 kg', await page.evaluate("Math.abs(gramsToLotQty(1000, 'gal', 1) - 0.264172) < 1e-5 && Math.abs(gramsToLotQty(500, 'L', 1) - 0.5) < 1e-9 && gramsToLotQty(500, 'kg', 1) === 0.5"));

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
