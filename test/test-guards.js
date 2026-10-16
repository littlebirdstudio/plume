// Checks the delete guards and the unlock wording. Drives the real page in
// headless Chromium, capturing the text of every native dialog, because the
// whole point of these changes is what the dialog says.
const { chromium } = require('playwright');

const { previewUrl } = require('./helpers');
const URL = previewUrl('formulations');
let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got ? '\n       got: ' + got : '')); }
}

// The formulation every case below acts on. Seeded by the suite rather than
// relied on from the page, so the test says what it needs and a change to any
// sample data elsewhere cannot quietly alter what is being asserted.
const INGS = [
  { id: 'i1', name: 'Shea butter', inci: 'Butyrospermum Parkii (Shea) Butter',
    phase: 'oil', flag: 'no', functionCategory: ['Emollient'], lots: [] }
];

function variant(vid, num, label, status) {
  return {
    vid, num, label, status,
    lines: [{ ingId: 'i1', pct: 100 }],
    instructions: '', batchSize: '100', addinsInTotal: false,
    usageLog: [], history: [], branchedFrom: null, branchNote: '',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z'
  };
}

const FORMS = [{
  id: 'f1', name: 'Lotion bar', type: 'balm', notes: '', formNotes: '',
  variants: [variant('v1', 1, 'Candelilla', 'approved'),
             variant('v2', 2, 'Beeswax sub', 'draft')],
  activeVariantId: 'v1'
}];

// Batches and products that point at the sample formulation f1.
const BATCHES = [
  { id: 'b1', formulaId: 'f1', batchName: 'Lotion bar -- 2026-09-02', date: '2026-09-02',
    ingredientSnapshot: [{ ingredientId: 'i1', ingredientName: 'Shea butter', grams: 100 }] },
  { id: 'b2', formulaId: 'f1', batchName: 'Lotion bar -- 2026-09-20', date: '2026-09-20',
    ingredientSnapshot: [] },
  { id: 'b3', formulaId: 'other', batchName: 'Something else', date: '2026-09-21',
    ingredientSnapshot: [] }
];
const PRODUCTS = [
  { id: 'p1', name: 'Lotion bar 2oz', formulaId: 'f1', netWtG: 56 },
  { id: 'p2', name: 'Sampler kit', productKind: 'multi',
    components: [{ id: 'c1', formulaId: 'f1', netWtG: 10, label: 'mini bar' }] },
  { id: 'p3', name: 'Unrelated salve', formulaId: 'other', netWtG: 30 }
];

(async () => {
  const browser = await chromium.launch();

  async function session(seed) {
    const page = await browser.newPage();
    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
    await page.goto(URL);
    await page.waitForTimeout(400);
    // Base library first, then whatever extra the case needs, then one reload
    // so the module boots against the finished state.
    await page.evaluate(seedBase);
    if (seed) await page.evaluate(seed);
    await page.reload();
    await page.waitForTimeout(400);
    return { page, dialogs };
  }

  const seedBase = `
    localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(INGS))});
    localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});
    localStorage.setItem('aerie-batches-v1', '[]');
    localStorage.setItem('plume-products-v1', '[]');
  `;

  const seedDeps = `
    localStorage.setItem('aerie-batches-v1', ${JSON.stringify(JSON.stringify(BATCHES))});
    localStorage.setItem('plume-products-v1', ${JSON.stringify(JSON.stringify(PRODUCTS))});
  `;

  console.log('\n1. Unlock wording');
  {
    const { page } = await session(null);
    await page.evaluate("openFormula('f1'); selectVariant('v1'); openUnlock();");
    const txt = await page.evaluate("document.getElementById('m-unlock-intro').innerText");
    ok('says batches keep their amounts', /batches you have already made keep the amounts/i.test(txt), txt);
    ok('says products change for units already made', /including ones made months ago/i.test(txt));
    ok('no longer claims edits reach past batches',
       !/cost of anything\s+already batched/i.test(txt));
    await page.close();
  }

  console.log('\n2. Deleting a formulation that products and batches depend on');
  {
    const { page, dialogs } = await session(seedDeps);
    await page.evaluate("openFormula('f1'); deleteFormula();");
    await page.waitForTimeout(200);
    const m = dialogs.join('\n');
    ok('names the formulation', /Permanently delete "Lotion bar"\?/.test(m), m);
    ok('counts only the products that point at it', /2 products use this formulation/.test(m), m);
    ok('names those products', /Lotion bar 2oz, Sampler kit/.test(m), m);
    ok('reaches multi-component products through components[]', /Sampler kit/.test(m));
    ok('warns products cannot be relinked', /no way to relink/.test(m), m);
    ok('counts only the batches that point at it', /2 batches were made from it/.test(m), m);
    ok('excludes the unrelated batch', !/Something else/.test(m), m);
    ok('says batch records survive', /keep their own ingredient amounts/.test(m), m);
    ok('still warns it cannot be undone', /cannot be undone/.test(m));
    await page.close();
  }

  console.log('\n3. Deleting a formulation nothing depends on');
  {
    const { page, dialogs } = await session(null);
    await page.evaluate("openFormula('f1'); deleteFormula();");
    await page.waitForTimeout(200);
    const m = dialogs.join('\n');
    ok('no product warning', !/product/.test(m), m);
    ok('no batch line', !/batch/.test(m), m);
    ok('still reports the version count', /All 2 versions will be deleted/.test(m), m);
    const gone = await page.evaluate('forms.length');
    ok('delete still goes through', gone === 0);
    await page.close();
  }

  console.log('\n4. Deleting the in-use version names its successor');
  {
    const { page, dialogs } = await session(null);
    await page.evaluate("openFormula('f1'); selectVariant('v1'); deleteVariant('v1');");
    await page.waitForTimeout(200);
    const m = dialogs.join('\n');
    ok('flags that it is the in-use version', /version costing and batches use/.test(m), m);
    ok('names the successor', /Beeswax sub will take over/.test(m), m);
    const act = await page.evaluate("forms[0].activeVariantId");
    ok('successor really does take over', act === 'v2', act);
    await page.close();
  }

  console.log('\n5. Deleting a version that is not in use says nothing extra');
  {
    const { page, dialogs } = await session(null);
    await page.evaluate("openFormula('f1'); selectVariant('v2'); deleteVariant('v2');");
    await page.waitForTimeout(200);
    const m = dialogs.join('\n');
    ok('no successor line', !/take over/.test(m), m);
    ok('still deletes', (await page.evaluate("forms[0].variants.length")) === 1);
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
