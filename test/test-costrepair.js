// One-time repair (2026-10-26, v1.56): lots bought by volume with no density
// set had been priced as if they weighed like water, and that price was
// saved. On the next load each such lot is repriced at the density Plume now
// uses; a price she typed, a lot with a density set, and water-like
// ingredients are left alone. Ingredients lists the changes once.
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}
const lot = (id, size, unit, price, cpg, extra) => Object.assign({ id: id, supplier: 'X', purchaseSize: String(size), purchaseUnit: unit, purchasePrice: String(price), costPerG: String(cpg), qtyPurchased: String(size), qtyUnit: unit }, extra || {});
const INGS = [
  // Old water figure: 14.99 / 100 mL = 0.1499. Squalane is 0.81 g/mL by INCI: 0.1851.
  { id: 'sq', name: 'Squalane', inci: 'Squalane', phase: 'oil', functionCategory: ['Emollient'], lots: [lot('L1', 100, 'mL', 14.99, '0.1499'), lot('L2', 32, 'fl oz', 60.99, '0.0644')], activeLotId: 'L1' },
  // Glycerin, 4 fl oz at $2.99: water figure 0.0253, at 1.26 g/mL 0.0201.
  { id: 'gl', name: 'Glycerin', inci: 'Glycerin', phase: 'water', lots: [lot('L1', 4, 'fl oz', 2.99, '0.0253')], activeLotId: 'L1' },
  // A price she typed (not the water figure): untouched.
  { id: 'jo', name: 'Jojoba oil', inci: 'Simmondsia Chinensis Seed Oil', phase: 'oil', lots: [lot('L1', 32, 'fl oz', 35.99, '0.0500')], activeLotId: 'L1' },
  // Density set on the ingredient and priced with it: untouched.
  { id: 'ba', name: 'Baobab oil', inci: 'Adansonia Digitata Seed Oil', phase: 'oil', density: '0.92', lots: [lot('L1', 32, 'fl oz', 39.99, '0.0459')], activeLotId: 'L1' },
  // Water-like (no density known): untouched.
  { id: 'hy', name: 'Rose hydrosol', inci: 'Rosa Damascena Flower Water', phase: 'water', lots: [lot('L1', 5, 'fl oz', 5.98, '0.0404')], activeLotId: 'L1' },
  // Bought by weight: untouched.
  { id: 'sh', name: 'Shea butter', inci: 'Butyrospermum Parkii Butter', phase: 'oil', lots: [lot('L1', 1, 'lb', 9.5, '0.0209')], activeLotId: 'L1' }
];
const SEED = `
  localStorage.clear();
  localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(INGS))});
  localStorage.setItem('aerie-formulations-v1', '[]');
  localStorage.setItem('plume-theme', 'light');`;
const cpgs = "JSON.parse(localStorage.getItem('aerie-ingredients-v2')).map(function (i) { return i.id + ':' + i.lots.map(function (l) { return l.costPerG; }).join('/'); }).join(' ')";

(async () => {
  const browser = await chromium.launch();
  const errors = [], dialogs = [];
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('pageerror', e => errors.push(String(e)));
  // The costing page boots first: the repair runs on any page, before it reads.
  await page.goto(previewUrl('costing')); await page.evaluate(SEED); await page.reload(); await page.waitForTimeout(500);
  const after = await page.evaluate(cpgs);
  ok('Squalane bought in mL and fl oz: repriced at 0.81 g/mL', /sq:0\.1851\/0\.0796/.test(after), after);
  ok('Glycerin: repriced down at 1.26 g/mL', /gl:0\.0201/.test(after), after);
  ok('a price she typed, a set density, a water-like hydrosol and a lot by weight are untouched', /jo:0\.0500/.test(after) && /ba:0\.0459/.test(after) && /hy:0\.0404/.test(after) && /sh:0\.0209/.test(after), after);
  const rec = await page.evaluate("JSON.parse(localStorage.getItem('plume-fix-volcpg-v1'))");
  ok('the changes are kept for Ingredients to show', rec && rec.changes.length === 3 && rec.shown === false, rec);
  ok('the page already priced with the repaired figures', await page.evaluate("Math.abs(Plume.costPerG(ings.filter(function (i) { return i.id === 'sq'; })[0]) - 0.1851) < 1e-9"));
  // Ingredients shows the list once.
  await trackDialogs(page, dialogs);
  await page.goto(previewUrl('ingredients')); await page.waitForTimeout(600);
  const shown = dialogs.slice();
  ok('Ingredients says what changed, once', shown.length === 1 && /Corrected 3 lot prices/.test(shown[0]) && /Squalane/.test(shown[0]) && /Glycerin/.test(shown[0]) && /0\.1499/.test(shown[0]) && /0\.1851/.test(shown[0]), shown);
  dialogs.length = 0;
  await page.reload(); await page.waitForTimeout(500);
  ok('and not again', dialogs.length === 0, dialogs);
  // Runs once: a later wrong-looking price is not touched again.
  await page.evaluate("var a = JSON.parse(localStorage.getItem('aerie-ingredients-v2')); a[0].lots[0].costPerG = '0.1499'; localStorage.setItem('aerie-ingredients-v2', JSON.stringify(a));");
  await page.reload(); await page.waitForTimeout(400);
  ok('it runs only once', /sq:0\.1499/.test(await page.evaluate(cpgs)));
  // The dialog shows a table, with every value escaped.
  const p2 = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  p2.on('pageerror', e => errors.push(String(e)));
  await p2.goto(previewUrl('ingredients')); await p2.evaluate(SEED); await p2.waitForTimeout(300);
  await p2.evaluate("localStorage.removeItem('plume-fix-volcpg-v1'); var a = JSON.parse(localStorage.getItem('aerie-ingredients-v2')); a[1].name = '<img src=x onerror=window.PWN=1>'; a[1].lots[0].costPerG = '0.0253'; localStorage.setItem('aerie-ingredients-v2', JSON.stringify(a));");
  await p2.reload(); await p2.waitForTimeout(600);
  ok('the list is a table and an odd name is shown as text', await p2.evaluate("!!document.querySelector('.plume-dlg table.fixvol') && window.PWN === undefined && /<img/.test(document.querySelector('.plume-dlg').textContent)"));
  await p2.screenshot({ path: '/tmp/claude-0/-home-claude/7cb246fb-9bc7-57b0-9340-741090c7c61e/scratchpad/fixvol.png' });

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
