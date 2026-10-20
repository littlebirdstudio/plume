// What's next pointers (2026-10-20): short notes where the next step of the
// work is not done yet, each gone once it is, and a Settings switch that
// turns them all off on this device. Also the start page's five steps.
const path = require('path');
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const ING = [{ id: 'a1', name: 'Jojoba oil', inci: 'Simmondsia Chinensis Seed Oil', lots: [] }];
const FORMS = [
  { id: 'fo', name: 'Calendula face oil', type: 'Face oil', lines: [{ ingId: 'a1', pct: 100 }],
    variants: [{ vid: 'v1', num: 1, status: 'approved', lines: [{ ingId: 'a1', pct: 100 }] }], activeVariantId: 'v1' },
  { id: 'fm', name: 'Rose mist', type: 'Toner / mist', lines: [{ ingId: 'a1', pct: 100 }],
    variants: [{ vid: 'v1', num: 1, status: 'approved', lines: [{ ingId: 'a1', pct: 100 }] }], activeVariantId: 'v1' }
];
const BATCHES = [{ id: 'b1', date: '2026-10-18', formulaId: 'fo', formulaName: 'Calendula face oil', formulaType: 'Face oil', batchName: 'Face oil, October',
  batchType: 'production', actualYield: 100, status: 'ready', ingredientSnapshot: [], packagingRuns: [], committed: true, lotDraws: [], packagingDraws: [] }];
