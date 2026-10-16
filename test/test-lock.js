// jsdom checks for the approved-version lock in plume-formulations.html.
// Loads the real page with plume-core.js, seeds one formulation with an
// approved variant and a draft variant, and drives the editor.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const { ROOT } = require('./helpers');
let pass = 0, fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
}

const ings = [
  { id: 'i1', name: 'Shea butter', inci: 'Butyrospermum Parkii (Shea) Butter',
    phase: 'oil', functionCategory: ['Emollient'], lots: [] },
  { id: 'i2', name: 'Jojoba oil', inci: 'Simmondsia Chinensis (Jojoba) Seed Oil',
    phase: 'oil', functionCategory: ['Emollient'], lots: [] }
];

function variant(vid, num, label, status) {
  return {
    vid, num, label, status,
    lines: [{ ingId: 'i1', pct: 60 }, { ingId: 'i2', pct: 40 }],
    instructions: 'Melt, blend, pour.', batchSize: '100',
    addinsInTotal: false, usageLog: [], history: [],
    branchedFrom: null, branchNote: '',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
}

const forms = [{
  id: 'f1', name: 'Lotion bar', type: 'balm', notes: '', formNotes: '',
  variants: [variant('v1', 1, 'Candelilla', 'approved'),
             variant('v2', 2, 'Beeswax sub', 'draft')],
  activeVariantId: 'v1'
}];

const html = fs.readFileSync(path.join(ROOT, 'plume-formulations.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/' });
const w = dom.window;

w.localStorage.setItem('aerie-ingredients-v2', JSON.stringify(ings));
w.localStorage.setItem('aerie-formulations-v1', JSON.stringify(forms));

// Evaluate the page's own scripts in order: plume-core.js, then the inline block.
w.eval(fs.readFileSync(path.join(ROOT, 'plume-core.js'), 'utf8'));
const inline = html.match(/<script>([\s\S]*?)<\/script>/)[1];
w.eval(inline);
w.eval('if (typeof boot === "function") boot(); else if (typeof Plume !== "undefined") Plume.boot(function(){ loadAll(); });');

const $ = (sel) => w.document.querySelector(sel);
const byId = (id) => w.document.getElementById(id);

console.log('\n1. Approved version loads locked');
w.openFormula('f1');
w.selectVariant('v1');
ok('isLocked() is true', w.isLocked() === true);
ok('ed-layout carries .ed-locked', byId('ed-layout').classList.contains('ed-locked'));
ok('status select disabled', byId('f-status').disabled === true);
ok('method textarea disabled', byId('f-instruct').disabled === true);
ok('percent inputs disabled',
   Array.from(w.document.querySelectorAll('#phase-groups .ing-inp')).length > 0 &&
   Array.from(w.document.querySelectorAll('#phase-groups .ing-inp')).every(e => e.disabled));
ok('remove buttons disabled',
   Array.from(w.document.querySelectorAll('#phase-groups .ing-rm')).every(e => e.disabled));
ok('rows not draggable',
   Array.from(w.document.querySelectorAll('#phase-groups .ing-row')).every(r => r.draggable === false));
ok('ingredient name button stays live',
   Array.from(w.document.querySelectorAll('#phase-groups .ing-name-btn')).every(e => e.disabled === false));
ok('add-ingredient search disabled', byId('ing-search').disabled === true);
ok('batch size stays editable', byId('batch-sz').disabled === false);
ok('formula name stays editable', byId('f-name').disabled === false);
ok('intention stays editable', byId('f-notes').disabled === false);
ok('lock bar shown', /Unlock to edit/.test(byId('lock-bar').innerHTML));

console.log('\n2. Draft version is not locked');
w.selectVariant('v2');
ok('isLocked() is false', w.isLocked() === false);
ok('percent inputs enabled',
   Array.from(w.document.querySelectorAll('#phase-groups .ing-inp')).every(e => e.disabled === false));
ok('rows draggable again',
   Array.from(w.document.querySelectorAll('#phase-groups .ing-row')).every(r => r.draggable === true));
ok('lock bar empty', byId('lock-bar').innerHTML === '');

console.log('\n3. Unlock in place');
w.selectVariant('v1');
w.openUnlock();
ok('unlock modal opened', byId('m-unlock').className.indexOf('open') !== -1);
w.unlockInPlace();
ok('isLocked() now false', w.isLocked() === false);
ok('status select re-enabled', byId('f-status').disabled === false);
ok('percent inputs re-enabled',
   Array.from(w.document.querySelectorAll('#phase-groups .ing-inp')).every(e => e.disabled === false));
ok('bar warns it is unlocked', /Unlocked/.test(byId('lock-bar').innerHTML));

console.log('\n4. Re-lock, and unlock does not survive a reload of the version');
w.relock();
ok('locked again', w.isLocked() === true);
w.unlockInPlace();
w.selectVariant('v2');
w.selectVariant('v1');
ok('unlock forgotten after switching away and back', w.isLocked() === true);

console.log('\n5. Editing while locked still renders after a batch change');
byId('batch-sz').value = '500';
w.onBatchIn('500');
ok('still locked after re-render', w.isLocked() === true);
ok('inputs still disabled after re-render',
   Array.from(w.document.querySelectorAll('#phase-groups .ing-inp')).every(e => e.disabled));

console.log('\n6. Branching from an approved version starts as a draft');
w.selectVariant('v1');
w.openUnlock();
w.unlockViaBranch();
byId('m-branch-name').value = 'Test branch';
w.confirmBranch();
const f = w.forms.find(x => x.id === 'f1');
const nv = f.variants[f.variants.length - 1];
ok('new variant created', nv.label === 'Test branch');
ok('new variant status is draft', nv.status === 'draft');
ok('editor moved to the new variant', w.curVid === nv.vid);
ok('new variant is not locked', w.isLocked() === false);
ok('approved source untouched',
   f.variants.find(v => v.vid === 'v1').status === 'approved');

console.log('\n7. Notes tab has no lock bar');
w.selectVariant('v1');
w.selectNotes();
ok('lock bar cleared on notes tab', byId('lock-bar').innerHTML === '');
ok('isLocked() false while on notes', w.isLocked() === false);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
