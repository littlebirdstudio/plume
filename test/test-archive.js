// Archiving a formulation, and Retired actually retiring a version.
// Runs the real pages in headless Chromium against shared storage, so the
// Costing and Batchlog pickers are exercised the way they actually load.
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const INGS = [{ id: 'i1', name: 'Shea butter', inci: 'Butyrospermum Parkii (Shea) Butter',
                phase: 'oil', functionCategory: ['Emollient'], lots: [] }];

function v(vid, num, label, status) {
  return { vid, num, label, status, lines: [{ ingId: 'i1', pct: 100 }],
           instructions: '', batchSize: '100', addinsInTotal: false,
           usageLog: [], history: [], branchedFrom: null, branchNote: '',
           createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };
}

const FORMS = [
  { id: 'f1', name: 'Lotion bar', type: 'balm', notes: '', formNotes: '',
    variants: [v('v1', 1, 'Candelilla', 'approved'), v('v2', 2, 'Beeswax sub', 'draft')],
    activeVariantId: 'v1' },
  { id: 'f2', name: 'Old salve', type: 'balm', notes: '', formNotes: '',
    variants: [v('w1', 1, '', 'approved')], activeVariantId: 'w1', archived: true },
  { id: 'f3', name: 'Face oil', type: 'serum', notes: '', formNotes: '',
    variants: [v('x1', 1, '', 'draft')], activeVariantId: 'x1' }
];

// A product that points at the ARCHIVED formulation. This is the case the
// picker exception exists for.
const PRODUCTS = [
  { id: 'p1', name: 'Old salve 1oz', formulaId: 'f2', netWtG: 28, packagingRecipe: [] },
  { id: 'p2', name: 'Sampler', productKind: 'multi', packagingRecipe: [],
    components: [{ id: 'c1', formulaId: 'f2', netWtG: 10, label: 'mini salve' }] }
];

const SEED = `
  localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(INGS))});
  localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});
  localStorage.setItem('plume-products-v1', ${JSON.stringify(JSON.stringify(PRODUCTS))});
  localStorage.setItem('aerie-batches-v1', '[]');
`;

