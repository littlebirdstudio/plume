// Small fixes (2026-10-26, v1.55): the smaller items from the 24 October
// bug sweep and the 25 October scan. Each check fails on the old code.
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}
const today = (() => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Anchorage' })); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
const lot = (id, extra) => Object.assign({ id: id, supplier: 'Lotioncrafter', qtyPurchased: '500', qtyUnit: 'g', costPerG: '0.02', received: '2026-09-01' }, extra || {});
const INGS = [
  { id: 'ia', name: 'Argan oil', inci: 'Argania Spinosa Kernel Oil', phase: 'oil', functionCategory: ['Emollient'], lots: [lot('L1', { organic: true })], activeLotId: 'L1' },
  { id: 'iw', name: 'Distilled water', inci: 'Aqua', phase: 'water', lots: [lot('L1')], activeLotId: 'L1' },
  { id: 'ir', name: 'Rosehip oil', inci: 'Rosa Canina Seed Oil', phase: 'oil', lots: [lot('L1', { bestBy: today })], activeLotId: 'L1' },
  { id: 'iv', name: 'Vitamin C', inci: 'Ascorbic Acid', phase: 'active', lots: [lot('L1', { bestBy: '2026-11-01' })], activeLotId: 'L1', useRate: '2% leave-on, 1% rinse-off' },
  { id: 'io', name: 'Mystery', inci: 'Something', phase: 'other', lots: [], useRate: '2–5%' },
  // A stock solution made here: two batches' lots, the newer one prices it.
  { id: 'ih', name: 'HA solution', inci: 'Aqua, Sodium Hyaluronate', phase: 'water', madeBy: 'fh',
    lots: [lot('L-made-b1', { supplier: 'Made in-house', madeBatchId: 'b1', received: '2026-10-10', costPerG: '0.05', madeG: 200 })], activeLotId: 'L-made-b1' }
];
const L = (ingId, pct) => ({ ingId: ingId, pct: String(pct) });
const V = (id, lines) => ({ vid: 'v' + id, num: 1, label: '', status: 'approved', lines: lines, batchSize: '100', usageLog: [], history: [] });
const F = (id, name, type, lines) => ({ id: id, name: name, type: type, status: 'approved', lines: lines, variants: [V(id, lines)], activeVariantId: 'v' + id });
const FORMS = [F('fa', 'Argan serum', 'Face serum', [L('iw', 90), L('ia', 10)]), F('fh', 'HA solution', 'Stock solution', [L('iw', 100)])];
const PRODUCTS = [
  { id: 'p1', name: 'Serum A', status: 'active', productKind: 'single', formulaId: 'fa', netWtG: 30, retail: 20, packagingRecipe: [], productionRuns: [], labelMarks: [{ key: 'organic', sym: '*', note: 'Organic' }] },
  { id: 'p2', name: 'Serum B', status: 'active', productKind: 'single', formulaId: 'fa', netWtG: 15, retail: 12, packagingRecipe: [], productionRuns: [], labelMarks: [{ key: 'organic', sym: '†', note: 'Certified organic' }] },
  { id: 'pk', name: 'Duo', status: 'active', productKind: 'kit', retail: 30, kitParts: [{ id: 'k1', productId: 'p1', qty: 1 }, { id: 'k2', productId: 'p2', qty: 1 }], packagingRecipe: [], productionRuns: [] },
  // Filled past its batch's yield: 345 g from a 300 g batch.
  { id: 'p3', name: 'Serum jar', status: 'active', productKind: 'single', formulaId: 'fa', netWtG: 115, retail: 25, packagingRecipe: [],
    productionRuns: [{ id: 'r1', date: '2026-10-21', units: 3, batchId: 'bo', draws: [{ batchId: 'bo', grams: 345 }] }] }
];
const BATCHES = [{ id: 'bo', formulaId: 'fa', formulaName: 'Argan serum', batchName: 'Argan serum', date: '2026-10-20', targetYield: 300, actualYield: 300, status: 'ready', committed: true, lotDraws: [] }];
const SEED = `
  localStorage.clear();
  localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(INGS))});
  localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});
  localStorage.setItem('plume-products-v1', ${JSON.stringify(JSON.stringify(PRODUCTS))});
  localStorage.setItem('aerie-batches-v1', ${JSON.stringify(JSON.stringify(BATCHES))});
  localStorage.setItem('aerie-packaging-v2', '[]');
  localStorage.setItem('aerie-suppliers-v1', '[]');
  localStorage.setItem('plume_costing_listorder_v1', '1');
  localStorage.setItem('plume-theme', 'light');`;

(async () => {
  const browser = await chromium.launch();
  const errors = [], dialogs = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'America/Anchorage' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await trackDialogs(page, dialogs);
  await page.goto(previewUrl('ingredients')); await page.evaluate(SEED); await page.reload(); await page.waitForTimeout(500);

  console.log('\n1. Costs and dates');
  const cpg = await page.evaluate(`(function () {
    viewIngredient('ia'); editCurrent();
    document.getElementById('f-density').value = '';
    var row = document.querySelector('#lots-container .lot-row'), id = row.id;
    row.querySelector('[data-field="purchaseSize"]').value = '100';
    row.querySelector('[data-field="purchaseUnit"]').value = 'mL';
    row.querySelector('[data-field="purchasePrice"]').value = '10';
    calcLotCostPerG(id);
    var d = Plume.densityFor(ingredients.filter(function (i) { return i.id === 'ia'; })[0]);
    return { cpg: parseFloat(row.querySelector('[data-field="costPerG"]').value), want: 10 / (100 * d.value), dens: d.value, note: document.getElementById(id + '-cpg-note').textContent };
  })()`);
  ok('a lot bought in mL with no density typed uses the typical density, like Quick add (was water: 14% low)', cpg.dens !== 1 && Math.abs(cpg.cpg - cpg.want) < 0.00006, cpg);
  ok('and says the density is a typical one', /typical density/.test(cpg.note), cpg.note);
  await page.evaluate("closeModal('modal-add')");
  ok('a lot whose best-by is today still counts as expiring (UTC read it as yesterday)', await page.evaluate("isExpiring(ingredients.filter(function (i) { return i.id === 'ir'; })[0].lots)"));
  ok('a 1 November best-by shows as Nov 2026, not Oct', await page.evaluate("formatDateShort('2026-11-01')") === 'Nov 2026', await page.evaluate("formatDateShort('2026-11-01')"));

  console.log('\n2. Notes');
  const html = (t) => page.evaluate(`Plume.rt.toHtml(${JSON.stringify(t)})`);
  ok('"2*3*4" stays as typed', await html('2*3*4') === '2*3*4', await html('2*3*4'));
  ok('"a * b * c" stays as typed', await html('a * b * c') === 'a * b * c');
  ok('*this* and **that** still format', await html('*this* and **that**') === '<em>this</em> and <strong>that</strong>', await html('*this* and **that**'));
  ok('***both*** is bold and italic', /<strong>both<\/strong>/.test(await html('***both***')) && /<em>/.test(await html('***both***')));
  ok('plain text keeps spaced asterisks', await page.evaluate("Plume.rt.plain('2*3*4 and *x*')") === '2*3*4 and x');
  const from = (h) => page.evaluate(`(function () { var d = document.createElement('div'); d.innerHTML = ${JSON.stringify(h)}; return Plume.rt.fromEl(d); })()`);
  ok('bold across a line break stays on both lines', await from('<b>one<br>two</b> three') === '**one**\n**two** three', await from('<b>one<br>two</b> three'));
  ok('Enter twice is one blank line, not two', await from('<div>a</div><div><br></div><div>b</div>') === 'a\n\nb', await from('<div>a</div><div><br></div><div>b</div>'));
  ok('and round-trips unchanged', await page.evaluate("(function () { var d = document.createElement('div'); d.innerHTML = Plume.rt.toHtml('a\\n\\nb'); return Plume.rt.fromEl(d); })()") === 'a\n\nb');
  await page.evaluate("viewIngredient('iw'); editCurrent(); setIngTab('glance');"); await page.waitForTimeout(150);
  const box = page.locator('#f-choose + .rt-wrap .rt-ed');
  await box.click(); await page.keyboard.type('x'.repeat(230)); await page.waitForTimeout(100);
  const lim = await page.evaluate("[document.getElementById('f-choose').value.length, (document.querySelector('#f-choose + .rt-wrap .rt-count') || {}).textContent]");
  ok('the lowdown box stops at its 200 characters and shows the count', lim[0] === 200 && lim[1] === '200 / 200', lim);
  await page.evaluate("closeModal('modal-add')");
  ok('Recommended % beside its label: a bare range loses the %', await page.evaluate("Plume.recText('2–5%')") === '2–5' && await page.evaluate("Plume.recText('.5 %')") === '.5');
  ok('words keep theirs ("2% leave-on" read "2leave-on")', await page.evaluate("Plume.recText('2% leave-on, 1% rinse-off')") === '2% leave-on, 1% rinse-off');

  console.log('\n3. Quick add');
  ok('mailto: and http: links are left alone; a bare address gets https://', await page.evaluate("[qaLink('mailto:a@b.co'), qaLink('http://x.co'), qaLink('x.co/oil'), qaLink('localhost:3000')].join(' ')") === 'mailto:a@b.co http://x.co https://x.co/oil https://localhost:3000');
  await page.evaluate("openQuickAdd()"); await page.waitForTimeout(150);
  await page.fill('#qa-name', 'Rosehip seed oil'); await page.dispatchEvent('#qa-name', 'input');
  ok('the duplicate check knows the starter list\'s other names (Rosehip oil)', /Already in your library: Rosehip oil/.test(await page.evaluate("document.getElementById('qa-hint').innerText")), await page.evaluate("document.getElementById('qa-hint').innerText"));
  await page.evaluate("qaClear(false)");
  await page.evaluate("document.querySelector('#qa-funcs input[value=\"Emollient\"]').checked = true");
  dialogs.length = 0;
  await page.evaluate("window.PLUME_TEST_ANSWER = false; (function (m) { m.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); m.dispatchEvent(new MouseEvent('click', { bubbles: true })); })(document.getElementById('modal-quick'));"); await page.waitForTimeout(150);
  ok('a backdrop click with only a function ticked asks first', dialogs.some(d => /Close Quick add/.test(d)) && await page.evaluate("document.getElementById('modal-quick').classList.contains('open')"), dialogs);
  await page.evaluate("qaClear(false); document.getElementById('qa-c-organic').checked = true;");
  dialogs.length = 0;
  await page.evaluate("(function (m) { m.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); m.dispatchEvent(new MouseEvent('click', { bubbles: true })); })(document.getElementById('modal-quick'));"); await page.waitForTimeout(150);
  ok('so does a certification alone', dialogs.some(d => /Close Quick add/.test(d)));
  await page.evaluate("qaClear(false); document.getElementById('qa-lot').value = 'LC-1';");
  dialogs.length = 0;
  await page.evaluate("(function (m) { m.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); m.dispatchEvent(new MouseEvent('click', { bubbles: true })); })(document.getElementById('modal-quick'));"); await page.waitForTimeout(150);
  ok('and a lot # alone', dialogs.some(d => /Close Quick add/.test(d)));
  await page.evaluate("qaClear(false); window.PLUME_TEST_ANSWER = undefined; (function (m) { m.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); m.dispatchEvent(new MouseEvent('click', { bubbles: true })); })(document.getElementById('modal-quick'));"); await page.waitForTimeout(150);
  ok('an empty form closes without asking', await page.evaluate("!document.getElementById('modal-quick').classList.contains('open')"));

  console.log('\n4. Phases');
  ok('Active and Other are phase filters', await page.evaluate("Array.from(document.querySelectorAll('#phase-chips .ps-chip')).map(function (b) { return b.textContent.trim(); }).join(',')") === 'All,Oil phase,Water phase,Cool-down,Active,Add-in,Other');
  await page.evaluate("setPhaseChip('active')"); await page.waitForTimeout(100);
  ok('filtering to Active shows Vitamin C only', await page.evaluate("Array.from(document.querySelectorAll('#tbody tr[data-ing]')).map(function (r) { return r.getAttribute('data-ing'); }).join(',')") === 'iv');
  await page.evaluate("setPhaseChip('')");
  const phTxt = await page.evaluate("[document.querySelector('tr[data-ing=\"iv\"] .ps-tag').textContent, document.querySelector('tr[data-ing=\"io\"] .ps-tag').textContent].join('|')");
  ok('the list names them "Active" and "Other", not lowercase', phTxt === 'Active|Other', phTxt);
  const cs = require('fs').readFileSync(require('path').join(__dirname, '..', 'plume-cheatsheet.js'), 'utf8').match(/var PHASE_NAMES = (\{[^}]*\})/);
  ok('the cheat sheet names them too', cs && /active: 'Active'/.test(cs[1]) && /other: 'Other'/.test(cs[1]), cs && cs[1]);

  console.log('\n5. Stock solutions (Batches)');
  await page.goto(previewUrl('batchlog')); await page.waitForTimeout(500);
  const made = await page.evaluate(`(function () {
    refreshLibrary();
    var back = { id: 'b2', formulaId: 'fh', date: '2026-09-01', actualYield: 100, committed: true, lotDraws: [], status: 'ready' };
    addMadeLot(back);
    var ing = findIng('ih'), a1 = ing.activeLotId;
    var later = { id: 'b3', formulaId: 'fh', date: '2026-10-20', actualYield: 50, committed: true, lotDraws: [], status: 'ready' };
    addMadeLot(later);
    var a2 = ing.activeLotId;
    removeMadeLot(later);
    var a3 = ing.activeLotId;
    // Its lot deleted in Ingredients: the batch still pointed at it.
    var gone = { id: 'b4', formulaId: 'fh', date: '2026-10-22', actualYield: 80, committed: true, lotDraws: [], status: 'ready', madeIngId: 'ih', madeLotId: 'L-deleted' };
    var re = addMadeLot(gone);
    return { a1: a1, a2: a2, a3: a3, re: re ? re.id : null, link: gone.madeLotId };
  })()`);
  ok('a back-dated batch does not take over the price (newest by date does)', made.a1 === 'L-made-b1', made);
  ok('a newer batch does', made.a2 === 'L-made-b3', made);
  ok('removing it hands the price back to the newest left', made.a3 === 'L-made-b1', made);
  ok('"Add N g to its stock" works again after its lot was deleted in Ingredients', made.re === 'L-made-b4' && made.link === 'L-made-b4', made);
  const left = await page.evaluate("rowHtml(findBatch('bo'))");
  ok('a batch filled past its yield reads "45 g over", not "-45 g of 300 g"', /45 g over/.test(left) && !/-45/.test(left), left.slice(0, 300));
  await page.evaluate("openBatchDetail('bo'); setBatchTab('runs')"); await page.waitForTimeout(200);
  ok('in its details too', /45 g over/.test(await page.evaluate("document.querySelector('#d-fills .bulk-card').innerText")));

  console.log('\n6. Products & Costing');
  await page.goto(previewUrl('costing')); await page.waitForTimeout(500);
  await page.evaluate("openProduct('pk')"); await page.waitForTimeout(250);
  ok('a kit shows no Mark certified chips, and says where marks are set', await page.evaluate("!document.querySelector('#lbl-marks input[data-mk]') && /each product in the kit/.test(document.getElementById('lbl-marks').innerText)"));
  const kitLabel = await page.evaluate("document.getElementById('label-preview').innerText");
  ok('both products\' symbols for organic get a footnote', /\*Organic/.test(kitLabel) && /†Certified organic/.test(kitLabel), kitLabel);
  await page.evaluate("openProduct('p1')"); await page.waitForTimeout(250);
  ok('a single product still has the chips', await page.evaluate("!!document.querySelector('#lbl-marks input[data-mk]')"));
  ok('the label weight placeholder is short enough for a phone', (await page.evaluate("document.getElementById('p-netwt-display').placeholder")).length <= 32);
  dialogs.length = 0;
  const opened = await page.evaluate("(function () { var n = 0, real = bcOpenPrintWindow; bcOpenPrintWindow = function () { n++; }; openLineSheet(); ls.pick = {}; printLineSheet(); bcOpenPrintWindow = real; return n; })()");
  await page.waitForTimeout(100);
  ok('printing a line sheet with nothing ticked says so instead of a blank page', opened === 0 && dialogs.some(d => /line sheet is empty/i.test(d)), dialogs);
  await page.evaluate("Plume.stock.open(); Plume.stock.mode('consign')"); await page.waitForTimeout(200);
  const lk = await page.evaluate("(function () { var a = document.getElementById('st-cs-link'), t = document.createElement('span'); t.style.color = 'var(--bark)'; document.body.appendChild(t); var want = getComputedStyle(t).color; t.remove(); return { got: getComputedStyle(a).color, want: want, u: getComputedStyle(a).textDecorationLine }; })()");
  ok('the "Shops and settling up" link is in the app\'s link colour, not browser blue', lk.got === lk.want && lk.u === 'underline', lk);

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
