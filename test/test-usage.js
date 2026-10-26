// Usage, her model (2026-10-26, v1.57). Recommended is a range for optimal
// function (outside it, a quiet note); the safe limit is one-directional
// ("safe up to", or no upper limit, or not established, which are not the
// same); a preservative has an effective range in place of Recommended
// (outside it, a firm warning); a usage note comes up when an amount is
// outside a range; Caution replaces Restricted and keeps the orange dot.
// Also: older records read through the old fields until saved, an update
// file applies the review after a preview, new formula lines start blank,
// and the starter list carries the new fields.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');
const { ROOT, previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const lot = (id, g, cost) => ({ id, qtyPurchased: String(g), qtyUnit: 'g', costPerG: cost, supplier: 'X', received: '2026-08-20' });
const INGS = [
  // New model.
  { id: 'nia', name: 'Niacinamide', inci: 'Niacinamide', phase: 'water', functionCategory: ['Active'], usageV2: true,
    recMin: '2', recMax: '5', safeMax: '10', usageNote: 'Above 5% can flush sensitive skin.', lots: [lot('n1', 100, 0.1)] },
  { id: 'opt', name: 'Optiphen Plus', inci: 'Phenoxyethanol', phase: 'cool-down', functionCategory: ['Preservative'], usageV2: true,
    effMin: '0.75', effMax: '1.5', safeMax: '1.5', lots: [lot('o1', 100, 0.2)] },
  { id: 'hyd', name: 'Rose hydrosol', inci: 'Rosa Damascena Flower Water', phase: 'water', usageV2: true,
    recMin: '10', recMax: '100', safeMax: 'none', lots: [lot('h1', 500, 0.02)] },
  { id: 'unk', name: 'Snow mushroom', inci: 'Tremella Fuciformis Extract', phase: 'water', usageV2: true,
    recMin: '0.5', recMax: '5', safeMax: '', lots: [lot('s1', 50, 0.3)] },
  { id: 'lav', name: 'Lavender essential oil', inci: 'Lavandula Angustifolia Oil', phase: 'cool-down', usageV2: true,
    recMin: '0.5', recMax: '1', safeMax: '1', caution: 'Must be diluted before skin use.', lots: [lot('l1', 30, 0.5)] },
  // Old fields, never saved since: read through the legacy reading.
  { id: 'gly', name: 'Glycerin', inci: 'Glycerin', phase: 'water', useRate: '2–5%', min: '1', max: '10', lots: [lot('g1', 500, 0.01)] },
  { id: 'jo', name: 'Jojoba oil', inci: 'Simmondsia Chinensis Seed Oil', phase: 'oil', min: '1', max: '100', lots: [lot('j1', 500, 0.04)] },
  { id: 'geo', name: 'Geogard', inci: 'Gluconolactone', phase: 'cool-down', functionCategory: ['Preservative'], min: '0.75', max: '1.5', lots: [] },
  { id: 'ylg', name: 'Ylang ylang', inci: 'Cananga Odorata Flower Oil', phase: 'cool-down', flag: 'yes', restrictions: 'Sensitizer.', max: '0.8', lots: [] },
  { id: 'old', name: 'Old flag only', inci: 'X', phase: 'oil', flag: 'yes', lots: [] }
];
const V = (vid, lines) => ({ vid, num: 1, label: '', status: 'draft', lines, instructions: '', batchSize: 100, usageLog: [], history: [] });
const lines = [
  { ingId: 'nia', pct: 12 },        // over the safe limit: firm
  { ingId: 'gly', pct: 1 },         // below recommended (legacy): quiet
  { ingId: 'opt', pct: 0.5 },       // below effective: firm
  { ingId: 'hyd', pct: 60 },        // in range, no upper limit
  { ingId: 'unk', pct: 8 },         // above recommended, limit not established: quiet only
  { ingId: 'jo', pct: 18.5 },
  { ingId: 'lav', addin: true, gramsFixed: '2' }  // an add-in: 2 g in 100 g is 2%, over 1%
];
const FORMS = [{ id: 'fs', name: 'Serum', type: 'Serum', status: 'draft', lines, variants: [V('vs', lines)], activeVariantId: 'vs' },
               { id: 'fe', name: 'Empty', type: 'Serum', status: 'draft', lines: [], variants: [V('ve', [])], activeVariantId: 've' }];
const SEED = `
  localStorage.clear();
  localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(INGS))});
  localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});
  localStorage.setItem('plume-theme', 'light');`;
const getIngs = "JSON.parse(localStorage.getItem('aerie-ingredients-v2'))";

console.log('\n0. The starter list');
{
  const c = {}; vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'plume-starter.js'), 'utf8') + ';this.PS = PlumeStarter;', c);
  const items = c.PS.items, by = n => items.find(i => i.name === n);
  ok('257 items, every one on the new fields', items.length === 257 && items.every(i => i.usageV2 === true), items.length);
  ok('none carries the old min, max, flag or restrictions', items.every(i => !('min' in i) && !('max' in i) && !('flag' in i) && !('restrictions' in i)),
     items.filter(i => 'min' in i || 'max' in i || 'flag' in i).map(i => i.name));
  ok('removed at her direction', ['Comfrey', 'Orris root', 'Black seed oil', 'Berry wax', 'Camellia oil (tea seed)'].every(n => !by(n)));
  ok('Red clay lists the three clays it can be', by('Red clay').inci === 'Illite / Montmorillonite / Kaolin' && /edit it to match/.test(by('Red clay').usageNote));
  const pres = items.filter(i => /Preservatives/.test(i.type) && (i.effMin || i.effMax));
  ok('preservatives carry an effective range, no Recommended, and the Preservative function', pres.length >= 8 && pres.every(i => [].concat(i.functionCategory || []).indexOf('Preservative') !== -1) && pres.every(i => !i.recMin && !i.recMax), pres.filter(i => i.recMin || i.recMax).map(i => i.name));
  const f = parseFloat;
  ok('no range runs above its safe limit', items.every(i => !(i.safeMax && i.safeMax !== 'none' && ((i.recMax && f(i.recMax) > f(i.safeMax)) || (i.effMax && f(i.effMax) > f(i.safeMax))))),
     items.filter(i => i.safeMax && i.safeMax !== 'none' && i.recMax && f(i.recMax) > f(i.safeMax)).map(i => i.name));
  ok('safe limits are numbers, none, or left out', items.every(i => i.safeMax === undefined || i.safeMax === 'none' || /^\d*\.?\d+$/.test(i.safeMax)));
  ok('Arginine says its amount depends on use', /pH adjuster/.test(by('Arginine').usageNote || ''));
  ok('Ylang ylang takes her safe limit', by('Ylang ylang essential oil').safeMax === '0.8');
}

