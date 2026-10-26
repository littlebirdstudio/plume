// Quick add (2026-10-24, v1.41). New opens a short form: name, INCI,
// functions, phase, usage, and what was bought, which becomes the first lot.
// Typing a name offers the starter list's entry and warns about one already
// in the library. "Save & add another" keeps the supplier, order # and date
// for the rest of the same order. Certifications are ticks on the lot.
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const INGS = [
  { id: 'ig', name: 'Glycerin', inci: 'Glycerin', phase: 'water', lots: [] }
];
const SEED = `
  localStorage.clear();
  localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(INGS))});
  localStorage.setItem('aerie-suppliers-v1', JSON.stringify([{ id: 's1', name: 'Mountain Rose Herbs', webLink: '', notes: '' }]));
  localStorage.setItem('plume-theme', 'light');`;
const getIngs = "JSON.parse(localStorage.getItem('aerie-ingredients-v2'))";

(async () => {
  const browser = await chromium.launch();
  const errors = [], dialogs = [];
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await trackDialogs(page, dialogs);
  await page.goto(previewUrl('ingredients')); await page.evaluate(SEED); await page.reload(); await page.waitForTimeout(500);

  console.log('\n1. Opening it');
  await page.click('#ing-new-btn'); await page.waitForTimeout(200);
  ok('New opens Quick add, not the full editor', await page.evaluate("document.getElementById('modal-quick').classList.contains('open') && !document.getElementById('modal-add').classList.contains('open')"));
  ok('received starts at today, functions and certifications are offered', await page.evaluate("document.getElementById('qa-received').value === todayISO() && document.querySelectorAll('#qa-funcs input').length >= 10 && !!document.getElementById('qa-c-cosmosCert') && !!document.getElementById('qa-c-cosmosApproved') && !!document.getElementById('qa-c-other')"));
  ok('saved suppliers are offered as she types', await page.evaluate("Array.from(document.querySelectorAll('#qa-sup-list option')).map(function (o) { return o.value; }).indexOf('Mountain Rose Herbs') !== -1"));
  await page.evaluate("qaSave(false)");
  ok('saving with no name says what is needed and saves nothing', /common name and an INCI name/.test(await page.evaluate("document.getElementById('qa-err').textContent")) && (await page.evaluate(getIngs)).length === 1);

  console.log('\n2. Typing a name');
  await page.fill('#qa-name', 'glycerin'); await page.dispatchEvent('#qa-name', 'input');
  ok('one already in the library is pointed out, with a way to open it', /Already in your library: Glycerin/.test(await page.evaluate("document.getElementById('qa-hint').innerText")));
  await page.fill('#qa-name', 'jojo'); await page.dispatchEvent('#qa-name', 'input');
  const hint = await page.evaluate("document.getElementById('qa-hint').innerText");
  ok('the starter list offers its entry', /From the starter list: Jojoba oil/.test(hint), hint);
  await page.evaluate("document.querySelector('#qa-hint .qa-hint.sug button').click()"); await page.waitForTimeout(100);
  const filled = await page.evaluate("[qaVal('qa-name'), qaVal('qa-inci'), document.getElementById('qa-phase').value, qaVal('qa-recmax'), qaReadFuncs().join(',')]");
  ok('Use this fills name, INCI, phase, usage and function', filled[0] === 'Jojoba oil' && /Simmondsia/.test(filled[1]) && filled[2] === 'oil' && filled[3] !== '' && filled[4] === 'Emollient', filled);
  ok('and says the starter\'s notes come along', /Filled from the starter list: Jojoba oil/.test(await page.evaluate("document.getElementById('qa-hint').innerText")));

  console.log('\n3. What was bought');
  await page.fill('#qa-sup', 'Lotioncrafter'); await page.fill('#qa-order', 'LC-88123'); await page.fill('#qa-received', '2026-10-20');
  await page.fill('#qa-size', '16'); await page.selectOption('#qa-unit', 'oz'); await page.fill('#qa-price', '12.50'); await page.dispatchEvent('#qa-price', 'input');
  ok('cost per gram fills in as she types', /\$0\.0276/.test(await page.evaluate("document.getElementById('qa-cpg').innerText")));
  await page.fill('#qa-link', 'lotioncrafter.com/products/jojoba-oil');
  await page.check('#qa-c-organic'); await page.check('#qa-c-cosmosCert'); await page.fill('#qa-c-other', 'Fair for Life');
  await page.click('text=Save & add another'); await page.waitForTimeout(200);
  let ings = await page.evaluate(getIngs);
  const jo = ings.find(i => i.name === 'Jojoba oil');
  const l = jo && jo.lots[0];
  ok('it saves, starting from the starter entry (its lowdown comes along as a draft)', jo && jo.chooseWhen && jo.chooseWhenDraft === true && jo.functionCategory.join() === 'Emollient', jo);
  ok('with the purchase as its first, active lot', l && jo.activeLotId === l.id && l.supplier === 'Lotioncrafter' && l.orderNum === 'LC-88123' && l.received === '2026-10-20' &&
     l.purchaseSize === '16' && l.purchaseUnit === 'oz' && l.qtyPurchased === '16' && l.qtyUnit === 'oz' && l.costPerG === '0.0276', l);
  ok('the purchase link goes on the lot, with https:// added', l && l.buyLink === 'https://lotioncrafter.com/products/jojoba-oil', l && l.buyLink);
  ok('and its certifications on the lot', l && l.organic === true && l.cosmosCert === true && l.cosmosApproved === false && l.ecocert === false && l.certOther === 'Fair for Life');
  ok('a new supplier joins the supplier list', await page.evaluate("JSON.parse(localStorage.getItem('aerie-suppliers-v1')).some(function (s) { return s.name === 'Lotioncrafter'; })"));
  ok('the form clears but keeps the supplier, order # and date', await page.evaluate("qaVal('qa-name') === '' && qaVal('qa-size') === '' && qaVal('qa-link') === '' && !document.getElementById('qa-c-cosmosCert').checked && qaVal('qa-sup') === 'Lotioncrafter' && qaVal('qa-order') === 'LC-88123' && qaVal('qa-received') === '2026-10-20'"));
  ok('and says so', /Kept for the next one: supplier Lotioncrafter, order #LC-88123/.test(await page.evaluate("document.getElementById('qa-kept').innerText")));
  ok('what was added is listed', /Jojoba oil/.test(await page.evaluate("document.getElementById('qa-done').innerText")));

  console.log('\n4. The next item from the same order');
  await page.fill('#qa-name', 'Calendula infused oil'); await page.fill('#qa-inci', 'Helianthus Annuus Seed Oil, Calendula Officinalis Flower Extract');
  await page.selectOption('#qa-phase', 'oil');
  await page.fill('#qa-size', '250'); await page.selectOption('#qa-unit', 'mL'); await page.fill('#qa-price', '18'); await page.dispatchEvent('#qa-price', 'input');
  ok('a volume purchase says which density it used', /using 1 g\/mL \(no density known, assuming water\)/.test(await page.evaluate("document.getElementById('qa-cpg').innerText")), await page.evaluate("document.getElementById('qa-cpg').innerText"));
  await page.evaluate("Array.from(document.querySelectorAll('#qa-funcs input')).filter(function (b) { return b.value === 'Emollient'; })[0].click()");
  ok('and ticking Emollient picks the oil density up', /\$0\.0783 using 0\.92 g\/mL/.test(await page.evaluate("document.getElementById('qa-cpg').innerText.replace(/\\s+/g, ' ')")), await page.evaluate("document.getElementById('qa-cpg').innerText"));
  await page.evaluate("qaSave(false)"); await page.waitForTimeout(200);
  ings = await page.evaluate(getIngs);
  const ca = ings.find(i => i.name === 'Calendula infused oil');
  ok('Save closes Quick add; the kept order # went onto this one too', !(await page.evaluate("document.getElementById('modal-quick').classList.contains('open')")) && ca && ca.lots[0].orderNum === 'LC-88123' && ca.lots[0].supplier === 'Lotioncrafter');
  ok('a plain new ingredient has no starter notes', ca && !ca.chooseWhen && ca.phase === 'oil');

  console.log('\n5. No purchase, and Add more details');
  await page.click('#ing-new-btn'); await page.waitForTimeout(150);
  ok('opening again starts clean', await page.evaluate("qaVal('qa-sup') === '' && qaVal('qa-order') === '' && document.getElementById('qa-done').hidden"));
  await page.fill('#qa-name', 'Allantoin'); await page.fill('#qa-inci', 'Allantoin');
  await page.evaluate("qaMore()"); await page.waitForTimeout(300);
  ings = await page.evaluate(getIngs);
  const al = ings.find(i => i.name === 'Allantoin');
  ok('Add more details saves it with no lot and opens the full editor on it', al && al.lots.length === 0 && await page.evaluate(`document.getElementById('modal-add').classList.contains('open') && editingId === '${al && al.id}' && document.getElementById('f-name').value === 'Allantoin'`));
  await page.evaluate("closeModal('modal-add')");
  await page.evaluate("openQuickAdd()"); await page.fill('#qa-name', 'Half typed');
  dialogs.length = 0;
  await page.evaluate("window.PLUME_TEST_ANSWER = false"); await page.mouse.click(10, 500); await page.waitForTimeout(150);
  ok('a click outside with something typed asks first', /Close Quick add\?/.test(dialogs.join(' ')) && await page.evaluate("document.getElementById('modal-quick').classList.contains('open')"), dialogs);
  await page.evaluate("window.PLUME_TEST_ANSWER = undefined; closeQuickAdd()");

  console.log('\n6. Certifications elsewhere');
  await page.evaluate(`viewIngredient('${jo.id}')`); await page.waitForTimeout(200);
  const head = await page.evaluate("document.getElementById('d-header').innerText.replace(/\\s+/g, ' ')");
  ok('the profile shows the active lot\'s certifications', /Organic/i.test(head) && /COSMOS Certified/i.test(head) && /Fair for Life/i.test(head), head);
  await page.evaluate("editCurrent()"); await page.waitForTimeout(200);
  ok('the lot editor has the certification ticks, set', await page.evaluate("(function () { var r = document.querySelector('#lots-container .lot-row'); return r.querySelector('[data-field=cosmosCert]').checked && !r.querySelector('[data-field=cosmosApproved]').checked && r.querySelector('[data-field=organic]').checked && !r.querySelector('[data-field=natrue]').checked && r.querySelector('[data-field=certOther]').value === 'Fair for Life'; })()"));
  await page.evaluate("document.querySelector('#lots-container .lot-row [data-field=natrue]').checked = true; saveIngredient()"); await page.waitForTimeout(200);
  const l2 = (await page.evaluate(getIngs)).find(i => i.id === jo.id).lots[0];
  ok('and saving keeps them, with the new one', l2.natrue === true && l2.cosmosCert === true && l2.certOther === 'Fair for Life', l2);
  ok('lotCerts lists them for any page', await page.evaluate("Plume.lotCerts({ organic: true, cosmosApproved: true, natrue: 'true', certOther: 'Fair for Life, Leaping Bunny' }).join('|')") === 'Organic|COSMOS Approved|NATRUE|Fair for Life|Leaping Bunny');

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