(async () => {
  const browser = await chromium.launch();

  async function open(module, seed) {
    const page = await browser.newPage();
    const dialogs = [];
    await trackDialogs(page, dialogs);
    await page.goto(previewUrl(module));
    await page.waitForTimeout(300);
    await page.evaluate(seed === undefined ? SEED : seed);
    await page.reload();
    await page.waitForTimeout(500);
    return { page, dialogs };
  }

  console.log('\n1. Formulation list hides archived');
  {
    const { page } = await open('formulations');
    let names = await page.evaluate("Array.from(document.querySelectorAll('.fcard-name')).map(e => e.textContent)");
    ok('archived formulation not listed', !names.join('|').includes('Old salve'), names);
    ok('live formulations listed', names.join('|').includes('Lotion bar') && names.join('|').includes('Face oil'), names);
    const toggle = await page.evaluate("document.querySelector('.arch-bar button').textContent");
    ok('toggle offers the archived count', /Show 1 archived/.test(toggle), toggle);
    await page.evaluate('toggleShowArchived()');
    names = await page.evaluate("Array.from(document.querySelectorAll('.fcard-name')).map(e => e.textContent)");
    ok('archived shown when asked', names.join('|').includes('Old salve'), names);
    ok('archived card carries a tag', names.join('|').includes('archived'), names);
    await page.close();
  }

  console.log('\n2. Archiving and unarchiving from the editor');
  {
    const { page, dialogs } = await open('formulations');
    await page.evaluate("openFormula('f3')");
    ok('button reads Archive for a live formulation',
       (await page.evaluate("document.getElementById('archive-btn').textContent")) === 'Archive');
    await page.evaluate('toggleArchiveFormula()');
    await page.waitForTimeout(200);
    ok('flag set', (await page.evaluate("forms.find(f => f.id === 'f3').archived")) === true);
    ok('button flips to Unarchive',
       (await page.evaluate("document.getElementById('archive-btn').textContent")) === 'Unarchive');
    ok('banner explains the state',
       /Archived/.test(await page.evaluate("document.getElementById('arch-bar-ed').innerText")));
    ok('confirm says it can be undone', /bring it back at any time/.test(dialogs.join('\n')), dialogs);
    await page.evaluate('toggleArchiveFormula()');
    ok('unarchive needs no confirmation', dialogs.length === 1, dialogs.length);
    ok('flag cleared', (await page.evaluate("forms.find(f => f.id === 'f3').archived")) !== true);
    await page.close();
  }

  console.log('\n3. Archiving names what keeps working');
  {
    const { page, dialogs } = await open('formulations');
    await page.evaluate("openFormula('f1'); toggleArchiveFormula();");
    await page.waitForTimeout(150);
    ok('no dependants, so no reassurance line', !/keeps working/.test(dialogs.join('\n')), dialogs);
    await page.close();

    const s2 = await open('formulations');
    await s2.page.evaluate("openFormula('f2'); toggleArchiveFormula();"); // unarchive f2
    await s2.page.waitForTimeout(150);
    await s2.page.evaluate("toggleArchiveFormula();"); // archive again, now with deps
    await s2.page.waitForTimeout(150);
    ok('names the products that keep working', /2 products still cost and label exactly as before/.test(s2.dialogs.join('\n')), s2.dialogs);
    await s2.page.close();
  }

  console.log('\n4. Retired versions leave the tab strip');
  {
    const { page } = await open('formulations');
    await page.evaluate("openFormula('f1'); selectVariant('v2');");
    await page.waitForTimeout(150);
    await page.evaluate("var s = document.getElementById('f-status'); s.value = 'retired'; onStatusChange(s);");
    await page.waitForTimeout(200);
    ok('status saved as retired', (await page.evaluate("forms.find(f=>f.id==='f1').variants.find(x=>x.vid==='v2').status")) === 'retired');
    await page.evaluate("selectVariant('v1')");
    await page.waitForTimeout(150);
    let tabs = await page.evaluate("Array.from(document.querySelectorAll('.var-tab .vt-name')).map(e=>e.textContent)");
    ok('retired tab hidden once you leave it', !tabs.includes('Beeswax sub'), tabs);
    ok('live tab still there', tabs.includes('Candelilla'), tabs);
    const strip = await page.evaluate("document.getElementById('var-strip').innerText");
    ok('strip offers to show retired', /Show 1 retired/.test(strip), strip);
    await page.evaluate('toggleShowRetired()');
    tabs = await page.evaluate("Array.from(document.querySelectorAll('.var-tab .vt-name')).map(e=>e.textContent)");
    ok('retired tab returns when asked', tabs.includes('Beeswax sub'), tabs);
    await page.close();
  }

  console.log('\n5. Retiring the in-use version hands the role on');
  {
    const { page, dialogs } = await open('formulations');
    await page.evaluate("openFormula('f1'); selectVariant('v1');");
    await page.waitForTimeout(150);
    await page.evaluate("var s = document.getElementById('f-status'); s.value = 'retired'; onStatusChange(s);");
    await page.waitForTimeout(200);
    ok('warns about the handover', /Beeswax sub will take over/.test(dialogs.join('\n')), dialogs);
    ok('active variant moved', (await page.evaluate("forms.find(f=>f.id==='f1').activeVariantId")) === 'v2');
    await page.close();
  }

  console.log('\n6. The last live version cannot be retired');
  {
    const { page, dialogs } = await open('formulations');
    await page.evaluate("openFormula('f3');");
    await page.waitForTimeout(150);
    await page.evaluate("var s = document.getElementById('f-status'); s.value = 'retired'; onStatusChange(s);");
    await page.waitForTimeout(200);
    ok('refused with an explanation', /only version left that is not retired/.test(dialogs.join('\n')), dialogs);
    ok('status reverted in the select',
       (await page.evaluate("document.getElementById('f-status').value")) !== 'retired');
    ok('nothing saved', (await page.evaluate("forms.find(f=>f.id==='f3').variants[0].status")) !== 'retired');
    await page.close();
  }

  console.log('\n7. Batchlog will not start a batch from an archived formulation');
  {
    const { page } = await open('batchlog');
    const opts = await page.evaluate("Array.from(document.getElementById('f-formula').options).map(o=>o.textContent)");
    ok('archived excluded', !opts.join('|').includes('Old salve'), opts);
    ok('live offered', opts.join('|').includes('Lotion bar'), opts);
    await page.close();
  }

  console.log('\n8. Costing pickers');
  {
    const { page } = await open('costing');

    await page.evaluate("openNewProduct ? openNewProduct() : openNew()");
    await page.waitForTimeout(200);
    const nOpts = await page.evaluate("Array.from(document.getElementById('n-formula').options).map(o=>o.textContent)");
    ok('new product does not offer archived', !nOpts.join('|').includes('Old salve'), nOpts);

    await page.evaluate("openProduct('p1')");
    await page.waitForTimeout(200);
    const pOpts = await page.evaluate("Array.from(document.getElementById('p-formula').options).map(o=>o.textContent)");
    ok('product already on an archived formula keeps its option',
       pOpts.join('|').includes('Old salve'), pOpts);
    ok('and it is marked archived', /Old salve \[archived\]/.test(pOpts.join('|')), pOpts);
    ok('the link is still selected',
       (await page.evaluate("document.getElementById('p-formula').value")) === 'f2');

    await page.evaluate("openProduct('p2')");
    await page.waitForTimeout(200);
    const cOpts = await page.evaluate(
      "Array.from(document.querySelectorAll('.comp-recipe-row select')[0].options).map(o=>o.textContent)");
    ok('component row keeps its archived formula', cOpts.join('|').includes('Old salve'), cOpts);
    ok('component link still selected',
       (await page.evaluate("document.querySelectorAll('.comp-recipe-row select')[0].value")) === 'f2');
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
