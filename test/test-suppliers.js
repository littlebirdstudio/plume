// Suppliers as a slide-in panel on every page, and the sidebar's Library
// section (2026-10-20). Suppliers used to be a modal that only Ingredients
// had. Lots and packaging items name a supplier as plain text, so the panel
// matches them by name, and a rename can follow the name there.
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const SUPS = [
  { id: 's1', name: 'Lotioncrafter', webLink: 'https://www.lotioncrafter.com/shop', notes: 'Bulk oils' },
  { id: 's2', name: 'Formulator Sample Shop', webLink: '', notes: '' }
];
const INGS = [
  { id: 'i1', name: 'Jojoba oil', lots: [{ id: 'l1', supplier: 'Lotioncrafter', qtyPurchased: 500, qtyUnit: 'g' },
                                         { id: 'l2', supplier: 'lotioncrafter ', qtyPurchased: 100, qtyUnit: 'g' }] },
  { id: 'i2', name: 'Glycerin', lots: [{ id: 'l3', supplier: 'Lotioncrafter', qtyPurchased: 1000, qtyUnit: 'g' }] },
  { id: 'i3', name: 'Niacinamide', lots: [{ id: 'l4', supplier: 'MakingCosmetics', qtyPurchased: 50, qtyUnit: 'g' }] },
  { id: 'i4', name: 'Old oil', archived: true, lots: [{ id: 'l5', supplier: 'Lotioncrafter' }] },
  { id: 'i5', name: 'Candelilla wax', lots: [{ id: 'l6', supplier: 'Lotion Crafter', qtyPurchased: 200, qtyUnit: 'g' }] }
];
const PKGS = [
  { id: 'p1', kind: 'dropper', capacity: '1 oz', color: 'Amber', supplier: 'Lotioncrafter', purchases: [] },
  { id: 'p2', kind: 'jar', capacity: '2 oz', supplier: 'SKS Bottle', purchases: [] }
];

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const SEED = `
    localStorage.setItem('aerie-suppliers-v1', ${JSON.stringify(JSON.stringify(SUPS))});
    localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(INGS))});
    localStorage.setItem('aerie-packaging-v2', ${JSON.stringify(JSON.stringify(PKGS))});
    localStorage.setItem('aerie-formulations-v1', '[]');
    localStorage.setItem('plume-products-v1', '[]');
    localStorage.setItem('aerie-batches-v1', '[]');
    localStorage.setItem('plume-theme', 'light');`;
  async function open(module) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    page.on('pageerror', e => errors.push(module + ': ' + String(e)));
    await trackDialogs(page, []);
    await page.goto(previewUrl(module));
    await page.waitForTimeout(300);
    await page.evaluate(SEED);
    await page.reload();
    await page.waitForTimeout(500);
    return page;
  }
  const stored = (page, key) => page.evaluate("JSON.parse(localStorage.getItem('" + key + "'))");

  console.log('\n1. Every page opens the same panel');
  for (const m of ['ingredients', 'packaging', 'formulations', 'batchlog', 'costing']) {
    const page = await open(m);
    await page.click('#ps-nav-suppliers');
    await page.waitForTimeout(250);
    ok(m + ': Suppliers in the Library opens the panel here, without leaving the page', await page.evaluate(
      "document.getElementById('ps-peek').classList.contains('open') && !!document.querySelector('#ps-peek .sup-list') && /" + m + "/.test(location.href)"));
    await page.close();
  }

  console.log('\n2. What each supplier supplies');
  {
    const page = await open('packaging');
    await page.click('#ps-nav-suppliers'); await page.waitForTimeout(250);
    const lc = await page.evaluate("document.querySelector('.sup-row[data-sup=\"s1\"] .sup-use').textContent");
    ok('matched by name, ignoring case and spacing; archived left out; ingredients counted once', lc === '2 ingredients · 1 packaging item', lc);
    ok('names on hover', (await page.evaluate("document.querySelector('.sup-row[data-sup=\"s1\"] .sup-use').title")).indexOf('Glycerin') !== -1);
    ok('a supplier nothing names says so', (await page.evaluate("document.querySelector('.sup-row[data-sup=\"s2\"] .sup-use').textContent")) === 'Not on any lot or packaging item yet');
    ok('the website shows as its short name and opens in a new tab', await page.evaluate(
      "var a=document.querySelector('.sup-row[data-sup=\"s1\"] .sup-web'); a.textContent.indexOf('lotioncrafter.com')===0 && a.target==='_blank'"));
    const loose = await page.evaluate("Array.from(document.querySelectorAll('.sup-loose-name')).map(function(x){return x.textContent;})");
    ok('names typed on lots and items but not saved are listed', JSON.stringify(loose) === '["Lotion Crafter","MakingCosmetics","SKS Bottle"]', loose);
    const twin = await page.evaluate("var r=Array.from(document.querySelectorAll('.sup-loose-row')).find(function(r){return /Lotion Crafter/.test(r.textContent);}); r.querySelector('button').textContent");
    ok('a different spelling of a saved supplier is offered as a match, not a new supplier', twin === 'Same as Lotioncrafter', twin);
    await page.evaluate("Array.from(document.querySelectorAll('.sup-loose-row')).find(function(r){return /Lotion Crafter/.test(r.textContent);}).querySelector('button').click()");
    ok('matching renames it on the lot', (await stored(page, 'aerie-ingredients-v2'))[4].lots[0].supplier === 'Lotioncrafter');
    ok('and the saved supplier now counts it', (await page.evaluate("document.querySelector('.sup-row[data-sup=\"s1\"] .sup-use').textContent")) === '3 ingredients · 1 packaging item');
    ok('the stray name is gone from the list', !(await page.evaluate("Array.from(document.querySelectorAll('.sup-loose-name')).some(function(x){return x.textContent==='Lotion Crafter';})")));
    ok('the sidebar marks Suppliers while the panel is open', await page.evaluate("document.getElementById('ps-nav-suppliers').classList.contains('on')"));

    console.log('\n3. Saving one found on lots');
    await page.evaluate("Array.from(document.querySelectorAll('.sup-loose-row')).find(function(r){return /SKS/.test(r.textContent);}).querySelector('button').click()");
    ok('Save opens the form with the name filled in', (await page.evaluate("document.getElementById('sup-name').value")) === 'SKS Bottle');
    await page.fill('#sup-web', 'sks-bottle.com');
    await page.evaluate("Plume.suppliers.save()");
    const sups = await stored(page, 'aerie-suppliers-v1');
    ok('it is saved', sups.some(s => s.name === 'SKS Bottle' && s.webLink === 'sks-bottle.com'), sups);
    ok('and leaves the "not saved here" list', (await page.evaluate("document.body.textContent.indexOf('SKS Bottle')!==-1 && !Array.from(document.querySelectorAll('.sup-loose-name')).some(function(x){return x.textContent==='SKS Bottle';})")));
    ok('a link without https still opens', await page.evaluate("Array.from(document.querySelectorAll('.sup-web')).some(function(a){return a.getAttribute('href')==='https://sks-bottle.com';})"));
    ok('the sidebar count follows', (await page.evaluate("document.querySelector('.ps-ct[data-ct=\"suppliers\"]').textContent")) === '3');

    console.log('\n4. New, duplicate, blank');
    await page.evaluate("Plume.suppliers.add()");
    await page.evaluate("Plume.suppliers.save()");
    ok('a blank name is refused with a reason', (await page.evaluate("document.getElementById('sup-err').textContent")).indexOf('name') !== -1);
    await page.fill('#sup-name', '  LOTIONCRAFTER ');
    await page.evaluate("Plume.suppliers.save()");
    ok('a name already saved is refused', (await page.evaluate("document.getElementById('sup-err').textContent")).indexOf('already saved') !== -1);
    await page.evaluate("Plume.suppliers.cancel()");
    ok('Cancel saves nothing', (await stored(page, 'aerie-suppliers-v1')).length === 3);

    console.log('\n5. Renaming follows the name onto lots and items');
    await page.evaluate("Plume.suppliers.edit('s1')");
    ok('the rename tick box waits until the name changes', await page.evaluate("document.getElementById('sup-rename').hidden"));
    await page.fill('#sup-name', 'Lotioncrafter LLC');
    await page.dispatchEvent('#sup-name', 'input');
    ok('then it shows, ticked', await page.evaluate("!document.getElementById('sup-rename').hidden && document.getElementById('sup-rename-on').checked"));
    await page.evaluate("Plume.suppliers.save()");
    const ings = await stored(page, 'aerie-ingredients-v2'), pk = await stored(page, 'aerie-packaging-v2');
    ok('every lot that named it is renamed, spelling variants too', ings[0].lots.every(l => l.supplier === 'Lotioncrafter LLC') && ings[1].lots[0].supplier === 'Lotioncrafter LLC');
    ok('so is the packaging item', pk[0].supplier === 'Lotioncrafter LLC');
    ok('other suppliers untouched', ings[2].lots[0].supplier === 'MakingCosmetics' && pk[1].supplier === 'SKS Bottle');
    ok('the page took the fresh copy, so its next save keeps the rename', await page.evaluate("items[0].supplier === 'Lotioncrafter LLC'"));
    await page.evaluate("Plume.suppliers.edit('s1')");
    await page.fill('#sup-name', 'Lotioncrafter');
    await page.dispatchEvent('#sup-name', 'input');
    await page.uncheck('#sup-rename-on');
    await page.evaluate("Plume.suppliers.save()");
    ok('unticked, only the saved supplier changes', (await stored(page, 'aerie-packaging-v2'))[0].supplier === 'Lotioncrafter LLC' &&
       (await stored(page, 'aerie-suppliers-v1')).find(s => s.id === 's1').name === 'Lotioncrafter');

    console.log('\n6. Delete');
    await page.evaluate("Plume.suppliers.edit('s2')");
    await page.evaluate("document.querySelector('.sup-del').click()");
    await page.waitForTimeout(100);
    ok('deleting removes only the saved supplier', !(await stored(page, 'aerie-suppliers-v1')).some(s => s.id === 's2'));

    console.log('\n7. Packaging suggests suppliers');
    await page.keyboard.press('Escape');
    await page.evaluate("openAdd()");
    const opts = await page.evaluate("Array.from(document.querySelectorAll('#pk-sup-list option')).map(function(o){return o.value;})");
    ok('the supplier field offers saved suppliers and names on other items, once each',
       JSON.stringify(opts) === '["Lotioncrafter","Lotioncrafter LLC","SKS Bottle"]', opts);
    await page.close();
  }

  console.log('\n8. Ingredients');
  {
    const page = await open('ingredients');
    ok('the old modal is gone', await page.evaluate("!document.getElementById('modal-suppliers')"));
    // Since v1.38 an open page reloads itself on a new link, so no reload here.
    await page.evaluate("location.hash='#suppliers'");
    await page.waitForFunction("document.getElementById('ps-peek') && document.getElementById('ps-peek').classList.contains('open') && !!document.querySelector('.sup-list')", null, { timeout: 10000 }).catch(() => {});
    ok('an old #suppliers link opens the panel', await page.evaluate("document.getElementById('ps-peek').classList.contains('open') && !!document.querySelector('.sup-list')"));
    ok('names are shown as text, never as markup', await page.evaluate(
      "Plume.suppliers.add(); document.getElementById('sup-name').value='<b>Bold</b> Co'; Plume.suppliers.save(); !document.querySelector('.sup-name b') && document.body.textContent.indexOf('<b>Bold</b> Co')!==-1"));
    await page.close();
  }

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
