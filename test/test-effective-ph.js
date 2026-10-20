// Effective pH (2026-10-20, v1.37). The ingredient field once labelled
// "Optimal pH" is now "Effective pH range" (her point: optimal is not the
// same as functional; outside its range a preservative may not protect the
// product). Formulations warns when a version's target pH falls outside an
// ingredient's range, and Batches when a batch's final pH does. The starter
// list's ten preservatives carry ranges from manufacturer data, offered to
// her library through a review.
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const INGS = [
  { id: 'iw', name: 'Distilled water', inci: 'Aqua', phase: 'water', lots: [] },
  { id: 'ip', name: 'Optiphen Plus', inci: 'Phenoxyethanol (and) Caprylyl Glycol (and) Sorbic Acid', phase: 'cool-down', functionCategory: ['Preservative'], optimalPh: '4 – 6', lots: [] },
  { id: 'ig', name: 'Liquid Germall Plus', inci: 'Propylene Glycol (and) Diazolidinyl Urea (and) Iodopropynyl Butylcarbamate', phase: 'cool-down', function: 'Preservative, broad spectrum', lots: [] },
  { id: 'ix', name: 'Xanthan gum', inci: 'Xanthan Gum', phase: 'water', functionCategory: ['Thickener'], optimalPh: '3 to 12, with better results above 4', lots: [] },
  { id: 'ie', name: 'Euxyl K 903', inci: 'Benzyl Alcohol (and) Benzoic Acid', phase: 'cool-down', functionCategory: ['Preservative'], lots: [] }
];
const V = (vid, lines, ph) => Object.assign({ vid: vid, num: 1, label: '', status: 'draft', lines: lines, instructions: '', batchSize: 100, usageLog: [], history: [] }, ph || {});
const mist = [{ ingId: 'iw', pct: 98 }, { ingId: 'ip', pct: 1 }, { ingId: 'ix', pct: 0.5 }, { ingId: 'ig', pct: 0.5 }];
const FORMS = [
  { id: 'fm', name: 'Hydrating mist', type: 'Toner / mist', status: 'draft', lines: mist, variants: [V('v1', mist, { phMin: '5.5', phMax: '6.5' })], activeVariantId: 'v1', phMin: '5.5', phMax: '6.5' }
];
const BATCHES = [{ id: 'b1', date: '2026-10-10', lotCode: '261010', formulaId: 'fm', formulaName: 'Hydrating mist', formulaType: 'Toner / mist', batchName: 'Mist', actualYield: 200,
  status: 'ready', batchType: 'production', committed: true, lotDraws: [], packagingRuns: [], packagingDraws: [], phMin: '5.5', phMax: '6.5',
  ingredientSnapshot: [{ ingredientId: 'iw', ingredientName: 'Distilled water', grams: 196 }, { ingredientId: 'ip', ingredientName: 'Optiphen Plus', grams: 2 }] }];
const SEED = `
  localStorage.clear();
  localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(INGS))});
  localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});
  localStorage.setItem('aerie-batches-v1', ${JSON.stringify(JSON.stringify(BATCHES))});
  localStorage.setItem('plume-products-v1', '[]');
  localStorage.setItem('plume-theme', 'light');`;

