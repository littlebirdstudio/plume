// Cost to make (2026-10-26, v1.59): each fill and kit build records what one
// unit cost to make and package that day (ingredients at the prices in use,
// plus packaging); a sidebar panel shows it per product over time. Fills
// from before costs were recorded use today's cost, marked ~ (her call).
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const lot = (id, cpg) => ({ id: id, supplier: 'Lotioncrafter', qtyPurchased: '1000', qtyUnit: 'g', costPerG: String(cpg), received: '2026-05-01' });
const INGS = [
  { id: 'ij', name: 'Jojoba oil', inci: 'Simmondsia Chinensis Seed Oil', phase: 'oil', lots: [lot('L1', 0.04)], activeLotId: 'L1' },
  { id: 'ir', name: 'Rosehip seed oil', inci: 'Rosa Canina Seed Oil', phase: 'oil', lots: [lot('L1', 0.15)], activeLotId: 'L1' },
  { id: 'ix', name: 'Shea butter', inci: 'Butyrospermum Parkii Butter', phase: 'oil', lots: [{ id: 'L1', supplier: 'Lotioncrafter', qtyPurchased: '450', qtyUnit: 'g', costPerG: '0.02', received: '2026-05-01' }], activeLotId: 'L1' }
];
const FORMS = [{ id: 'fo', name: 'Face oil', type: 'Face oil', lines: [{ ingId: 'ij', pct: '60' }, { ingId: 'ir', pct: '40' }],
  variants: [{ vid: 'v1', num: 1, lines: [{ ingId: 'ij', pct: '60' }, { ingId: 'ir', pct: '40' }], batchSize: '100' }], activeVariantId: 'v1' }];
const buy = (n, total) => [{ id: 'b1', date: '2026-05-01', qty: n, totalCost: total, shipping: 0 }];
const PKGS = [
  { id: 'k1', kind: 'dropper', capacity: '1 oz', color: 'Amber', material: 'Glass', purchases: buy(24, 18) },
  { id: 'lb', kind: 'label', capacity: '2 × 1 in', part: 'Front', purchases: buy(100, 20) },
  { id: 'bx', kind: 'box', capacity: '4 × 4 in', purchases: buy(10, 10) }
];
const BATCHES = [{ id: 'b1', date: '2026-10-01', formulaId: 'fo', formulaName: 'Face oil', formulaType: 'Face oil', batchName: 'October', actualYield: 1000,
  status: 'ready', batchType: 'production', ingredientSnapshot: [], packagingRuns: [], committed: true, lotDraws: [], packagingDraws: [], lotCode: '261001' },
  { id: 'b2', date: '2026-10-02', formulaId: 'fo', formulaName: 'Face oil', formulaType: 'Face oil', batchName: 'Second', actualYield: 980, targetYield: 1000,
  status: 'ready', batchType: 'production', packagingRuns: [], committed: true, lotDraws: [], packagingDraws: [], lotCode: '261002',
  ingredientSnapshot: [{ ingredientId: 'ij', ingredientName: 'Jojoba oil', grams: 600 }, { ingredientId: 'ir', ingredientName: 'Rosehip seed oil', grams: 400 }] }];
const PRODUCTS = [
  { id: 'p1', name: 'Face oil 30 mL', status: 'active', formulaId: 'fo', netWtG: 28, netWtDisplay: '1 fl oz', retail: 30,
    packagingRecipe: [{ packagingId: 'k1', quantity: 1 }, { packagingId: 'lb', quantity: 1 }],
    wholesale: 6, productionRuns: [{ id: 'old', date: '2026-06-02', units: 10, fill: true, draws: [{ batchId: 'gone', grams: 280, lot: '260601' }], packaging: [] }] },
  { id: 'kt', name: 'Gift set', status: 'active', productKind: 'kit', kitParts: [{ id: 'q1', productId: 'p1', qty: 2 }],
    packagingRecipe: [{ packagingId: 'bx', quantity: 1 }], productionRuns: [] },
  { id: 'pn', name: 'Face oil mini', status: 'active', formulaId: 'fo', netWtG: 5, packagingRecipe: [], productionRuns: [] }
];

