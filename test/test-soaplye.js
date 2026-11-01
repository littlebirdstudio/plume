// Soap lye and water (2026-11-01, her ask): a soap formula says that lye and
// water come from the Lye calculator; a lye or water line on a soap is
// flagged as counted twice (water stays an ordinary line in skincare); the
// Lye calculator shows the lye from Ingredients (its cost and stock), or,
// when there is none, what that means and a link that opens the starter
// list searched for it.
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}
const olive = { id: 'o', name: 'Olive oil', inci: 'Olea Europaea (Olive) Fruit Oil', phase: 'oil', soap: { naoh: 0.135, koh: 0.19 },
  lots: [{ id: 'lo', costPerG: '0.01', stockG: '5000' }], activeLotId: 'lo' };
const lye = { id: 'n', name: 'Sodium hydroxide (lye, NaOH)', inci: 'Sodium Hydroxide', phase: 'water',
  lots: [{ id: 'ln', costPerG: '0.02', qtyPurchased: '800', qtyUnit: 'g' }], activeLotId: 'ln' };
const water = { id: 'w', name: 'Distilled water', inci: 'Aqua', phase: 'water', lots: [] };
const hydrosol = { id: 'h', name: 'Rose hydrosol', inci: 'Rosa Damascena Flower Water', phase: 'water', lots: [] };
function form(id, type, lines) {
  const v = { vid: id + 'v', num: 1, label: '', status: 'draft', lines, instructions: '', batchSize: '1000', addinsInTotal: false, usageLog: [], history: [],
    soapSettings: { superfat: 5, lyeType: 'naoh', lyeMethod: 'concentration', lyeConc: 33 } };
  return { id, name: type, type, status: 'draft', lines, batchSize: '1000', notes: '', formNotes: '', variants: [v], activeVariantId: v.vid };
}
const soapPlain = form('s1', 'Cold Process Soap', [{ ingId: 'o', pct: '100' }]);
const soapTwice = form('s2', 'Cold Process Soap', [{ ingId: 'o', pct: '90' }, { ingId: 'n', pct: '5' }, { ingId: 'w', pct: '5' }]);
const toner = form('t1', 'Toner / mist', [{ ingId: 'w', pct: '50' }, { ingId: 'h', pct: '50' }]);

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (lib, forms) => {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await trackDialogs(page, []);
    await page.goto(previewUrl('formulations'));
    await page.evaluate(([i, f]) => { localStorage.clear(); localStorage.setItem('aerie-ingredients-v2', i); localStorage.setItem('aerie-formulations-v1', f); },
      [JSON.stringify(lib), JSON.stringify(forms)]);
    await page.goto(previewUrl('formulations')); await page.waitForTimeout(400);
    return page;
  };
  const shown = (sel) => "(function(){var e=document.querySelector('" + sel + "');return !!e && !e.hidden && e.offsetParent !== null;})()";

  console.log('\n1. Lye in Ingredients: shown in the Lye calculator');
  {
    const page = await open([olive, lye, water, hydrosol], [soapPlain, soapTwice, toner]);
    await page.evaluate("openFormula('s1')"); await page.waitForTimeout(250);
    ok('a soap says lye and water are calculated', await page.evaluate(shown('#soap-calc-note')));
    const lib = await page.evaluate("(document.querySelector('#lye-result .lye-lib')||{}).textContent || ''");
    // 1000 g olive x 0.135 x 0.95 = 128.25 g NaOH; at $0.02/g = $2.565, shown $2.56
    ok('the lye from Ingredients, its cost and stock', /From Sodium hydroxide \(lye, NaOH\): \$2\.56 in the cost · 800 g in stock/.test(lib), lib);
    ok('and that a committed batch takes it', /takes it from stock/.test(lib));
    ok('no warning on a plain soap', await page.evaluate("!document.querySelector('.soap-twice')"));

    console.log('\n2. Lye or water as a line on a soap');
    await page.evaluate("openFormula('s2')"); await page.waitForTimeout(250);
    const w = await page.evaluate("Array.prototype.map.call(document.querySelectorAll('.soap-twice'),function(e){return e.textContent;})");
    ok('both lines are flagged', w.length === 2 && /Lye is calculated/.test(w.join()) && /Water is calculated/.test(w.join()), w);

    console.log('\n3. Skincare is unchanged');
    await page.evaluate("openFormula('t1')"); await page.waitForTimeout(250);
    ok('no soap note', !(await page.evaluate(shown('#soap-calc-note'))));
    ok('water is an ordinary line, a hydrosol too', await page.evaluate("!document.querySelector('.soap-twice') && document.querySelectorAll('#phase-groups .ing-row').length === 2"));
    await page.close();
  }

  console.log('\n4. No lye in Ingredients: said plainly, with a way to add it');
  {
    const page = await open([olive], [soapPlain]);
    await page.evaluate("openFormula('s1')"); await page.waitForTimeout(250);
    const miss = await page.evaluate("(document.querySelector('#lye-result .lye-lib.miss')||{}).textContent || ''");
    ok('what it means', /Sodium hydroxide is not in Ingredients, so it is not in the cost and is not taken from stock/.test(miss), miss);
    ok('the link opens the starter list, searched', await page.evaluate("document.querySelector('#lye-result .lye-lib.miss a').getAttribute('href') === 'plume-ingredients.html#quickadd=Sodium%20hydroxide'"));
    await page.evaluate("document.getElementById('soap-lye-type').value='koh'; recalcSoap();"); await page.waitForTimeout(100);
    ok('for KOH it names potassium hydroxide', /Potassium hydroxide is not in Ingredients/.test(await page.evaluate("document.querySelector('#lye-result .lye-lib.miss').textContent")));
    await page.close();
  }

  console.log('\n5. The starter list opens searched');
  {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await trackDialogs(page, []);
    await page.goto(previewUrl('ingredients') + '#quickadd=Sodium%20hydroxide'); await page.waitForTimeout(500);
    ok('the search is filled in', await page.evaluate("document.getElementById('seeder-search').value === 'Sodium hydroxide'"));
    ok('and sodium hydroxide is listed', /Sodium hydroxide \(lye, NaOH\)/.test(await page.evaluate("document.getElementById('modal-seeder').innerText")));
    ok('the link is cleared once followed', await page.evaluate("location.hash === ''"));
    await page.close();
  }

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
