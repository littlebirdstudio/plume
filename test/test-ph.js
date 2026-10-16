// pH records (added 2026-10-16): a target range on each version, the steps
// of a test pour in the usage log, and a batch's final pH.
//
// Heide's split, which these tests hold the code to: the batch is where she
// looks up what pH a specific batch ended at; the usage log is how she got
// there. pH fields appear only for a water-phase formula, never for soap or
// an anhydrous product.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');
const { ROOT, previewUrl } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

// ── 1. Core helpers, without a DOM ──────────────────────────────
const core = fs.readFileSync(path.join(ROOT, 'plume-core.js'), 'utf8');
const sandbox = { window: {}, document: { documentElement: { style: { setProperty() {} } } },
                  localStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 } };
vm.createContext(sandbox);
vm.runInContext(core, sandbox);
const P = sandbox.Plume;

console.log('\n1. Reading a pH');
ok('a meter reading keeps its second decimal', P.parsePh('5.20') === '5.20');
ok('a strip reading stays whole', P.parsePh('5') === '5');
ok('a comma decimal is accepted', P.parsePh('5,5') === '5.5');
ok('spaces are trimmed', P.parsePh('  4.8 ') === '4.8');
ok('a leading decimal point gets its zero', P.parsePh('.5') === '0.5');
ok('blank is blank, not an error', P.parsePh('') === '' && P.parsePh(null) === '' && P.parsePh('  ') === '');
ok('above 14 is not a pH', P.parsePh('15') === null);
ok('three decimals is not a reading', P.parsePh('5.123') === null);
ok('words are not a pH', P.parsePh('five') === null && P.parsePh('5.5a') === null);
ok('negative is not a pH', P.parsePh('-1') === null);
ok('0 and 14 are both valid', P.parsePh('0') === '0' && P.parsePh('14') === '14');

console.log('\n2. Against a target');
ok('inside the range', P.phRange('5.2', '4.8', '5.5') === 'in');
ok('the edges count as inside', P.phRange('4.8', '4.8', '5.5') === 'in' && P.phRange('5.50', '4.8', '5.5') === 'in');
ok('below', P.phRange('4.5', '4.8', '5.5') === 'low');
ok('above', P.phRange('6', '4.8', '5.5') === 'high');
ok('min only', P.phRange('4', '4.5', '') === 'low' && P.phRange('9', '4.5', '') === 'in');
ok('max only', P.phRange('6', '', '5.5') === 'high');
ok('no target means no verdict', P.phRange('5', '', '') === '');
ok('no reading means no verdict', P.phRange('', '4.8', '5.5') === '');
ok('target text, both ends', P.phTargetText('4.8', '5.5') === '4.8–5.5');
ok('target text, one end', P.phTargetText('4.8', '') === '≥ 4.8' && P.phTargetText('', '5.5') === '≤ 5.5');
ok('target text, none', P.phTargetText('', '') === '');

console.log('\n3. Which formulas get pH at all');
const ING = [
  { id: 'w', name: 'Distilled water', phase: 'water' },
  { id: 'o', name: 'Jojoba', phase: 'oil' },
  { id: 'h', name: 'Rose hydrosol', phase: 'cool-down' }
];
ok('a water-phase line makes it aqueous', P.isAqueous([{ ingId: 'o' }, { ingId: 'w' }], ING) === true);
ok('an all-oil formula is not', P.isAqueous([{ ingId: 'o' }], ING) === false);
ok('a line moved INTO water counts', P.isAqueous([{ ingId: 'h', phase: 'water' }], ING) === true);
ok('a water ingredient moved OUT of water does not', P.isAqueous([{ ingId: 'w', phase: 'oil' }], ING) === false);
ok('an add-in line sits outside the phases', P.isAqueous([{ ingId: 'w', addin: true }], ING) === false);
ok('a missing ingredient does not throw', P.isAqueous([{ ingId: 'gone' }], ING) === false);

