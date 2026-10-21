// Incomplete costs (2026-10-20, v1.38). An ingredient with no cost per gram
// used to count as free while the cost read as complete: the "missing"
// warning appeared only when EVERY line lacked a price, so a serum missing
// one ingredient's price showed a low unit cost and high margins with
// nothing to say so. Now any missing price (ingredient or packaging) makes
// the cost a floor: "at least", the flag in the list, a warning naming
// what is missing, margins "at most", and packs and kits inherit it.
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const lot = (cpg) => [{ id: 'l' + Math.random().toString(36).slice(2, 6), qtyPurchased: '1000', qtyUnit: 'g', costPerG: cpg }];
const INGS = [
  { id: 'iw', name: 'Distilled water', phase: 'water', lots: lot(0.001) },
  { id: 'ih', name: 'Hyaluronic acid', phase: 'water', lots: [] },
  { id: 'ij', name: 'Jojoba oil', phase: 'oil', lots: lot(0.04) },
  { id: 'io', name: 'Olive oil', phase: 'oil', lots: lot(0.01), soap: { naoh: 0.135, koh: 0.19 } },
  { id: 'ic', name: 'Cocoa butter', phase: 'oil', lots: [], soap: { naoh: 0.137, koh: 0.192 } }
];
const V = (vid, lines) => ({ vid: vid, num: 1, label: '', status: 'approved', lines: lines, instructions: '', batchSize: 100, usageLog: [], history: [] });
const F = (id, name, type, lines) => ({ id: id, name: name, type: type, status: 'approved', lines: lines, variants: [V('v' + id, lines)], activeVariantId: 'v' + id });
const FORMS = [
  F('fs', 'Serum', 'Facial serum', [{ ingId: 'iw', pct: 98 }, { ingId: 'ih', pct: 2 }]),
  F('fo', 'Face oil', 'Face oil', [{ ingId: 'ij', pct: 100 }]),
  F('fp', 'Bar', 'Cold Process Soap', [{ ingId: 'io', pct: 70 }, { ingId: 'ic', pct: 30 }])
];
const stock = (cost) => [{ id: 'p', date: '2026-09-01', qty: 10, totalCost: cost, shipping: 0 }];
const PKGS = [
  { id: 'kb', kind: 'dropper', capacity: '30 mL', color: 'Amber', purchases: stock(10) },
  { id: 'kl', kind: 'label', capacity: '2 × 1 in', part: 'Front', purchases: [] }
];
const PRODUCTS = [
  { id: 'ps', name: 'Serum 30 mL', status: 'active', formulaId: 'fs', netWtG: 30, retail: 30, wholesale: 15, packagingRecipe: [{ packagingId: 'kb', quantity: 1 }], productionRuns: [] },
  { id: 'po', name: 'Face oil 30 mL', status: 'active', formulaId: 'fo', netWtG: 30, retail: 30, packagingRecipe: [{ packagingId: 'kb', quantity: 1 }], productionRuns: [] },
  { id: 'pl', name: 'Face oil, labelled', status: 'active', formulaId: 'fo', netWtG: 30, retail: 30, packagingRecipe: [{ packagingId: 'kb', quantity: 1 }, { packagingId: 'kl', quantity: 1 }], productionRuns: [] },
  { id: 'pm', name: 'Duo', status: 'active', productKind: 'multi', components: [{ formulaId: 'fs', netWtG: 5, label: 'Serum 5 mL' }, { formulaId: 'fo', netWtG: 3, label: 'Oil 3 mL' }],
    packagingRecipe: [], productionRuns: [] },
  { id: 'pk', name: 'Gift kit', status: 'active', productKind: 'kit', kitParts: [{ id: 'k1', productId: 'ps', qty: 1 }, { id: 'k2', productId: 'po', qty: 1 }], packagingRecipe: [], productionRuns: [] },
  { id: 'pk2', name: 'Oil kit', status: 'active', productKind: 'kit', kitParts: [{ id: 'k3', productId: 'po', qty: 2 }], packagingRecipe: [], productionRuns: [] }
];
const SEED = `
  localStorage.clear();
  localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(INGS))});
  localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});
  localStorage.setItem('aerie-packaging-v2', ${JSON.stringify(JSON.stringify(PKGS))});
  localStorage.setItem('aerie-batches-v1', '[]');
  localStorage.setItem('plume-products-v1', ${JSON.stringify(JSON.stringify(PRODUCTS))});
  localStorage.setItem('plume_costing_listorder_v1', '1');
  localStorage.setItem('plume-theme', 'light');`;

