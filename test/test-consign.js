// Consignment (2026-10-20, v1.39). Units consigned to a shop leave the shelf
// but stay hers; at a settle-up (hers come on no schedule) she enters what
// sold and what came back, and the rest stays at the shop. No money is
// recorded (her call). On hand is the shelf; units at shops show beside it.
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const FORMS = [{ id: 'fs', name: 'Spritz', type: 'Toner / mist', status: 'approved', lines: [] }];
const PRODUCTS = [
  { id: 'p60', name: 'Spritz 60 mL', status: 'active', formulaId: 'fs', netWtG: 60, packagingRecipe: [], productionRuns: [{ id: 'r1', date: '2026-10-02', units: 20, fill: true, draws: [] }] },
  { id: 'p5', name: 'Spritz 5 mL', status: 'active', formulaId: 'fs', netWtG: 5, packagingRecipe: [], productionRuns: [{ id: 'r2', date: '2026-10-02', units: 12, fill: true, draws: [] }] }
];
const SEED = `
  localStorage.clear();
  localStorage.setItem('aerie-ingredients-v2', '[]');
  localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});
  localStorage.setItem('aerie-packaging-v2', '[]');
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
  const prod = (id) => page.evaluate(`JSON.parse(localStorage.getItem('plume-products-v1')).filter(function(p){return p.id==='${id}';})[0]`);

  console.log('\n1. The arithmetic');
  await page.goto(previewUrl('costing')); await page.evaluate(SEED); await page.reload(); await page.waitForTimeout(500);
  const core = await page.evaluate(`(function () {
    var p = { id: 'x', productionRuns: [{ units: 20 }], stockLog: [] };
    Plume.consignPass([p], [{ productId: 'x', value: 8 }], 'shA', { date: '2026-10-05' });
    var a = [Plume.onHand(p), Plume.atShops(p).total];
    Plume.settlePass([p], 'shA', [{ productId: 'x', sold: 5, returned: 1 }], { date: '2026-10-19' });
    var parts = Plume.onHandParts(p);
    return { after: a, shelf: Plume.onHand(p), shop: Plume.atShops(p).by.shA, sold: parts.soldAtShops, n: p.stockLog.length };
  })()`);
  ok('consigning takes units off the shelf and puts them at the shop', core.after.join() === '12,8', core);
  ok('a settle-up: sold leaves the shop, returned comes back to the shelf, the rest stays', core.shelf === 13 && core.shop === 2 && core.sold === 5 && core.n === 3, core);

  console.log('\n2. Update stock: Consign');
  await page.evaluate("Plume.stock.open()"); await page.waitForTimeout(200);
  await page.evaluate("Plume.stock.mode('consign')"); await page.waitForTimeout(150);
  ok('Consign sits between the reasons and Reconcile, with a shop to pick', await page.evaluate("!!document.getElementById('st-shop')") &&
     /Consign,Reconcile$/.test(await page.evaluate("Array.from(document.querySelectorAll('.st-modes .ps-chip')).map(function(b){return b.firstChild.textContent;}).join(',')")));
  await page.fill('#st-rows input[data-pid="p60"]', '6'); await page.dispatchEvent('#st-rows input[data-pid="p60"]', 'input');
  ok('it will not save without a shop, and says so', await page.evaluate("document.getElementById('st-save').disabled") && /Pick the shop/.test(await page.evaluate("document.getElementById('st-over').textContent")));
  await page.evaluate("window.PLUME_TEST_ANSWER = 'Raven Gallery'; document.getElementById('st-shop').value='__new'; Plume.stock.shop('__new'); window.PLUME_TEST_ANSWER = undefined;"); await page.waitForTimeout(150);
  ok('a shop can be added from right there, and is picked', await page.evaluate("Plume.shopsAll().length === 1 && document.getElementById('st-shop').selectedOptions[0].textContent === 'Raven Gallery'"));
  await page.fill('#st-rows input[data-pid="p5"]', '30'); await page.dispatchEvent('#st-rows input[data-pid="p5"]', 'input');
  ok('consigning more than is on the shelf stops it', await page.evaluate("document.getElementById('st-save').disabled") && /More than is on hand/.test(await page.evaluate("document.getElementById('st-over').textContent")));
  await page.fill('#st-rows input[data-pid="p5"]', '4'); await page.dispatchEvent('#st-rows input[data-pid="p5"]', 'input');
  await page.evaluate("Plume.stock.save()"); await page.waitForTimeout(250);
  const p60 = await prod('p60');
  ok('saving moves them: shelf down, shop up', p60.stockLog.length === 1 && p60.stockLog[0].kind === 'move' && p60.stockLog[0].qty === -6 && p60.stockLog[0].shopQty === 6, p60.stockLog);
  ok('the list shows the shelf, with what is at shops beneath', /14\s*\+6 at shops/.test(await page.evaluate("Array.from(document.querySelectorAll('tr.prod-row')).map(r => r.innerText).filter(t => /Spritz 60 mL/.test(t))[0] || ''")));

  console.log('\n3. Consignment: shops and settling up');
  ok('the sidebar has Consignment under Stock', await page.evaluate("!!document.getElementById('ps-nav-consign')"));
  await page.click('#ps-nav-consign'); await page.waitForTimeout(250);
  const card = await page.evaluate("document.querySelector('.cs-card').innerText.replace(/\\s+/g, ' ')");
  ok('each shop shows what is there', /Raven Gallery 10 units there 2 products/.test(card), card);
  await page.click('.cs-card'); await page.waitForTimeout(200);
  ok('a shop lists its products, how many there and since when', /Spritz 60 mL since/.test(await page.evaluate("document.querySelector('.cs-panel').innerText.replace(/\\s+/g, ' ')")) && await page.evaluate("document.querySelectorAll('.cs-row').length") === 2);
  const row = '.cs-row[data-pid="p60"]';
  await page.fill(row + ' [data-k="sold"]', '4'); await page.dispatchEvent(row + ' [data-k="sold"]', 'input');
  await page.fill(row + ' [data-k="returned"]', '1'); await page.dispatchEvent(row + ' [data-k="returned"]', 'input');
  ok('what is left at the shop works itself out as she types', await page.evaluate(`document.querySelector('${row} .cs-left').textContent`) === '1');
  await page.fill(row + ' [data-k="sold"]', '9'); await page.dispatchEvent(row + ' [data-k="sold"]', 'input');
  ok('more than the shop has stops the save', await page.evaluate("document.getElementById('cs-save').disabled") && /More than the shop has/.test(await page.evaluate("document.getElementById('cs-over').textContent")));
  await page.fill(row + ' [data-k="sold"]', '4'); await page.dispatchEvent(row + ' [data-k="sold"]', 'input');
  await page.evaluate("Plume.consign.save(Plume.shopsAll()[0].id)"); await page.waitForTimeout(250);
  const after = await page.evaluate("(function(){ var p = JSON.parse(localStorage.getItem('plume-products-v1')).filter(function(x){return x.id==='p60';})[0]; return { shelf: Plume.onHand(p), shop: Plume.atShops(p).total, sold: Plume.onHandParts(p).soldAtShops }; })()");
  ok('the settle-up records 4 sold and 1 back; 1 stays', after.shelf === 15 && after.shop === 1 && after.sold === 4, after);
  ok('the shop keeps a history', /Sold 4/.test(await page.evaluate("document.querySelector('.cs-hist').innerText.replace(/\\s+/g, ' ')")) && /Came back 1/.test(await page.evaluate("document.querySelector('.cs-hist').innerText.replace(/\\s+/g, ' ')")));
  await page.evaluate("Array.from(document.querySelectorAll('.cs-acts button'))[0].click()"); await page.waitForTimeout(200);
  ok('Consign more opens Update stock on Consign, with this shop picked', await page.evaluate("!!document.getElementById('st-shop') && document.getElementById('st-shop').selectedOptions[0].textContent === 'Raven Gallery'"));
  await page.evaluate("Plume.peek.close()"); await page.waitForTimeout(200);

  console.log('\n4. A product');
  await page.evaluate("openProduct('p60'); setEdTab('runs')"); await page.waitForTimeout(250);
  const box = await page.evaluate("document.getElementById('onhand-box').innerText.replace(/\\s+/g, ' ')");
  ok('on hand says shelf, what is at shops, and where', /15 ?on your shelf \+ 1 at shops/.test(box) && /4 sold at shops/.test(box) && /At shops: 1 at Raven Gallery/.test(box), box);
  const hist = await page.evaluate("document.getElementById('stock-hist').innerText.replace(/\\s+/g, ' ')");
  ok('its stock changes say consigned, sold at and back from the shop', /Consigned to Raven Gallery/.test(hist) && /Sold 4 at Raven Gallery/.test(hist) && /Back from Raven Gallery/.test(hist), hist);
  const consignId = (await prod('p60')).stockLog.filter(e => e.kind === 'move' && e.shopQty > 0)[0].id;
  dialogs.length = 0;
  await page.evaluate(`undoStockLine('${consignId}')`); await page.waitForTimeout(150);
  ok('the consignment cannot be removed while its units have sold or come back', /below zero/.test(dialogs.join(' ')) && (await prod('p60')).stockLog.length === 3, dialogs);

  console.log('\n5. Stock history');
  await page.evaluate("Plume.stock.history()"); await page.waitForTimeout(250);
  const tiles = await page.evaluate("Array.from(document.querySelectorAll('.sh-tile')).map(t => t.innerText.replace(/\\s+/g, ' ')).join(' | ')");
  ok('sales at a shop count as Sold; consigning and coming back do not', /Sold 4/.test(tiles) && !/Returned 1/.test(tiles), tiles);
  await page.evaluate("Plume.stock.group('shop')"); await page.waitForTimeout(150);
  ok('By shop groups them', /Raven Gallery/.test(await page.evaluate("document.querySelector('.sh-list').innerText")) && await page.evaluate("Array.from(document.querySelectorAll('.sh-tabs .ps-tab')).some(b => b.textContent === 'By shop' && b.classList.contains('on'))"));
  await page.evaluate("Plume.peek.close()"); await page.waitForTimeout(150);

  console.log('\n6. Backup');
  const exp = await page.evaluate(`(function () {
    var got = null, Orig = window.Blob;
    window.Blob = function (parts) { got = parts[0]; return new Orig(parts); };
    var u = URL.createObjectURL; URL.createObjectURL = function () { return 'blob:x'; };
    var c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {};
    exportData(); window.Blob = Orig; URL.createObjectURL = u; HTMLAnchorElement.prototype.click = c;
    var d = JSON.parse(got); return d.shops && d.shops.length === 1 && d.shops[0].name === 'Raven Gallery';
  })()`);
  ok('the products export carries the shops', exp);

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
