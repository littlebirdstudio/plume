// Packaging cost per unit: the average cost of what is on hand (her call,
// 2026-11-04: "I don't actually know which 10 mL amber bottle stock I am
// pulling from anyway"). Before, the newest priced purchase repriced every
// unit on the shelf the moment a reorder was entered, even while on order.
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}
const near = (a, b) => a !== null && Math.abs(a - b) < 1e-9;
const buy = (date, qty, total, extra) => Object.assign({ date, qty: String(qty), totalCost: String(total) }, extra || {});
const take = (date, qty) => ({ id: 'a' + date + qty, date, qty: -qty });

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await trackDialogs(page, []);
  await page.goto(previewUrl('packaging'));
  const cost = (it) => page.evaluate((x) => Plume.pkgUnitCostOf(x), it);

  console.log('\n1. The rule');
  ok('one purchase: its price', near(await cost({ purchases: [buy('2026-10-01', 10, 10)] }), 1));
  ok('a reorder at a higher price blends in by count: (4 x $1.00 + 10 x $1.50) / 14',
     near(await cost({ purchases: [buy('2026-10-01', 10, 10), buy('2026-10-10', 10, 15)], adjustments: [take('2026-10-05', 6)] }), 19 / 14));
  ok('using stock does not change the average', near(await cost({ purchases: [buy('2026-10-01', 10, 10), buy('2026-10-10', 10, 15)],
     adjustments: [take('2026-10-05', 6), take('2026-10-20', 9)] }), 19 / 14));
  ok('the old rule would have said $1.50; this is lower while the cheaper ones last', (await cost({ purchases: [buy('2026-10-01', 10, 10), buy('2026-10-10', 10, 15)], adjustments: [take('2026-10-05', 6)] })) < 1.5);
  ok('a reorder still on order does not count yet', near(await cost({ purchases: [buy('2026-10-01', 10, 10), buy('2026-10-10', 10, 15, { onOrder: true })] }), 1));
  ok('once stock ran out, the next purchase starts fresh at its own price',
     near(await cost({ purchases: [buy('2026-10-01', 10, 10), buy('2026-10-10', 10, 15)], adjustments: [take('2026-10-05', 10)] }), 1.5));
  ok('and after stock went below zero, too',
     near(await cost({ purchases: [buy('2026-10-01', 10, 10), buy('2026-10-10', 10, 15)], adjustments: [take('2026-10-05', 12)] }), 1.5));
  ok('a purchase with no price adds units at the average', near(await cost({ purchases: [buy('2026-10-01', 10, 10), buy('2026-10-02', 10, 0)] }), 1));
  ok('then a priced one blends with all of them: (20 x $1 + 10 x $2.50) / 30',
     near(await cost({ purchases: [buy('2026-10-01', 10, 10), buy('2026-10-02', 10, 0), buy('2026-10-03', 10, 25)] }), 45 / 30));
  ok('on the same day, a purchase comes before what is taken out',
     near(await cost({ purchases: [buy('2026-10-01', 5, 5), buy('2026-10-10', 10, 20)], adjustments: [take('2026-10-10', 5)] }), (0 * 1 + 10 * 2) / 10) === false &&
     near(await cost({ purchases: [buy('2026-10-01', 5, 5), buy('2026-10-10', 10, 20)], adjustments: [take('2026-10-10', 5)] }), (5 * 1 + 10 * 2) / 15));
  ok('a first order still on order has a cost (its own price)', near(await cost({ purchases: [buy('2026-10-10', 10, 15, { onOrder: true })] }), 1.5));
  ok('nothing priced: no cost', (await cost({ purchases: [buy('2026-10-10', 10, 0)] })) === null);
  ok('no purchases: no cost', (await cost({ purchases: [] })) === null);

  console.log('\n2. Everywhere it is read');
  const wipes = { id: 'w', kind: 'cloth', capacity: '8 × 8 in', color: 'White', material: 'Bamboo', supplier: 'X',
    purchases: [buy('2026-10-01', 10, 10), buy('2026-10-10', 10, 15)], adjustments: [take('2026-10-05', 6)] };
  await page.evaluate((it) => { localStorage.clear(); localStorage.setItem('aerie-packaging-v2', JSON.stringify([it])); }, wipes);
  await page.goto(previewUrl('packaging')); await page.waitForTimeout(500);
  const row = await page.evaluate("document.querySelector('tr.pk-row').innerText.replace(/\\s+/g,' ')");
  ok('the Packaging list shows the average', /\$1\.36/.test(row), row);
  ok('inventory value is units on hand at the average', near(await page.evaluate("Plume.pkValue(JSON.parse(localStorage.getItem('aerie-packaging-v2'))[0])"), 14 * 19 / 14));
  const pc = await page.evaluate("Plume.productCostParts({ packagingRecipe: [{ packagingId: 'w', quantity: '2' }] }, { pkgs: JSON.parse(localStorage.getItem('aerie-packaging-v2')), forms: [], ings: [], products: [] }).pkg");
  ok('a product\'s packaging cost uses it', near(pc, 2 * 19 / 14), pc);
  await page.evaluate("openEdit('w')"); await page.waitForTimeout(300);
  const panel = await page.evaluate("document.getElementById('modal-cost-per-unit').textContent + ' | ' + document.getElementById('modal-cost-note').textContent");
  ok('the edit panel shows it and says what it is', /^\$1\.3571 \| average of what is on hand, shipping not included$/.test(panel), panel);
  await page.evaluate("saveItem()"); await page.waitForTimeout(300);
  ok('saving keeps its stock moves and stores the same cost for older readers',
     await page.evaluate("(function(){var i=JSON.parse(localStorage.getItem('aerie-packaging-v2'))[0];return i.adjustments.length===1 && i.cost==='1.3571';})()"));

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
