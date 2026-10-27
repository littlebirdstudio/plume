// Receipts (2026-10-26, session 29, her ask): a receipt read in a Claude
// chat comes back as a 'plume-receipt' file. Import on Ingredients shows
// every line matched to her library, nothing added without a tick.
// Ingredient lines become lots On order; packaging lines become Packaging
// purchases On order; shipping and tax stay with the order
// (plume-orders-v1), never in a cost per gram or per unit. Packaging's cost
// per unit no longer includes shipping ("match ingredients"), on every page.
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
             qtyPurchased: '300', qtyUnit: 'g', received: '2026-06-15' }], activeLotId: 'L1' },
  { id: 'ir', name: 'Rosehip seed oil', inci: 'Rosa Canina Seed Oil', phase: 'oil',
    lots: [{ id: 'L1', supplier: 'Mountain Rose Herbs', purchaseSize: '4', purchaseUnit: 'fl oz', purchasePrice: '14', costPerG: '0.1272',
             qtyPurchased: '2', qtyUnit: 'fl oz', received: '2026-05-01' }], activeLotId: 'L1' },
  { id: 'is', name: 'Shea butter', inci: 'Butyrospermum Parkii (Shea) Butter', phase: 'oil', lots: [] }
];
const PKGS = [
  { id: 'k3', kind: 'jar', name: 'Jar · 2 oz · White', type: 'container', capacity: '2 oz', color: 'White', material: 'Plastic',
    purchases: [{ date: '2026-06-01', qty: 24, totalCost: '24', shipping: '6', supplier: 'SKS Bottle' }], adjustments: [] }
];
const RECEIPT = {
  kind: 'plume-receipt', supplier: 'Lotioncrafter', orderNum: 'LC-48213', date: '2026-10-24', shipping: 14.95, tax: 1.5,
  receiptLink: 'example.com/orders/LC-48213',
  lines: [
    { kind: 'ingredient', name: 'Beeswax', count: 2, size: 1, unit: 'lb', price: 11.5, priceIs: 'each', lotNum: 'BW2210', link: 'https://example.com/beeswax' },
    { kind: 'ingredient', name: 'Rosehip oil', count: 1, size: 4, unit: 'fl. oz', price: 12.4, priceIs: 'total' },
    { kind: 'ingredient', name: 'Shea butter, refined', inci: 'Butyrospermum Parkii (Shea) Butter', count: 1, size: 16, unit: 'oz', price: 9.25, priceIs: 'each' },
    { kind: 'ingredient', name: 'Distilled water', count: 2, size: 1, unit: 'Gallon', price: 1.29, priceIs: 'each' },
    { kind: 'ingredient', name: 'Hydrolyzed rice protein', count: 2, size: 4, unit: 'oz', price: 9.99, priceIs: 'each' },
    { kind: 'packaging', name: 'Jar · 2 oz · White', count: 24, price: 21.6, priceIs: 'total' },
    { kind: 'packaging', name: 'Amber Boston round, 2 oz', count: 12, price: 0.89, priceIs: 'each' }
  ]
};
const SEED = `
  localStorage.clear();
  localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(INGS))});
  localStorage.setItem('aerie-formulations-v1', '[]');
  localStorage.setItem('aerie-suppliers-v1', '[{"id":"s1","name":"Lotioncrafter"}]');
  localStorage.setItem('aerie-batches-v1', '[]');
  localStorage.setItem('aerie-packaging-v2', ${JSON.stringify(JSON.stringify(PKGS))});
  localStorage.setItem('plume-products-v1', '[]');
  localStorage.setItem('plume-theme', 'light');`;
