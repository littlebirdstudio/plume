// Arithmetic in Bought and Price paid, and kg, L and gal (2026-10-26, her
// option b): "2 x 4" in Bought and "2 x 9.99" in Price paid for two 4 oz
// bottles at $9.99 each. The box keeps the total; the line under the
// purchase spells out the sum. Works the same in Quick add.
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}
const SEED = `
  localStorage.clear();
  localStorage.setItem('aerie-ingredients-v2', '[]');
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

  console.log('\n1. Reading a sum');
  const m = (v) => page.evaluate(`Plume.mathVal(${JSON.stringify(v)})`);
  ok('"2 x 4", "2×4", "2*4" and "2 X 4" are 8', (await m('2 x 4')) === 8 && (await m('2×4')) === 8 && (await m('2*4')) === 8 && (await m('2 X 4')) === 8);
  ok('"3 x 1.29" is 3.87, "2 x 4 x 3" is 24', (await m('3 x 1.29')) === 3.87 && (await m('2 x 4 x 3')) === 24);
  ok('a plain number reads as itself, ".5" too', (await m('16')) === 16 && (await m('.5')) === 0.5);
  ok('anything else is not a number ("2 x", "abc", "2 + 4")', await page.evaluate("[Plume.mathNum('2 x'), Plume.mathNum('abc'), Plume.mathNum('2 + 4')].every(function (x) { return x === null; })"));

  console.log('\n2. The new units');
  ok('kg, L and a US gallon in grams (L and gal at the density)', await page.evaluate(
    "Plume.qtyToGrams(2, 'kg', 1) === 2000 && Plume.qtyToGrams(1, 'L', 0.92) === 920 && Math.abs(Plume.qtyToGrams(1, 'gal', 1) - 3785.41) < 1e-9"));
  ok('the lots drawer offers g, kg, oz, lb, mL, L, fl oz and gal', await page.evaluate(
    "openAdd(); addLotRow(); Array.from(document.querySelector('#lots-container .lot-row [data-field=\"purchaseUnit\"]').options).map(function (o) { return o.value; }).join(',') === 'g,kg,oz,lb,mL,L,fl oz,gal'"));

  console.log('\n3. In the lots drawer');
  await page.evaluate("closeModal('modal-add')");
  await page.evaluate("openAdd(); document.getElementById('f-name').value = 'Rice protein'; document.getElementById('f-inci').value = 'Hydrolyzed Rice Protein'; openLotsDrawer(); addLotRow();"); await page.waitForTimeout(150);
  const id = await page.evaluate("document.querySelector('#lots-container .lot-row').id");
  const ps = '#' + id + '-psize', pp = '#' + id + '-pprice';
  await page.selectOption('#' + id + '-punit', 'oz');
  await page.fill(ps, '2 x 4');
  await page.fill(pp, '2 x 9.99');
  const sum = () => page.evaluate(`document.getElementById('${id}-buy-sum').textContent`);
  ok('while typing, the line spells out the sum', /^2 × 4 oz = 8 oz \(226\.8 g\) for 2 × \$9\.99 = \$19\.98, \$0\.0881\/g$/.test(await sum()), await sum());
  ok('and cost per gram fills in', (await page.evaluate(`document.getElementById('${id}-cpg').value`)) === '0.0881');
  await page.click('#' + id + '-pprice'); await page.click('#' + id + '-psize'); await page.click('#' + id + '-pprice'); await page.keyboard.press('Tab');
  ok('leaving the boxes puts the totals in them', (await page.inputValue(ps)) === '8' && (await page.inputValue(pp)) === '19.98');
  ok('and the line still shows how they were worked out', /^2 × 4 oz = 8 oz/.test(await sum()) && /2 × \$9\.99 = \$19\.98/.test(await sum()), await sum());
  ok('on hand starts at the total bought', (await page.evaluate(`document.getElementById('${id}-qty').value`)) === '8');
  await page.fill(ps, '10');
  ok('typing a plain number drops the spelled-out sum', /^10 oz \(283\.5 g\) for 2 × \$9\.99 = \$19\.98/.test(await sum()), await sum());
  await page.fill(ps, '2 x 4');
  await page.evaluate("saveIngredient()"); await page.waitForTimeout(250);
  let ing = await page.evaluate(getIng('Rice protein'));
  ok('saving without leaving the box still stores the total', ing && ing.lots[0].purchaseSize === '8' && ing.lots[0].purchasePrice === '19.98' && ing.lots[0].qtyPurchased === '8', ing && ing.lots[0]);

  console.log('\n4. Gallons of distilled water');
  await page.evaluate("document.getElementById('lots-drawer-overlay').classList.remove('open'); closeModal('modal-add'); openAdd(); document.getElementById('f-name').value = 'Distilled water'; document.getElementById('f-inci').value = 'Aqua'; openLotsDrawer(); addLotRow();"); await page.waitForTimeout(150);
  const wid = await page.evaluate("document.querySelector('#lots-container .lot-row').id");
  await page.selectOption('#' + wid + '-punit', 'gal');
  await page.fill('#' + wid + '-psize', '3');
  await page.fill('#' + wid + '-pprice', '3 x 1.29');
  const wsum = await page.evaluate(`document.getElementById('${wid}-buy-sum').textContent`);
  ok('3 gal at $1.29 each: 11,356 g for $3.87', /^3 gal \(11356\.23 g\) for 3 × \$1\.29 = \$3\.87, \$0\.0003\/g$/.test(wsum), wsum);
  await page.evaluate("saveIngredient()"); await page.waitForTimeout(250);
  ing = await page.evaluate(getIng('Distilled water'));
  ok('stored as 3 gal, $3.87, stock in grams right', ing && ing.lots[0].purchaseUnit === 'gal' && ing.lots[0].purchasePrice === '3.87' &&
    Math.abs(await page.evaluate(`Plume.stockG(${getIng('Distilled water')})`) - 11356.23) < 0.01, ing && ing.lots[0]);

  console.log('\n5. In Quick add');
  await page.evaluate("document.getElementById('lots-drawer-overlay').classList.remove('open'); closeModal('modal-add'); openQuickAdd();"); await page.waitForTimeout(150);
  await page.fill('#qa-name', 'Rice bran wax'); await page.fill('#qa-inci', 'Oryza Sativa Bran Wax');
  await page.selectOption('#qa-unit', 'oz');
  await page.fill('#qa-size', '2 x 4'); await page.fill('#qa-price', '2 x 9.99');
  const qn = () => page.evaluate("document.getElementById('qa-cpg').textContent + ' | ' + document.getElementById('qa-cpg-note').textContent");
  ok('the cost and the spelled-out sums show', /^\$0\.0881 \| 2 × 4 oz = 8 oz · 2 × \$9\.99 = \$19\.98$/.test(await qn()), await qn());
  await page.click('#qa-lot');
  ok('leaving the boxes puts the totals in them', (await page.inputValue('#qa-size')) === '8' && (await page.inputValue('#qa-price')) === '19.98');
  await page.evaluate("qaSave(true)"); await page.waitForTimeout(250);
  ing = await page.evaluate(getIng('Rice bran wax'));
  ok('saved: 8 oz bought, $19.98 paid, 8 oz on hand', ing && ing.lots[0].purchaseSize === '8' && ing.lots[0].purchasePrice === '19.98' && ing.lots[0].qtyPurchased === '8', ing && ing.lots[0]);
  ok('the form clears, sums and all', (await page.inputValue('#qa-size')) === '' && (await qn()) === 'From bought and price | ');
  await page.evaluate("closeQuickAdd()");

  console.log('\n6. Batches take from a gallon lot in gallons');
  await page.goto(previewUrl('batchlog')); await page.waitForTimeout(500);
  ok('a batch takes 1,000 g of water as 0.264 gal; 500 g as 0.5 L or 0.5 kg', await page.evaluate("Math.abs(gramsToLotQty(1000, 'gal', 1) - 0.264172) < 1e-5 && Math.abs(gramsToLotQty(500, 'L', 1) - 0.5) < 1e-9 && gramsToLotQty(500, 'kg', 1) === 0.5"));

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
