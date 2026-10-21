// Links into a page that is already open (2026-10-20). Module links open in
// named windows, so when that page is already open a link only changes its
// hash, which loaded nothing: Lot sticker from a batch brought Products &
// Costing forward without opening the sticker panel. Every page now reloads
// on a new hash (Plume.followLinks), asking first when something is unsaved.
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const FORMS = [{ id: 'fm', name: 'Mist', type: 'Toner / mist', status: 'draft', lines: [],
  variants: [{ vid: 'v1', num: 1, label: '', status: 'draft', lines: [], usageLog: [{ id: 'e1', date: '2026-10-01', batch: '', version: 'Version 1', notes: 'Fine.' }], history: [] }], activeVariantId: 'v1' }];
const BATCHES = [{ id: 'b1', date: '2026-10-10', lotCode: '261010', formulaId: 'fm', formulaName: 'Mist', formulaType: 'Toner / mist', batchName: 'Mist batch', actualYield: 100,
  status: 'ready', batchType: 'production', committed: true, lotDraws: [], packagingRuns: [], packagingDraws: [], ingredientSnapshot: [] }];
const PRODUCTS = [{ id: 'p1', name: 'Mist 60 mL', status: 'active', formulaId: 'fm', netWtG: 60, packagingRecipe: [], productionRuns: [] }];
const SEED = `
  localStorage.clear();
  localStorage.setItem('aerie-ingredients-v2', '[]');
  localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});
  localStorage.setItem('aerie-batches-v1', ${JSON.stringify(JSON.stringify(BATCHES))});
  localStorage.setItem('plume-products-v1', ${JSON.stringify(JSON.stringify(PRODUCTS))});
  localStorage.setItem('plume_costing_listorder_v1', '1');
  localStorage.setItem('plume-theme', 'light');`;

(async () => {
  const browser = await chromium.launch();
  const errors = [], dialogs = [];
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await trackDialogs(page, dialogs);
  const settle = () => page.waitForTimeout(1000);
  // CI runners are slower than a laptop: wait for what the link should do,
  // up to 10 s, rather than a fixed time. The check that follows decides.
  const until = (js) => page.waitForFunction(js, null, { timeout: 10000 }).then(() => true, () => false);

  console.log('\n1. Products & Costing, already open');
  await page.goto(previewUrl('costing')); await page.evaluate(SEED); await page.reload(); await settle();
  await page.evaluate("location.hash = '#lot=b1'"); await until("document.getElementById('m-barcode') && document.getElementById('m-barcode').classList.contains('open') && document.getElementById('bc-lot-code').value === '261010'");
  ok('a lot sticker link opens the sticker panel on that batch', await page.evaluate("document.getElementById('m-barcode').classList.contains('open') && bcMode() === 'lot'") &&
     await page.inputValue('#bc-lot-code') === '261010');
  ok('and clears the link, so the same one can be followed again', await page.evaluate("location.hash === ''"));
  await page.evaluate("closeModal('m-barcode'); openProduct('p1')"); await page.waitForTimeout(250);
  await page.fill('#p-name', 'Mist 60 mL (renamed)'); await page.dispatchEvent('#p-name', 'input');
  dialogs.length = 0;
  await page.evaluate("window.PLUME_TEST_ANSWER = false; location.hash = '#lot=b1'"); await page.waitForTimeout(400);
  ok('with unsaved edits it asks first', /changes that are not saved/.test(dialogs.join(' ')), dialogs);
  ok('Stay here keeps the edits and clears the link', await page.inputValue('#p-name') === 'Mist 60 mL (renamed)' && await page.evaluate("location.hash === ''"));
  await page.evaluate("window.PLUME_TEST_ANSWER = undefined; location.hash = '#lot=b1'");
  // A reload follows; wait for the panel rather than a fixed time.
  const opened = await page.waitForFunction("document.getElementById('m-barcode') && document.getElementById('m-barcode').classList.contains('open')", null, { timeout: 8000 }).then(() => true, () => false);
  ok('following it anyway opens the sticker panel', opened);

  console.log('\n2. Batches, already open');
  await page.goto(previewUrl('batchlog')); await settle();
  await page.evaluate("location.hash = '#b=b1'"); await until("document.getElementById('m-detail') && document.getElementById('m-detail').classList.contains('open') && typeof editingBatchId !== 'undefined' && editingBatchId === 'b1'");
  ok('a "Back to batch" link opens that batch', await page.evaluate("document.getElementById('m-detail').classList.contains('open') && editingBatchId === 'b1'"));
  await page.evaluate("closeDetail()"); await page.waitForTimeout(300);
  await page.evaluate("location.hash = '#new=fm'"); await until("document.getElementById('m-new') && document.getElementById('m-new').classList.contains('open') && document.getElementById('f-formula').value === 'fm'");
  ok('a Make batch link opens New batch with the formulation', await page.evaluate("document.getElementById('m-new').classList.contains('open') && document.getElementById('f-formula').value === 'fm'"));

  console.log('\n3. Formulations, already open');
  await page.goto(previewUrl('formulations')); await settle();
  await page.evaluate("location.hash = '#f=fm&v=v1&j=e1'"); await until("document.getElementById('et-log') && document.getElementById('et-log').classList.contains('on') && !!document.getElementById('je-e1')");
  ok('a log entry link opens the formulation on its log', await page.evaluate("document.getElementById('et-log').classList.contains('on') && !!document.getElementById('je-e1')"));
  ok('and clears the link', await page.evaluate("location.hash === ''"));
  await page.evaluate("openFormula('fm'); setEdTab('method'); location.hash = '#f=fm&v=v1&j=e1'"); await until("document.getElementById('et-log') && document.getElementById('et-log').classList.contains('on')");
  ok('the same link works a second time', await page.evaluate("document.getElementById('et-log').classList.contains('on')"));

  console.log('\n4. Ingredients, already open');
  await page.evaluate(`localStorage.setItem('aerie-ingredients-v2', JSON.stringify([{ id: 'ia', name: 'Glycerin', inci: 'Glycerin', phase: 'water', lots: [] }]))`);
  await page.goto(previewUrl('ingredients')); await settle();
  await page.evaluate("location.hash = '#ing=ia'"); await until("typeof viewingId !== 'undefined' && viewingId === 'ia'");
  ok('an ingredient link opens its details', await page.evaluate("viewingId === 'ia'"));

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
