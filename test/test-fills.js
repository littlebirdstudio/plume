// Fills (2026-10-19, v1.30): a batch is bulk; a fill is production, logged
// on the product in Products & Costing's inline row. One fill counts the
// units, takes the product's packaging list out of stock, and takes the
// grams from the batch (FIFO by default; a batch per part for a sample
// pack). Short packaging stops it. The X reverses it. Batches only report
// bulk left and where it went, with links to fill each product.
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
  B({ id: 'sa', date: '2026-08-10', formulaId: 'fs', formulaName: 'Niacinamide serum', formulaType: 'Facial serum', batchName: 'Serum, August', actualYield: 200, status: 'depleted' }),
  B({ id: 'ss', date: '2026-09-20', formulaId: 'fs', formulaName: 'Niacinamide serum', formulaType: 'Facial serum', batchName: 'Serum, September', actualYield: 100 }),
  B({ id: 'bs', date: '2026-10-17', formulaId: 'fs', formulaName: 'Niacinamide serum', formulaType: 'Facial serum', batchName: 'Serum, October', actualYield: 200 }),
  B({ id: 'bo', date: '2026-10-04', formulaId: 'fo', formulaName: 'Calendula face oil', formulaType: 'Face oil', batchName: '', actualYield: 410 }),
  B({ id: 'bb', date: '2026-09-20', formulaId: 'fb', formulaName: 'Whipped butter', formulaType: 'Body butter', batchName: '', actualYield: 600,
      packagingRuns: [{ id: 'r1', date: '2026-09-21', notes: 'Market stock', committed: true, components: [{ packagingId: 'jar', packagingName: 'Jar', quantity: 8 }] }] }),
  B({ id: 'bx', date: '2026-10-12', formulaId: 'fs', formulaName: 'Niacinamide serum', formulaType: 'Facial serum', batchName: 'Spray trial', batchType: 'test', status: 'discarded', actualYield: 80 })
];
const PRODUCTS = [
  { id: 'p10', name: 'Serum 10 mL', status: 'active', formulaId: 'fs', netWtG: 10, retail: 20, packagingRecipe: [{ packagingId: 'k10', quantity: 1 }, { packagingId: 'lb', quantity: 1 }],
    productionRuns: [{ id: 'old1', date: '2026-08-12', units: 12, batchId: 'sa', notes: 'Market' }, { id: 'old2', date: '2026-09-21', units: 6, batchId: 'ss', notes: '' }] },
  { id: 'p5', name: 'Serum 5 mL', status: 'active', formulaId: 'fs', netWtG: 5, packagingRecipe: [{ packagingId: 'k5', quantity: 1 }, { packagingId: 'lb', quantity: 1 }], productionRuns: [] },
  { id: 'pn', name: 'Serum roller (no weight set)', status: 'draft', formulaId: 'fs', netWtG: '', packagingRecipe: [], productionRuns: [] },
  { id: 'p30', name: 'Face oil 30 mL', status: 'active', formulaId: 'fo', netWtG: 27, packagingRecipe: [], productionRuns: [{ id: 'old3', date: '2026-10-05', units: 6, batchId: 'bo', notes: '' }] },
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
  const stored = () => page.evaluate("JSON.parse(localStorage.getItem('plume-products-v1'))");
  const stockOf = (id) => page.evaluate(`Plume.pkStock(JSON.parse(localStorage.getItem('aerie-packaging-v2')).find(function (x) { return x.id === '${id}'; }))`);
  const rowText = (name) => page.evaluate(`Array.from(document.querySelectorAll('#tbody tr.bl-row')).map(r => r.innerText).filter(t => t.indexOf(${JSON.stringify(name)}) !== -1)[0] || ''`);

  console.log('\n1. Core rules');
  ok('the default batch is the oldest ready one with bulk left (FIFO)', await page.evaluate(`Plume.fillDefaultBatch([
      { id: 'new', formulaId: 'f', date: '2026-10-01', actualYield: 100, status: 'ready' },
      { id: 'old', formulaId: 'f', date: '2026-08-01', actualYield: 100, status: 'ready' },
      { id: 'gone', formulaId: 'f', date: '2026-07-01', actualYield: 100, status: 'depleted' }], 'f', []) === 'old'`));
  ok('curing soap is skipped while a ready batch has bulk', await page.evaluate(`Plume.fillDefaultBatch([
      { id: 'cure', formulaId: 'f', date: '2026-08-01', actualYield: 100, status: 'curing' },
      { id: 'ready', formulaId: 'f', date: '2026-10-01', actualYield: 100, status: 'ready' }], 'f', []) === 'ready'`));
  ok('and used when curing is all there is', await page.evaluate(`Plume.fillDefaultBatch([{ id: 'cure', formulaId: 'f', date: '2026-08-01', actualYield: 100, status: 'curing' }], 'f', []) === 'cure'`));
  ok('a batch with nothing left is passed over', await page.evaluate(`Plume.fillDefaultBatch([
      { id: 'empty', formulaId: 'f', date: '2026-08-01', actualYield: 10, status: 'ready' },
      { id: 'full', formulaId: 'f', date: '2026-10-01', actualYield: 100, status: 'ready' }], 'f',
      [{ id: 'p', netWtG: 10, productionRuns: [{ units: 1, batchId: 'empty' }] }]) === 'full'`));
  ok('Used up reads 0 g; the arithmetic is kept apart', await page.evaluate(`Plume.batchLeftG({ id: 'x', actualYield: 50, status: 'depleted' }, []) === 0 && Plume.batchNumbersG({ id: 'x', actualYield: 50, status: 'depleted' }, []) === 50`));

  console.log('\n2. Batch list');
  ok('it opens on By formulation', await page.evaluate("document.getElementById('f-view').value === 'formula'"));
  ok('an older run counts its grams (6 × 27 g)', /248 g of 410 g/.test(await rowText('Calendula face oil')), await rowText('Calendula face oil'));
  ok('a Used up batch reads 0 g', /0 g of 200 g/.test(await rowText('Serum, August')), await rowText('Serum, August'));

  console.log('\n3. A batch: Filled');
  await page.evaluate("openBatchDetail('ss'); setBatchTab('runs')"); await page.waitForTimeout(400);
  ok('the third tab is Filled', (await page.evaluate("document.getElementById('bt-runs').innerText")).trim().indexOf('Filled') === 0);
  ok('the bulk card shows what is left (100 g less 6 × 10 g)', /40 g\s*of 100 g made/.test(await page.evaluate("document.querySelector('#d-fills .bulk-card').innerText")));
  const links = await page.evaluate("Array.from(document.querySelectorAll('#d-fills .go-btn')).map(a => a.innerText.replace(/\\s+/g, ' ').trim() + ' ' + a.getAttribute('href'))");
  ok('Fill from this batch lists each product of this formulation and the pack, linked with the batch', links.length === 4 &&
     /Serum 10 mL .*plume-costing\.html#p=p10&fill=ss$/.test(links[0]) && links.some(l => /Sample duo Serum 5 mL .*#p=duo&fill=ss$/.test(l)) && !links.some(l => /Face oil 30/.test(l)), links);
  ok('there is no fill button or undo on the batch', await page.evaluate("!document.getElementById('d-fill-btn') && !document.querySelector('#d-fills .fill-it .x')"));
  ok('the filled list names each product, without a second link to it', await page.evaluate("!document.querySelector('#d-fills .fill-it a') && /Serum 10 mL[\\s\\S]*logged before fills/.test(document.getElementById('d-fills').innerText)"));
  await page.evaluate("closeDetail()"); await page.waitForTimeout(300);
  await page.evaluate("setBlView('status')"); await page.reload(); await page.waitForTimeout(500);
  ok('the list remembers the view she picked', await page.evaluate("document.getElementById('f-view').value === 'status' && document.querySelector('[data-bl-view=\"status\"]').classList.contains('on')"));
  await page.evaluate("setBlView('formula')");
  await page.evaluate("openBatchDetail('ss'); setBatchTab('runs')"); await page.waitForTimeout(300);
  await page.evaluate("closeDetail()"); await page.waitForTimeout(300);
  await page.evaluate("openBatchDetail('sa'); setBatchTab('runs')"); await page.waitForTimeout(300);
  ok('a Used up batch reads 0 g and says what the numbers were', /0 g\s*of 200 g/.test(await page.evaluate("document.querySelector('#d-fills .bulk-card').innerText")) &&
     /By the numbers 80 g was left/.test(await page.evaluate("document.getElementById('d-fills').innerText")) && await page.evaluate("!document.querySelector('#d-fills .fill-go')"));
  await page.evaluate("closeDetail()"); await page.waitForTimeout(300);
  await page.evaluate("openBatchDetail('bx'); setBatchTab('runs')"); await page.waitForTimeout(300);
  ok('a discarded batch offers no fills', await page.evaluate("!document.querySelector('#d-fills .fill-go') && /Discarded/.test(document.getElementById('d-fills').innerText)"));
  await page.evaluate("closeDetail()"); await page.waitForTimeout(300);
  await page.evaluate("openBatchDetail('bb'); setBatchTab('runs')"); await page.waitForTimeout(300);
  ok('older packaging runs stay as history', await page.evaluate("!document.getElementById('d-legacy').hidden && /Market stock/.test(document.getElementById('d-legacy').innerText)"));
  await page.evaluate("closeDetail()"); await page.waitForTimeout(300);
  await page.goto(previewUrl('batchlog') + '#b=bs'); await page.waitForFunction("document.getElementById('m-detail') && document.getElementById('m-detail').classList.contains('open') && !document.getElementById('bp-runs').hidden", null, { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(200);
  ok('#b= opens that batch on Filled (the Back link)', await page.evaluate("document.getElementById('m-detail').classList.contains('open') && findBatch(editingBatchId).id === 'bs' && !document.getElementById('bp-runs').hidden"));

  console.log('\n4. Products & Costing: the fill row');
  await page.goto(previewUrl('costing')); await page.waitForTimeout(500);
  await page.evaluate("openProduct('p10'); setEdTab('runs')"); await page.waitForTimeout(200);
  const opts = await page.evaluate("Array.from(document.getElementById('run-b0').options).map(o => (o.selected ? '*' : '') + o.textContent)");
  ok('batches are listed oldest first by lot code, the oldest with bulk chosen; Used up and discarded left out', opts.length === 3 &&
     /^\*Lot 2609\w* · Serum, September · 40 g left/.test(opts[0]) && /^Lot 261017 · Serum, October · 200 g left/.test(opts[1]) && opts[2] === 'Not from a logged batch', opts);
  const takes = () => page.evaluate("document.getElementById('run-takes').innerText.replace(/\\s+/g, ' ')");
  ok('before units, Add fill waits', await page.evaluate("document.getElementById('run-add').disabled") && /Type the units/.test(await takes()));
  await page.fill('#run-units', '3');
  ok('the line says what it takes', /3 × Dropper bottle · 10 mL · Amber glass/.test(await takes()) && /3 × Product label · 2 × 1 in · Front/.test(await takes()) && /30 g from Serum, September/.test(await takes()), await takes());
  await page.evaluate("var r=document.getElementById('p-retail'); r.value='99'; r.dispatchEvent(new Event('input'))");
  await page.fill('#run-notes', 'Market');
  await page.click('#run-add'); await page.waitForTimeout(200);
  let sp = (await stored()).find(p => p.id === 'p10');
  const r = sp.productionRuns.find(x => x.fill);
  ok('Add fill records the units, batch and grams', r && r.units === 3 && r.draws[0].batchId === 'ss' && r.draws[0].grams === 30 && r.notes === 'Market', sp.productionRuns);
  ok('with unsaved edits, Fill saves them first (no separate Save step)', sp.retail === 99 && !dialogs.some(d => /Save first/.test(JSON.stringify(d))) && await page.evaluate("!unsaved()"));
  ok('the open editor has the fill too', await page.evaluate("findProduct('p10').productionRuns.length === 3"));
  ok('the packaging leaves stock, noted', (await stockOf('k10')) === 21 && (await stockOf('lb')) === 37 &&
     await page.evaluate("JSON.parse(localStorage.getItem('aerie-packaging-v2')).find(x => x.id === 'k10').adjustments[0].note === 'Filled: Serum 10 mL'"));
  const list = () => page.evaluate("document.getElementById('runs-list').innerText");
  ok('the list shows the batch, grams and the packaging taken', /Serum, September\s*30 g\s*3 × Dropper bottle · 10 mL · Amber glass\s*3 × Product label/.test(await list()) && /Market/.test(await list()), await list());
  ok('older runs say no packaging was taken', /logged before packaging was taken/.test(await list()));
  ok('the row clears for the next one', (await page.evaluate("document.getElementById('run-units').value")) === '');
  ok('the batch has 10 g left', await page.evaluate("Plume.batchLeftG({ id: 'ss', actualYield: 100 }, JSON.parse(localStorage.getItem('plume-products-v1'))) === 10"));
  await page.evaluate("dirty = false");

  console.log('\n4b. A changed net weight is saved with the fill');
  await page.evaluate("var n=document.getElementById('p-netwt-g'); n.value='12'; n.dispatchEvent(new Event('input'))");
  await page.fill('#run-units', '1');
  ok('the button reads Save and fill, and the line uses the new weight', (await page.evaluate("document.getElementById('run-add').textContent")) === 'Save and fill' && /12 g from Serum, September/.test(await takes()), await takes());
  await page.click('#run-add'); await page.waitForTimeout(200);
  sp = (await stored()).find(p => p.id === 'p10');
  ok('Fill saves the product, then fills from it', sp.netWtG === 12 && sp.productionRuns.some(x => x.fill && x.units === 1 && x.draws[0].grams === 12) && (await page.evaluate("document.getElementById('run-add').textContent")) === 'Fill', sp);
  await page.evaluate("deleteRun(JSON.parse(localStorage.getItem('plume-products-v1')).find(p => p.id === 'p10').productionRuns.find(x => x.fill && x.units === 1).id)"); await page.waitForTimeout(150);
  await page.evaluate("var n=document.getElementById('p-netwt-g'); n.value='10'; n.dispatchEvent(new Event('input')); saveProduct();"); await page.waitForTimeout(100);

  console.log('\n5. Short packaging stops it; grams only warn');
  await page.selectOption('#run-b0', 'bs');
  await page.fill('#run-units', '30');
  ok('short packaging stops the fill and says which and by how much', await page.evaluate("document.getElementById('run-add').disabled") &&
     /Not enough in stock\. Dropper bottle · 10 mL · Amber glass: needs 30, 21 in stock/.test(await takes()), await takes());
  ok('grams over what is left only warn', /Serum, October has 200 g left by the numbers; this takes 300 g\. You can still add it/.test(await takes()));
  await page.evaluate("addRun()"); await page.waitForTimeout(100);
  ok('Add fill does nothing while short', (await stored()).find(p => p.id === 'p10').productionRuns.length === 3);
  await page.fill('#run-units', '');

  console.log('\n6. Reverse a fill');
  dialogs.length = 0;
  await page.evaluate(`deleteRun(${JSON.stringify(r.id)})`); await page.waitForTimeout(200);
  ok('it says what goes back', /puts back into packaging stock[\s\S]*3 x Dropper bottle · 10 mL/.test(JSON.stringify(dialogs)) && /30 g go back/.test(JSON.stringify(dialogs)), dialogs);
  ok('the packaging comes back and the fill is gone', (await stockOf('k10')) === 24 && (await stored()).find(p => p.id === 'p10').productionRuns.length === 2);
  dialogs.length = 0;
  await page.evaluate("deleteRun('old2')"); await page.waitForTimeout(200);
  ok('reversing an older run says no packaging goes back', /before packaging was taken for fills, so none goes back/.test(JSON.stringify(dialogs)), dialogs);

  console.log('\n7. No net weight, and no batch');
  await page.evaluate("leaveEditor(); openProduct('pn'); setEdTab('runs')"); await page.waitForTimeout(200);
  await page.fill('#run-units', '4');
  ok('without a net weight the batch is still recorded', /nothing from Serum, September by weight .*batch is still recorded/.test(await takes()), await takes());
  await page.click('#run-add'); await page.waitForTimeout(200);
  sp = (await stored()).find(p => p.id === 'pn');
  ok('and shown on the fill (v1.29 lost it)', sp.productionRuns[0].batchId === 'ss' && /Serum, September/.test(await list()), sp.productionRuns);
  await page.selectOption('#run-b0', '');
  await page.fill('#run-units', '2');
  ok('Not from a logged batch says no grams are tracked', /no grams tracked \(not from a logged batch\)/.test(await takes()));
  await page.click('#run-add'); await page.waitForTimeout(200);
  sp = (await stored()).find(p => p.id === 'pn');
  ok('and records no batch', sp.productionRuns.length === 2 && sp.productionRuns.some(x => x.batchId === null && x.draws.length === 0) && /not from a logged batch/.test(await list()));

  console.log('\n8. A sample pack: a batch per part');
  await page.evaluate("leaveEditor(); openProduct('duo'); setEdTab('runs')"); await page.waitForTimeout(200);
  ok('the row counts packs and lists a batch pick per part', (await page.evaluate("document.getElementById('run-units-lbl').textContent")) === 'Packs' &&
     (await page.evaluate("Array.from(document.querySelectorAll('#run-parts select')).map(s => s.value).join()")) === 'bo,ss');
  await page.fill('#run-units', '2');
  ok('each part shows its grams', (await page.evaluate("Array.from(document.querySelectorAll('#run-parts .r')).map(e => e.textContent).join()")) === '5.4 g,10 g');
  await page.click('#run-add'); await page.waitForTimeout(200);
  const duo = (await stored()).find(p => p.id === 'duo');
  ok('the fill draws from both batches and takes the packaging', duo.productionRuns[0].draws.map(d => d.batchId + ':' + d.grams).join() === 'bo:5.4,ss:10' && (await stockOf('k5')) === 56 && (await stockOf('kb')) === 13, duo.productionRuns);
  await page.fill('#run-units', '20');
  ok('20 packs need 20 pouches and stop', await page.evaluate("document.getElementById('run-add').disabled") && /Bag \/ pouch · 3 × 4 in · Kraft: needs 20, 13 in stock/.test(await takes()));

  console.log('\n9. Arriving from a batch');
  await page.goto(previewUrl('costing') + '#p=duo&fill=bs'); await page.waitForFunction("typeof curId !== 'undefined' && curId === 'duo' && !!document.getElementById('run-units')", null, { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(300);
  ok('the product opens on Fills', await page.evaluate("curId === 'duo' && !document.getElementById('pp-runs').hidden"));
  ok('with that batch chosen for its part, the other part on its own oldest', (await page.evaluate("Array.from(document.querySelectorAll('#run-parts select')).map(s => s.value).join()")) === 'bo,bs');
  ok('the cursor in Packs, and a link back to the batch', await page.evaluate("document.activeElement.id === 'run-units'") &&
     (await page.evaluate("var a=document.getElementById('run-back'); !a.hidden && a.getAttribute('href') === 'plume-batchlog.html#b=bs' && /Back to Serum, October/.test(a.textContent)")));
  await page.evaluate("leaveEditor(); openProduct('p10'); setEdTab('runs')"); await page.waitForTimeout(150);
  ok('another product does not keep the link or the choice', await page.evaluate("document.getElementById('run-back').hidden") && (await page.evaluate("document.getElementById('run-b0').value")) === 'ss');
  await page.goto(previewUrl('costing') + '#p=p5'); await page.waitForFunction("typeof curId !== 'undefined' && curId === 'p5'", null, { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(300);
  ok('#p= alone opens a product on Fills', await page.evaluate("curId === 'p5' && !document.getElementById('pp-runs').hidden && document.getElementById('run-back').hidden"));
  await ctx.close();

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  phone.on('pageerror', e => errors.push(String(e)));
  await trackDialogs(phone, []);
  await phone.goto(previewUrl('costing'));
  await phone.evaluate(`localStorage.setItem('plume-products-v1', ${JSON.stringify(JSON.stringify(PRODUCTS))});
    localStorage.setItem('aerie-batches-v1', ${JSON.stringify(JSON.stringify(BATCHES))});
    localStorage.setItem('aerie-packaging-v2', ${JSON.stringify(JSON.stringify(PKGS))});
    localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});`);
  await phone.reload(); await phone.waitForTimeout(400);
  await phone.evaluate("openProduct('duo'); setEdTab('runs')"); await phone.waitForTimeout(200);
  await phone.fill('#run-units', '3');
  ok('the fill row fits a phone', await phone.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"));
  await phone.close();

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
