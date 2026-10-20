// Size (2026-10-20): one scale for the whole app, chosen in Settings and
// kept on this device. Standard is the original size. Pop-ups placed from
// an element's box still line up under it at every size.
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}
const stock = (n) => [{ id: 'p' + n, date: '2026-09-01', qty: n, totalCost: n, shipping: 0 }];
const DATA = {
  'aerie-ingredients-v2': [{ id: 'a1', name: 'Jojoba oil', inci: 'Simmondsia Chinensis Seed Oil', lots: [] }, { id: 'a2', name: 'Rosehip oil', inci: 'Rosa Canina Fruit Oil', lots: [] }, { id: 'a3', name: 'Squalane', inci: 'Squalane', lots: [] }],
  'aerie-formulations-v1': [{ id: 'fo', name: 'Face oil', type: 'Face oil', lines: [{ ingId: 'a1', pct: 100 }], variants: [{ vid: 'v1', num: 1, status: 'draft', lines: [{ ingId: 'a1', pct: 100 }] }], activeVariantId: 'v1' }],
  'aerie-packaging-v2': [{ id: 'd5', kind: 'dropper', capacity: '5 mL', color: 'Amber', material: 'Glass', purchases: stock(40) }, { id: 'd10', kind: 'dropper', capacity: '10 mL', color: 'Amber', material: 'Glass', purchases: stock(24) }],
  'plume-products-v1': [{ id: 'o10', name: 'Face Oil 10 mL', status: 'active', formulaId: 'fo', netWtG: 9, packagingRecipe: [{ packagingId: 'd10', quantity: 1 }], productionRuns: [] }]
};

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errors.push(String(e)));
  await trackDialogs(page, []);
  await page.goto(previewUrl('costing'));
  await page.evaluate("localStorage.clear(); localStorage.setItem('plume-theme', 'light'); localStorage.setItem('plume_costing_listorder_v1', '1');" +
    Object.keys(DATA).map(k => "localStorage.setItem('" + k + "', " + JSON.stringify(JSON.stringify(DATA[k])) + ");").join(''));
  await page.reload(); await page.waitForTimeout(500);

  console.log('\n1. The setting');
  ok('Standard is the original size: no zoom', await page.evaluate("Plume.sizeChoice() === 'standard' && Plume.zoom() === 1 && !document.documentElement.style.zoom"));
  await page.evaluate("openSettings()"); await page.waitForTimeout(200);
  ok('Settings offers Smaller, Standard and Larger, inside the dialog', await page.evaluate(
    "var el=document.getElementById('plume-theme-choice'); !!el.closest('.modal') && /Smaller[\\s\\S]*Standard[\\s\\S]*Larger/.test(el.innerText)"));
  await page.evaluate("Array.from(document.querySelectorAll('#plume-theme-choice .plume-theme-opt')).find(b => b.textContent === 'Smaller').click()");
  ok('Smaller scales the whole page at once', (await page.evaluate("document.documentElement.style.zoom")) === '0.8');
  await page.reload(); await page.waitForTimeout(500);
  ok('and is kept on this device', (await page.evaluate("document.documentElement.style.zoom")) === '0.8');

  console.log('\n2. Pop-ups line up at every size');
  for (const size of ['smaller', 'standard', 'larger']) {
    await page.evaluate("localStorage.setItem('plume-size', '" + size + "')");
    await page.goto(previewUrl('costing')); await page.waitForTimeout(500);
    await page.evaluate("openProduct('o10')"); await page.waitForTimeout(200);
    await page.click('#pkg-recipe-body .pk-pick-btn'); await page.waitForTimeout(150);
    const g = await page.evaluate("var b=document.querySelector('#pkg-recipe-body .pk-pick-btn').getBoundingClientRect(), p=document.querySelector('.pk-pop').getBoundingClientRect(); [Math.round(p.left - b.left), Math.round(p.top - b.bottom)]");
    ok(size + ': the packaging list opens just under its button', Math.abs(g[0]) <= 1 && g[1] >= 0 && g[1] <= 7, g);
    await page.keyboard.press('Escape');
    await page.goto(previewUrl('formulations')); await page.waitForTimeout(500);
    await page.evaluate("openFormula('fo')"); await page.waitForTimeout(300);
    await page.click('#ing-search'); await page.keyboard.type('o'); await page.waitForTimeout(250);
    const d = await page.evaluate("var s=document.getElementById('ing-search').getBoundingClientRect(), d=document.getElementById('ing-dd').getBoundingClientRect(); [Math.round(d.left - s.left), Math.round(d.top - s.bottom)]");
    ok(size + ': the ingredient list opens just under the search box', Math.abs(d[0]) <= 1 && d[1] >= 0 && d[1] <= 7, d);
    ok(size + ': the page fits the window without sideways scroll', await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"));
  }

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