const PRODUCTS = [
  { id: 'pm', name: 'Rose Mist 2 oz', status: 'active', formulaId: 'fm', netWtG: 56, packagingRecipe: [], productionRuns: [] }
];

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await trackDialogs(page, []);
  const seed = async (data) => {
    await page.evaluate("localStorage.clear(); localStorage.setItem('plume-theme', 'light'); localStorage.setItem('plume_costing_listorder_v1', '1');" +
      Object.keys(data).map(k => "localStorage.setItem('" + k + "', " + JSON.stringify(JSON.stringify(data[k])) + ");").join(''));
  };
  const visible = (sel) => page.evaluate("var e=document.querySelector(" + JSON.stringify(sel) + "); !!e && getComputedStyle(e).display !== 'none' && e.offsetParent !== null");

  console.log('\n1. Empty modules say where to start');
  await page.goto(previewUrl('ingredients')); await seed({}); await page.reload(); await page.waitForTimeout(500);
  ok('Ingredients: Start here, with Add an ingredient', /Start here/.test(await page.evaluate("document.getElementById('tbody').innerText")) &&
     /Add an ingredient/.test(await page.evaluate("document.querySelector('#tbody .ns-go').textContent")));
  await page.evaluate("document.querySelector('#tbody .ns-go').click()"); await page.waitForTimeout(200);
  ok('and the button opens a new ingredient', await page.evaluate("document.getElementById('modal-add').classList.contains('open') || !!document.querySelector('.modal-ov.open')"));
  await page.goto(previewUrl('packaging')); await page.waitForTimeout(500);
  ok('Packaging: add the packaging you buy', /Add the packaging you buy/.test(await page.evaluate("document.getElementById('tbody').innerText")));
  await page.goto(previewUrl('formulations')); await page.waitForTimeout(500);
  ok('Formulations: design your first formulation', /Design your first formulation/.test(await page.evaluate("document.getElementById('fcard-container').innerText")));
  await page.goto(previewUrl('batchlog')); await page.waitForTimeout(500);
  ok('Batches: log a batch each time you make one', /Log a batch each time/.test(await page.evaluate("document.getElementById('tbody').innerText")));
  await page.goto(previewUrl('costing')); await page.waitForTimeout(500);
  ok('Products: set up each product you sell', /Set up each product you sell/.test(await page.evaluate("document.getElementById('list-body').innerText")));

  console.log('\n2. The next step along the way');
  await seed({ 'aerie-ingredients-v2': ING, 'aerie-formulations-v1': FORMS, 'aerie-batches-v1': BATCHES, 'plume-products-v1': PRODUCTS });
  await page.goto(previewUrl('formulations')); await page.waitForTimeout(500);
  await page.evaluate("openFormula('fm')"); await page.waitForTimeout(300);
  ok('a formulation never made: Not made yet, Make a batch', /Not made yet[\s\S]*Make a batch/.test(await page.evaluate("document.getElementById('f-next').innerText")));
  await page.evaluate("dirty = false; openFormula('fo')"); await page.waitForTimeout(300);
  ok('gone once it has a batch', (await page.evaluate("document.getElementById('f-next').innerHTML")) === '');
  await page.goto(previewUrl('batchlog')); await page.waitForTimeout(500);
  await page.evaluate("openBatchDetail('b1'); setBatchTab('runs')"); await page.waitForTimeout(300);
  ok('a batch with no products: set up what you will sell', /Next: set up what you will sell from it/.test(await page.evaluate("document.getElementById('d-fills').innerText")) &&
     (await page.evaluate("document.querySelector('#d-fills .ns-go').getAttribute('href')")) === 'plume-costing.html#new=fo');
  await page.goto(previewUrl('costing') + '#new=fo'); await page.waitForTimeout(500);
  ok('which opens New product with that formulation chosen', await page.evaluate("document.getElementById('m-new').classList.contains('open') && document.getElementById('n-formula').value === 'fo'"));
  await page.evaluate("closeModal('m-new'); openProduct('pm')"); await page.waitForTimeout(200);
  ok('a product with no packaging list: add what goes around each unit', /Add what goes around each unit/.test(await page.evaluate("document.getElementById('pkg-recipe-body').innerText")));
  await page.evaluate("setEdTab('runs')");
  ok('a product whose formulation has no batch: No batch of Rose mist yet', /No batch of Rose mist yet/.test(await page.evaluate("document.getElementById('run-next').innerText")) &&
     (await page.evaluate("document.querySelector('#run-next .ns-go').getAttribute('href')")) === 'plume-batchlog.html#new=fm');
  await page.evaluate("document.querySelector('#pkg-recipe-body .ns-go').click()"); await page.waitForTimeout(150);
  ok('the packaging pointer goes once a row is added', !(await page.evaluate("!!document.querySelector('#pkg-recipe-body .next-step')")));

  console.log('\n3. Settings turns them off');
  await page.evaluate("openSettings()"); await page.waitForTimeout(200);
  ok('Settings has a Show / Hide switch', /What’s next pointers/.test(await page.evaluate("document.getElementById('plume-theme-choice').innerText")));
  await page.evaluate("Array.from(document.querySelectorAll('#plume-theme-choice .plume-theme-opt')).find(b => b.textContent === 'Hide').click()");
  ok('Hide hides every pointer', await page.evaluate("document.documentElement.classList.contains('plume-no-tips')") && !(await visible('#run-next .next-step')));
  await page.goto(previewUrl('costing')); await seed({}); await page.evaluate("localStorage.setItem('plume-tips', 'off')"); await page.reload(); await page.waitForTimeout(500);
  ok('and the plain line shows instead, after a reload too', await visible('#list-body .next-off') && !(await visible('#list-body .next-step')) &&
     /No products yet/.test(await page.evaluate("document.getElementById('list-body').innerText")));
  await page.evaluate("Plume.setTips(true)");
  ok('Show brings them back', await visible('#list-body .next-step'));

  console.log('\n3b. Packaging stock tracking can be turned off');
  await seed({ 'aerie-ingredients-v2': ING, 'aerie-formulations-v1': FORMS, 'aerie-batches-v1': BATCHES,
    'aerie-packaging-v2': [{ id: 'k', kind: 'dropper', capacity: '2 oz', color: 'Amber', material: 'Glass' }],
    'plume-products-v1': [{ id: 'po', name: 'Face Oil 30 mL', status: 'active', formulaId: 'fo', netWtG: 27, packagingRecipe: [{ packagingId: 'k', quantity: 1 }], productionRuns: [] }] });
  await page.reload(); await page.waitForTimeout(500);
  await page.evaluate("openProduct('po'); setEdTab('runs'); document.getElementById('run-units').value = '2'; fillTakes();");
  ok('tracked (the default): no packaging stock entered stops the fill', await page.evaluate("document.getElementById('run-add').disabled && /Not enough in stock/.test(document.getElementById('run-takes').innerText)"));
  await page.evaluate("openSettings()"); await page.waitForTimeout(150);
  await page.evaluate("Array.from(document.querySelectorAll('#plume-theme-choice .plume-theme-opt')).find(b => /Don.t track/.test(b.textContent)).click()");
  await page.evaluate("closeModal('m-settings'); document.getElementById('run-units').value = '2'; fillTakes();");
  ok('Don\'t track: the fill goes ahead and says packaging is not tracked', await page.evaluate("!document.getElementById('run-add').disabled && /not tracked/.test(document.getElementById('run-takes').innerText)"));
  await page.click('#run-add'); await page.waitForTimeout(200);
  ok('the fill counts units and grams, takes no packaging', await page.evaluate("var r=JSON.parse(localStorage.getItem('plume-products-v1'))[0].productionRuns[0]; r && r.units === 2 && r.draws[0].grams === 54 && r.pkgUntracked === true && !(JSON.parse(localStorage.getItem('aerie-packaging-v2'))[0].adjustments || []).length"));
  ok('and the list says so', /packaging stock not tracked/.test(await page.evaluate("document.getElementById('runs-list').innerText")));
  ok('the setting is saved with the data', (await page.evaluate("localStorage.getItem('plume-track-pkg')")) === 'off');
  await page.evaluate("Plume.setPkgTracking(true)");

  console.log('\n4. The start page');
  const home = 'file://' + path.join(__dirname, '..', 'index.html');
  await seed({});
  await page.goto(home); await page.waitForTimeout(400);
  const cards = () => page.evaluate("Array.from(document.querySelectorAll('.module-card')).map(c => c.querySelector('.card-title').textContent + ':' + c.querySelector('.card-count').textContent + (c.classList.contains('now') ? ':next' : ''))");
  ok('five steps in the order of the work, the first marked Next', JSON.stringify(await cards()) === JSON.stringify(['Ingredients:none yet:next', 'Packaging:none yet', 'Formulations:none yet', 'Batches:none yet', 'Products & Costing:none yet']), await cards());
  await seed({ 'aerie-ingredients-v2': ING, 'aerie-formulations-v1': FORMS, 'plume-products-v1': PRODUCTS,
    'aerie-packaging-v2': [{ id: 'k', kind: 'jar', capacity: '4 oz' }] });
  await page.reload(); await page.waitForTimeout(400);
  ok('counts, and Next moves to the first step not started', JSON.stringify(await cards()) === JSON.stringify(['Ingredients:1 ingredient', 'Packaging:1 item', 'Formulations:2 formulations', 'Batches:none yet:next', 'Products & Costing:1 product']), await cards());
  await ctx.close();

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
