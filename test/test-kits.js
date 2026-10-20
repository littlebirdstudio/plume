// Kits built from filled products, units on hand, the stock panel and
// "Not for individual sale" (2026-10-20). Her way of working: fill minis
// (and any product) from batches, then build kits from what is filled,
// adding the kit's own packaging. Before this, a pack took grams straight
// from batches, so filling minis AND the pack counted the bulk twice.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');
const { ROOT, previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const FORMS = [
  { id: 'f1', name: 'Face Oil', type: 'Face oil', lines: [{ ingId: 'i1', pct: 100 }], variants: [{ vid: 'v1', lines: [{ ingId: 'i1', pct: 100 }] }], activeVariantId: 'v1' },
  { id: 'f2', name: 'Spritz', type: 'Toner / mist', lines: [{ ingId: 'i2', pct: 100 }], variants: [{ vid: 'v2', lines: [{ ingId: 'i2', pct: 100 }] }], activeVariantId: 'v2' }
];
const INGS = [
  { id: 'i1', name: 'Jojoba oil', inci: 'Simmondsia Chinensis Seed Oil', lots: [{ id: 'l1', costPerG: 0.1, qtyPurchased: 1000, qtyUnit: 'g' }] },
  { id: 'i2', name: 'Rose water', inci: 'Rosa Damascena Flower Water', lots: [{ id: 'l2', costPerG: 0.02, qtyPurchased: 1000, qtyUnit: 'g' }] }
];
const PKGS = [
  { id: 'dr', kind: 'dropper', capacity: '5 ml', purchases: [{ date: '2026-10-01', qty: 50, totalCost: 25, shipping: 0 }], adjustments: [] },
  { id: 'ms', kind: 'mist', capacity: '5 ml', purchases: [{ date: '2026-10-01', qty: 50, totalCost: 15, shipping: 0 }], adjustments: [] },
  { id: 'bx', kind: 'box', capacity: 'small', purchases: [{ date: '2026-10-01', qty: 4, totalCost: 4, shipping: 0 }], adjustments: [] }
];
const PRODS = [
  { id: 'full', name: 'Face Oil 1 oz', status: 'active', productKind: 'single', formulaId: 'f1', netWtG: 28, retail: 28, wholesale: 14, packagingRecipe: [], productionRuns: [{ id: 'r0', date: '2026-10-10', units: 8, fill: true, draws: [] }] },
  { id: 'mo', name: 'Oil mini', status: 'active', productKind: 'single', formulaId: 'f1', netWtG: 5, notForSale: true, packagingRecipe: [{ packagingId: 'dr', quantity: 1 }], productionRuns: [{ id: 'r1', date: '2026-10-10', units: 12, fill: true, draws: [] }] },
  { id: 'ms5', name: 'Spritz mini', status: 'active', productKind: 'single', formulaId: 'f2', netWtG: 5, notForSale: true, packagingRecipe: [{ packagingId: 'ms', quantity: 1 }], productionRuns: [{ id: 'r2', date: '2026-10-10', units: 5, fill: true, draws: [] }] },
  { id: 'kit', name: 'Duo Kit', status: 'active', productKind: 'kit', retail: 18, kitParts: [{ id: 'k1', productId: 'mo', qty: 2 }, { id: 'k2', productId: 'ms5', qty: 1 }], packagingRecipe: [{ packagingId: 'bx', quantity: 1 }], productionRuns: [] },
  { id: 'old', name: 'Older pack', status: 'active', productKind: 'multi', components: [{ id: 'c1', formulaId: 'f1', netWtG: 3 }], packagingRecipe: [], productionRuns: [] }
];

// ── 1. Core arithmetic ─────────────────────────────────────────
const core = fs.readFileSync(path.join(ROOT, 'plume-core.js'), 'utf8');
const sandbox = { window: {}, document: { documentElement: { style: { setProperty() {} } } },
                  localStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 } };
vm.createContext(sandbox);
vm.runInContext(core, sandbox);
const P = sandbox.Plume;
const clone = x => JSON.parse(JSON.stringify(x));
async function type2(page, v) { await page.fill('#run-units', v); await page.dispatchEvent('#run-units', 'input'); }