console.log('\n4. Showing readings');
const steps = [
  { v: '6.4', m: 'strip', add: '4 drops 50% citric' },
  { v: '5.6', m: 'meter', add: '1 drop' },
  { v: '5.30', m: 'meter' }
];
const h = P.phStepsHtml(steps, '4.8', '5.5');
ok('every reading and adjuster appears in order',
   /6\.4[\s\S]*4 drops 50% citric[\s\S]*5\.6[\s\S]*1 drop[\s\S]*5\.30/.test(h), h);
ok('only the final reading is judged against the target',
   (h.match(/ph-in|ph-low|ph-high/g) || []).length === 1 && /ph-in[^>]*>pH 5\.30/.test(h), h);
ok('the method shows beside each reading', (h.match(/class="ph-m"/g) || []).length === 3);
ok('a final reading outside the target says so',
   /ph-high/.test(P.phStepsHtml([{ v: '6.0', m: 'strip' }], '4.8', '5.5')));
ok('the final step is the last reading', P.phFinal(steps).v === '5.30');
ok('adjuster text is escaped',
   P.phStepsHtml([{ v: '5', m: 'strip', add: '<b>x</b>' }]).indexOf('<b>') === -1);
ok('empty steps render nothing', P.phStepsHtml([{ v: '', m: 'strip' }]) === '' && P.phStepsHtml([]) === '');
ok('a badge with no value renders nothing', P.phBadge('', 'strip') === '');

console.log('\n5. The bench sheet');
const sheet = (o) => P.buildSheet(Object.assign({ name: 'T', lines: [{ ingId: 'w', pct: 90 }, { ingId: 'o', pct: 10 }],
  ings: ING, batchSize: 100 }, o));
ok('an aqueous formula with a target prints it', /pH<\/span><\/div>[\s\S]*Target: <strong>4\.8–5\.5/.test(sheet({ phMin: '4.8', phMax: '5.5' })));
ok('an aqueous formula with no target prints a blank to write in',
   /<div class="sec-title"><span[^>]*>pH<\/span><\/div>/.test(sheet({})) && /Target: <strong><span/.test(sheet({})));