(async () => {
  const browser = await chromium.launch();
  const errors = [], dialogs = [];
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await trackDialogs(page, dialogs);
  await page.goto(previewUrl('costing')); await page.evaluate(SEED); await page.reload(); await page.waitForTimeout(500);

  console.log('\n1. The arithmetic');
  const d = await page.evaluate("(function(){ var d = formulationCostDetail(findForm('fs')); return { perG: d.perG, missing: d.missing, complete: d.complete }; })()");
  ok('a formulation missing one price is incomplete and names it', d.complete === false && d.missing.join() === 'Hyaluronic acid', d);
  ok('its cost per gram still counts what is priced (a floor)', Math.abs(d.perG - 0.00098) < 1e-9, d.perG);
  ok('a fully priced one is complete', await page.evaluate("formulationCostDetail(findForm('fo')).complete === true"));
  const cs = await page.evaluate("products.map(function(p){ var c = computeProductCost(p); return p.id + ':' + (c.costComplete ? 'complete' : 'floor'); }).join(' ')");
  ok('products: missing ingredient or packaging price makes a floor; packs and kits inherit it', cs === 'ps:floor po:complete pl:floor pm:floor pk:floor pk2:complete', cs);
  ok('a pack counts its partly priced component (not zero)', await page.evaluate("Math.abs(computeProductCost(findProduct('pm')).ingCost - (5 * 0.00098 + 3 * 0.04)) < 1e-9"));
  ok('Products & Costing and core\'s unit cost still agree on every product', await page.evaluate(
    "products.every(function(p){ return Math.abs(Plume.productUnitCost(p, { ings: ings, forms: forms, pkgs: pkgs, products: products }) - computeProductCost(p).totalCost) < 1e-9; })"));

  console.log('\n2. The product list');
  const row = (name) => page.evaluate(`Array.from(document.querySelectorAll('tr.prod-row')).map(r => r.innerText.replace(/\\s+/g, ' ')).filter(t => t.indexOf(${JSON.stringify(name)}) !== -1)[0] || ''`);
  ok('an incomplete cost reads "at least" with the flag', /at least \$1\.03/.test(await row('Serum 30 mL')) && await page.evaluate("!!Array.from(document.querySelectorAll('tr.prod-row')).filter(r => /Serum 30 mL/.test(r.innerText))[0].querySelector('.cost-flag')"), await row('Serum 30 mL'));
  ok('a complete one does not', !/at least/.test(await row('Face oil 30 mL')), await row('Face oil 30 mL'));
  ok('an unpriced label is enough to flag it', /at least/.test(await row('Face oil, labelled')));

  console.log('\n3. A product');
  await page.evaluate("openProduct('ps')"); await page.waitForTimeout(250);
  const panel = () => page.evaluate("document.getElementById('cost-panel').innerText.replace(/\\s+/g, ' ')");
  let cp = await panel();
  ok('the cost is "at least" and the warning names the ingredient', /at least ?\$1\.03/.test(cp) && /No cost per gram for Hyaluronic acid, so it counts as free/.test(cp), cp);
  ok('the margins say they are at most', /at most/.test(await page.evaluate("document.getElementById('marg-retail').innerText")) && /at most/.test(await page.evaluate("document.getElementById('marg-wholesale').innerText")));
  ok('the hint under the formulation says at least', /at least \$0\.0010 per gram/.test(await page.evaluate("document.getElementById('p-form-hint').textContent")));
  await page.evaluate("openProduct('pl')"); await page.waitForTimeout(250);
  ok('an unpriced packaging item is named, with where to fix it', /No price for Label · 2 × 1 in · Front/.test(await panel()) || /No price for .*Front/.test(await panel()), await panel());
  await page.evaluate("openProduct('po')"); await page.waitForTimeout(250);
  ok('a complete product shows no warning and plain margins', !/at least|No cost|No price/.test(await panel()) && !/at most/.test(await page.evaluate("document.getElementById('marg-retail').innerText")));
  await page.evaluate("openProduct('pm')"); await page.waitForTimeout(250);
  ok('a pack names the part and the missing ingredient', /Incomplete cost for Serum 5 mL \(no price for Hyaluronic acid\)/.test(await panel()), await panel());
  await page.evaluate("openProduct('pk')"); await page.waitForTimeout(250);
  ok('a kit names the product whose cost is incomplete', /Incomplete cost for Serum 30 mL/.test(await panel()) && /at least/.test(await panel()), await panel());

  console.log('\n4. Formulations');
  await page.goto(previewUrl('formulations')); await page.waitForTimeout(500);
  await page.evaluate("openFormula('fs')"); await page.waitForTimeout(300);
  const fc = await page.evaluate("document.getElementById('cost-panel').innerText.replace(/\\s+/g, ' ')");
  ok('Formulations names what is not counted, quietly (no "at least", no warning colour)', !/at least/.test(fc) && /Not counted: Hyaluronic acid \(no price yet\)/.test(fc) &&
     await page.evaluate("getComputedStyle(document.querySelector('#cost-panel .cost-miss')).backgroundColor === 'rgba(0, 0, 0, 0)'"), fc);
  ok('the name links to the ingredient', await page.evaluate("document.querySelector('#cost-panel .cost-miss a').getAttribute('href')") === 'plume-ingredients.html#ing=ih');
  await page.evaluate("openFormula('fp')"); await page.waitForTimeout(300);
  const sc = await page.evaluate("document.getElementById('cost-panel').innerText.replace(/\\s+/g, ' ')");
  ok('soap says so too (it used to say nothing)', /Not counted: Cocoa butter/.test(sc), sc);
  await page.evaluate("openFormula('fo')"); await page.waitForTimeout(300);
  ok('a fully priced formulation has no note', !/Not counted/.test(await page.evaluate("document.getElementById('cost-panel').innerText")));

  console.log('\n5. Made in-house or free');
  await page.goto(previewUrl('ingredients')); await page.waitForTimeout(500);
  await page.evaluate("viewingId = 'ih'; editFromList = true; editCurrent()"); await page.waitForTimeout(200);
  ok('the editor offers it under the lots, off by default', await page.evaluate("!document.getElementById('f-nocost').checked"));
  await page.check('#f-nocost'); await page.evaluate("saveIngredient(false)"); await page.waitForTimeout(250);
  ok('it saves on the ingredient', await page.evaluate("JSON.parse(localStorage.getItem('aerie-ingredients-v2')).filter(function(i){return i.id==='ih';})[0].noCost === true"));
  ok('the list says in-house instead of a blank price', /in-house/.test(await page.evaluate("Array.from(document.querySelectorAll('#tbody tr')).map(r => r.innerText).filter(t => /Hyaluronic/.test(t))[0] || ''")));
  ok('core counts it as $0, and a priced lot still wins', await page.evaluate("Plume.costPerG({ noCost: true, lots: [] }) === 0 && Plume.costPerG({ noCost: true, lots: [{ id: 'a', costPerG: 0.5 }] }) === 0.5 && Plume.costPerG({ lots: [] }) === null"));
  await page.goto(previewUrl('costing')); await page.waitForTimeout(500);
  ok('the serum is complete now: no flag, no "at least"', await page.evaluate("computeProductCost(findProduct('ps')).costComplete === true"));
  await page.goto(previewUrl('formulations')); await page.waitForTimeout(500);
  await page.evaluate("openFormula('fs')"); await page.waitForTimeout(300);
  ok('and Formulations no longer names it', !/Not counted/.test(await page.evaluate("document.getElementById('cost-panel').innerText")));

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