(async () => {
  const browser = await chromium.launch();
  const errors = [], dialogs = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => errors.push(String(e)));
  await trackDialogs(page, dialogs);
  await page.goto(previewUrl('costing'));
  await page.waitForTimeout(300);
  await page.evaluate(`
    localStorage.clear();
    localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(INGS))});
    localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});
    localStorage.setItem('aerie-packaging-v2', ${JSON.stringify(JSON.stringify(PKGS))});
    localStorage.setItem('aerie-batches-v1', ${JSON.stringify(JSON.stringify(BATCHES))});
    localStorage.setItem('plume-products-v1', ${JSON.stringify(JSON.stringify(PRODUCTS))});
    localStorage.setItem('plume_costing_listorder_v1', '1');
    localStorage.setItem('plume-theme', 'light');`);
  await page.reload();
  await page.waitForTimeout(500);
  const stored = () => page.evaluate("JSON.parse(localStorage.getItem('plume-products-v1'))");

  console.log('\n1. The split adds up, and agrees with Products & Costing');
  // 28 g at (0.6 × 0.04 + 0.4 × 0.15) = $0.084/g → $2.352; bottle $0.75 + label $0.20.
  const parts = await page.evaluate("Plume.productCostParts(JSON.parse(localStorage.getItem('plume-products-v1'))[0])");
  ok('ingredients and packaging for one unit', Math.abs(parts.ing - 2.352) < 1e-9 && Math.abs(parts.pkg - 0.95) < 1e-9 && Math.abs(parts.total - 3.302) < 1e-9, parts);
  ok('the total is the same figure the product editor shows, for every product', await page.evaluate(
    "products.every(function (p) { return Math.abs(Plume.productCostParts(p).total - computeProductCost(p).totalCost) < 1e-9 && Math.abs(Plume.productUnitCost(p) - computeProductCost(p).totalCost) < 1e-9; })"));

  console.log('\n2. A fill records what one unit cost that day');
  await page.evaluate("openProduct('p1'); setEdTab('runs')"); await page.waitForTimeout(300);
  await page.fill('#run-units', '6');
  await page.evaluate("addRun()"); await page.waitForTimeout(250);
  let p1 = (await stored()).find(p => p.id === 'p1');
  let fill = p1.productionRuns.find(r => r.id !== 'old');
  ok('the new fill carries the unit cost and its split', fill && fill.unitCost === 3.302 && fill.ingCost === 2.352 && fill.pkgCost === 0.95, fill);
  ok('the older fill is left as it was (no cost added after the fact)', !('unitCost' in p1.productionRuns.find(r => r.id === 'old')));

  // A dearer rosehip lot: today changes, the recorded fill does not.
  await page.evaluate(`var l = JSON.parse(localStorage.getItem('aerie-ingredients-v2')); l[1].lots[0].costPerG = '0.25'; localStorage.setItem('aerie-ingredients-v2', JSON.stringify(l)); Plume.Store.refresh('aerie-ingredients-v2');`);
  const today = await page.evaluate("Plume.productUnitCost(JSON.parse(localStorage.getItem('plume-products-v1'))[0])");
  ok('a price change moves today\'s cost (28 g at $0.124/g + $0.95)', Math.abs(today - 4.422) < 1e-9, today);
  p1 = (await stored()).find(p => p.id === 'p1');
  ok('and leaves the recorded fill alone', p1.productionRuns.find(r => r.id === fill.id).unitCost === 3.302);

  console.log('\n3. A kit build records its cost too');
  await page.evaluate("leaveEditor ? leaveEditor() : goList()"); await page.waitForTimeout(200);
  await page.evaluate("openProduct('kt'); setEdTab('runs')"); await page.waitForTimeout(300);
  await page.fill('#run-units', '2');
  await page.evaluate("addRun()"); await page.waitForTimeout(250);
  const kt = (await stored()).find(p => p.id === 'kt');
  const kb = (kt.productionRuns || [])[0];
  // Two face oils at today's $4.422 plus a $1.00 box.
  ok('two face oils at today\'s cost plus the box', kb && kb.kit && Math.abs(kb.unitCost - 9.844) < 1e-6 && Math.abs(kb.ingCost - 8.844) < 1e-6 && kb.pkgCost === 1, kb);

  console.log('\n4. The Analytics page');
  ok('Analytics is a link in the sidebar under Stock, after Stock history', await page.evaluate(
    "var b = document.getElementById('ps-nav-analytics'); !!b && b.previousElementSibling.id === 'ps-nav-history' && b.textContent.trim() === 'Analytics' && b.getAttribute('href') === 'plume-analytics.html'"));
  await page.goto(previewUrl('analytics')); await page.waitForTimeout(500);
  await page.evaluate("setRange('all')"); await page.waitForTimeout(150);
  ok('its own sidebar link is marked as the current page', await page.evaluate("document.getElementById('ps-nav-analytics').classList.contains('on')"));
  const tiles = await page.evaluate("document.getElementById('an-tiles').innerText.replace(/\\s+/g, ' ')");
  // Fills: 10 at today's $4.422 (~, from before costs were noted) + 6 at $3.302; the kit adds only its $1.00 box × 2: $66.03.
  ok('spent making product counts fills, and kits only for their own packaging', /Spent making product ~\$66\.03 16 units filled/.test(tiles), tiles);
  ok('batches made, with their ingredient cost', /Batches made 2 \$124\.00 in ingredients/.test(tiles), tiles);
  ok('on hand now, at cost, split four ways', /On hand now, at cost \$[\d.,]+ products \$[\d.,]+ · bulk \$[\d.,]+ · ingredients \$[\d.,]+ · packaging \$[\d.,]+/.test(tiles), tiles);
  const looks = await page.evaluate("document.getElementById('an-looks').innerText.replace(/\\s+/g, ' ')");
  ok('a wholesale price under twice the cost is flagged', /Prices to look at 1 [^]*Face oil 30 mL 85% at retail · wholesale 1\.4× cost/.test(looks), looks);
  ok('an ingredient in stock that no batch has used is listed, with its value', /Ingredients not used in a while 1 [^]*Shea butter \$9\.00 on hand · not used in a batch yet/.test(looks), looks);
  ok('one a batch used is not', !/Jojoba oil \$/.test(looks), looks);
  const prow = await page.evaluate("document.querySelector('#an-products tr[data-p=\"p1\"]').innerText.replace(/\\s+/g, ' ')");
  ok('the product table: cost today, change, margins, on hand', /Face oil 30 mL Face oil · 1 fl oz \$4\.42 \+34% since \w{3} \d{4} 85% 1\.4× 12/.test(prow), prow);
  await page.evaluate("openProduct('p1')"); await page.waitForTimeout(150);
  ok('clicking a product opens its cost over time: a point per fill, the older one hollow', await page.evaluate("document.querySelectorAll('#an-products .ct-chart .ct-dot').length === 2 && document.querySelectorAll('#an-products .ct-chart .ct-dot.est').length === 1"));
  const fills = await page.evaluate("document.querySelector('#an-products .ct-fills').innerText.replace(/\\s+/g, ' ')");
  ok('and its fills, newest first, with the lot and the split', /Units Ingredients Packaging A unit \w{3} \d+, \d{4} Lot 261001 6 \$2\.35 \$0\.95 \$3\.30 Jun 2, 2026 Lot 260601 10 ~\$3\.47 ~\$0\.95 ~\$4\.42/.test(fills), fills);
  const brow = await page.evaluate("document.getElementById('an-batches').innerText.replace(/\\s+/g, ' ')");
  // 600 g jojoba at $0.04 + 400 g rosehip at $0.25 = $124, over 980 g made.
  ok('the batch table prices a batch and gives its cost per 100 g of what it made', /Second Oct 2, 2026 · Lot 261002 980 g \$124\.00 \$12\.65/.test(brow), brow);
  await page.evaluate("setFocus('~kits')"); await page.waitForTimeout(100);
  ok('focusing narrows the products to the group picked', await page.evaluate("document.querySelectorAll('#an-products tbody tr[data-p]').length === 1 && !!document.querySelector('#an-products tr[data-p=\"kt\"]')"));
  await page.evaluate("setFocus('')");
  await page.evaluate("document.querySelector('.an-k .an-link').click()"); await page.waitForTimeout(350);
  ok('Went out opens Stock history on the same period', await page.evaluate("document.getElementById('ps-peek').classList.contains('open') && document.querySelector('.sh-panel .sh-ranges .ps-chip.on').textContent === 'All time'"));
  await page.evaluate("Plume.peek.close()"); await page.waitForTimeout(200);

  console.log('\n4b. The batch costs agree with the batch panel');
  await page.goto(previewUrl('batchlog')); await page.waitForTimeout(500);
  await page.evaluate("openBatchDetail('b2'); setBatchTab('ings')"); await page.waitForTimeout(300);
  const bt = await page.evaluate("(document.querySelector('#d-snapshot .bt-r.tot') || {}).innerText || ''");
  ok('the batch panel shows the same $124.00', /\$124\.00/.test(bt), bt);
  await page.goto(previewUrl('costing')); await page.waitForTimeout(500);

  console.log('\n5. Reversing a fill takes its point away');
  await page.evaluate("Plume.peek.close()"); await page.waitForTimeout(200);
  await page.evaluate("openProduct('p1'); setEdTab('runs')"); await page.waitForTimeout(300);
  await page.evaluate(`deleteRun(${JSON.stringify(fill.id)})`); await page.waitForTimeout(250);
  ok('the fill is gone, so is its cost', !(await stored()).find(p => p.id === 'p1').productionRuns.some(r => r.id === fill.id));

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