const getIng = (name) => `JSON.parse(localStorage.getItem('aerie-ingredients-v2')).filter(function (i) { return i.name === '${name}'; })[0]`;
const getPkg = (id) => `JSON.parse(localStorage.getItem('aerie-packaging-v2')).filter(function (k) { return k.id === '${id}'; })[0]`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [], dialogs = [];
  page.on('pageerror', e => errors.push(String(e)));
  await trackDialogs(page, dialogs);
  await page.goto(previewUrl('ingredients')); await page.evaluate(SEED); await page.reload(); await page.waitForTimeout(500);
  const txt = (sel) => page.evaluate(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
  const val = (sel) => page.evaluate(`(document.querySelector(${JSON.stringify(sel)}) || {}).value`);
  const open = (r) => page.evaluate(`previewReceipt(${JSON.stringify(r)})`);

  console.log('\n1. The receipt opens as a preview, every line matched');
  await open(RECEIPT); await page.waitForTimeout(150);
  ok('the dialog is open, with the order: supplier, order #, items, shipping, tax', await page.evaluate("document.getElementById('modal-receipt').classList.contains('open')") &&
    /Lotioncrafter/.test(await txt('#rc-order')) && /Order LC-48213/.test(await txt('#rc-order')) && /Shipping \$14\.95/.test(await txt('#rc-order')) && /Tax \$1\.50/.test(await txt('#rc-order')), await txt('#rc-order'));
  ok('it says shipping and tax stay out of cost', /not added to cost per gram or per unit/.test(await txt('#rc-order')));
  ok('items add up the lines: 23 + 12.40 + 9.25 + 2.58 + 19.98 + 21.60 + 10.68 = $99.49', /Items \$99\.49/.test(await txt('#rc-order')), await txt('#rc-order'));
  ok('Beeswax matches by name', (await val('#rc0-to')) === 'ib');
  ok('"Rosehip oil" matches Rosehip seed oil (the starter list\'s other name)', (await val('#rc1-to')) === 'ir');
  ok('"Shea butter, refined" matches Shea butter by its INCI', (await val('#rc2-to')) === 'is');
  ok('Distilled water is new, from the starter list, its INCI filled in', (await val('#rc3-to')) === 'new' && (await val('#rc3-inci')) === 'Aqua' && /from the starter list/.test(await txt('#rc3-to')));
  ok('Hydrolyzed rice protein is new and asks for an INCI name', (await val('#rc4-to')) === 'new' && (await val('#rc4-inci')) === '' && /Needs an INCI name/.test(await txt('#rc4')));
  ok('the jar matches the packaging item', (await val('#rc5-to')) === 'k3');
  ok('the Boston round is a new packaging item', (await val('#rc6-to')) === 'new' && /new item/.test(await txt('#rc6')));
  ok('lines spell out the buy: "2 × 1 lb = 2 lb · 2 × $11.50 = $23.00"', (await txt('#rc0 .rc-buy')) === '2 × 1 lb = 2 lb · 2 × $11.50 = $23.00', await txt('#rc0 .rc-buy'));
  ok('"fl. oz" and "Gallon" read as fl oz and gal', /^4 fl oz/.test(await txt('#rc1 .rc-buy')) && /^2 × 1 gal = 2 gal/.test(await txt('#rc3 .rc-buy')), [await txt('#rc1 .rc-buy'), await txt('#rc3 .rc-buy')]);
  ok('packaging reads in units: "12 units · 12 × $0.89 = $10.68"', (await txt('#rc6 .rc-buy')) === '12 units · 12 × $0.89 = $10.68', await txt('#rc6 .rc-buy'));
  ok('on order is said once, on the order, not on every line', /Everything comes in on order/.test(await txt('#rc-order')) && (await page.evaluate("document.querySelectorAll('#rc-lines .rc-tag.ord').length")) === 0);
  ok('it says how a line matched when not by its own name', /another name/.test(await txt('#rc1')) && /its INCI name/.test(await txt('#rc2')) && !/Matched/.test(await txt('#rc0')));
  ok('Import waits while a ticked line needs a look, and names it', await page.evaluate("document.getElementById('rc-apply').disabled") && (await txt('#rc-count')) === 'Needs a look first: Hydrolyzed rice protein.', await txt('#rc-count'));

  console.log('\n2. Fixing and choosing before it comes in');
  await page.fill('#rc4-inci', 'Hydrolyzed Rice Protein');
  ok('typing the INCI frees Import: 7 lines', !(await page.evaluate("document.getElementById('rc-apply').disabled")) && (await txt('#rc-apply')) === 'Import 7 lines', await txt('#rc-apply'));
  await page.click('#rc4-on');
  ok('unticking a line: 6 lines', (await txt('#rc-apply')) === 'Import 6 lines' && await page.evaluate("document.getElementById('rc4').classList.contains('off')"));
  await page.click('#rc4-on');
  ok('ticked again, the typed INCI is still there', (await val('#rc4-inci')) === 'Hydrolyzed Rice Protein');

  console.log('\n3. Import');
  const stockBefore = await page.evaluate(`Plume.stockG(${getIng('Beeswax')})`);
  await page.click('#rc-apply'); await page.waitForTimeout(250);
  ok('the dialog closes and says what came in, on order', !(await page.evaluate("document.getElementById('modal-receipt').classList.contains('open')")) &&
    dialogs.some(d => /Added 5 ingredient purchases \(2 new ingredients\) and 2 packaging purchases, all on order/.test(d)), dialogs.slice(-1));
  let bw = await page.evaluate(getIng('Beeswax'));
  const b2 = bw.lots[1];
  ok('Beeswax: a second lot, L2, on order, with the order on it', bw.lots.length === 2 && b2.id === 'L2' && b2.onOrder === true && b2.received === '' &&
    b2.orderNum === 'LC-48213' && b2.ordered === '2026-10-24' && b2.supplier === 'Lotioncrafter' && b2.lotNum === 'BW2210' && b2.receiptLink === 'https://example.com/orders/LC-48213', b2);
  ok('…bought as 2 × 1 lb at $11.50 each: 2 lb for $23, $0.0254/g', b2.buyCount === '2' && b2.buySize === '1' && b2.buyPrice === '11.5' && b2.buyPriceIs === 'each' &&
    b2.purchaseSize === '2' && b2.purchaseUnit === 'lb' && b2.purchasePrice === '23' && b2.costPerG === (23 / 907.18474).toFixed(4) && b2.qtyPurchased === '2' && b2.qtyUnit === 'lb', b2);
  ok('…its lot in use stays L1, and nothing is added to stock until it arrives', bw.activeLotId === 'L1' && Math.abs((await page.evaluate(`Plume.stockG(${getIng('Beeswax')})`)) - stockBefore) < 1e-9);
  ok('…and the cost per gram is not changed by the shipping', b2.costPerG === '0.0254');
  const rh = await page.evaluate(getIng('Rosehip seed oil'));
  ok('Rosehip seed oil: a lot of 4 fl oz for $12.40, priced by its density', rh.lots.length === 2 && rh.lots[1].purchaseUnit === 'fl oz' && rh.lots[1].purchasePrice === '12.4' &&
    rh.lots[1].costPerG === (12.4 / (4 * 29.5735 * (await page.evaluate(`Plume.densityFor(${getIng('Rosehip seed oil')}).value`)))).toFixed(4), rh.lots[1]);
  const sh = await page.evaluate(getIng('Shea butter'));
  ok('Shea butter had no lots: its first purchase becomes the lot in use', sh.lots.length === 1 && sh.lots[0].id === 'L1' && sh.activeLotId === 'L1' && sh.lots[0].onOrder === true);
  const dw = await page.evaluate(getIng('Distilled water'));
  ok('Distilled water: new, from the starter list (water phase), 2 gal on order', dw && dw.inci === 'Aqua' && dw.phase === 'water' && dw.lots.length === 1 && dw.lots[0].purchaseUnit === 'gal' &&
    dw.lots[0].purchaseSize === '2' && dw.lots[0].purchasePrice === '2.58' && dw.activeLotId === 'L1', dw && dw.lots);
  const rp = await page.evaluate(getIng('Hydrolyzed rice protein'));
  ok('Hydrolyzed rice protein: new, with the INCI typed', rp && rp.inci === 'Hydrolyzed Rice Protein' && rp.lots.length === 1 && rp.lots[0].purchasePrice === '19.98');
  let jar = await page.evaluate(getPkg('k3'));
  const jp = jar.purchases[1];
  ok('the jar: a purchase of 24 for $21.60, on order, with supplier and order #', jar.purchases.length === 2 && jp.qty === 24 && jp.totalCost === '21.6' && jp.onOrder === true &&
    jp.supplier === 'Lotioncrafter' && jp.orderNum === 'LC-48213' && jp.date === '2026-10-24' && jp.shipping === '', jp);
  ok('…not in stock yet (24 here, 24 on order)', (await page.evaluate(`Plume.pkStock(${getPkg('k3')})`)) === 24 && (await page.evaluate(`Plume.pkOnOrder(${getPkg('k3')})`)) === 24);
  const pk = await page.evaluate("JSON.parse(localStorage.getItem('aerie-packaging-v2'))");
  const br = pk.filter(k => k.name === 'Amber Boston round, 2 oz')[0];
  ok('the Boston round: a new item (Other), 12 on order for $10.68', br && br.kind === 'other' && br.other === 'Amber Boston round, 2 oz' && br.purchases.length === 1 &&
    br.purchases[0].qty === 12 && br.purchases[0].totalCost === '10.68' && br.purchases[0].onOrder === true, br);
  let orders = await page.evaluate("JSON.parse(localStorage.getItem('plume-orders-v1'))");
  ok('one order record: shipping $14.95 and tax $1.50, kept apart', orders.length === 1 && orders[0].supplier === 'Lotioncrafter' && orders[0].orderNum === 'LC-48213' &&
    orders[0].shipping === '14.95' && orders[0].tax === '1.5' && orders[0].date === '2026-10-24' && orders[0].lines === 7, orders);
  ok('no shipping on any lot or purchase', !JSON.stringify(await page.evaluate("JSON.parse(localStorage.getItem('aerie-ingredients-v2'))")).includes('14.95') && jp.shipping === '');

  console.log('\n4. The same receipt again');
  await open(RECEIPT); await page.waitForTimeout(150);
  ok('it says the order came in already', /came in once already/.test(await txt('#rc-order')));
  ok('the lines already in Plume are unticked', (await page.evaluate("[0,1,2,5].every(function (i) { return !document.getElementById('rc' + i + '-on').checked; })")) &&
    /Already in Plume from this order/.test(await txt('#rc0')));
  ok('the new ones now match what the first import made', (await val('#rc3-to')) === dw.id && (await val('#rc6-to')) === br.id);
  ok('…and are unticked too', (await page.evaluate("[3,4,6].every(function (i) { return !document.getElementById('rc' + i + '-on').checked; })")));
  ok('the button updates the order only', (await txt('#rc-apply')) === 'Update the order' && !(await page.evaluate("document.getElementById('rc-apply').disabled")));
  const re = JSON.parse(JSON.stringify(RECEIPT)); re.shipping = 12.95;
  await page.evaluate("closeModal('modal-receipt')");
  await open(re); await page.waitForTimeout(100);
  await page.click('#rc-apply'); await page.waitForTimeout(200);
  orders = await page.evaluate("JSON.parse(localStorage.getItem('plume-orders-v1'))");
  bw = await page.evaluate(getIng('Beeswax'));
  ok('updating: still one order, shipping now $12.95, no new lots', orders.length === 1 && orders[0].shipping === '12.95' && bw.lots.length === 2, [orders.length, orders[0].shipping, bw.lots.length]);

  console.log('\n5. Arrived');
  await page.evaluate("markArrived(null, 'ib', 'L2')"); await page.waitForTimeout(150);
  bw = await page.evaluate(getIng('Beeswax'));
  ok('Mark arrived: Beeswax has 2 lb more on hand, dated today', !bw.lots[1].onOrder && bw.lots[1].received === (await page.evaluate('todayISO()')) &&
    Math.abs((await page.evaluate(`Plume.stockG(${getIng('Beeswax')})`)) - stockBefore - 907.18) < 0.01);

  console.log('\n6. A file that is not right');
  await page.evaluate("closeModal('modal-receipt')");
  const nDlg = dialogs.length;
  await open({ kind: 'plume-receipt', supplier: 'X', lines: [] }); await page.waitForTimeout(100);
  ok('no lines: says so, no dialog', dialogs.length === nDlg + 1 && /no lines/.test(dialogs[dialogs.length - 1]) && !(await page.evaluate("document.getElementById('modal-receipt').classList.contains('open')")));
  await open({ kind: 'plume-receipt', supplier: 'X', orderNum: 'X1', lines: [{ kind: 'ingredient', name: 'Beeswax', count: 1, price: 5 }] }); await page.waitForTimeout(100);
  ok('a line with no size cannot come in ticked', await page.evaluate("document.getElementById('rc-apply').disabled") && /size was not read/.test(await txt('#rc0')));
  await page.evaluate("closeModal('modal-receipt')");

  console.log('\n7. The backup carries the orders');
  const payload = await page.evaluate("(function () { var got = null, B = window.Blob; window.Blob = function (parts) { got = parts[0]; return new B(parts); }; var c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {}; exportData(); window.Blob = B; HTMLAnchorElement.prototype.click = c; return JSON.parse(got); })()");
  ok('Export includes the order', Array.isArray(payload.orders) && payload.orders.length === 1 && payload.orders[0].orderNum === 'LC-48213');

  console.log('\n7b. Her order date, and an order that is already here (2026-10-26, her ask)');
  const OLD = { kind: 'plume-receipt', supplier: 'Dauphine Organics', orderNum: '29406', shipping: 0, tax: 0,
    lines: [{ kind: 'ingredient', name: 'Beeswax', count: 1, size: 100, unit: 'g', price: 5, priceIs: 'each' },
            { kind: 'packaging', name: 'Tin, 2 oz', count: 6, price: 6, priceIs: 'total' }] };
  await open(OLD); await page.waitForTimeout(150);
  const today = await page.evaluate('todayISO()');
  ok('no date on the invoice: the date box starts on today, and the order starts On order', (await val('#rc-date')) === today &&
    await page.evaluate("document.getElementById('rc-ord-b').classList.contains('on')") && !(await page.evaluate("!!document.getElementById('rc-recv')")));
  await page.fill('#rc-date', '2026-09-15'); await page.dispatchEvent('#rc-date', 'change'); await page.waitForTimeout(80);
  ok('changing the date keeps it', (await val('#rc-date')) === '2026-09-15');
  await page.click('#rc-here-b'); await page.waitForTimeout(80);
  ok('Already here: an Arrived date, starting on the order date, and the card says so', (await val('#rc-recv')) === '2026-09-15' &&
    /comes in as stock, arrived on/.test(await txt('#rc-order')) && /will come in, as stock/.test(await txt('#rc-count')), await txt('#rc-count'));
  await page.fill('#rc-recv', '2026-09-19'); await page.dispatchEvent('#rc-recv', 'change'); await page.waitForTimeout(80);
  const bwBefore = await page.evaluate(`Plume.stockG(${getIng('Beeswax')})`);
  await page.click('#rc-apply'); await page.waitForTimeout(250);
  bw = await page.evaluate(getIng('Beeswax'));
  const lx = bw.lots[bw.lots.length - 1];
  ok('the lot is in stock, arrived Sep 19, ordered Sep 15', !lx.onOrder && lx.received === '2026-09-19' && lx.ordered === '2026-09-15' && lx.orderNum === '29406', lx);
  ok('…and Beeswax has 100 g more on hand', Math.abs((await page.evaluate(`Plume.stockG(${getIng('Beeswax')})`)) - bwBefore - 100) < 1e-6);
  const tin = (await page.evaluate("JSON.parse(localStorage.getItem('aerie-packaging-v2'))")).filter(k => k.name === 'Tin, 2 oz')[0];
  ok('the packaging purchase is in stock too, dated Sep 15, arrived Sep 19', tin && !tin.purchases[0].onOrder && tin.purchases[0].date === '2026-09-15' &&
    tin.purchases[0].received === '2026-09-19' && (await page.evaluate("Plume.pkStock(JSON.parse(localStorage.getItem('aerie-packaging-v2')).filter(function (k) { return k.name === 'Tin, 2 oz'; })[0])")) === 6, tin && tin.purchases);
  orders = await page.evaluate("JSON.parse(localStorage.getItem('plume-orders-v1'))");
  ok('the order record carries her date', orders.filter(o => o.orderNum === '29406')[0].date === '2026-09-15');
  ok('it says they came in as stock', /in stock as of/.test(dialogs[dialogs.length - 1]), dialogs.slice(-1));
  const fix = JSON.parse(JSON.stringify(OLD));
  await open(fix); await page.waitForTimeout(120);
  await page.fill('#rc-date', '2026-09-14'); await page.dispatchEvent('#rc-date', 'change'); await page.waitForTimeout(80);
  await page.click('#rc-apply'); await page.waitForTimeout(200);
  orders = await page.evaluate("JSON.parse(localStorage.getItem('plume-orders-v1'))");
  ok('the same receipt again with a new date: Update the order fixes the order\'s date', orders.filter(o => o.orderNum === '29406').length === 1 && orders.filter(o => o.orderNum === '29406')[0].date === '2026-09-14');

  // ── Packaging page ──
  await page.goto(previewUrl('packaging')); await page.waitForTimeout(500);
  console.log('\n8. Packaging: on order, Mark arrived, and cost per unit without shipping');
  ok('the list shows 24 in stock and +24 on order', /24/.test(await txt('tr[data-id="k3"] .stock-pill')) && /\+24 on order/.test(await txt('tr[data-id="k3"]')), await txt('tr[data-id="k3"]'));
  ok('cost per unit is the newest purchase without shipping: $21.60 / 24 = $0.90', (await page.evaluate(`Plume.pkgUnitCostOf(${getPkg('k3')})`)) === 0.9 && /\$0\.90/.test(await txt('tr[data-id="k3"]')));
  await page.evaluate("openEdit('k3'); setEdTab('stock')"); await page.waitForTimeout(200);
  const rowIds = await page.evaluate("Array.from(document.querySelectorAll('#purchase-rows .purchase-row')).map(function (r) { return r.id; })");
  const ordRow = rowIds[1];
  ok('the receipt purchase shows On order, supplier and order #, and Mark arrived', /on order/.test(await txt('#' + ordRow + '-ord')) && /Lotioncrafter · order LC-48213/.test(await txt('#' + ordRow + '-ord')) &&
    await page.evaluate(`!!document.querySelector('#${ordRow}-ord button')`), await txt('#' + ordRow + '-ord'));
  ok('the old purchase with $6 shipping: cost/unit $1.0000, shipping kept apart', /Cost \/ unit: \$1\.0000 \(shipping of \$6\.00 kept apart\)/.test(await txt('#' + rowIds[0] + '-calc')), await txt('#' + rowIds[0] + '-calc'));
  ok('the panel says 24 units (+24 on order), $0.9000 per unit', /24 units \(\+24 on order\)/.test(await txt('#modal-stock-total')) && (await txt('#modal-cost-per-unit')) === '$0.9000', [await txt('#modal-stock-total'), await txt('#modal-cost-per-unit')]);
  await page.click('#' + ordRow + '-ord button'); await page.waitForTimeout(100);
  ok('Mark arrived: 48 units, no on order', /^48 units$/.test(await txt('#modal-stock-total')), await txt('#modal-stock-total'));
  await page.evaluate("saveItem()"); await page.waitForTimeout(200);
  jar = await page.evaluate(getPkg('k3'));
  ok('saved: still from the receipt (supplier, order #), arrived today, 48 in stock', !jar.purchases[1].onOrder && jar.purchases[1].orderNum === 'LC-48213' && jar.purchases[1].supplier === 'Lotioncrafter' &&
    jar.purchases[1].received === (await page.evaluate('todayISO()')) && (await page.evaluate(`Plume.pkStock(${getPkg('k3')})`)) === 48, jar.purchases[1]);
  ok('the old purchase keeps its $6 shipping figure', jar.purchases[0].shipping === '6');
  ok('the item\'s stored cost is $0.9000 too', jar.cost === '0.9000', jar.cost);

  console.log('\n9. Every page agrees on the jar\'s cost per unit');
  await page.goto(previewUrl('costing')); await page.waitForTimeout(500);
  ok('Products & Costing: $0.90', (await page.evaluate(`pkgUnitCost(${getPkg('k3')})`)) === 0.9);
  await page.goto(previewUrl('batchlog')); await page.waitForTimeout(500);
  ok('Batch log stock: 48', (await page.evaluate(`calcPkgStock(${getPkg('k3')})`)) === 48);

  console.log('\n10. Analytics: shipping and tax counted apart');
  await page.goto(previewUrl('analytics')); await page.waitForTimeout(600);
  const bought = await page.evaluate("Array.from(document.querySelectorAll('.an-tile')).filter(function (t) { return /Bought/.test(t.querySelector('.an-k').textContent); }).map(function (t) { return t.textContent; })[0] || ''");
  ok('Bought shows the shipping and tax line ($12.95 + $1.50 + the old $6 = $20.45)', /shipping and tax \$20\.45, kept apart/.test(bought), bought);
  ok('…and the Boston rounds still on order', /plus \$[\d.,]+ on order/.test(bought), bought);

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
