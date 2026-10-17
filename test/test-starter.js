// Quick add, rebuilt 2026-10-16 as a comprehensive starter list for a general
// audience (plume-starter.js v2): one list organized by ingredient type, one
// entry per ingredient, no borrowed prose, no stored SAP numbers (taken from
// the SoapCalc reference as an oil is added), with search and type chips in
// place of tabs. The old "Patch soap data" and "Import ingredient reference
// data" buttons are gone.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { ROOT, previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const Starter = require(path.join(ROOT, 'plume-starter.js'));
const Sap = require(path.join(ROOT, 'plume-sapdata.js'));
const FB = JSON.parse(fs.readFileSync(path.join(ROOT, 'fb_ingredients.json'), 'utf8'));
const items = Starter.items;
const byName = n => items.find(i => i.name === n);
const norm = x => String(x || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

console.log('\n1. The list');
ok('a comprehensive list', items.length >= 250, items.length);
ok('every item has a name, INCI, phase and a listed type',
   items.every(i => i.name && i.inci && i.phase && Starter.types.indexOf(i.type) !== -1),
   items.filter(i => !(i.name && i.inci && i.phase && Starter.types.indexOf(i.type) !== -1)).map(i => i.name));
ok('every type has ingredients', Starter.types.every(t => items.some(i => i.type === t)),
   Starter.types.filter(t => !items.some(i => i.type === t)));
ok('organized by type, not by history or source',
   Starter.types.indexOf('Your Ingredients') === -1 && Starter.types.indexOf('Formula Botanica') === -1, Starter.types);
const names = items.map(i => i.name.toLowerCase());
ok('one entry per name', new Set(names).size === names.length,
   names.filter((n, i) => names.indexOf(n) !== i));
ok('purchasing variants folded', !items.some(i => /\((organic|soap grade)\)/i.test(i.name)),
   items.filter(i => /\((organic|soap grade)\)/i.test(i.name)).map(i => i.name));
ok('real grades kept apart',
   !!byName('Coconut oil, virgin') && !!byName('Coconut oil (76°)') &&
   !!byName('Sunflower oil') && !!byName('Sunflower oil (high oleic)') &&
   !!byName('Hyaluronic acid (LMW)') && !!byName('Hyaluronic acid (HMW)'));
ok('the two camellias stay apart (different species)',
   /sinensis/i.test((byName('Camellia oil (tea seed)') || {}).inci) && /japonica|oleifera/i.test((byName('Camellia seed oil') || {}).inci));
ok('no borrowed prose', items.every(i => !i.generalInfo), items.filter(i => i.generalInfo).map(i => i.name));
ok('no stored SAP numbers', items.every(i => !(i.soap && (i.soap.naoh || i.soap.koh))));
const known = n => items.some(i => i.name.toLowerCase() === n.toLowerCase() || (i.aka || []).some(a => a.toLowerCase() === n.toLowerCase()));
const lost = FB.filter(r => !known(r.name) &&
  !String(r.inci).split(/\s+or\s+|,\s*or\s+/i).map(norm).some(k => items.some(i => norm(i.inci) === k)));
ok('every directory ingredient is still offered, as itself or merged', lost.length === 0, lost.map(r => r.name));
// Her library holds the directory's names from the old import; those must
// still be recognised, except where one name covers two grades (which grade
// her "Coconut oil" is cannot be known).
const unrec = FB.filter(r => !known(r.name)).map(r => r.name).sort();
ok('directory names are recognised, bar the three that cover two grades',
   JSON.stringify(unrec) === JSON.stringify(['Aloe vera', 'Coconut oil', 'Sodium hyaluronate']), unrec);
ok('folded names are kept as former names', (byName('Rosehip seed oil').aka || []).indexOf('Rosehip oil') !== -1);
ok('short factual fields survive', !!(byName('Shea butter') || {}).meltingPoint || !!(byName('Mango butter') || {}).meltingPoint);
ok('Red clay is its own item, not folded into kaolin', !!byName('Red clay'));
ok('high-oleic sunflower does not inherit "unstable"', !(byName('Sunflower oil (high oleic)') || {}).oxidationStability);
ok('Tapioca starch carries the starch INCI', (byName('Tapioca starch') || {}).inci === 'Tapioca Starch');
ok('carrot seed carrier oil and essential oil are two entries',
   byName('Carrot seed oil') && byName('Carrot seed oil').type === 'Carrier oils' &&
   byName('Carrot seed essential oil') && byName('Carrot seed essential oil').type === 'Essential oils');
ok('pH adjusters have their own type', (byName('Citric acid') || {}).type === 'pH adjusters' && (byName('Arginine') || {}).type === 'pH adjusters');
ok('rosemary CO2 extract sits with the antioxidants', /antioxidants/.test((byName('Rosemary CO2 extract') || {}).type));
ok('no INCI is left cut off mid-list', items.every(i => !/(\(and\)|\bor)\s*$/.test(i.inci)),
   items.filter(i => /(\(and\)|\bor)\s*$/.test(i.inci)).map(i => i.name + ': ' + i.inci));
ok('waters are tagged Base / solvent', ['Distilled water', 'Rose hydrosol', 'Aloe vera juice'].every(n => (byName(n).functionCategory || []).indexOf('Base / solvent') !== -1));
ok('hydrosols are co-tagged Fragrance (her call)', items.filter(i => /hydrosol/i.test(i.name)).every(i => (i.functionCategory || []).indexOf('Fragrance') !== -1));
ok('lowdowns say inexpensive, not cheap', items.every(i => !/\bcheap/i.test(i.chooseWhen || '')),
   items.filter(i => /\bcheap/i.test(i.chooseWhen || '')).map(i => i.name));
ok('directory brand names are properly cased',
   !!byName('Sucragel AOF Bio') && !!byName('Spectrastat G2 Natural (MB)') && !!byName('SCS (sodium coco sulfate)'));

console.log('\n2. Oils reach SoapCalc by their starter names');
const oils = items.filter(i => /Carrier oils|Butters and fats|Waxes/.test(i.type));
const expected = ['Shea butter', 'Olive oil', 'Coconut oil (76°)', 'Coconut oil, virgin', 'Castor oil', 'Grapeseed oil',
  'Apricot kernel oil', 'Baobab oil', 'Marula oil', 'Pomegranate seed oil', 'Camellia oil (tea seed)', 'Rosehip seed oil',
  'Meadowfoam seed oil', 'Tamanu oil', 'Borage seed oil', 'Flaxseed oil', 'Fractionated coconut oil', 'Beeswax', 'Canola oil (rapeseed)'];
expected.forEach(n => ok(n + ' finds its SoapCalc row', !!Sap.lookup(n), n));
ok('an oil SoapCalc lacks finds nothing', Sap.lookup('Neem oil') === null);
ok('most oils, butters and waxes are covered', oils.filter(i => Sap.lookup(i.name)).length >= 50,
   oils.filter(i => Sap.lookup(i.name)).length);

(async () => {
  const browser = await chromium.launch();
  const LIB = [
    { id: 'x1', name: 'Distilled water', inci: 'Aqua', phase: 'water', lots: [] },
    { id: 'x2', name: 'Grapeseed oil (organic)', inci: 'Vitis Vinifera (Grape) Seed Oil', phase: 'oil', lots: [] },
    { id: 'x4', name: 'Rosehip oil', inci: 'Rosa Canina Fruit Oil', phase: 'oil', lots: [] },
    { id: 'x3', name: 'Old archived oil', inci: 'Something', phase: 'oil', lots: [], archived: true }
  ];
  async function open() {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await trackDialogs(page, []);
    await page.goto(previewUrl('ingredients'));
    await page.waitForTimeout(300);
    await page.evaluate(`localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(LIB))});`);
    await page.reload();
    await page.waitForTimeout(500);
    return { page, errors };
  }
  const shownNames = page => page.evaluate("Array.from(document.querySelectorAll('#seeder-content .seeder-item-name')).map(function(e){return e.textContent;})");
  const row = (page, n) => page.evaluate(`(function(n){var l=Array.from(document.querySelectorAll('#seeder-content .seeder-item')).find(function(x){return x.querySelector('.seeder-item-name').textContent===n;});
    return l ? {cls:l.className, dis:l.querySelector('input').disabled, tag:/in library/i.test(l.innerText), id:l.querySelector('input').id} : null;})(${JSON.stringify(n)})`);
  const search = (page, q) => page.evaluate(`(function(){var s=document.getElementById('seeder-search');s.value=${JSON.stringify(q)};setSeederQuery(s.value);})()`);
  async function tick(page, n) {
    await search(page, n);
    const r = await row(page, n);
    if (!r || r.dis) return false;
    await page.evaluate(`(function(){var c=document.getElementById('${r.id}');c.checked=true;seederPick(c);})()`);
    return true;
  }

  console.log('\n3. Settings');
  {
    const { page, errors } = await open();
    await page.evaluate("openModal('modal-settings')");
    const txt = await page.evaluate("document.getElementById('modal-settings').innerText");
    ok('Patch soap data is gone', !/Patch soap data/i.test(txt));
    ok('Import ingredient reference data is gone', !/Import ingredient reference/i.test(txt));
    ok('Quick add and the SAP check remain', /Quick add/.test(txt) && /Check SAP values/.test(txt));
    ok('their code is gone too',
       await page.evaluate("typeof patchSoapData === 'undefined' && typeof importReferenceData === 'undefined'"));
    ok('no page errors', errors.length === 0, errors);
    await page.close();
  }

  console.log('\n4. Browsing: chips and search');
  {
    const { page, errors } = await open();
    await page.evaluate("openSeeder()");
    ok('a type choice for All plus every type',
       (await page.evaluate("document.querySelectorAll('#seeder-type option').length")) === Starter.types.length + 1);
    ok('All shows the whole list', (await shownNames(page)).length === items.length);
    await page.evaluate("setSeederType('Waxes')");
    const waxes = await shownNames(page);
    ok('choosing a type narrows to it', waxes.length === items.filter(i => i.type === 'Waxes').length && waxes.indexOf('Beeswax') !== -1, waxes);
    await page.evaluate("setSeederType('')");
    await search(page, 'rose');
    const rose = await shownNames(page);
    ok('search finds across types', rose.indexOf('Rose hydrosol') !== -1 && rose.indexOf('Rosehip seed oil') !== -1, rose);
    await search(page, 'thickener');
    ok('search reaches what an ingredient does', (await shownNames(page)).length > 0);
    await search(page, 'zzzz');
    ok('no match says so', /No starter ingredients match/.test(await page.evaluate("document.getElementById('seeder-content').innerText")));
    await search(page, '');
    const water = await row(page, 'Distilled water');
    ok('an ingredient already in the library is marked and cannot be ticked',
       water && /in-lib/.test(water.cls) && water.dis && water.tag, water);
    const grape = await row(page, 'Grapeseed oil');
    ok('"(organic)" in the library still counts as in library', grape && grape.dis, grape);
    const rh = await row(page, 'Rosehip seed oil');
    ok('a former name in the library ("Rosehip oil") counts as in library', rh && rh.dis, rh);
    await search(page, 'rosehip oil');
    ok('searching a former name finds the entry', (await shownNames(page)).indexOf('Rosehip seed oil') !== -1);
    await search(page, '');
    ok('no page errors', errors.length === 0, errors);
    await page.close();
  }

  console.log('\n5. Ticks survive searching and switching type');
  {
    const { page } = await open();
    await page.evaluate("openSeeder()");
    ok('tick one', await tick(page, 'Shea butter'));
    ok('tick another after a new search', await tick(page, 'Neem oil'));
    await page.evaluate("setSeederType('Essential oils')");
    ok('the count keeps both', /^2 selected/.test(await page.evaluate("document.getElementById('seeder-count').textContent")));
    await search(page, ''); await page.evaluate("setSeederType('')");
    ok('and both are still ticked in the full list',
       await page.evaluate("['Shea butter','Neem oil'].every(function(n){var l=Array.from(document.querySelectorAll('#seeder-content .seeder-item')).find(function(x){return x.querySelector('.seeder-item-name').textContent===n;});return l&&l.querySelector('input').checked;})"));
    await page.evaluate("setSeederType('Waxes')");
    await page.evaluate("seederToggleAll()");
    const n = items.filter(i => i.type === 'Waxes').length;
    ok('select-all takes only what is shown', new RegExp('^' + (2 + n) + ' selected').test(await page.evaluate("document.getElementById('seeder-count').textContent")),
       await page.evaluate("document.getElementById('seeder-count').textContent"));
    await page.close();
  }

  console.log('\n6. Adding');
  {
    const { page, errors } = await open();
    await page.evaluate("openSeeder()");
    for (const n of ['Coconut oil (76°)', 'Neem oil', 'Murumuru butter', 'Jojoba oil', 'Beeswax', 'Camellia oil (tea seed)']) {
      ok('can tick ' + n, await tick(page, n));
    }
    await page.evaluate("seederAdd()");
    await page.waitForTimeout(300);
    const lib = await page.evaluate("JSON.parse(localStorage.getItem('aerie-ingredients-v2'))");
    const f = n => lib.find(i => i.name === n);
    ok('six were added and saved', lib.length === LIB.length + 6, lib.map(i => i.name));
    ok('coconut takes the SoapCalc value, not the old 0.190',
       Math.abs(f('Coconut oil (76°)').soap.naoh - 0.183) < 0.0001 && Math.abs(f('Coconut oil (76°)').soap.koh - 0.257) < 0.0001, f('Coconut oil (76°)').soap);
    ok('camellia (tea seed) takes its SoapCalc value', f('Camellia oil (tea seed)').soap && f('Camellia oil (tea seed)').soap.naoh === 0.138);
    ok('neem, which SoapCalc lacks, arrives with no SAP', !(f('Neem oil').soap && f('Neem oil').soap.naoh));
    ok('murumuru, unknown on purpose, arrives with no SAP', !(f('Murumuru butter').soap && f('Murumuru butter').soap.naoh));
    ok('the grouping type and former names are not stored on the ingredient', lib.every(i => i.type === undefined && i.aka === undefined));
    ok('no borrowed prose arrives', lib.every(i => !i.generalInfo));
    ok('each starts with no lots and its own id',
       f('Neem oil').lots.length === 0 && new Set(lib.map(i => i.id)).size === lib.length);
    await search(page, 'neem');
    ok('what was added now shows as in library', !!(await row(page, 'Neem oil')).dis);
    ok('the status line reports it', /Added 6 ingredients/.test(await page.evaluate("document.getElementById('seeder-status').textContent")));
    ok('no page errors', errors.length === 0, errors);
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