console.log('\n1. Units on hand and kits, in core');
{
  const prods = clone(PRODS), pk = clone(PKGS);
  const find = id => prods.find(x => x.id === id);
  ok('on hand is what was filled when nothing else happened', P.onHand(find('mo')) === 12);
  ok('a kit can hold single products only: not kits, not older packs',
     P.kitPartOk(find('mo')) && !P.kitPartOk(find('kit')) && !P.kitPartOk(find('old')));
  const needs = P.kitNeeds(find('kit'), 3, prods);
  ok('3 kits need 6 oil minis and 3 spritz minis', JSON.stringify(needs.map(n => [n.productId, n.need, n.have])) === '[["mo",6,12],["ms5",3,5]]', needs);
  ok('6 kits would be short of spritz minis', JSON.stringify(P.kitShortages(find('kit'), 6, prods).map(n => n.productId)) === '["ms5"]');
  const run = P.buildKit(prods, find('kit'), { date: '2026-10-20', units: 3, notes: 'gift sets' }, pk);
  ok('building takes the parts off hand', P.onHand(find('mo')) === 6 && P.onHand(find('ms5')) === 2, [P.onHand(find('mo')), P.onHand(find('ms5'))]);
  ok('and puts the kits on hand', P.onHand(find('kit')) === 3);
  ok('the kit packaging leaves stock', P.pkStock(pk.find(x => x.id === 'bx')) === 1);
  ok('the minis\' own bottles do not leave again (they went out when filled)', P.pkStock(pk.find(x => x.id === 'dr')) === 50);
  ok('the build records what it used', JSON.stringify(run.parts.map(c => [c.productId, c.quantity])) === '[["mo",6],["ms5",3]]');
  ok('the parts\' history says which kit', find('mo').stockLog[0].note === 'Into kit: Duo Kit' && find('mo').stockLog[0].kind === 'kit');
  ok('the batch arithmetic ignores builds (they draw no grams)', P.fillDraws(run, find('kit')).length === 0);
  P.undoKitBuild(prods, find('kit'), run.id, pk);
  ok('reversing puts every part, the kits and the packaging back',
     P.onHand(find('mo')) === 12 && P.onHand(find('ms5')) === 5 && P.onHand(find('kit')) === 0 && P.pkStock(pk.find(x => x.id === 'bx')) === 4);
  ok('and leaves no trace in the parts\' history', !find('mo').stockLog.length);

  const n = P.stockPass(prods, [{ productId: 'full', value: '3' }, { productId: 'mo', value: '' }], { mode: 'out', date: '2026-10-18', note: 'Market' });
  ok('took out: one pass, blank rows skipped', n === 1 && P.onHand(find('full')) === 5);
  P.stockPass(prods, [{ productId: 'full', value: '7' }], { mode: 'count', date: '2026-10-19', note: 'Shelf' });
  ok('counted: on hand becomes the count', P.onHand(find('full')) === 7);
  const parts = P.onHandParts(find('full'));
  ok('and the parts add up: 8 filled, 3 out, +2 from the count', parts.filled === 8 && parts.out === -3 && parts.counted === 2, parts);
  P.stockPass(prods, [{ productId: 'full', value: '7' }], { mode: 'count' });
  ok('a count that matches is still recorded, as 0', find('full').stockLog.slice(-1)[0].qty === 0);
  const id = find('full').stockLog[0].id;
  ok('a taken-out line can be removed', P.undoStock(find('full'), id) && P.onHand(find('full')) === 10);
  ok('negative values are refused', P.stockPass(prods, [{ productId: 'mo', value: '-2' }], { mode: 'out' }) === 0);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const SEED = `
    localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});
    localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(INGS))});
    localStorage.setItem('aerie-packaging-v2', ${JSON.stringify(JSON.stringify(PKGS))});
    localStorage.setItem('plume-products-v1', ${JSON.stringify(JSON.stringify(PRODS))});
    localStorage.setItem('aerie-batches-v1', '[]');
    localStorage.setItem('plume-theme', 'light');`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => errors.push(String(e)));
  await trackDialogs(page, []);
  await page.goto(previewUrl('costing'));
  await page.waitForTimeout(300);
  await page.evaluate(SEED);
  await page.reload();
  await page.waitForTimeout(500);
  const stored = () => page.evaluate("JSON.parse(localStorage.getItem('plume-products-v1'))");
  const onHandOf = async id => page.evaluate("Plume.onHand(JSON.parse(localStorage.getItem('plume-products-v1')).find(function(p){return p.id==='" + id + "';}))");

  console.log('\n2. The list');
  ok('the column says On hand', (await page.evaluate("document.querySelector('thead').textContent")).indexOf('On hand') !== -1);
  ok('not-for-sale products carry a tag', await page.evaluate("Array.from(document.querySelectorAll('.prod-row')).filter(function(r){return r.querySelector('.nfs-tag');}).length === 2"));
  ok('their price and margin read as a dash', await page.evaluate(
    "var r=Array.from(document.querySelectorAll('.prod-row')).find(function(r){return /Oil mini/.test(r.textContent);}); r.querySelectorAll('td')[4].textContent === '--'"));
  ok('kits sit with packs', await page.evaluate("Array.from(document.querySelectorAll('.grp-type')).pop().textContent.indexOf('Sample packs') !== -1"));

  console.log('\n3. A kit in the editor');
  await page.evaluate("openProduct('kit')");
  ok('Made from shows A kit of products, and not the older pack choice', await page.evaluate(
    "document.getElementById('kind-btn-kit').classList.contains('on') && document.getElementById('kind-btn-multi').hidden"));
  ok('its parts list the products with what is on hand', await page.evaluate(
    "var r=document.querySelectorAll('#kit-parts-body .kit-row'); r.length===2 && r[0].querySelectorAll('.kr-n')[0].textContent==='12'"));
  const cost = await page.evaluate("computeProductCost(findProduct('kit')).totalCost");
  // oil mini: 5 g x $0.10 + dropper $0.50 = $1.00; spritz mini: 5 g x $0.02 + mist $0.30 = $0.40; box $1.00
  ok('its cost is the parts\' unit costs plus the kit packaging: 2 x 1.00 + 0.40 + 1.00', Math.abs(cost - 3.40) < 1e-9, cost);
  ok('a kit offers only single products as parts', await page.evaluate(
    "var o=Array.from(document.querySelectorAll('#kit-parts-body select')[0].options).map(function(x){return x.value;}); o.indexOf('old')===-1 && o.indexOf('kit')===-1 && o.indexOf('mo')!==-1"));
  ok('its label lists each product\'s ingredients', (await page.evaluate("document.getElementById('label-preview').textContent")).indexOf('Spritz mini: Rosa Damascena') !== -1);

  console.log('\n4. Building kits');
  await page.evaluate("setEdTab('runs')");
  ok('the tab reads Built', (await page.evaluate("document.getElementById('pt-runs-lbl').textContent")) === 'Built');
  await page.fill('#run-units', '6'); await page.dispatchEvent('#run-units', 'input');
  ok('6 kits: short of spritz minis, so Build is stopped', await page.evaluate(
    "document.getElementById('run-add').disabled && /Spritz mini: needs 6, 5 on hand/.test(document.getElementById('run-takes').textContent)"));
  await page.fill('#run-units', '3'); await page.dispatchEvent('#run-units', 'input');
  ok('3 kits: says what it takes', await page.evaluate(
    "!document.getElementById('run-add').disabled && /6\\s*× Oil mini/.test(document.getElementById('run-takes').textContent)"));
  await page.click('#run-add');
  await page.waitForTimeout(150);
  ok('after building, the minis are off hand and the kits are on', (await onHandOf('mo')) === 6 && (await onHandOf('ms5')) === 2 && (await onHandOf('kit')) === 3);
  ok('the box left packaging stock', await page.evaluate("Plume.pkStock(JSON.parse(localStorage.getItem('aerie-packaging-v2')).find(function(x){return x.id==='bx';})) === 1"));
  ok('the build is listed with the products it used', /2 ×?\s*|6/.test(await page.evaluate("document.getElementById('runs-list').textContent")) &&
     (await page.evaluate("document.getElementById('runs-list').textContent")).indexOf('Oil mini') !== -1);
  ok('the parts\' on-hand counts in the editor follow', (await page.evaluate("document.querySelectorAll('#kit-parts-body .kr-n')[0].textContent")) === '6');
  await page.evaluate("deleteRun(findProduct('kit').productionRuns[0].id)");
  await page.waitForTimeout(150);
  ok('reversing a build puts it all back', (await onHandOf('mo')) === 12 && (await onHandOf('kit')) === 0 &&
     await page.evaluate("Plume.pkStock(JSON.parse(localStorage.getItem('aerie-packaging-v2')).find(function(x){return x.id==='bx';})) === 4"));

  console.log('\n5. Not for individual sale');
  await page.evaluate("openProduct('mo')");
  ok('the tick is on, the price cards hidden, the note shown', await page.evaluate(
    "document.getElementById('p-nfs').checked && document.getElementById('price-card').hidden && !document.getElementById('nfs-card').hidden"));
  ok('the on-hand box names the kit it goes into', (await page.evaluate("document.getElementById('onhand-box').textContent")).indexOf('Goes into Duo Kit') !== -1);
  await page.evaluate("openProduct('full')");
  await page.evaluate("document.getElementById('p-nfs').click()");
  await page.evaluate("saveProduct()");
  ok('ticking it saves, and unticking removes the key', (await stored()).find(x => x.id === 'full').notForSale === true);
  await page.evaluate("document.getElementById('p-nfs').click(); saveProduct()");
  ok('unticked', !('notForSale' in (await stored()).find(x => x.id === 'full')));
  ok('the line sheet leaves not-for-sale products out', await page.evaluate("leaveEditor(); lsOffered().map(function(p){return p.id;}).indexOf('mo')===-1 && lsOffered().map(function(p){return p.id;}).indexOf('full')!==-1"));

  console.log('\n6. Update stock, from the sidebar');
  await page.evaluate("leaveEditor()");
  ok('the sidebar has Update stock, above Settings', await page.evaluate(
    "var b=document.getElementById('ps-nav-stock'); b && b.nextElementSibling && /Settings/.test(b.nextElementSibling.textContent)"));
  ok('Products & Costing no longer has its own button', await page.evaluate("!document.getElementById('stock-open')"));
  await page.click('#ps-nav-stock');
  await page.waitForTimeout(200);
  ok('it opens the panel with every active product and what is on hand', await page.evaluate(
    "document.querySelectorAll('#st-rows .st-row').length === 5 && document.querySelector('#st-rows .st-row[data-pid=\"full\"] .st-have').textContent === '8'"));
  ok('the reasons are Sold, Gifted, Marketing, Damaged, then Reconcile', (await page.evaluate(
    "Array.from(document.querySelectorAll('.st-modes .ps-chip')).map(function(b){return b.firstChild.textContent;}).join(',')")) === 'Sold,Gifted,Marketing,Damaged,Reconcile');
  ok('Save waits until something is entered', await page.evaluate("document.getElementById('st-save').disabled"));
  const type = async (pid, v) => { await page.fill('#st-rows input[data-pid="' + pid + '"]', v); await page.dispatchEvent('#st-rows input[data-pid="' + pid + '"]', 'input'); };
  await type('full', '3');
  await page.fill('#st-note', 'Market, Oct 18');
  await page.evaluate("Plume.stock.mode('gifted')");
  ok('switching reason starts a fresh column', (await page.evaluate("document.querySelector('#st-rows input[data-pid=\"full\"]').value")) === '');
  await type('full', '1');
  await page.evaluate("Plume.stock.mode('damaged')");
  await type('mo', '2');
  ok('the note survives switching', (await page.evaluate("document.getElementById('st-note').value")) === 'Market, Oct 18');
  await page.evaluate("Plume.stock.search('spritz')");
  ok('a search keeps what was typed for products it hides', (await page.evaluate("Plume.stock.entries().damaged.length")) === 1);
  await page.evaluate("Plume.stock.search('')");
  await page.evaluate("Plume.stock.mode('sold')");
  ok('each reason keeps its own numbers', (await page.evaluate("document.querySelector('#st-rows input[data-pid=\"full\"]').value")) === '3');
  ok('the footer adds them up', (await page.evaluate("document.getElementById('st-ct').textContent")) === 'Sold 3 · Gifted 1 · Damaged 2');
  await page.evaluate("Plume.stock.mode('marketing')");
  await type('ms5', '4');
  await page.evaluate("Plume.stock.mode('sold')");
  await type('ms5', '2');
  ok('reasons adding up to more than is on hand stop Save, and say which', await page.evaluate(
    "document.getElementById('st-save').disabled && /Spritz mini \\(6 of 5\\)/.test(document.getElementById('st-over').textContent) && document.querySelector('#st-rows .st-row[data-pid=\"ms5\"]').classList.contains('over')"));
  await page.evaluate("Plume.stock.mode('count')");
  await type('ms5', '5');
  ok('reconciling the same product in the pass lifts it: the count wins', await page.evaluate("!document.getElementById('st-save').disabled"));
  await type('ms5', '');
  await page.evaluate("Plume.stock.mode('marketing')");
  await type('ms5', '');
  await page.evaluate("Plume.stock.mode('sold')");
  await type('ms5', '');
  ok('clearing them lets Save through again', await page.evaluate("!document.getElementById('st-save').disabled"));
  await page.evaluate("Plume.stock.save()");
  await page.waitForTimeout(150);
  ok('one Save records every reason', (await onHandOf('full')) === 4 && (await onHandOf('mo')) === 10);
  const log = (await stored()).find(x => x.id === 'full').stockLog;
  ok('each line keeps its reason and the note', log.map(e => e.reason).sort().join(',') === 'gifted,sold' && log.every(e => e.note === 'Market, Oct 18'), log);
  ok('the list behind the panel follows', await page.evaluate(
    "Array.from(document.querySelectorAll('.prod-row')).find(function(r){return /Face Oil 1 oz/.test(r.textContent);}).querySelectorAll('td')[1].textContent === '4'"));

  await page.evaluate("Plume.stock.open(); Plume.stock.mode('count')");
  await type('mo', '9');
  await page.evaluate("Plume.stock.mode('sold')");
  await type('mo', '1');
  await page.evaluate("Plume.stock.save()");
  await page.waitForTimeout(150);
  ok('Reconcile is applied after the reasons in the same pass: on hand is the count', (await onHandOf('mo')) === 9);
  await page.evaluate("openProduct('mo'); setEdTab('runs')");
  const hist = await page.evaluate("document.getElementById('stock-hist').textContent");
  ok('the product\'s history names each reason and the reconcile', hist.indexOf('Damaged') !== -1 && hist.indexOf('Reconciled to 9') !== -1 && hist.indexOf('Sold') !== -1, hist);
  ok('the on-hand box breaks it down by reason', /2 damaged/.test(await page.evaluate("document.getElementById('onhand-box').textContent")));
  const before = await onHandOf('mo');
  await page.evaluate("undoStockLine(findProduct('mo').stockLog.filter(function(e){return e.reason==='damaged';})[0].id)");
  await page.waitForTimeout(100);
  ok('a stock change can be removed: the 2 damaged come back', (await onHandOf('mo')) === before + 2);
  await page.evaluate("Plume.stock.open()");
  await type('mo', '1.5');
  await page.evaluate("Plume.stock.save()");
  ok('part units are refused', (await page.evaluate("document.getElementById('ps-peek').classList.contains('open')")));
  await page.evaluate("Plume.peek.close()");

  console.log('\n6b. Reversing a fill');
  // Oil mini: 12 filled. Build 2 kits, which takes 4 of them.
  await page.evaluate("openProduct('kit'); setEdTab('runs')");
  await type2(page, '2');
  await page.click('#run-add');
  await page.waitForTimeout(150);
  await page.evaluate("openProduct('mo'); setEdTab('runs')");
  const said = await page.evaluate("var m=''; var real=Plume.tell; Plume.tell=function(t){ m=t; }; deleteRun('r1'); Plume.tell=real; m");
  ok('a fill whose units went into kits cannot be reversed, and says why', /into kits/.test(said) && (await stored()).find(x => x.id === 'mo').productionRuns.length === 1, said);

  console.log('\n6c. Unit cost recorded, and the stock report');
  ok('core works out the same unit cost as Products & Costing, for every product (single, kit, older pack, not for sale)', await page.evaluate(
    "products.every(function(p){ return Math.abs(Plume.productUnitCost(p, { ings: ings, forms: forms, pkgs: pkgs, products: products }) - computeProductCost(p).totalCost) < 1e-9; })"));
  const outs = (await stored()).find(x => x.id === 'full').stockLog.filter(e => e.kind === 'out');
  // Face Oil 1 oz: 28 g x $0.10, no packaging
  ok('each stock change carries the unit cost on the day it was saved', outs.length && outs.every(e => Math.abs(e.unitCost - 2.8) < 1e-9), outs);
  await page.evaluate("Plume.peek.close(); leaveEditor(); openReport()");
  ok('the report opens from the list', await page.evaluate("document.getElementById('view-report').style.display === '' && document.getElementById('view-list').style.display === 'none'"));
  const tiles = await page.evaluate("Array.from(document.querySelectorAll('.rp-tile')).map(function(t){return t.querySelector('.rp-k').textContent+':'+t.querySelector('.rp-n').textContent;}).join(',')");
  // Sold: 3 of Face Oil 1 oz and 1 Oil mini earlier in this test; the 2 damaged were removed again.
  ok('the totals add up each reason: 4 sold, 1 gifted, none damaged', /Sold:4/.test(tiles) && /Damaged:0/.test(tiles) && /Gifted:1/.test(tiles) && /Marketing:0/.test(tiles), tiles);
  ok('sold at cost: 3 x $2.80 + 1 x $1.00', (await page.evaluate("Array.from(document.querySelectorAll('.rp-tile')).find(function(t){return /Sold/.test(t.textContent);}).querySelector('.rp-c').textContent")) === '$9.40 at cost');
  ok('there is a row for this month', /October 2026/.test(await page.evaluate("document.getElementById('rp-months').textContent")));
  ok('and a row per product, most units out first', (await page.evaluate("document.querySelector('#rp-prods tbody tr td').textContent")) === 'Face Oil 1 oz');
  // An entry from before costs were recorded uses today's cost, marked ~
  await page.evaluate("var ps=JSON.parse(localStorage.getItem('plume-products-v1')); ps.find(function(p){return p.id==='mo';}).stockLog.push({id:'old1',date:'2026-09-02',qty:-2,kind:'out',reason:'marketing',note:''}); localStorage.setItem('plume-products-v1', JSON.stringify(ps)); Plume.Store.init(function(){ openReport(); });");
  await page.waitForTimeout(150);
  ok('an older change without a recorded cost is estimated and marked ~', /~\$/.test(await page.evaluate("document.getElementById('rp-months').textContent")) &&
     /before costs were recorded/.test(await page.evaluate("document.getElementById('rp-foot').textContent")));
  ok('September gets its own row', /September 2026/.test(await page.evaluate("document.getElementById('rp-months').textContent")));
  await page.evaluate("rpRange='all'; renderReport()");
  ok('All time is a range choice', await page.evaluate("Array.from(document.querySelectorAll('#rp-range .ps-chip')).some(function(b){return b.classList.contains('on') && b.textContent==='All time';})"));
  await page.evaluate("closeReport()");

  console.log('\n7. Older packs and the rest');
  await page.evaluate("openProduct('old')");
  ok('an older pack keeps its kind, with a note on how to make a kit', await page.evaluate(
    "document.getElementById('kind-btn-multi').classList.contains('on') && !document.getElementById('kind-btn-multi').hidden && document.getElementById('multi-mode-fields').textContent.indexOf('A kit of products') !== -1"));
  await page.evaluate("leaveEditor(); openProduct('mo')");
  const msg = [];
  await page.evaluate("window.PLUME_TEST_ANSWER = false");
  const delMsg = await page.evaluate("var m=''; var real=Plume.ask; Plume.ask=function(t){ m=t; }; deleteProduct(); Plume.ask=real; m");
  ok('deleting a kit part names the kit', delMsg.indexOf('Duo Kit') !== -1, delMsg);

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
