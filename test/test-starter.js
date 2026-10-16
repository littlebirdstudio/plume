// Quick add, rebuilt 2026-10-16: Plume's curated starter list merged with the
// Formula Botanica directory (plume-starter.js), SAP taken from the SoapCalc
// reference at the moment an oil is added, and the old "Patch soap data" and
// "Import ingredient reference data" buttons removed.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { ROOT, previewUrl } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const Starter = require(path.join(ROOT, 'plume-starter.js'));
const Sap = require(path.join(ROOT, 'plume-sapdata.js'));
const FB = JSON.parse(fs.readFileSync(path.join(ROOT, 'fb_ingredients.json'), 'utf8'));
const items = [];
Starter.tabs.forEach(t => t.cats.forEach(c => c.items.forEach(i => items.push(i))));
const byName = n => items.find(i => i.name === n);
const norm = x => String(x || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

console.log('\n1. The combined list');
ok('six tabs, the curated five first and unchanged',
   JSON.stringify(Starter.tabs.map(t => t.label)) ===
   JSON.stringify(['Essentials', 'Butters, Oils & EOs', 'Hydrosols, Esters & More', 'Your Ingredients', 'Soap Making', 'Formula Botanica']),
   Starter.tabs.map(t => t.label));
ok('every item has a name, INCI and phase', items.every(i => i.name && i.inci && i.phase),
   items.filter(i => !(i.name && i.inci && i.phase)).map(i => i.name));
ok('no item stores SAP numbers', items.every(i => !(i.soap && (i.soap.naoh || i.soap.koh))),
   items.filter(i => i.soap && (i.soap.naoh || i.soap.koh)).map(i => i.name));
const lost = FB.filter(r => !items.some(i => i.name.toLowerCase() === r.name.toLowerCase()) &&
  !String(r.inci).split(/\s+or\s+|,\s*or\s+/i).map(norm).some(k => items.some(i => norm(i.inci) === k)));
ok('every directory ingredient is in Quick add, as itself or merged', lost.length === 0, lost.map(r => r.name));
ok('directory details reached curated items', byName('Beeswax') && byName('Beeswax').generalInfo && byName('Beeswax').inci === 'Cera Alba');
ok('the curated name and INCI win over the directory\'s', byName('Glycerin') && !byName('Glycerine'));
ok('Red clay stays its own item, not folded into kaolin', !!byName('Red clay'));
ok('Mineral salts stays its own item', !!byName('Mineral salts'));
ok('regular sunflower gets the directory\'s stability note',
   /unstable/i.test((byName('Sunflower oil') || {}).oxidationStability || ''));
ok('high-oleic sunflower does not inherit it',
   !(byName('Sunflower oil (high oleic)') || {}).oxidationStability);
ok('Tapioca starch carries the starch INCI, not an extract\'s',
   (byName('Tapioca starch') || {}).inci === 'Tapioca Starch', (byName('Tapioca starch') || {}).inci);

console.log('\n2. The directory\'s oil names reach SoapCalc');
[['Rosehip oil', 'Rosehip seed oil'], ['Meadowfoam oil', 'Meadowfoam seed oil'], ['Tamanu seed oil', 'Tamanu oil'],
 ['Borage seed oil', 'Borage oil'], ['Flaxseed oil', 'Flax seed oil (linseed)'],
 ['Fractionated coconut oil/ medium chain triglycerides (mct)', 'Fractionated coconut oil']].forEach(([a, b]) => {
  const r = Sap.lookup(a);
  ok('"' + a + '" finds ' + b, r && r.name === b, r && r.name);
});
ok('an oil SoapCalc lacks still finds nothing', Sap.lookup('Neem oil') === null);

(async () => {
  const browser = await chromium.launch();
  const LIB = [
    { id: 'x1', name: 'Distilled water', inci: 'Aqua', phase: 'water', lots: [] },
    { id: 'x2', name: 'Old archived oil', inci: 'Something', phase: 'oil', lots: [], archived: true }
  ];
  async function open() {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', d => d.accept());
    await page.goto(previewUrl('ingredients'));
    await page.waitForTimeout(300);
    await page.evaluate(`localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(LIB))});`);
    await page.reload();
    await page.waitForTimeout(500);
    return { page, errors };
  }
  // Ticks an item by name wherever it sits; returns false if not found.
  const tick = (page, name) => page.evaluate(`(function (n) {
    for (var t = 0; t < SEEDER_BATCHES.length; t++) {
      var cats = SEEDER_BATCHES[t].cats;
      for (var c = 0; c < cats.length; c++) for (var i = 0; i < cats[c].items.length; i++) {
        if (cats[c].items[i].name !== n) continue;
        switchSeederTab(t);
        var cb = document.getElementById('sc-' + t + '-' + c + '-' + i);
        if (!cb || cb.disabled) return false;
        cb.checked = true; seederPick(cb); return true;
      }
    }
    return false;
  })(${JSON.stringify(name)})`);

  console.log('\n3. Settings');
  {
    const { page, errors } = await open();
    await page.evaluate("openModal('modal-settings')");
    const txt = await page.evaluate("document.getElementById('modal-settings').innerText");
    ok('Patch soap data is gone', !/Patch soap data/i.test(txt));
    ok('Import ingredient reference data is gone', !/Import ingredient reference/i.test(txt));
    ok('Quick add and the SAP check remain', /Quick add/.test(txt) && /Check SAP values/.test(txt));
    ok('the old functions are gone too',
       await page.evaluate("typeof patchSoapData === 'undefined' && typeof importReferenceData === 'undefined'"));
    ok('no page errors', errors.length === 0, errors);
    await page.close();
  }

  console.log('\n4. Adding from Quick add');
  {
    const { page, errors } = await open();
    await page.evaluate("openSeeder()");
    await page.waitForTimeout(200);
    ok('six tabs show', (await page.evaluate("document.querySelectorAll('#seeder-tabs .seeder-tab').length")) === 6);
    await page.evaluate("switchSeederTab(0)");
    const water = await page.evaluate(`(function(){var l=Array.from(document.querySelectorAll('#seeder-content .seeder-item')).find(function(x){return /Distilled water/.test(x.innerText);});
      return l ? {cls:l.className, dis:l.querySelector('input').disabled, tag:/in library/i.test(l.innerText)} : null;})()`);
    ok('an ingredient already in the library is marked and cannot be ticked',
       water && /in-lib/.test(water.cls) && water.dis && water.tag, water);
    await page.evaluate("seederToggleAll()");
    ok('select-all leaves the marked ones alone',
       (await page.evaluate("document.querySelectorAll('#seeder-content input:disabled:checked').length")) === 0);
    await page.evaluate("seederToggleAll()");   // clear again

    for (const n of ['Coconut oil (76°)', 'Neem oil', 'Murumuru butter', 'Rosehip oil', 'Beeswax']) {
      ok('can tick ' + n, await tick(page, n));
    }
    await page.evaluate("seederAdd()");
    await page.waitForTimeout(1500);
    const lib = await page.evaluate("JSON.parse(localStorage.getItem('aerie-ingredients-v2'))");
    const f = n => lib.find(i => i.name === n);
    ok('five ingredients were added', lib.length === LIB.length + 5, lib.map(i => i.name));
    ok('coconut arrives with the SoapCalc value, not the old 0.190',
       f('Coconut oil (76°)').soap && Math.abs(f('Coconut oil (76°)').soap.naoh - 0.183) < 0.0001 &&
       Math.abs(f('Coconut oil (76°)').soap.koh - 0.257) < 0.0001, f('Coconut oil (76°)').soap);
    ok('rosehip finds SoapCalc through its directory name',
       f('Rosehip oil') && f('Rosehip oil').soap && f('Rosehip oil').soap.naoh === Sap.lookup('Rosehip seed oil').naoh, f('Rosehip oil'));
    ok('neem, which SoapCalc lacks, arrives with no SAP rather than a guess',
       f('Neem oil') && !(f('Neem oil').soap && f('Neem oil').soap.naoh), f('Neem oil') && f('Neem oil').soap);
    ok('murumuru, unknown on purpose, arrives with no SAP',
       f('Murumuru butter') && !(f('Murumuru butter').soap && f('Murumuru butter').soap.naoh));
    ok('directory details come along', !!f('Beeswax').generalInfo);
    ok('a new ingredient starts with no lots and its own id',
       Array.isArray(f('Neem oil').lots) && f('Neem oil').lots.length === 0 && f('Neem oil').id && f('Neem oil').id !== f('Beeswax').id);
    ok('what was just added now shows as in library',
       await page.evaluate("(function(){switchSeederTab(5);return Array.from(document.querySelectorAll('#seeder-content .seeder-item.in-lib')).some(function(x){return /Neem oil/.test(x.innerText);});})()"));
    ok('no page errors', errors.length === 0, errors);
    await page.close();
  }

  console.log('\n5. Ticks survive switching tabs');
  {
    const { page } = await open();
    await page.evaluate("openSeeder()");
    ok('tick on one tab', await tick(page, 'Jojoba oil') || await tick(page, 'Shea butter'));
    ok('tick on another', await tick(page, 'Neem oil'));
    await page.evaluate("switchSeederTab(0)");
    ok('the count still includes both', /^2 selected/.test(await page.evaluate("document.getElementById('seeder-count').textContent")));
    await page.evaluate("switchSeederTab(5)");
    ok('and the earlier tick is still shown when you come back',
       await page.evaluate("Array.from(document.querySelectorAll('#seeder-content input:checked')).some(function(c){return /Neem oil/.test(c.parentNode.innerText);})"));
    await page.close();
  }

  console.log('\n6. The same item ticked on two tabs is added once');
  {
    const { page } = await open();
    await page.evaluate("openSeeder()");
    const twice = await page.evaluate(`(function(){var n=0;SEEDER_BATCHES.forEach(function(t,ti){t.cats.forEach(function(c,ci){c.items.forEach(function(it,ii){
      if(it.name==='Cetyl alcohol'){switchSeederTab(ti);var cb=document.getElementById('sc-'+ti+'-'+ci+'-'+ii);
      if(cb){cb.checked=true;seederPick(cb);n++;}}});});});return n;})()`);
    ok('Cetyl alcohol appears on more than one tab', twice >= 2, twice);
    await page.evaluate("seederAdd()");
    await page.waitForTimeout(800);
    const n = await page.evaluate("JSON.parse(localStorage.getItem('aerie-ingredients-v2')).filter(function(i){return i.name==='Cetyl alcohol';}).length");
    ok('and lands in the library exactly once', n === 1, n);
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
