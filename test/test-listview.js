// Formulations: Tiles or List (2026-11-01). Tiles stay the default and the
// choice is kept on the device; the list is a table sorted by any column,
// blanks last; the filters, search and archive work the same; a row opens
// the formulation; the board order is never changed by the list.
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}
const ings = [
  { id: 'a', name: 'Water', inci: 'Aqua', phase: 'water', lots: [{ id: 'la', costPerG: '0.01', stockG: '100' }], activeLotId: 'la' },
  { id: 'b', name: 'Glycerin', inci: 'Glycerin', phase: 'water', lots: [{ id: 'lb', costPerG: '0.50', stockG: '100' }], activeLotId: 'lb' }
];
function form(id, name, type, status, lines, daysAgo, extra) {
  const v = { vid: id + 'v', num: 1, label: '', status, lines, instructions: '', batchSize: '100', addinsInTotal: true, usageLog: [], history: [] };
  return Object.assign({ id, name, type, status, lines, batchSize: '100', addinsInTotal: true, notes: '', formNotes: '',
    variants: [v], activeVariantId: v.vid, updatedAt: daysAgo === null ? undefined : new Date(Date.now() - daysAgo * 864e5).toISOString() }, extra || {});
}
const forms = [
  form('f1', 'Toner', 'Toner', 'testing', [{ ingId: 'a', pct: '90' }, { ingId: 'b', pct: '10' }], 1),    // $5.90
  form('f2', 'Balm', 'Balm', 'approved', [{ ingId: 'a', pct: '50' }, { ingId: 'b', pct: '50' }], 10, { board: { r: 0, c: 0, t: 1 } }), // $25.50
  form('f3', 'Cleanser', 'Cleanser', 'draft', [], null),                                               // no cost, no date
  form('f4', 'Old bar', 'Balm', 'retired', [{ ingId: 'a', pct: '100' }], 99, { archived: true })
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await trackDialogs(page, []);
  await page.addInitScript(([i, f]) => {
    if (sessionStorage.getItem('s')) return;
    localStorage.clear(); localStorage.setItem('aerie-ingredients-v2', i); localStorage.setItem('aerie-formulations-v1', f);
    sessionStorage.setItem('s', '1');
  }, [JSON.stringify(ings), JSON.stringify(forms)]);
  await page.goto(previewUrl('formulations'));
  await page.waitForTimeout(400);
  const names = () => page.evaluate("Array.from(document.querySelectorAll('.fl-table tbody tr td.fl-name')).map(function(t){return t.firstChild.textContent;})");
  const boardBefore = await page.evaluate("JSON.stringify(JSON.parse(localStorage.getItem('aerie-formulations-v1')).map(function(f){return f.board||null;}))");

  console.log('\n1. Tiles by default, List one click away');
  ok('tiles show at first', await page.evaluate("!!document.querySelector('.fcard') && !document.querySelector('.fl-table')"));
  ok('the toggle shows Tiles pressed', await page.evaluate("document.getElementById('fl-view-tiles').getAttribute('aria-pressed') === 'true'"));
  await page.click('#fl-view-list'); await page.waitForTimeout(100);
  ok('List shows the table', await page.evaluate("!!document.querySelector('.fl-table') && !document.querySelector('.fcard')"));
  ok('List is pressed now', await page.evaluate("document.getElementById('fl-view-list').getAttribute('aria-pressed') === 'true'"));
  ok('the columns', JSON.stringify(await page.evaluate("Array.from(document.querySelectorAll('.fl-table th')).map(function(t){return t.textContent.replace(/[\\u2191\\u2193]/g,'');})")) ===
    JSON.stringify(['Name', 'Type', 'Status', 'Versions', 'Ingredients', 'Cost / 100 g', 'Last changed']));

  console.log('\n2. Sorting');
  ok('by name, A to Z, archived left out', JSON.stringify(await names()) === '["Balm","Cleanser","Toner"]', await names());
  await page.click('th:nth-child(1) .fl-sort'); await page.waitForTimeout(50);
  ok('name again: Z to A', JSON.stringify(await names()) === '["Toner","Cleanser","Balm"]', await names());
  await page.click('th:nth-child(6) .fl-sort'); await page.waitForTimeout(50);
  ok('cost: highest first, no cost last', JSON.stringify(await names()) === '["Balm","Toner","Cleanser"]', await names());
  ok('cost is shown per 100 g', await page.evaluate("document.querySelector('.fl-table tbody tr td:nth-child(6)').textContent === '$25.50'"));
  await page.click('th:nth-child(6) .fl-sort'); await page.waitForTimeout(50);
  ok('cost reversed: lowest first, no cost still last', JSON.stringify(await names()) === '["Toner","Balm","Cleanser"]', await names());
  await page.click('th:nth-child(7) .fl-sort'); await page.waitForTimeout(50);
  ok('last changed: newest first, no date last', JSON.stringify(await names()) === '["Toner","Balm","Cleanser"]', await names());
  await page.click('th:nth-child(3) .fl-sort'); await page.waitForTimeout(50);
  ok('status: approved, testing, draft', JSON.stringify(await names()) === '["Balm","Toner","Cleanser"]', await names());
  ok('the sorted column says so', await page.evaluate("document.querySelector('th:nth-child(3)').getAttribute('aria-sort') === 'ascending'"));

  console.log('\n3. Filters, search and archive work the same');
  await page.evaluate("setListStatus('approved')"); await page.waitForTimeout(50);
  ok('a status filter', JSON.stringify(await names()) === '["Balm"]', await names());
  await page.evaluate("setListStatus('')"); await page.fill('#fl-search', 'old'); await page.waitForTimeout(50);
  ok('search reaches the archive, marked', JSON.stringify(await names()) === '["Old bar"]' && await page.evaluate("document.querySelector('.fl-table tbody tr').classList.contains('fl-archived')"), await names());
  await page.fill('#fl-search', ''); await page.evaluate("renderCards()");

  console.log('\n4. Kept, and opening');
  await page.reload(); await page.waitForTimeout(400);
  ok('the list is kept on reload', await page.evaluate("!!document.querySelector('.fl-table')"));
  await page.click('.fl-table tbody tr:first-child'); await page.waitForTimeout(200);
  ok('a row opens its formulation', await page.evaluate("!!curForm() && document.getElementById('f-name').value.length > 0"));
  ok('the board was not changed', (await page.evaluate("JSON.stringify(JSON.parse(localStorage.getItem('aerie-formulations-v1')).map(function(f){return f.board||null;}))")) === boardBefore);
  await page.evaluate("goList(); setFlView('tiles')"); await page.waitForTimeout(100);
  ok('back to tiles', await page.evaluate("!!document.querySelector('.fcard') && localStorage.getItem('plume-fl-view') === 'tiles'"));

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