ok('an anhydrous formula prints no pH section',
   !/sec-title"><span[^>]*>pH</.test(sheet({ lines: [{ ingId: 'o', pct: 100 }] })));
ok('soap never prints one, even with water', !/sec-title"><span[^>]*>pH</.test(sheet({ isSoap: true, soapSettings: {} })));
ok('the final line names both instruments', /strip \/ meter/.test(sheet({})));

// ── Browser fixtures ────────────────────────────────────────────
const INGS = [
  { id: 'i1', name: 'Distilled water', inci: 'Aqua', phase: 'water', functionCategory: ['Other'], lots: [] },
  { id: 'i2', name: 'Glycerin', inci: 'Glycerin', phase: 'water', functionCategory: ['Humectant'], lots: [] },
  { id: 'i3', name: 'Shea butter', inci: 'Butyrospermum Parkii (Shea) Butter', phase: 'oil', functionCategory: ['Emollient'], lots: [] },
  { id: 'i4', name: 'Beeswax', inci: 'Cera Alba', phase: 'oil', functionCategory: ['Thickener'], lots: [] }
];
function variant(vid, num, label, lines, extra) {
  return Object.assign({ vid, num, label, status: 'draft', lines,
    instructions: '', batchSize: '100', addinsInTotal: false,
    usageLog: [], history: [], branchedFrom: null, branchNote: '',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' }, extra || {});
}
const FORMS = [
  { id: 'f1', name: 'Rose toner', type: 'Toner / mist', notes: '', formNotes: '', activeVariantId: 'v1',
    lines: [{ ingId: 'i1', pct: 95 }, { ingId: 'i2', pct: 5 }],
    variants: [variant('v1', 1, '', [{ ingId: 'i1', pct: 95 }, { ingId: 'i2', pct: 5 }], {
      usageLog: [{ id: 'u0', date: '2026-10-01', batch: '50', version: 'Version 1', notes: '',
                   ph: [{ v: '6.2', m: 'strip', add: '3 drops 50% citric' }, { v: '5.4', m: 'meter' }] }]
    })] },
  { id: 'f2', name: 'Lip balm', type: 'Lip balm', notes: '', formNotes: '', activeVariantId: 'b1',
    lines: [{ ingId: 'i3', pct: 70 }, { ingId: 'i4', pct: 30 }],
    variants: [variant('b1', 1, '', [{ ingId: 'i3', pct: 70 }, { ingId: 'i4', pct: 30 }])] },
  { id: 'f3', name: 'Approved mist', type: 'Toner / mist', notes: '', formNotes: '', activeVariantId: 'a1',
    lines: [{ ingId: 'i1', pct: 100 }], phMin: '5', phMax: '6',
    variants: [variant('a1', 1, '', [{ ingId: 'i1', pct: 100 }], { status: 'approved', phMin: '5', phMax: '6' })] }
];
function batch(id, formulaId, formulaName, formulaType, snap, extra) {
  return Object.assign({ id, date: '2026-10-10', formulaId, formulaName, formulaType, batchName: formulaName + ' -- 2026-10-10',
    batchType: 'production', targetYield: 100, actualYield: 100, cureWeeks: null, readyDate: '2026-10-10',
    status: 'ready', notes: '', ingredientSnapshot: snap, packagingRuns: [], committed: true,
    committedAt: '2026-10-10T00:00:00.000Z', lotDraws: [], packagingDraws: [],
    createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z' }, extra || {});
}
const BATCHES = [
  // Made against 4.8-5.5; the formula's target is different now (see seed).
  batch('b1', 'f1', 'Rose toner', 'Toner / mist',
        [{ ingredientId: 'i1', ingredientName: 'Distilled water', grams: 95 }], { phMin: '4.8', phMax: '5.5' }),
  batch('b2', 'f2', 'Lip balm', 'Lip balm',
        [{ ingredientId: 'i3', ingredientName: 'Shea butter', grams: 70 }]),
  // Made before pH existed: no phMin key, so it reads the formula's target.
  batch('b3', 'f3', 'Approved mist', 'Toner / mist',
        [{ ingredientId: 'i1', ingredientName: 'Distilled water', grams: 100 }])
];

(async () => {
  const browser = await chromium.launch();
  const SEED = `
    localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(INGS))});
    localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});
    localStorage.setItem('plume-products-v1', '[]');
    localStorage.setItem('aerie-batches-v1', ${JSON.stringify(JSON.stringify(BATCHES))});`;
  async function open(module) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', d => d.accept());
    await page.goto(previewUrl(module));
    await page.waitForTimeout(300);
    await page.evaluate(SEED);
    await page.reload();
    await page.waitForTimeout(500);
    return { page, errors };
  }
  const shown = (page, id) => page.evaluate(`(function(){var e=document.getElementById(${JSON.stringify(id)});return !!e && e.style.display!=='none' && e.offsetParent!==null;})()`);

  console.log('\n6. Target pH on a version');
  {
    const { page, errors } = await open('formulations');
    await page.evaluate("openFormula('f2')"); await page.waitForTimeout(200);
    ok('a lip balm shows no target field', !(await shown(page, 'ph-target-row')));
    await page.evaluate("openFormula('f1')"); await page.waitForTimeout(200);
    ok('a toner shows it', await shown(page, 'ph-target-row'));

    await page.fill('#f-ph-min', '15');
    await page.dispatchEvent('#f-ph-min', 'input');
    ok('an impossible pH turns the field red and says why',
       await page.evaluate("document.getElementById('f-ph-min').classList.contains('ph-bad') && document.getElementById('ph-target-err').style.display !== 'none'"));
    await page.fill('#f-ph-min', '4.8'); await page.dispatchEvent('#f-ph-min', 'input');
    await page.fill('#f-ph-max', '5.50'); await page.dispatchEvent('#f-ph-max', 'input');
    ok('and clears once it is fixed',
       await page.evaluate("!document.getElementById('f-ph-min').classList.contains('ph-bad') && document.getElementById('ph-target-err').style.display === 'none'"));
    await page.evaluate("saveFormula(true)");
    const saved = await page.evaluate(`(function(){var f=forms.find(function(x){return x.id==='f1';});var v=f.variants[0];
      return {vmin:v.phMin,vmax:v.phMax,fmin:f.phMin,fmax:f.phMax,hist:(v.history||[]).map(function(h){return (h.changes||h.lines||h.text||[]).join?((h.changes||[]).join('|')):JSON.stringify(h);}).join(' / ')};})()`);
    ok('saves on the version, as typed', saved.vmin === '4.8' && saved.vmax === '5.50', saved);
    ok('and mirrors to the formula, where Batchlog reads it', saved.fmin === '4.8' && saved.fmax === '5.50', saved);
    ok('and is recorded in change history', /Target pH set to 4\.8–5\.50/.test(JSON.stringify(await page.evaluate("forms.find(function(x){return x.id==='f1';}).variants[0].history"))));

    await page.fill('#f-ph-min', '5.0'); await page.dispatchEvent('#f-ph-min', 'input');
    await page.evaluate("saveFormula(true)");
    ok('a change reads old -> new in history',
       /Target pH 4\.8–5\.50 → 5\.0–5\.50/.test(JSON.stringify(await page.evaluate("forms.find(function(x){return x.id==='f1';}).variants[0].history"))));

    await page.evaluate("openBranch()");
    await page.fill('#m-branch-name', 'Lavender');
    await page.evaluate("confirmBranch()"); await page.waitForTimeout(200);
    const nv = await page.evaluate("(function(){var f=forms.find(function(x){return x.id==='f1';});var v=f.variants[f.variants.length-1];return {label:v.label,min:v.phMin,max:v.phMax};})()");
    ok('a new version starts with the same target', nv.label === 'Lavender' && nv.min === '5.0' && nv.max === '5.50', nv);

    await page.evaluate("openFormula('f3')"); await page.waitForTimeout(200);
    ok('an approved version locks its target like its other fields',
       await page.evaluate("document.getElementById('f-ph-min').disabled && document.getElementById('f-ph-max').disabled"));
    ok('no page errors', errors.length === 0, errors);
    await page.close();
  }

  console.log('\n7. pH steps in the usage log');
  {
    const { page, errors } = await open('formulations');
    await page.evaluate("openFormula('f1')"); await page.waitForTimeout(200);
    await page.fill('#f-ph-min', '4.8'); await page.fill('#f-ph-max', '5.5');
    await page.evaluate("saveFormula(true)");
    await page.evaluate("openUsage()");
    ok('the modal names the target', /target 4\.8–5\.5/.test(await page.evaluate("document.getElementById('ul-ph-target').textContent")));
    const today = await page.evaluate("(function(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');})()");
    ok('the date defaults to the LOCAL day', (await page.inputValue('#ul-date')) === today);
    ok('the pH section is offered for a toner', await shown(page, 'ul-ph-wrap'));
    ok('earlier adjusters are suggested',
       await page.evaluate("Array.from(document.querySelectorAll('#ph-adjusters option')).map(function(o){return o.value;}).indexOf('3 drops 50% citric') !== -1"));

    await page.evaluate("addPhStep()");
    await page.evaluate("addPhStep()");
    const rows = '#ul-ph-steps .ph-step';
    await page.fill(rows + ':nth-child(1) .ph-v', '6.3');
    await page.fill(rows + ':nth-child(1) .ph-a', '2 drops lactic');
    await page.selectOption(rows + ':nth-child(2) .ph-m', 'meter');
    await page.fill(rows + ':nth-child(2) .ph-v', '20');
    await page.evaluate("saveUseEntry()");
    ok('a reading that is not a pH blocks the save and says why',
       (await page.evaluate("forms.find(function(x){return x.id==='f1';}).variants[0].usageLog.length")) === 1 &&
       await shown(page, 'ul-ph-err'));
    await page.fill(rows + ':nth-child(2) .ph-v', '5.25');
    await page.evaluate("saveUseEntry()");
    const log = await page.evaluate("forms.find(function(x){return x.id==='f1';}).variants[0].usageLog");
    const e = log[log.length - 1];
    ok('saves once fixed', log.length === 2, log.length);
    ok('the steps are stored in order with their methods',
       JSON.stringify(e.ph) === JSON.stringify([{ v: '6.3', m: 'strip', add: '2 drops lactic' }, { v: '5.25', m: 'meter' }]), e.ph);
    const html = await page.evaluate("document.getElementById('use-panel').innerHTML");
    ok('the log shows the sequence', /6\.3[\s\S]*2 drops lactic[\s\S]*5\.25/.test(html));
    ok('the final reading is judged against the version target', /ph-badge ph-in[^>]*>pH 5\.25/.test(html), html.slice(0, 400));

    await page.evaluate("openUsage()");
    await page.evaluate("saveUseEntry()");
    const last = await page.evaluate("(function(){var l=forms.find(function(x){return x.id==='f1';}).variants[0].usageLog;return l[l.length-1];})()");
    ok('an entry with no readings stores no pH at all', !('ph' in last), last);

    await page.evaluate("closeModal('m-use'); openFormula('f2')"); await page.waitForTimeout(200);
    await page.evaluate("openUsage()");
    ok('a lip balm is not offered pH readings', !(await shown(page, 'ul-ph-wrap')));
    ok('no page errors', errors.length === 0, errors);
    await page.close();
  }

  console.log('\n8. Final pH on a batch');
  {
    const { page, errors } = await open('batchlog');
    await page.evaluate("openBatchDetail('b2')"); await page.waitForTimeout(150);
    ok('a lip balm batch shows no pH field', !(await shown(page, 'd-ph-row')));
    await page.evaluate("closeModal('m-detail'); openBatchDetail('b1')"); await page.waitForTimeout(150);
    ok('a toner batch shows it', await shown(page, 'd-ph-row'));
    ok('with the target it was MADE against, not the formula\'s current one',
       /Target 4\.8–5\.5/.test(await page.evaluate("document.getElementById('d-ph-note').textContent")));

    await page.fill('#d-ph', '5.9'); await page.dispatchEvent('#d-ph', 'input');
    await page.selectOption('#d-ph-method', 'meter');
    ok('an out-of-range reading is flagged as you type',
       /ph-high/.test(await page.evaluate("document.getElementById('d-ph-note').innerHTML")));
    await page.fill('#d-ph', 'abc'); await page.dispatchEvent('#d-ph', 'input');
    await page.evaluate("saveBatchEdits()");
    ok('a non-number does not save',
       (await page.evaluate("findBatch('b1').finalPh")) === undefined && await shown(page, 'd-ph-err'));
    await page.fill('#d-ph', '5.30'); await page.dispatchEvent('#d-ph', 'input');
    await page.evaluate("saveBatchEdits()");
    const b = await page.evaluate("(function(){var b=findBatch('b1');return {ph:b.finalPh,m:b.finalPhMethod};})()");
    ok('saves the reading as typed, with its method', b.ph === '5.30' && b.m === 'meter', b);
    const stored = await page.evaluate("JSON.parse(localStorage.getItem('aerie-batches-v1')).find(function(x){return x.id==='b1';}).finalPh");
    ok('and it reaches storage', stored === '5.30', stored);
    ok('the batch list shows it under the yield',
       /pH 5\.30/.test(await page.evaluate("document.querySelector('tr[onclick*=\"b1\"]') ? document.querySelector('tr[onclick*=\"b1\"]').innerHTML : document.body.innerHTML")));

    await page.fill('#d-ph', ''); await page.dispatchEvent('#d-ph', 'input');
    await page.evaluate("saveBatchEdits()");
    ok('clearing it removes it', (await page.evaluate("'finalPh' in findBatch('b1')")) === false);

    await page.evaluate("closeModal('m-detail'); openBatchDetail('b3')"); await page.waitForTimeout(150);
    ok('a batch from before pH existed compares with the formula\'s target',
       /Target 5–6/.test(await page.evaluate("document.getElementById('d-ph-note').textContent")));
    ok('no page errors', errors.length === 0, errors);
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
