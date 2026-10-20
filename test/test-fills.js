// Fills (2026-10-19): a batch is bulk; a fill is production. One fill
// counts the units on a product, takes its packaging list out of stock,
// and takes the grams from the batch it came from. Checked from both doors:
// "Fill from this batch" in Batches, and a product's Fills tab in
// Products & Costing (where a sample pack picks a batch per part).
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const FORMS = [
  { id: 'fs', name: 'Niacinamide serum', type: 'Facial serum', lines: [] },
  { id: 'fo', name: 'Calendula face oil', type: 'Face oil', lines: [] },
  { id: 'fb', name: 'Whipped butter', type: 'Body butter', lines: [] }
];
const stock = (n) => [{ id: 'p' + n, date: '2026-09-01', qty: n, totalCost: n, shipping: 0 }];
const PKGS = [
  { id: 'k10', kind: 'dropper', capacity: '10 mL', color: 'Amber', material: 'Glass', purchases: stock(24) },
  { id: 'k5', kind: 'dropper', capacity: '5 mL', color: 'Amber', material: 'Glass', purchases: stock(60) },
  { id: 'lb', kind: 'label', capacity: '2 × 1 in', part: 'Front', purchases: stock(40) },
  { id: 'kb', kind: 'pouch', capacity: '3 × 4 in', color: 'Kraft', purchases: stock(15) },
  { id: 'jar', kind: 'jar', capacity: '4 oz', color: 'White', material: 'Plastic', purchases: stock(30) }
];
const B = (o) => Object.assign({ batchType: 'production', status: 'ready', ingredientSnapshot: [], packagingRuns: [], committed: true, lotDraws: [], packagingDraws: [] }, o);
const BATCHES = [
  B({ id: 'bs', date: '2026-10-17', formulaId: 'fs', formulaName: 'Niacinamide serum', formulaType: 'Facial serum', batchName: 'Serum, October', actualYield: 200 }),
  B({ id: 'bo', date: '2026-10-04', formulaId: 'fo', formulaName: 'Calendula face oil', formulaType: 'Face oil', batchName: '', actualYield: 410 }),
  B({ id: 'bb', date: '2026-09-20', formulaId: 'fb', formulaName: 'Whipped butter', formulaType: 'Body butter', batchName: '', actualYield: 600,
      packagingRuns: [{ id: 'r1', date: '2026-09-21', notes: 'Market stock', committed: true, components: [{ packagingId: 'jar', packagingName: 'Jar', quantity: 8 }] }] }),
  B({ id: 'bx', date: '2026-10-12', formulaId: 'fs', formulaName: 'Niacinamide serum', formulaType: 'Facial serum', batchName: 'Spray trial', batchType: 'test', status: 'discarded', actualYield: 80 })
];
const PRODUCTS = [
  { id: 'p10', name: 'Serum 10 mL', status: 'active', formulaId: 'fs', netWtG: 10, packagingRecipe: [{ packagingId: 'k10', quantity: 1 }, { packagingId: 'lb', quantity: 1 }], productionRuns: [] },
  { id: 'p5', name: 'Serum 5 mL', status: 'active', formulaId: 'fs', netWtG: 5, packagingRecipe: [{ packagingId: 'k5', quantity: 1 }, { packagingId: 'lb', quantity: 1 }], productionRuns: [] },
  { id: 'p30', name: 'Face oil 30 mL', status: 'active', formulaId: 'fo', netWtG: 27, packagingRecipe: [], productionRuns: [{ id: 'old1', date: '2026-10-05', units: 6, batchId: 'bo', notes: '' }] },
  { id: 'duo', name: 'Sample duo', status: 'active', productKind: 'multi', components: [{ formulaId: 'fo', netWtG: 2.7, label: 'Face oil 3 mL' }, { formulaId: 'fs', netWtG: 5, label: 'Serum 5 mL' }],
    packagingRecipe: [{ packagingId: 'k5', quantity: 2 }, { packagingId: 'kb', quantity: 1 }], productionRuns: [] }
];

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const dialogs = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await trackDialogs(page, dialogs);
  await page.goto(previewUrl('batchlog'));
  await page.waitForTimeout(300);
  await page.evaluate(`
    localStorage.clear();
    localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});
    localStorage.setItem('aerie-packaging-v2', ${JSON.stringify(JSON.stringify(PKGS))});
    localStorage.setItem('aerie-batches-v1', ${JSON.stringify(JSON.stringify(BATCHES))});
    localStorage.setItem('plume-products-v1', ${JSON.stringify(JSON.stringify(PRODUCTS))});
    localStorage.setItem('plume_costing_listorder_v1', '1');
    localStorage.setItem('plume-theme', 'light');`);
  await page.reload();
  await page.waitForTimeout(500);
  const stockOf = (id) => page.evaluate(`Plume.pkStock(JSON.parse(localStorage.getItem('aerie-packaging-v2')).find(function (x) { return x.id === '${id}'; }))`);
  const rowText = (name) => page.evaluate(`Array.from(document.querySelectorAll('#tbody tr.bl-row')).map(r => r.innerText).filter(t => t.indexOf(${JSON.stringify(name)}) !== -1)[0] || ''`);

  console.log('\n1. Batch list');
  ok('it opens on By formulation', await page.evaluate("document.getElementById('f-view').value === 'formula' && document.querySelector('[data-bl-view=\"formula\"]').classList.contains('on')"));
  ok('Bulk left replaces Packaged', await page.evaluate("/Bulk left/.test(document.querySelector('.bl-table thead').innerText) && !/Packaged/.test(document.querySelector('.bl-table thead').innerText)"));
  ok('a new batch has all of it left', /200 g of 200 g/.test(await rowText('Serum, October')), await rowText('Serum, October'));
  ok('an older run linked to a batch counts its grams (6 × 27 g)', /248 g of 410 g/.test(await rowText('Calendula face oil')) && /1 fill · 6 units/.test(await rowText('Calendula face oil')), await rowText('Calendula face oil'));
  ok('older packaging runs are named as such', /1 older packaging run/.test(await rowText('Whipped butter')));
  ok('a discarded batch shows no bulk', /--/.test(await rowText('Spray trial')) && !/of 80 g/.test(await rowText('Spray trial')));

  console.log('\n2. A batch');
  await page.evaluate("openBatchDetail('bs')"); await page.waitForTimeout(400);
  ok('the third tab is Fills', (await page.evaluate("document.getElementById('bt-runs').innerText")).trim() === 'Fills');
  ok('Delete batch is a visible button at the bottom', await page.evaluate("var e=document.getElementById('d-delete-btn'); e && e.offsetParent !== null && !!e.closest('.bp-foot') && !document.querySelector('#m-detail [data-ps-menu]')"));
  await page.evaluate("setBatchTab('runs')");
  ok('the bulk card shows what is left', /200 g\s*of 200 g made/.test(await page.evaluate("document.querySelector('#d-fills .bulk-card').innerText")));
  ok('the old run builder is gone', await page.evaluate("document.getElementById('d-pkg-builder').offsetParent === null"));

  console.log('\n3. Fill from this batch');
  await page.click('#d-fill-btn'); await page.waitForTimeout(400);
  ok('the fill panel opens over the batch', await page.evaluate("!!document.getElementById('fl-ov') && document.getElementById('m-detail').classList.contains('open')"));
  ok('it lists each size of this formulation, not packs or other formulations', (await page.evaluate("Array.from(document.querySelectorAll('[data-fl-p]')).map(e => e.getAttribute('data-fl-p')).join()")) === 'p10,p5');
  ok('sample packs are pointed to their own page', /Sample duo[\s\S]*own page/.test(await page.evaluate("document.querySelector('#fl-ov .fl-note').innerText")));
  await page.fill('[data-fl-q="p10"]', '5');
  await page.fill('[data-fl-q="p5"]', '10');
  const sum = () => page.evaluate("document.getElementById('fl-sum').innerText");
  ok('the total updates as she types: 100 g of 200 g', /Takes 100 g of 200 g left/.test(await sum()) && /100 g after/.test(await sum()), await sum());
  const pk = () => page.evaluate("Array.from(document.querySelectorAll('#fl-pkg .fl-pk')).map(e => e.innerText.replace(/\\s+/g, ' ').trim())");
  const lines = await pk();
  ok('the packaging adds up across products', lines.length === 3 && /10 mL.*5\s*of 24 in stock/.test(lines[0]) && /Front.*15\s*of 40 in stock/.test(lines[1]) && /5 mL.*10\s*of 60 in stock/.test(lines[2]), lines);
  await page.click('#fl-commit'); await page.waitForTimeout(300);
  ok('Commit fill closes the panel', await page.evaluate("!document.getElementById('fl-ov')"));
  const saved = await page.evaluate("JSON.parse(localStorage.getItem('plume-products-v1'))");
  const r10 = saved.find(p => p.id === 'p10').productionRuns[0];
  ok('each product gets its own fill with the grams it took', r10 && r10.fill === true && r10.units === 5 && r10.draws[0].batchId === 'bs' && r10.draws[0].grams === 50 && saved.find(p => p.id === 'p5').productionRuns[0].draws[0].grams === 50, r10);
  ok('the packaging leaves stock', (await stockOf('k10')) === 19 && (await stockOf('lb')) === 25 && (await stockOf('k5')) === 50);
  ok('the stock change says what it was for', await page.evaluate("JSON.parse(localStorage.getItem('aerie-packaging-v2')).find(x => x.id === 'k10').adjustments[0].note === 'Filled: Serum 10 mL'"));
  ok('the bulk left drops to 100 g', /100 g\s*of 200 g made/.test(await page.evaluate("document.querySelector('#d-fills .bulk-card').innerText")) && /100 g of 200 g/.test(await rowText('Serum, October')));
  ok('the fills are listed on the batch, and counted on the tab', (await page.evaluate("document.querySelectorAll('#d-fills .fill-it:not(.h)').length")) === 2 && (await page.evaluate("document.getElementById('bt-runs-ct').textContent")) === '2');

  console.log('\n4. Over the top, and Escape');
  await page.click('#d-fill-btn'); await page.waitForTimeout(300);
  await page.fill('[data-fl-q="p10"]', '30');
  ok('more than is left warns', await page.evaluate("document.getElementById('fl-sum').classList.contains('over')") && /More than is left: 300 g of 100 g/.test(await sum()) && /still commit/.test(await sum()));
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  ok('Escape closes the fill panel and leaves the batch open', await page.evaluate("!document.getElementById('fl-ov') && document.getElementById('m-detail').classList.contains('open')"));
  await page.click('#d-fill-btn'); await page.waitForTimeout(300);
  await page.click('#fl-commit'); await page.waitForTimeout(200);
  ok('committing nothing says so', /Type how many/.test(JSON.stringify(dialogs[dialogs.length - 1])) && await page.evaluate("!!document.getElementById('fl-ov')"));
  await page.keyboard.press('Escape');

  console.log('\n5. Undo a fill');
  dialogs.length = 0;
  await page.evaluate("undoBatchFill('p10', JSON.parse(localStorage.getItem('plume-products-v1')).find(p => p.id === 'p10').productionRuns[0].id)"); await page.waitForTimeout(200);
  ok('it says what goes back', /puts back into packaging stock[\s\S]*5 x Dropper bottle · 10 mL/.test(JSON.stringify(dialogs)) && /50 g go back/.test(JSON.stringify(dialogs)), dialogs);
  ok('the packaging and grams come back', (await stockOf('k10')) === 24 && (await stockOf('lb')) === 30 && /150 g\s*of 200 g/.test(await page.evaluate("document.querySelector('#d-fills .bulk-card').innerText")));
  await page.evaluate("closeDetail()"); await page.waitForTimeout(300);

  console.log('\n6. Discarded, older and deleted batches');
  await page.evaluate("openBatchDetail('bx'); setBatchTab('runs')"); await page.waitForTimeout(300);
  ok('a discarded batch offers no fill', await page.evaluate("!document.getElementById('d-fill-btn') && /Discarded, so it is not offered/.test(document.getElementById('d-fills').innerText)"));
  await page.evaluate("closeDetail()"); await page.waitForTimeout(300);
  await page.evaluate("openBatchDetail('bb'); setBatchTab('runs')"); await page.waitForTimeout(300);
  ok('older packaging runs stay as history', await page.evaluate("!document.getElementById('d-legacy').hidden && /Market stock/.test(document.getElementById('d-legacy').innerText)"));
  ok('with no delete button on them', await page.evaluate("getComputedStyle(document.querySelector('#d-legacy .pr-del')).display === 'none'"));
  await page.evaluate("closeDetail()"); await page.waitForTimeout(300);
  dialogs.length = 0;
  await page.evaluate("window.PLUME_TEST_ANSWER = false; openBatchDetail('bs'); deleteBatch()"); await page.waitForTimeout(200);
  ok('deleting a batch says its fills stay on their products', /1 fill came from this batch\. It stays on its product/.test(JSON.stringify(dialogs)), dialogs);
  await page.evaluate("window.PLUME_TEST_ANSWER = undefined; closeDetail()"); await page.waitForTimeout(300);

  console.log('\n7. Products & Costing: the Fills tab');
  await page.goto(previewUrl('costing')); await page.waitForTimeout(500);
  await page.evaluate("openProduct('p30')"); await page.waitForTimeout(200);
  ok('the middle tab is Fills, with its count', (await page.evaluate("document.getElementById('pt-runs').innerText")).replace(/\s+/g, ' ').trim() === 'Fills 1');
  ok('the tab bar is filled in the palette\'s darkest tone', await page.evaluate("var t=document.createElement('i'); t.style.background='var(--bark)'; document.body.appendChild(t); var want=getComputedStyle(t).backgroundColor; t.remove(); getComputedStyle(document.getElementById('pt-label')).backgroundColor === want && getComputedStyle(document.getElementById('pt-runs')).backgroundColor !== want"));
  await page.evaluate("setEdTab('runs')");
  const runs = () => page.evaluate("document.getElementById('runs-list').innerText");
  ok('an older run shows its batch, grams and that it took no packaging', /Calendula face oil[\s\S]*162 g/.test(await runs()) && /logged before fills/.test(await runs()), await runs());
  ok('the packaging picker leaves out stock here', await page.evaluate("document.querySelectorAll('#pkg-recipe-body .pk-pick-btn').length === 0 || !/in stock/.test(document.getElementById('pkg-recipe-body').innerText)"));
  await page.evaluate("markDirty(); openProductFill()"); await page.waitForTimeout(150);
  ok('with unsaved changes it asks her to save first', /Save the product first/.test(JSON.stringify(dialogs[dialogs.length - 1])) && await page.evaluate("!document.getElementById('fl-ov')"));
  await page.evaluate("dirty = false; leaveEditor()"); await page.waitForTimeout(150);

  console.log('\n8. A sample pack: a batch per part');
  await page.evaluate("openProduct('duo'); setEdTab('runs'); openProductFill()"); await page.waitForTimeout(400);
  const picks = await page.evaluate("Array.from(document.querySelectorAll('[data-fl-b]')).map(s => s.value + ':' + s.options.length)");
  ok('one batch pick per part, each its own formulation; discarded not offered', picks.join() === 'bo:2,bs:2', picks);
  await page.fill('#fl-units', '20');
  const sg = await page.evaluate("Array.from(document.querySelectorAll('[data-fl-sg]')).map(e => e.textContent)");
  ok('20 packs take 54 g of face oil and 100 g of serum', sg.join() === '54 g,100 g', sg);
  const pl = await pk();
  ok('short packaging warns but does not block', /5 mL.*40\s*of 50/.test(pl[0]) && /3 × 4 in.*20\s*of 15/.test(pl[1]) &&
     /Short on Bag \/ pouch[\s\S]*still commit/i.test(await page.evaluate("document.querySelector('#fl-pkg .fl-warn').innerText")), pl);
  await page.click('#fl-commit'); await page.waitForTimeout(300);
  const duo = (await page.evaluate("JSON.parse(localStorage.getItem('plume-products-v1'))")).find(p => p.id === 'duo');
  ok('the pack fill draws from both batches', duo.productionRuns.length === 1 && duo.productionRuns[0].draws.map(d => d.batchId + ':' + d.grams).join() === 'bo:54,bs:100', duo.productionRuns);
  ok('stock can go below zero', (await stockOf('kb')) === -5 && (await stockOf('k5')) === 10);
  ok('it shows on the Fills tab', /20[\s\S]*Calendula face oil \+ Serum, October[\s\S]*154 g/.test(await runs()), await runs());
  ok('and on each batch it came from', await page.evaluate("Plume.batchFills('bo', JSON.parse(localStorage.getItem('plume-products-v1'))).length === 2 && Plume.batchLeftG({ id: 'bo', actualYield: 410 }, JSON.parse(localStorage.getItem('plume-products-v1'))) === 194"));
  await page.evaluate("leaveEditor()"); await page.waitForTimeout(150);
  await page.evaluate("openProduct('p30'); setEdTab('runs')"); await page.waitForTimeout(150);
  dialogs.length = 0;
  await page.evaluate("deleteRun('old1')"); await page.waitForTimeout(200);
  ok('undoing an older run says no packaging goes back', /logged before fills, so no packaging was taken/.test(JSON.stringify(dialogs)), dialogs);
  ok('and it is gone', (await page.evaluate("JSON.parse(localStorage.getItem('plume-products-v1')).find(p => p.id === 'p30').productionRuns.length")) === 0);
  await ctx.close();

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  phone.on('pageerror', e => errors.push(String(e)));
  await trackDialogs(phone, []);
  await phone.goto(previewUrl('batchlog'));
  await phone.evaluate(`localStorage.setItem('plume-products-v1', ${JSON.stringify(JSON.stringify(PRODUCTS))});
    localStorage.setItem('aerie-batches-v1', ${JSON.stringify(JSON.stringify(BATCHES))});
    localStorage.setItem('aerie-packaging-v2', ${JSON.stringify(JSON.stringify(PKGS))});
    localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});`);
  await phone.reload(); await phone.waitForTimeout(400);
  await phone.evaluate("openBatchDetail('bs'); setBatchTab('runs'); openBatchFill()"); await phone.waitForTimeout(400);
  ok('the fill panel fits a phone', await phone.evaluate("var p=document.querySelector('.fl-panel'); p.scrollWidth <= p.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1"));
  await phone.close();

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
