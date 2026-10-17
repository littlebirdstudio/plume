// Blend splitting and label dedupe: the core helpers in isolation, then the
// two places that render a label list.
const fs = require('fs');
const { chromium } = require('playwright');
const path = require('path');
const { ROOT, previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

// ── 1. The splitter and merger, straight from core ──────────────
const core = fs.readFileSync(path.join(ROOT, 'plume-core.js'), 'utf8');
const sandbox = { window: {}, document: { documentElement: { style: { setProperty() {} } } },
                  localStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 } };
const vm = require('vm');
vm.createContext(sandbox);
vm.runInContext(core, sandbox);
const P = sandbox.Plume;

console.log('\n1. Splitting an INCI string');
ok('plain name stays whole', JSON.stringify(P.inciSplit('Glycerin')) === '["Glycerin"]');
ok('keeps a synonym parenthetical',
   JSON.stringify(P.inciSplit('Butyrospermum Parkii (Shea) Butter')) === '["Butyrospermum Parkii (Shea) Butter"]',
   P.inciSplit('Butyrospermum Parkii (Shea) Butter'));
ok('splits on (and)',
   JSON.stringify(P.inciSplit('Cetearyl Olivate (and) Sorbitan Olivate')) === '["Cetearyl Olivate","Sorbitan Olivate"]',
   P.inciSplit('Cetearyl Olivate (and) Sorbitan Olivate'));
ok('splits on commas',
   P.inciSplit('Propylene Glycol, Diazolidinyl Urea, Iodopropynyl Butylcarbamate').length === 3);
ok('splits on an ampersand', P.inciSplit('Water & Glycerin').length === 2);
ok('does NOT split a bare "and"',
   JSON.stringify(P.inciSplit('Witch Hazel and Rose Water')) === '["Witch Hazel and Rose Water"]',
   P.inciSplit('Witch Hazel and Rose Water'));
ok('keeps a slash inside a name',
   JSON.stringify(P.inciSplit('Caprylic/Capric Triglyceride')) === '["Caprylic/Capric Triglyceride"]');
ok('empty input gives nothing', P.inciSplit('').length === 0 && P.inciSplit(null).length === 0);
ok('collapses stray whitespace',
   JSON.stringify(P.inciSplit('Aqua  ,   Glycerin')) === '["Aqua","Glycerin"]');

console.log('\n2. Merging across a formula');
{
  const items = [
    { inci: 'Aqua', label: 'Distilled water' },
    { inci: 'Gluconolactone (and) Sodium Benzoate', label: 'Geogard Ultra' },
    { inci: 'Phenoxyethanol (and) Caprylyl Glycol (and) Sodium Benzoate', label: 'Optiphen' },
    { inci: 'Glycerin', label: 'Glycerin' }
  ];
  const out = P.inciMerge(items);
  const names = out.map(e => e.name);
  ok('one entry per distinct component', names.length === 6, names);
  ok('sodium benzoate listed once', names.filter(n => n === 'Sodium Benzoate').length === 1, names);
  ok('order follows first appearance',
     JSON.stringify(names) === JSON.stringify(['Aqua', 'Gluconolactone', 'Sodium Benzoate',
       'Phenoxyethanol', 'Caprylyl Glycol', 'Glycerin']), names);
  const merged = P.inciMerged(out);
  ok('reports exactly one merge', merged.length === 1, merged.map(m => m.name));
  ok('merge names both sources',
     merged[0].sources.map(s => s.label).join('|') === 'Geogard Ultra|Optiphen',
     merged[0].sources.map(s => s.label));
  ok('case difference still merges',
     P.inciMerge([{ inci: 'TOCOPHEROL' }, { inci: 'Tocopherol' }]).length === 1);
}