(async () => {
  const browser = await chromium.launch();
  const errors = [], dialogs = [];
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await trackDialogs(page, dialogs);

  console.log('\n1. Reading a range');
  await page.goto(previewUrl('formulations'));
  const rd = await page.evaluate(`['4.0 – 5.5', '3 to 6, with better efficacy at lower pH', 'Marketed between 3 – 8, but preferably below 5.5', 'up to 5', 'below 6', '4+', 'above 4.5', 'neutral', '5', '3,5-8']
    .map(function (t) { var r = Plume.effPhRange(t); return r ? (r.min === null ? '' : r.min) + '..' + (r.max === null ? '' : r.max) : '-'; }).join(' | ')`);
  ok('ranges, open sides and the first range of a sentence are read; anything else is not', rd === '4..5.5 | 3..6 | 3..8 | ..5 | ..6 | 4.. | 4.5.. | - | - | 3.5..8', rd);
  ok('a range reads back as text', await page.evaluate("Plume.effPhText({ min: 4, max: 6 }) === '4–6' && Plume.effPhText({ min: null, max: 5 }) === 'up to 5' && Plume.effPhText({ min: 4, max: null }) === 'from 4'"));
  ok('a preservative is known by its function or its function text', await page.evaluate("Plume.isPreservative({ functionCategory: ['Preservative'] }) && Plume.isPreservative({ function: 'Preservative (mold/yeast)' }) && Plume.isPreservative({ function: 'Broad-spectrum preservative' }) && !Plume.isPreservative({ function: 'Chelating agent, preservative booster' })"));

  console.log('\n2. Formulations: the target against each range');
  await page.evaluate(SEED); await page.reload(); await page.waitForTimeout(500);
  await page.evaluate("openFormula('fm')"); await page.waitForTimeout(300);
  const warn = () => page.evaluate("document.getElementById('ph-range-warn').hidden ? '' : document.getElementById('ph-range-warn').innerText.replace(/\\s+/g, ' ')");
  let w = await warn();
  ok('a target reaching above a preservative\'s range is named', /Target reaches pH 6\.5, above where Optiphen Plus is effective \(4–6\)/.test(w), w);
  ok('an ingredient whose range covers the target says nothing', !/Xanthan/.test(w), w);
  ok('a preservative with no range recorded is pointed out, not guessed', /No effective pH range is recorded for Liquid Germall Plus/.test(w), w);
  ok('the names link to the ingredient', await page.evaluate("Array.from(document.querySelectorAll('#ph-range-warn a')).map(a => a.getAttribute('href')).join(' ')") === 'plume-ingredients.html#ing=ip plume-ingredients.html#ing=ig');
  ok('an ingredient not in the recipe is not checked', !/Euxyl/.test(w));
  await page.fill('#f-ph-max', '5.8'); await page.waitForTimeout(100);
  w = await page.evaluate("document.getElementById('ph-range-warn').innerText");
  ok('bringing the target inside clears the warning as it is typed', !/Optiphen Plus/.test(w) && /Liquid Germall Plus/.test(w), w);
  await page.fill('#f-ph-min', '3'); await page.waitForTimeout(100);
  ok('a target starting below a range is named too', /Target starts at pH 3, below where Optiphen Plus is effective \(4–6\)/.test(await warn()) && /Xanthan gum/.test(await warn()) === false, await warn());
  await page.fill('#f-ph-min', ''); await page.fill('#f-ph-max', ''); await page.waitForTimeout(100);
  ok('with no target, nothing shows', await warn() === '');

  console.log('\n3. Batches: the final pH');
  await page.goto(previewUrl('batchlog')); await page.waitForTimeout(500);
  await page.evaluate("openBatchDetail('b1')"); await page.waitForTimeout(300);
  await page.fill('#d-ph', '6.3'); await page.dispatchEvent('#d-ph', 'input'); await page.waitForTimeout(100);
  const bw = await page.evaluate("document.getElementById('d-ph-range').hidden ? '' : document.getElementById('d-ph-range').innerText");
  ok('a final pH above a range is named, for what went into this batch', /Final pH 6\.3 is above where Optiphen Plus is effective \(4–6\)/.test(bw), bw);
  ok('only ingredients in the batch are checked (the gum and Germall were not used)', !/Xanthan|Germall/.test(bw), bw);
  await page.fill('#d-ph', '5.4'); await page.dispatchEvent('#d-ph', 'input'); await page.waitForTimeout(100);
  ok('inside the range, nothing shows', await page.evaluate("document.getElementById('d-ph-range').hidden"));
  await page.evaluate("closeDetail()"); await page.waitForTimeout(200);

  console.log('\n4. Ingredients: the label and the review');
  await page.goto(previewUrl('ingredients')); await page.waitForTimeout(600);
  ok('the field is labelled Effective pH range', await page.evaluate("Array.from(document.querySelectorAll('label')).some(l => l.textContent.trim() === 'Effective pH range') && !Array.from(document.querySelectorAll('label')).some(l => /Optimal pH/.test(l.textContent))"));
  ok('every preservative in the starter list has a range it can read, and a source', await page.evaluate(`(function () {
    var ps = SEEDER_ITEMS.filter(function (it) { return it.optimalPh; });
    return ps.length === 10 && ps.every(function (it) { return Plume.effPhRange(it.optimalPh) && it.phSource; });
  })()`));
  ok('Quick add brings the range but not the source', await page.evaluate("(function () { var i = starterToIngredient(SEEDER_ITEMS.filter(function (it) { return it.name === 'Optiphen'; })[0]); return i.optimalPh === '4 – 8' && !('phSource' in i); })()"));
  await page.evaluate("openLowdownReview('optimalPh')"); await page.waitForTimeout(200);
  const rv = await page.evaluate("document.getElementById('lowdown-review-body').innerText.replace(/\\s+/g, ' ')");
  ok('the review offers ranges for her ingredients that have none, with the source', /Euxyl K 903 3 – 6 Source: Ashland/.test(rv) && /Liquid Germall Plus 3 – 8/.test(rv), rv);
  ok('and leaves alone a range she has entered', !/Optiphen Plus/.test(rv) && !/Xanthan/.test(rv), rv);
  ok('it is titled for pH and counts ranges', await page.evaluate("document.getElementById('lowdown-title').textContent") === 'Fill in effective pH ranges' && /Add 2 pH ranges/.test(await page.evaluate("document.getElementById('lowdown-apply-btn').textContent")));
  await page.evaluate("applyLowdowns()"); await page.waitForTimeout(200);
  const after = await page.evaluate("JSON.parse(localStorage.getItem('aerie-ingredients-v2')).map(function (i) { return i.id + ':' + (i.optimalPh || '') + (i.chooseWhenDraft ? '!' : ''); }).join(' ')");
  ok('applying fills those two, marks nothing as a draft lowdown, changes nothing else', after === 'iw: ip:4 – 6 ig:3 – 8 ix:3 to 12, with better results above 4 ie:3 – 6', after);
  await page.evaluate("openLowdownReview()"); await page.waitForTimeout(150);
  ok('the lowdown review is still the lowdown review', await page.evaluate("document.getElementById('lowdown-title').textContent") === 'Fill in lowdowns');
  await page.evaluate("closeModal('modal-lowdown')");

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