(async () => {
  const browser = await chromium.launch();
  const errors = [], dialogs = [];
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await trackDialogs(page, dialogs);
  await page.goto(previewUrl('ingredients')); await page.evaluate(SEED); await page.reload(); await page.waitForTimeout(500);

  console.log('\n1. Reading usage');
  const r = await page.evaluate(`(function () {
    var by = function (id) { return ingredients.filter(function (i) { return i.id === id; })[0]; };
    var t = function (id, o) { return Plume.usageText(by(id), o); };
    return { nia: t('nia'), opt: t('opt'), hyd: t('hyd'), unk: t('unk'), gly: t('gly'), jo: t('jo'), geo: t('geo'), niaS: t('nia', { short: true }),
      ylg: Plume.usage(by('ylg')), old: Plume.usage(by('old')).caution };
  })()`);
  ok('Recommended and the safe limit in one line', r.nia === 'Recommended 2–5% · safe up to 10%', r.nia);
  ok('a preservative shows its effective range instead', r.opt === 'Effective 0.75–1.5% · safe up to 1.5%', r.opt);
  ok('no upper limit and not established read differently', r.hyd === 'Recommended 10–100% · no upper limit' && r.unk === 'Recommended 0.5–5% · safe limit not established', [r.hyd, r.unk]);
  ok('an old record: its recommended text and its max as the safe limit', r.gly === 'Recommended 2–5% · safe up to 10%', r.gly);
  ok('an old max of 100 meant no limit', /no upper limit/.test(r.jo), r.jo);
  ok('an old preservative min–max is its effective range', /^Effective 0\.75–1\.5%/.test(r.geo), r.geo);
  ok('the short form for the list', r.niaS === '2–5% · up to 10%', r.niaS);
  ok('an old restriction note becomes the caution', r.ylg.caution === 'Sensitizer.' && r.ylg.safeMax === '0.8', r.ylg);
  ok('an old flag with no note still counts as a caution', !!r.old, r.old);
  const ck = await page.evaluate(`(function () {
    var by = function (id) { return ingredients.filter(function (i) { return i.id === id; })[0]; };
    var c = function (id, p) { return Plume.usageCheck(by(id), p).map(function (x) { return x.level; }).join(','); };
    return [c('nia', 3), c('nia', 1), c('nia', 7), c('nia', 12), c('opt', 0.5), c('opt', 1), c('opt', 2), c('hyd', 100), c('unk', 50), c('nia', 0)];
  })()`);
  ok('in range: nothing', ck[0] === '' && ck[5] === '' && ck[7] === '', ck);
  ok('below or above Recommended: quiet', ck[1] === 'quiet' && ck[2] === 'quiet', ck);
  ok('over the safe limit: firm (and above Recommended too)', ck[3] === 'firm,quiet', ck);
  ok('a preservative below or above its effective range: firm', ck[4] === 'firm' && ck[6] === 'firm', ck);
  ok('limit not established: no firm warning, only the quiet note', ck[8] === 'quiet', ck);
  ok('a blank amount says nothing', ck[9] === '', ck);

  console.log('\n2. The list');
  const cell = await page.evaluate("Array.from(document.querySelectorAll('#tbody tr')).map(function (tr) { return tr.innerText.replace(/\\s+/g, ' '); }).filter(function (t) { return /Niacinamide|Ylang/.test(t); })");
  ok('the list shows the short usage', cell.some(t => /Niacinamide.*2–5% · up to 10%/.test(t)), cell);

  console.log('\n3. Editing');
  await page.evaluate("viewIngredient('gly'); editCurrent('basics')"); await page.waitForTimeout(200);
  const loaded = await page.evaluate("['f-recmin','f-recmax','f-safe-kind','f-safemax','f-effmin','f-effmax','f-usagenote','f-caution'].map(function (id) { return document.getElementById(id).value; })");
  ok('an old record loads into the new fields', JSON.stringify(loaded) === JSON.stringify(['2', '5', 'num', '10', '', '', '', '']), loaded);
  await page.evaluate("document.getElementById('f-recmax').value = '1'; saveIngredient(false)"); await page.waitForTimeout(200);
  ok('a range that runs high to low is refused', dialogs.some(d => /low to high/.test(d)), dialogs);
  dialogs.length = 0;
  await page.evaluate("document.getElementById('f-recmax').value = '12'; saveIngredient(false)"); await page.waitForTimeout(200);
  ok('a range above the safe limit is refused', dialogs.some(d => /above the safe limit/.test(d)), dialogs);
  dialogs.length = 0;
  await page.evaluate(`document.getElementById('f-recmax').value = '7';
    document.getElementById('f-safe-kind').value = 'none'; syncSafeKind('f');
    document.getElementById('f-usagenote').value = 'Sticky above 7%.';
    document.getElementById('f-caution').value = 'Test caution.';
    saveIngredient(false)`); await page.waitForTimeout(250);
  let g = (await page.evaluate(getIngs)).find(i => i.id === 'gly');
  ok('saved on the new fields', g.usageV2 === true && g.recMin === '2' && g.recMax === '7' && g.safeMax === 'none' && g.usageNote === 'Sticky above 7%.' && g.caution === 'Test caution.', g);
  ok('the old fields are gone, kept once in its history', g.useRate === undefined && g.min === undefined && g.max === undefined && g.usageOld && g.usageOld.useRate === '2–5%' && g.usageOld.max === '10', g);
  await page.evaluate("viewIngredient('gly'); editCurrent('basics')"); await page.waitForTimeout(150);
  ok('No upper limit turns the number box off', await page.evaluate("document.getElementById('f-safe-kind').value === 'none' && document.getElementById('f-safemax').disabled"));
  await page.evaluate("document.getElementById('f-safe-kind').value = ''; syncSafeKind('f'); saveIngredient(false)"); await page.waitForTimeout(200);
  g = (await page.evaluate(getIngs)).find(i => i.id === 'gly');
  ok('Not established saves as blank, not as no limit', g.safeMax === '' && g.usageOld.useRate === '2–5%', g);
  await page.evaluate("closeModal('modal-add')");

  console.log('\n4. Updating from a file');
  const upd = { kind: 'plume-ingredient-update', title: 'Usage review', updates: [
    { id: 'jo', name: 'Jojoba oil', usage: { recMin: '1', recMax: '100', safeMax: 'none', effMin: '', effMax: '', usageNote: 'Can be used neat.', caution: '' } },
    { id: 'zzz', name: 'Renamed geogard', usage: { recMin: '', recMax: '', safeMax: '1.5', effMin: '0.75', effMax: '1.5', usageNote: '', caution: '' } },
    { id: 'nope', name: 'Not here', usage: { recMin: '1', recMax: '2', safeMax: '', effMin: '', effMax: '', usageNote: '', caution: '' } },
    { id: 'nia', name: 'Niacinamide', usage: { recMin: '2', recMax: '5', safeMax: '10', effMin: '', effMax: '', usageNote: 'Above 5% can flush sensitive skin.', caution: '' } }
  ] };
  fs.writeFileSync(path.join(__dirname, 'tmp', 'usage-update.json'), JSON.stringify(upd));
  // Matched by id, then by name: rename Geogard so only its id would miss.
  await page.evaluate("var a = " + getIngs + "; a.filter(function (i) { return i.id === 'geo'; })[0].name = 'Renamed geogard'; localStorage.setItem('aerie-ingredients-v2', JSON.stringify(a));");
  await page.reload(); await page.waitForTimeout(400);
  dialogs.length = 0;
  await page.evaluate("window.PLUME_TEST_ANSWER = false");
  await page.setInputFiles('#import-file-input', path.join(__dirname, 'tmp', 'usage-update.json')); await page.waitForTimeout(400);
  ok('the preview lists only what changes, and what is not in the library', dialogs.length === 1 && /Update 2 ingredients\?/.test(dialogs[0]) && /Jojoba oil/.test(dialogs[0]) && /Renamed geogard/.test(dialogs[0]) && /Not here/.test(dialogs[0]) && !/Niacinamide/.test(dialogs[0]), dialogs);
  let L = await page.evaluate(getIngs);
  ok('saying no changes nothing', !L.find(i => i.id === 'jo').usageV2, L.find(i => i.id === 'jo'));
  dialogs.length = 0;
  await page.evaluate("window.PLUME_TEST_ANSWER = undefined");
  await page.setInputFiles('#import-file-input', path.join(__dirname, 'tmp', 'usage-update.json')); await page.waitForTimeout(400);
  L = await page.evaluate(getIngs);
  const jo = L.find(i => i.id === 'jo'), geo = L.find(i => i.id === 'geo');
  ok('saying yes applies them', jo.usageV2 && jo.safeMax === 'none' && jo.usageNote === 'Can be used neat.' && geo.usageV2 && geo.effMin === '0.75' && geo.recMin === '', [jo, geo]);
  ok('each keeps its old values once, and drops the old fields', jo.usageOld && jo.usageOld.max === '100' && jo.min === undefined && geo.usageOld.min === '0.75' && geo.max === undefined, [jo, geo]);
  ok('nothing new was added', L.length === INGS.length, L.length);
  dialogs.length = 0;
  await page.setInputFiles('#import-file-input', path.join(__dirname, 'tmp', 'usage-update.json')); await page.waitForTimeout(400);
  ok('the same file again has nothing to do', dialogs.length === 1 && /Nothing to update/.test(dialogs[0]), dialogs);

  console.log('\n5. Formulations');
  await page.goto(previewUrl('formulations')); await page.evaluate(SEED); await page.reload(); await page.waitForTimeout(400);
  await page.evaluate("openFormula('fs')"); await page.waitForTimeout(250);
  const rows = await page.evaluate("Array.from(document.querySelectorAll('#phase-groups .ing-row')).map(function (r) { return { t: r.innerText.replace(/\\s+/g, ' '), warn: r.classList.contains('warn'), dot: !!r.querySelector('.caution-dot'), tip: (r.querySelector('.rec-note.has-note') || {}).title || '' }; })");
  const row = n => rows.find(x => x.t.indexOf(n) !== -1) || {};
  ok('over the safe limit: a firm warning, with the note', row('Niacinamide').warn && /12% is over the safe limit \(10%\)/.test(row('Niacinamide').t) && /flush sensitive skin/.test(row('Niacinamide').t), row('Niacinamide'));
  ok('every line shows its numbers', /Recommended 2–5% · safe up to 10%/.test(row('Niacinamide').t) && /Effective 0\.75–1\.5%/.test(row('Optiphen').t), rows.map(x => x.t));
  ok('below Recommended: a quiet note, no warning', !row('Glycerin').warn && /Below recommended \(2–5%\)/.test(row('Glycerin').t), row('Glycerin'));
  ok('a preservative below its effective range: firm', row('Optiphen').warn && /below the effective range/.test(row('Optiphen').t), row('Optiphen'));
  ok('in range: no note, no warning', !row('Rose hydrosol').warn && !/recommended/i.test(row('Rose hydrosol').t.replace('Recommended 10–100%', '')), row('Rose hydrosol'));
  ok('limit not established: quiet only', !row('Snow mushroom').warn && /Above recommended/.test(row('Snow mushroom').t), row('Snow mushroom'));
  ok('an add-in is checked by its share of the batch', row('Lavender').warn && /2% is over the safe limit \(1%\)/.test(row('Lavender').t), row('Lavender'));
  ok('a caution keeps the orange dot and its line', row('Lavender').dot && /Caution: Must be diluted/.test(row('Lavender').t), row('Lavender'));
  await page.evaluate("fLines.filter(function (l) { return l.ingId === 'nia'; })[0].pct = 3; renderLines()"); await page.waitForTimeout(100);
  const nia = await page.evaluate("(function () { var r = Array.from(document.querySelectorAll('#phase-groups .ing-row')).filter(function (r) { return /Niacinamide/.test(r.innerText); })[0]; return { t: r.innerText, tip: (r.querySelector('.rec-note.has-note') || {}).title || '' }; })()");
  ok('in range, the usage note waits under the numbers', !/flush sensitive skin/.test(nia.t) && /flush sensitive skin/.test(nia.tip), nia);
  await page.evaluate("openFormula('fe'); addIng('nia')"); await page.waitForTimeout(150);
  ok('a new line starts blank', await page.evaluate("fLines[fLines.length - 1].pct === '' || fLines[fLines.length - 1].pct === undefined"));
  await page.evaluate("showIngDetail('lav')"); await page.waitForTimeout(100);
  const pop = await page.evaluate("document.getElementById('id-body').innerText");
  ok('the popup has the safe limit and the caution, not Recommended', /Safe limit\s*Safe up to 1%/i.test(pop) && /Caution\s*Must be diluted/i.test(pop) && !/Recommended/.test(pop), pop);

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
