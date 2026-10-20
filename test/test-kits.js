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

  console.log('\n6. Update stock');
  await page.evaluate("leaveEditor(); openStock()");
  ok('the panel lists every active product with what is on hand', await page.evaluate(
    "document.querySelectorAll('#st-rows .st-row').length === 5 && document.querySelector('#st-rows .st-row[data-pid=\"full\"] .st-have').textContent === '8'"));
  ok('Save waits until something is entered', await page.evaluate("document.getElementById('st-save').disabled"));
  await page.fill('#st-rows input[data-pid="full"]', '3');
  await page.dispatchEvent('#st-rows input[data-pid="full"]', 'input');
  await page.fill('#st-note', 'Market, Oct 18');
  await page.evaluate("stockSearch('spritz')");
  ok('a search keeps what was typed for products it hides', await page.evaluate("stockEntries().length === 1"));
  await page.evaluate("stockSearch('')");
  ok('and it is still in its box after clearing the search', (await page.evaluate("document.querySelector('#st-rows input[data-pid=\"full\"]').value")) === '3');
  await page.evaluate("saveStock()");
  ok('took out 3 at the market', (await onHandOf('full')) === 5 && (await stored()).find(x => x.id === 'full').stockLog[0].note === 'Market, Oct 18');
  await page.evaluate("openStock(); stockMode('count')");
  await page.fill('#st-rows input[data-pid="mo"]', '10');
  await page.dispatchEvent('#st-rows input[data-pid="mo"]', 'input');
  await page.evaluate("saveStock()");
  ok('counted 10 oil minis: on hand is 10', (await onHandOf('mo')) === 10);
  await page.evaluate("openProduct('mo'); setEdTab('runs')");
  ok('the product shows the change in its history', (await page.evaluate("document.getElementById('stock-hist').textContent")).indexOf('Counted 10') !== -1);
  await page.evaluate("undoStockLine(findProduct('mo').stockLog[0].id)");
  await page.waitForTimeout(100);
  ok('and the change can be removed', (await onHandOf('mo')) === 12);
  await page.evaluate("openStock()");
  await page.fill('#st-rows input[data-pid="mo"]', '1.5');
  await page.dispatchEvent('#st-rows input[data-pid="mo"]', 'input');
  await page.evaluate("saveStock()");
  ok('part units are refused', (await onHandOf('mo')) === 12);

  console.log('\n7. Older packs and the rest');
  await page.evaluate("Plume.peek.close(); openProduct('old')");
  ok('an older pack keeps its kind, with a note on how to make a kit', await page.evaluate(
    "document.getElementById('kind-btn-multi').classList.contains('on') && !document.getElementById('kind-btn-multi').hidden && document.getElementById('multi-mode-fields').textContent.indexOf('A kit of products') !== -1"));
  await page.evaluate("leaveEditor(); openProduct('mo')");
  const msg = [];
  await page.evaluate("window.PLUME_TEST_ANSWER = false");
  const said = await page.evaluate("var m=''; var real=Plume.ask; Plume.ask=function(t){ m=t; }; deleteProduct(); Plume.ask=real; m");
  ok('deleting a kit part names the kit', said.indexOf('Duo Kit') !== -1, said);

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