// ── 3 and 4. The two rendered lists ─────────────────────────────
const INGS = [
  { id: 'i1', name: 'Distilled water', inci: 'Aqua', phase: 'water', flag: 'no',
    functionCategory: ['Other'], lots: [] },
  { id: 'i2', name: 'Geogard Ultra', inci: 'Gluconolactone (and) Sodium Benzoate',
    phase: 'cool-down', flag: 'yes', functionCategory: ['Preservative'], lots: [] },
  { id: 'i3', name: 'Optiphen', inci: 'Phenoxyethanol (and) Caprylyl Glycol (and) Sodium Benzoate',
    phase: 'cool-down', flag: 'yes', functionCategory: ['Preservative'], lots: [] },
  { id: 'i4', name: 'Shea butter', inci: 'Butyrospermum Parkii (Shea) Butter',
    phase: 'oil', flag: 'no', functionCategory: ['Emollient'], lots: [] }
];
const LINES = [
  { ingId: 'i1', pct: 60 }, { ingId: 'i4', pct: 38 },
  { ingId: 'i2', pct: 1 },  { ingId: 'i3', pct: 1 }
];
const FORMS = [{
  id: 'f1', name: 'Test lotion', type: 'lotion', notes: '', formNotes: '',
  variants: [{ vid: 'v1', num: 1, label: '', status: 'draft', lines: LINES,
               instructions: '', batchSize: '100', addinsInTotal: false,
               usageLog: [], history: [], branchedFrom: null, branchNote: '',
               createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }],
  activeVariantId: 'v1', lines: LINES, status: 'draft'
}];
const PRODUCTS = [{ id: 'p1', name: 'Test lotion 2oz', formulaId: 'f1', netWtG: 56,
                    packagingRecipe: [], labelMode: 'inci' }];

const SEED = `
  localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(INGS))});
  localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});
  localStorage.setItem('plume-products-v1', ${JSON.stringify(JSON.stringify(PRODUCTS))});
  localStorage.setItem('aerie-batches-v1', '[]');
`;

(async () => {
  const browser = await chromium.launch();
  async function open(module) {
    const page = await browser.newPage();
    trackDialogs(page, []);
    await page.goto(previewUrl(module));
    await page.waitForTimeout(300);
    await page.evaluate(SEED);
    await page.reload();
    await page.waitForTimeout(500);
    return page;
  }

  console.log('\n3. Formulations INCI panel');
  {
    const page = await open('formulations');
    await page.evaluate("openFormula('f1')");
    await page.waitForTimeout(300);
    const txt = await page.evaluate("document.getElementById('inci-panel').innerText");
    const items = await page.evaluate(
      "Array.from(document.querySelectorAll('#inci-panel .inci-item')).map(e => e.innerText)");
    ok('blend split into components', items.some(t => /Gluconolactone/.test(t)), items);
    ok('sodium benzoate appears once',
       items.filter(t => /Sodium Benzoate/.test(t)).length === 1, items);
    ok('shea synonym not split', items.some(t => /Butyrospermum Parkii \(Shea\) Butter/.test(t)), items);
    ok('merged entry carries a count mark', /×2|x2/.test(txt), txt);
    ok('note names both ingredients', /Geogard Ultra and Optiphen/.test(txt), txt);
    ok('note warns the position may be low', /check whether it belongs higher up/.test(txt), txt);
    ok('restricted marker survives the split',
       (await page.evaluate("document.querySelectorAll('#inci-panel .inci-item span[style*=\"warning\"]').length")) > 0);

    // navigator.clipboard is read-only, so the stub goes on via
    // defineProperty, and copyInci resolves a promise before the text lands.
    const copied = await page.evaluate(`(async () => {
      let captured = '';
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: t => { captured = t; return Promise.resolve(); } }
      });
      copyInci();
      await new Promise(r => setTimeout(r, 50));
      return captured;
    })()`);
    ok('copy matches the panel', /Gluconolactone/.test(copied) &&
       copied.split('Sodium Benzoate').length - 1 === 1, copied);
    await page.close();
  }

  console.log('\n4. Costing label preview');
  {
    const page = await open('costing');
    await page.evaluate("openProduct('p1')");
    await page.waitForTimeout(300);
    const line = await page.evaluate(
      "document.querySelector('#label-preview .label-section:nth-child(3)').innerText");
    ok('label lists components', /Gluconolactone/.test(line), line);
    ok('sodium benzoate once on the label',
       line.split('Sodium Benzoate').length - 1 === 1, line);
    const note = await page.evaluate(`(() => {
      const n = document.querySelector('#label-preview .label-merge-note');
      return n ? n.innerText : '';
    })()`);
    ok('merge note shown', /Sodium Benzoate/.test(note), note);
    ok('note names both blends', /Geogard Ultra and Optiphen/.test(note), note);

    await page.evaluate("document.getElementById('lbl-common').checked = true; renderLabel();");
    await page.waitForTimeout(150);
    const common = await page.evaluate(
      "document.querySelector('#label-preview .label-section:nth-child(3)').innerText");
    ok('common-name mode untouched', /Geogard Ultra/.test(common) && !/Gluconolactone/.test(common), common);
    const noteCommon = await page.evaluate(`(() => {
      const n = document.querySelector('#label-preview .label-merge-note');
      return n ? n.innerText : '';
    })()`);
    ok('no merge note in common-name mode', noteCommon === '', noteCommon);
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
