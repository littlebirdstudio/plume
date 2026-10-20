// The app shell (2026-10-18 redesign, Ingredients first): a sidebar that
// replaces each module's own header, one palette for the whole app, the
// slide-in panel for a quick look, filter chips and the overflow menu.
//
// Part 1 checks core's pieces in plain Node. Part 2 drives Ingredients,
// the pilot module, in a real page.
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

const INGS = [
  { id: 'a1', name: 'Aloe vera juice', inci: 'Aloe Barbadensis Leaf Juice', phase: 'water',
    functionCategory: ['Base / solvent'], min: 0, max: 100,
    lots: [{ id: 'la', supplier: 'Making Cosmetics', qtyPurchased: 500, qtyUnit: 'g', cost: 20, status: 'purchased' }] },
  { id: 'a2', name: 'Bakuchiol', inci: 'Bakuchiol', phase: 'oil', functionCategory: ['Active'], min: 0.5, max: 1 },
  { id: 'a3', name: 'Cetyl alcohol', inci: 'Cetyl Alcohol', phase: 'oil', functionCategory: ['Thickener'], flag: 'yes' },
  { id: 'a4', name: 'Old oil', inci: 'Oil', phase: 'oil', functionCategory: ['Emollient'], archived: true }
];
const FORMS = [
  { id: 'f1', name: 'Serum', lines: [], variants: [{ vid: 'v1', num: 1, status: 'draft', lines: [] }], activeVariantId: 'v1' },
  { id: 'f2', name: 'Balm', lines: [], variants: [{ vid: 'v1', num: 1, status: 'draft', lines: [] }], activeVariantId: 'v1' }
];

// ── 1. Core ───────────────────────────────────────────────────
const core = fs.readFileSync(path.join(ROOT, 'plume-core.js'), 'utf8');
const sandbox = { window: {}, document: { documentElement: { style: { setProperty() {} } } },
                  localStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 } };
vm.createContext(sandbox);
vm.runInContext(core, sandbox);
const P = sandbox.Plume;

console.log('\n1. Core');
ok('the shell, panel and icons are exported',
   typeof P.shell === 'function' && typeof P.refreshShell === 'function' && typeof P.icon === 'function' &&
   P.peek && typeof P.peek.open === 'function' && typeof P.peek.close === 'function');
ok('the palettes are the new set, with Finch first',
   JSON.stringify(Object.keys(P.PALETTES)) === '["finch","garden","lagoon","plum","sage-green"]', Object.keys(P.PALETTES));
ok('no sand or peach page colours: every --cream is a near-neutral',
   Object.keys(P.PALETTES).every(k => {
     const c = P.PALETTES[k].vars['--cream'], r = parseInt(c.slice(1, 3), 16), b = parseInt(c.slice(5, 7), 16);
     return r - b <= 6;
   }));
ok('icons come back as inline SVG', /^<svg[^>]*class="ps-i/.test(P.icon('ingredients')));
ok('an unknown icon name gives nothing rather than breaking', P.icon('nope') === '');

(async () => {
  const browser = await chromium.launch();
  const SEED = `
    localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(INGS))});
    localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});
    localStorage.setItem('plume-products-v1', '[]');
    localStorage.setItem('aerie-batches-v1', '[]');
    localStorage.setItem('plume-theme', 'light');`;
  const errors = [];
  async function open(module, viewport) {
    const page = await browser.newPage({ viewport: viewport || { width: 1280, height: 820 } });
    page.on('pageerror', e => errors.push(String(e)));
    await trackDialogs(page, []);
    await page.goto(previewUrl(module));
    await page.waitForTimeout(300);
    await page.evaluate(SEED);
    await page.reload();
    await page.waitForTimeout(500);
    return page;
  }

  console.log('\n2. The sidebar');
  {
    const page = await open('ingredients');
    ok('the old header is gone and the sidebar is in', await page.evaluate(
      "!document.querySelector('.app-header') && !!document.getElementById('ps-side') && document.body.classList.contains('ps-shell')"));
    const nav = await page.evaluate("Array.from(document.querySelectorAll('#ps-side a.ps-nav[target]')).map(function(a){var c=a.querySelector('.ps-ct');return a.textContent.replace(c?c.textContent:'','').trim()+' '+(c?c.textContent.trim():'');})");
    ok('it lists the five modules with counts (archived ingredient left out)',
       JSON.stringify(nav) === '["Ingredients 3","Formulations 2","Packaging 0","Products & Costing 0","Batches 0"]', nav);
    ok('the current module is marked for screen readers too', await page.evaluate(
      "var a=document.querySelector('#ps-side .ps-nav.on'); a && a.getAttribute('aria-current')==='page' && /ingredients/.test(a.getAttribute('href'))"));
    ok('each module opens in its own window, so two can sit side by side', await page.evaluate(
      "Array.from(document.querySelectorAll('#ps-side a.ps-nav[target]')).every(function(a){return /^plume-/.test(a.target);})"));
    ok('Settings is in the sidebar and opens the settings', await page.evaluate(
      "var b=Array.from(document.querySelectorAll('#ps-side button')).find(function(x){return /Settings/.test(x.textContent);}); b.click(); !!document.querySelector('.modal-overlay.open, .modal-ov.open, .drawer-overlay.open, #settings-modal.open')"));
    await page.keyboard.press('Escape');
    await page.evaluate("document.querySelectorAll('.open').forEach(function(e){if(!e.classList.contains('ps-menu'))e.classList.remove('open');})");
    const w1 = await page.evaluate("document.getElementById('ps-side').getBoundingClientRect().width");
    await page.evaluate("Plume.toggleSide()");
    await page.waitForTimeout(250);
    const w2 = await page.evaluate("document.getElementById('ps-side').getBoundingClientRect().width");
    ok('collapsing narrows the sidebar', w2 < w1 && w2 <= 64, [w1, w2]);
    ok('and is remembered', (await page.evaluate("localStorage.getItem('plume-side-collapsed')")) === '1');
    await page.reload(); await page.waitForTimeout(400);
    ok('after a reload it is still collapsed', await page.evaluate("document.body.classList.contains('ps-collapsed')"));
    await page.evaluate("Plume.toggleSide()");
    ok('the collapse setting is not listed as data in storage reports',
       !(await page.evaluate("JSON.stringify(Plume.storageReport ? Plume.storageReport() : '')")).includes('side-collapsed'));
    await page.close();
  }

  console.log('\n3. Page head, chips and menu');
  {
    const page = await open('ingredients');
    const sum = await page.evaluate("document.getElementById('ing-summary').innerText.replace(/\\s+/g,' ')");
    ok('the summary line counts ingredients and stock', /3 ingredients/.test(sum) && /1 in stock/.test(sum), sum);
    const rows = () => page.evaluate("document.querySelectorAll('#tbody tr[data-ing]').length");
    ok('all three show at first', (await rows()) === 3, await rows());
    await page.evaluate("Array.from(document.querySelectorAll('#phase-chips .ps-chip')).find(function(b){return /Oil/.test(b.textContent);}).click()");
    ok('the Oil phase chip filters to oils', (await rows()) === 2, await rows());
    ok('and shows as chosen', await page.evaluate("/Oil/.test(document.querySelector('#phase-chips .ps-chip.on').textContent)"));
    await page.evaluate("Array.from(document.querySelectorAll('#phase-chips .ps-chip')).find(function(b){return /All/.test(b.textContent);}).click()");
    ok('All brings them back', (await rows()) === 3);
    await page.click('#restricted-chip');
    ok('Restricted shows only the restricted one', (await rows()) === 1, await rows());
    await page.click('#restricted-chip');
    await page.click('#in-stock-btn');
    ok('In stock shows only what is on hand', (await rows()) === 1, await rows());
    ok('in-stock rows keep their tint', await page.evaluate("document.querySelector('#tbody tr[data-ing]').classList.contains('has-stock')"));
    await page.click('#in-stock-btn');
    await page.click('#ing-more-btn');
    ok('the ⋯ button opens the menu', await page.evaluate("document.getElementById('ing-more-menu').classList.contains('open')"));
    const items = await page.evaluate("document.getElementById('ing-more-menu').innerText");
    ok('with quick add, export and import in it', /starter/.test(items) && /Export/.test(items) && /Import/.test(items), items);
    await page.mouse.click(600, 60);
    ok('a click elsewhere closes it', await page.evaluate("!document.getElementById('ing-more-menu').classList.contains('open')"));
    await page.close();
  }

  console.log('\n4. The quick-look panel');
  {
    const page = await open('ingredients');
    const isOpen = () => page.evaluate("Plume.peek.isOpen()");
    await page.click('#tbody tr[data-ing="a2"]');
    await page.waitForTimeout(250);
    ok('clicking a row opens the panel', await isOpen());
    ok('showing that ingredient', /Bakuchiol/.test(await page.evaluate("document.getElementById('ps-peek-body').innerText")));
    ok('the row is marked', await page.evaluate("document.querySelector('#tbody tr[data-ing=\"a2\"]').classList.contains('sel')"));
    await page.evaluate("toggleQuickLook('a1')");
    await page.waitForTimeout(150);
    ok('asking for another ingredient switches the panel to it', /Aloe vera/.test(await page.evaluate("document.getElementById('ps-peek-body').innerText")));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    ok('Escape closes it', !(await isOpen()));
    ok('and the mark comes off', await page.evaluate("!document.querySelector('#tbody tr.sel')"));
    await page.evaluate("toggleQuickLook('a1')");
    await page.click('#ps-scrim', { position: { x: 20, y: 400 } });
    await page.waitForTimeout(250);
    ok('clicking outside closes it too', !(await isOpen()));
    await page.evaluate("toggleQuickLook('a1')");
    await page.evaluate("Array.from(document.querySelectorAll('#ps-peek-actions button')).find(function(b){return /full page/i.test(b.textContent);}).click()");
    await page.waitForTimeout(250);
    ok('"Open full page" goes to the details and closes the panel',
       !(await isOpen()) && await page.evaluate("document.getElementById('detail-mode') ? getComputedStyle(document.getElementById('detail-mode')).display !== 'none' : /Aloe/.test(document.getElementById('d-header').innerText)"));
    await page.close();
  }

  console.log('\n4b. Formulations in the shell (2026-10-18)');
  {
    const page = await open('formulations');
    const f = [{ id: 'f1', name: 'Serum', type: 'Facial serum', notes: 'For dry skin', formNotes: '', activeVariantId: 'v1', status: 'draft',
      lines: [{ ingId: 'a1', pct: 99 }, { ingId: 'a2', pct: 1 }],
      variants: [{ vid: 'v1', num: 1, label: '', status: 'draft', lines: [{ ingId: 'a1', pct: 99 }, { ingId: 'a2', pct: 1 }],
                   instructions: 'Stir', batchSize: '100', addinsInTotal: true, usageLog: [], history: [] }] },
      { id: 'f2', name: 'Balm', type: 'Face balm', status: 'approved', lines: [],
        variants: [{ vid: 'b1', num: 1, status: 'approved', lines: [] }], activeVariantId: 'b1' },
      { id: 'f3', name: 'Old salve', type: 'Face balm', archived: true, lines: [],
        variants: [{ vid: 'c1', num: 1, status: 'draft', lines: [] }], activeVariantId: 'c1' }];
    await page.evaluate("localStorage.setItem('aerie-formulations-v1', " + JSON.stringify(JSON.stringify(f)) + ")");
    await page.reload(); await page.waitForTimeout(500);

    ok('the sidebar marks Formulations', (await page.evaluate("document.querySelector('#ps-side .ps-nav.on').textContent")).indexOf('Formulations') !== -1);
    ok('the old dark header is gone', (await page.evaluate("document.querySelector('.app-header')")) === null);
    ok('the page head is the colour block', await page.evaluate("getComputedStyle(document.querySelector('#list-view .ps-page-head')).backgroundColor !== 'rgba(0, 0, 0, 0)'"));
    ok('the summary counts live formulations by status', /2 formulations[\s\S]*1 approved[\s\S]*0 testing[\s\S]*1 draft/.test(await page.evaluate("document.getElementById('fl-summary').innerText")),
       await page.evaluate("document.getElementById('fl-summary').innerText"));
    const names = () => page.evaluate("Array.from(document.querySelectorAll('.fcard-name')).map(e => e.textContent).join('|')");
    ok('cards list the live formulations', (await names()) === 'Serum|Balm', await names());
    await page.evaluate("setListStatus('approved')");
    ok('a status chip filters the cards', (await names()) === 'Balm', await names());
    await page.evaluate("setListStatus('')");
    await page.evaluate("document.getElementById('fl-search').value = 'ser'; renderCards();");
    ok('the search box filters by name', (await names()) === 'Serum', await names());
    await page.evaluate("document.getElementById('fl-search').value = ''; renderCards();");

    await page.evaluate("openFormula('f1')");
    await page.waitForTimeout(200);
    ok('the breadcrumb names the formula', (await page.evaluate("document.getElementById('fe-crumb-cur').textContent")) === 'Serum');
    ok('name, purpose and the fields sit in the colour block', await page.evaluate(
      "var h=document.querySelector('#editor-view .ps-page-head'); !!(h.querySelector('#f-name') && h.querySelector('#f-notes') && h.querySelector('#f-type') && h.querySelector('#f-status'))"));
    ok('phase boxes keep their colours', await page.evaluate(
      "var w=document.querySelector('.phase-group.ph-water'), o=document.querySelector('.phase-group.ph-oil'); !!w && !!o && getComputedStyle(w).borderTopColor !== getComputedStyle(o).borderTopColor"));
    ok('rows sit inside their phase box', (await page.evaluate("document.querySelectorAll('.phase-group .ing-row').length")) === 2);
    ok('a clean formula reads Saved', /Saved/.test(await page.evaluate("document.getElementById('save-state').textContent")));
    await page.evaluate("document.getElementById('f-notes').value = 'For very dry skin'; document.getElementById('f-notes').dispatchEvent(new Event('input'))");
    ok('an edit turns it into a Save button', (await page.evaluate("!!document.querySelector('#save-state button')")) === true);
    await page.evaluate("document.querySelector('#save-state button').click()");
    ok('Save saves and goes back to Saved', (await page.evaluate("forms.find(x => x.id === 'f1').notes")) === 'For very dry skin' &&
       /Saved/.test(await page.evaluate("document.getElementById('save-state').textContent")));
    ok('Method is the first tab under the recipe', (await page.evaluate("document.getElementById('ep-method').style.display")) === '' &&
       (await page.evaluate("document.getElementById('f-instruct').value")) === 'Stir');
    await page.evaluate("document.getElementById('f-instruct').value = 'Stir gently'; document.getElementById('f-instruct').dispatchEvent(new Event('input')); saveFormula();");
    await page.evaluate("setEdTab('hist')");
    ok('Change history opens as a tab', (await page.evaluate("document.getElementById('ep-hist').style.display")) === '' &&
       (await page.evaluate("document.getElementById('ep-method').style.display")) === 'none');
    ok('the tab shows how many changes', (await page.evaluate("document.getElementById('et-hist-ct').textContent")) === String(await page.evaluate("forms.find(x => x.id === 'f1').variants[0].history.length")) &&
       (await page.evaluate("document.getElementById('et-hist-ct').textContent")) !== '');
    await page.evaluate("document.querySelector('.var-notes-btn').click()");
    await page.waitForTimeout(300);
    ok('Notes slides in from the right', await page.evaluate("document.getElementById('ps-peek').classList.contains('open') && !!document.getElementById('np-text')"));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    ok('Escape closes it', await page.evaluate("!document.getElementById('ps-peek').classList.contains('open')"));
    ok('Archive is in the ⋯ menu', await page.evaluate("!!document.querySelector('.fe-top .ps-menu #archive-btn')"));
    await page.close();
  }

  console.log('\n4c. Products & Costing in the shell (2026-10-19)');
  {
    const page = await open('costing');
    // Body butter (f1 Whip, f2 Peppermint), Face oil (f3), a pack, and a
    // formulation with no type. Packaging p1 costs 1.00 a unit.
    const f = [
      { id: 'f1', name: 'Whipped butter', type: 'Body butter', lines: [{ ingId: 'a1', pct: 100 }] },
      { id: 'f2', name: 'Peppermint butter', type: 'Body butter', lines: [{ ingId: 'a1', pct: 100 }] },
      { id: 'f3', name: 'Calendula oil', type: 'Face oil', lines: [{ ingId: 'a1', pct: 100 }] },
      { id: 'f4', name: 'Mystery', lines: [] }];
    const pk = [{ id: 'k1', kind: 'jar', capacity: '4 oz', color: 'White', purchases: [{ date: '2026-09-01', qty: 10, totalCost: 10, shipping: 0 }] }];
    const pr = [
      { id: 'w4', name: 'Whip 4 oz', sku: 'W4', status: 'active', formulaId: 'f1', netWtG: 100, packagingRecipe: [{ packagingId: 'k1', quantity: 1 }], retail: 20, wholesale: 10,
        productionRuns: [{ id: 'r1', date: '2026-10-01', units: 6 }] },
      { id: 'w2', name: 'Whip 2 oz', status: 'draft', formulaId: 'f1', netWtG: 50, packagingRecipe: [] },
      { id: 'pp', name: 'Pepper 4 oz', status: 'active', formulaId: 'f2', netWtG: 100, packagingRecipe: [] },
      { id: 'c1', name: 'Calendula 30', status: 'discontinued', formulaId: 'f3', netWtG: 27, packagingRecipe: [] },
      { id: 'kit', name: 'Duo', status: 'active', productKind: 'multi', components: [{ id: 'x', formulaId: 'f3', netWtG: 3, label: 'Oil 3 mL' }], packagingRecipe: [{ packagingId: 'k1', quantity: 1 }], retail: 8, wholesale: 1 },
      { id: 'mm', name: 'Mystery jar', status: 'active', formulaId: 'f4', packagingRecipe: [] }];
    await page.evaluate("localStorage.setItem('aerie-formulations-v1', " + JSON.stringify(JSON.stringify(f)) + ");" +
      "localStorage.setItem('aerie-packaging-v2', " + JSON.stringify(JSON.stringify(pk)) + ");" +
      "localStorage.setItem('plume-products-v1', " + JSON.stringify(JSON.stringify(pr)) + ");" +
      "localStorage.setItem('plume_costing_listorder_v1', '1');");
    await page.reload(); await page.waitForTimeout(500);

    ok('the sidebar marks Products & Costing', (await page.evaluate("document.querySelector('#ps-side .ps-nav.on').textContent")).indexOf('Products') !== -1);
    ok('the old dark header is gone', (await page.evaluate("document.querySelector('.app-hdr')")) === null);
    const sum = await page.evaluate("document.getElementById('pl-summary').innerText");
    ok('the summary counts products, active, units made and low margins', /6 products[\s\S]*4 active[\s\S]*6 units made[\s\S]*1 with a margin under 30%/.test(sum), sum);
    const outline = () => page.evaluate(`Array.from(document.querySelectorAll('#list-body tr')).map(function (r) {
      if (r.classList.contains('grp-type')) return 'T:' + r.querySelector('.type-bar').childNodes[1].textContent;
      if (r.classList.contains('grp-sub')) return 'F:' + r.querySelector('.sub-h').childNodes[1].textContent;
      return r.querySelector('.ps-name').textContent; }).join('|')`);
    ok('types, then formulations, then products; packs last; array order within a formulation',
       (await outline()) === 'T:Body butter|F:Peppermint butter|Pepper 4 oz|F:Whipped butter|Whip 4 oz|Whip 2 oz|T:Face oil|F:Calendula oil|Calendula 30|T:No type set|F:Mystery|Mystery jar|T:Sample packs & kits|Duo',
       await outline());
    ok('the type bar is the palette colour', await page.evaluate(
      "getComputedStyle(document.querySelector('.type-bar')).backgroundColor === getComputedStyle(document.querySelector('.ps-btn-primary')).backgroundColor"));
    ok('a formulation heading links to it', (await page.evaluate("document.querySelector('.sub-h a').getAttribute('href')")) === 'plume-formulations.html#f=f2');
    await page.evaluate("document.querySelector('.grp-type').click()");
    ok('clicking a type folds it away', (await outline()).indexOf('Pepper 4 oz') === -1 && (await outline()).indexOf('T:Body butter') === 0, await outline());
    await page.evaluate("document.getElementById('search').value = 'face oil'; renderList();");
    ok('search matches the type, and reaches a folded group', (await outline()) === 'T:Face oil|F:Calendula oil|Calendula 30', await outline());
    await page.evaluate("document.getElementById('search').value = ''; setStatusFilter('draft');");
    ok('a status chip filters', (await outline()) === 'T:Body butter', await outline());
    await page.evaluate("document.querySelector('.grp-type').click(); setStatusFilter('all');");
    ok('the row shows unit cost and both margins', /\$1\.00[\s\S]*95%[\s\S]*90%/.test(await page.evaluate(
      "Array.from(document.querySelectorAll('.prod-row')).find(r => r.innerText.indexOf('Whip 4 oz') !== -1).innerText")));

    await page.evaluate("openProduct('w4')");
    await page.waitForTimeout(200);
    ok('the breadcrumb names the product', (await page.evaluate("document.getElementById('pe-crumb-cur').textContent")) === 'Whip 4 oz');
    ok('name, label line and the fields sit in the colour block', await page.evaluate(
      "var h=document.querySelector('#view-editor .ps-page-head'); !!(h.querySelector('#p-name') && h.querySelector('#p-netwt-display') && h.querySelector('#p-sku') && h.querySelector('#p-status'))"));
    ok('cost, prices and the helper sit in the right column', await page.evaluate(
      "var a=document.querySelector('.ed-side'); !!(a.querySelector('#cost-panel') && a.querySelector('#p-retail') && a.querySelector('#pricing-helper'))"));
    ok('the right column stays in view', (await page.evaluate("getComputedStyle(document.querySelector('.ed-side')).position")) === 'sticky');
    ok('the cost card shows the total', /\$1\.00/.test(await page.evaluate("document.querySelector('#cost-panel .big').textContent")));
    ok('a clean product reads Saved', /Saved/.test(await page.evaluate("document.getElementById('save-state').textContent")));
    await page.evaluate("var r=document.getElementById('p-retail'); r.value='40'; r.dispatchEvent(new Event('input'))");
    ok('changing the price updates the margin beside it', /98%/.test(await page.evaluate("document.getElementById('marg-retail').textContent")),
       await page.evaluate("document.getElementById('marg-retail').textContent"));
    ok('an edit turns Saved into a Save button', await page.evaluate("!!document.querySelector('#save-state button')"));
    await page.evaluate("document.querySelector('#save-state button').click()");
    ok('Save saves and goes back to Saved', (await page.evaluate("findProduct('w4').retail")) === 40 &&
       /Saved/.test(await page.evaluate("document.getElementById('save-state').textContent")));
    ok('Label is the first tab', await page.evaluate("!document.getElementById('pp-label').hidden && document.getElementById('pp-runs').hidden"));
    ok('the runs tab shows how many runs', (await page.evaluate("document.getElementById('pt-runs-ct').textContent")) === '1');
    await page.evaluate("setEdTab('runs')");
    ok('Fills opens as a tab', await page.evaluate("!document.getElementById('pp-runs').hidden && document.getElementById('pp-label').hidden"));
    await page.evaluate("pickKind('multi')");
    ok('Made from switches to components', await page.evaluate(
      "document.getElementById('kind-multi').checked && document.getElementById('multi-mode-fields').style.display === '' && document.getElementById('kind-btn-multi').classList.contains('on')"));
    await page.evaluate("pickKind('single')");
    ok('and back', await page.evaluate("document.getElementById('kind-single').checked && document.getElementById('single-mode-fields').style.display === ''"));
    ok('Duplicate and Delete are in the ⋯ menu', await page.evaluate(
      "var m=document.querySelector('.fe-top .ps-menu'); /Duplicate/.test(m.textContent) && !!m.querySelector('.ps-menu-danger')"));
    await page.close();

    const phone = await open('costing', { width: 390, height: 844 });
    await phone.evaluate("localStorage.setItem('plume-products-v1', " + JSON.stringify(JSON.stringify(pr)) + ");" +
      "localStorage.setItem('aerie-formulations-v1', " + JSON.stringify(JSON.stringify(f)) + ");");
    await phone.reload(); await phone.waitForTimeout(500);
    ok('Costing list does not scroll sideways on a phone', await phone.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"));
    await phone.evaluate("openProduct('w4')"); await phone.waitForTimeout(200);
    ok('nor does the editor', await phone.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
       await phone.evaluate("document.documentElement.scrollWidth"));
    await phone.close();
  }

  console.log('\n4d. Batches in the shell (2026-10-19)');
  {
    const page = await open('batchlog');
    const today = await page.evaluate("Plume.todayISO()");
    const plus = (d) => page.evaluate("(function(){var x=Plume.parseLocalDate(Plume.todayISO());x.setDate(x.getDate()+" + d + ");return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');})()");
    const f = [
      { id: 'fb', name: 'Body butter', type: 'Body butter', status: 'approved', lines: [{ ingId: 'a1', pct: 100 }] },
      { id: 'fs', name: 'Oat soap', type: 'Cold Process Soap', status: 'approved', lines: [{ ingId: 'a1', gramsFixed: 500 }] },
      { id: 'ft', name: 'Serum trial', type: 'Facial serum', status: 'testing', lines: [{ ingId: 'a1', pct: 100 }] }];
    const ingsWithCost = [{ id: 'a1', name: 'Aloe vera juice', inci: 'Aloe', lots: [{ id: 'l1', costPerG: 0.02, qtyPurchased: 1000, qtyUnit: 'g' }], activeLotId: 'l1' }];
    const b = [
      { id: 'b1', date: today, formulaId: 'fb', formulaName: 'Body butter', formulaType: 'Body butter', batchName: 'Spring', batchType: 'production', actualYield: 400, status: 'ready', notes: '',
        ingredientSnapshot: [{ ingredientId: 'a1', ingredientName: 'Aloe vera juice', grams: 400 }],
        packagingRuns: [{ id: 'r1', date: today, components: [{ packagingId: 'x', packagingName: 'Jar', quantity: 6 }, { packagingId: 'y', packagingName: 'Label', quantity: 6 }], committed: true }], committed: true },
      { id: 'b2', date: await plus(-10), formulaId: 'fs', formulaName: 'Oat soap', formulaType: 'Cold Process Soap', batchName: '', batchType: 'production', actualYield: 1000, status: 'curing', cureWeeks: 4, readyDate: await plus(18), ingredientSnapshot: [], packagingRuns: [], committed: true },
      { id: 'b3', date: '2026-01-05', formulaId: 'ft', formulaName: 'Serum trial', formulaType: 'Facial serum', batchName: 'Trial', batchType: 'test', actualYield: 100, status: 'depleted', ingredientSnapshot: [], packagingRuns: [], committed: true }];
    await page.evaluate("localStorage.setItem('aerie-formulations-v1', " + JSON.stringify(JSON.stringify(f)) + ");" +
      "localStorage.setItem('aerie-ingredients-v2', " + JSON.stringify(JSON.stringify(ingsWithCost)) + ");" +
      "localStorage.setItem('aerie-batches-v1', " + JSON.stringify(JSON.stringify(b)) + ");");
    await page.reload(); await page.waitForTimeout(500);

    ok('the sidebar marks Batches', (await page.evaluate("document.querySelector('#ps-side .ps-nav.on').textContent")).indexOf('Batches') !== -1);
    ok('the old dark header and stat cards are gone', (await page.evaluate("!document.querySelector('.app-header') && !document.getElementById('s-total')")));
    const sum = await page.evaluate("document.getElementById('bl-summary').innerText");
    ok('the summary counts batches, curing, ready and this month', /3 batches[\s\S]*1 curing[\s\S]*1 ready[\s\S]*[12] this month/.test(sum), sum);
    const names = () => page.evaluate("Array.from(document.querySelectorAll('#tbody tr')).map(function(r){return r.classList.contains('group-row') ? 'G:' + r.innerText.trim().split('\\n')[0] : r.querySelector('.ps-name').textContent;}).join('|')");
    ok('the list opens By formulation (her item 1, 2026-10-19)', (await names()) === 'G:Body butter|Spring|G:Oat soap|Oat soap|G:Serum trial|Trial', await names());
    await page.click('[data-bl-view="recent"]');
    ok('Recent lists newest first', (await names()) === 'Spring|Oat soap|Trial', await names());
    await page.click('[data-bl-view="status"]');
    ok('the By status tab groups, curing first', (await names()) === 'G:Curing|Oat soap|G:Ready|Spring|G:Used up|Trial', await names());
    ok('and drives the old view select', (await page.evaluate("document.getElementById('f-view').value")) === 'status');
    await page.click('[data-bl-view="recent"]');
    await page.click('[data-bl-pill="f-type:test"]');
    ok('the Tests chip filters', (await names()) === 'Trial', await names());
    await page.click('[data-bl-pill="f-type:"]');
    const curing = await page.evaluate("Array.from(document.querySelectorAll('#tbody tr')).find(r => r.innerText.indexOf('Oat soap') !== -1).innerText");
    ok('a curing batch shows its ready date and days left', /Curing[\s\S]*ready[\s\S]*18 days/.test(curing), curing);
    ok('with a progress bar', await page.evaluate("!!document.querySelector('#tbody .cure-bar i')"));
    ok('bulk left replaces the old packaged-units guess', /400 g of 400 g[\s\S]*1 older packaging run/.test(await page.evaluate("document.querySelector('#tbody tr').innerText")));

    await page.evaluate("openBatchDetail('b1')"); await page.waitForTimeout(400);
    ok('a batch slides in at the right edge', await page.evaluate(
      "var r=document.querySelector('#m-detail .modal').getBoundingClientRect(); Math.round(r.right) === window.innerWidth && r.top === 0"));
    ok('Details is the first tab', await page.evaluate("!document.getElementById('bp-details').hidden && document.getElementById('bp-ings').hidden && document.getElementById('bp-runs').hidden"));
    ok('the tabs show counts', (await page.evaluate("document.getElementById('bt-ings-ct').textContent + '/' + document.getElementById('bt-runs-ct').textContent")) === '1/');
    ok('the header links to the formulation', (await page.evaluate("document.querySelector('#d-meta a').getAttribute('href')")) === 'plume-formulations.html#f=fb');
    ok('a clean batch reads Saved', /Saved/.test(await page.evaluate("document.getElementById('d-save-state').textContent")) && await page.evaluate("document.getElementById('d-save-btn').hidden"));
    await page.click('[data-bl-pill="d-type-sel:test"]');
    ok('a pill sets the batch type and shows Save changes', (await page.evaluate("document.getElementById('d-type-sel').value")) === 'test' && !(await page.evaluate("document.getElementById('d-save-btn').hidden")));
    await page.evaluate("PLUME_TEST_ANSWER = false; closeDetail();");
    ok('closing with unsaved changes asks, and No keeps it open', await page.evaluate("document.getElementById('m-detail').classList.contains('open')"));
    await page.evaluate("PLUME_TEST_ANSWER = undefined; saveBatchEdits();");
    ok('Save changes saves and goes back to Saved', (await page.evaluate("findBatch('b1').batchType")) === 'test' && /Saved/.test(await page.evaluate("document.getElementById('d-save-state').textContent")));
    await page.evaluate("setBatchTab('ings')");
    const ings = await page.evaluate("document.getElementById('d-snapshot').innerText");
    ok('Ingredients lists each line with its cost and a total', /Aloe vera juice[\s\S]*400\.0[\s\S]*\$8\.00[\s\S]*Ingredient cost for 400 g[\s\S]*\$8\.00/.test(ings), ings);
    await page.evaluate("setBatchTab('runs')");
    ok('the Fills tab shows the bulk left and Fill from this batch', /Bulk left[\s\S]*400 g/.test(await page.evaluate("document.getElementById('d-fills').innerText")) && await page.evaluate("!!document.getElementById('d-fill-btn')"));
    await page.keyboard.press('Escape'); await page.waitForTimeout(100);
    ok('Escape closes a saved batch', await page.evaluate("!document.getElementById('m-detail').classList.contains('open')"));

    await page.evaluate("openBatchDetail('b2')"); await page.waitForTimeout(150);
    ok('a curing batch shows cure pills, the curing note and a Curing status pill', await page.evaluate(
      "document.getElementById('d-cure-row').style.display === '' && document.querySelector('[data-bl-pill=\"d-cure:4\"]').classList.contains('on') && document.getElementById('d-curing-note').style.display === '' && document.querySelector('#d-status-pills [data-status=\"curing\"]').classList.contains('on')"));
    ok('an unnamed batch shows the formulation as its title', (await page.evaluate("document.getElementById('d-name').placeholder")) === 'Oat soap');
    await page.evaluate("closeDetail()");

    await page.evaluate("openNewBatch()"); await page.waitForTimeout(400);
    ok('New batch slides in from the right', await page.evaluate("var r=document.querySelector('#m-new .modal').getBoundingClientRect(); Math.round(r.right) === window.innerWidth"));
    await page.evaluate("document.getElementById('f-formula').value='ft'; onFormulaChange();");
    ok('a testing formulation selects the Test pill', await page.evaluate("document.querySelector('[data-bl-pill=\"f-type-sel:test\"]').classList.contains('on') && document.getElementById('f-type-sel').value === 'test'"));
    await page.evaluate("document.getElementById('f-formula').value='fs'; onFormulaChange();");
    ok('a soap shows the cure pills', await page.evaluate("document.getElementById('f-cure-row').style.display === '' && document.querySelector('[data-bl-pill=\"f-type-sel:production\"]').classList.contains('on')"));
    await page.close();

    const phone = await open('batchlog', { width: 390, height: 844 });
    await phone.evaluate("localStorage.setItem('aerie-batches-v1', " + JSON.stringify(JSON.stringify(b)) + ");");
    await phone.reload(); await phone.waitForTimeout(400);
    await phone.evaluate("openBatchDetail('b1'); setBatchTab('runs')"); await phone.waitForTimeout(150);
    ok('a batch fits a phone without sideways scroll', await phone.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"));
    await phone.close();
  }

  console.log('\n4e. Batch status: Used up, Discarded, Ready by itself (2026-10-19)');
  {
    const page = await open('batchlog');
    const day = (d) => page.evaluate("(function(){var x=Plume.parseLocalDate(Plume.todayISO());x.setDate(x.getDate()+" + d + ");return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');})()");
    const f = [{ id: 'fs', name: 'Oat soap', type: 'Cold Process Soap', lines: [] }, { id: 'fm', name: 'Rose mist', type: 'Toner / mist', lines: [] }];
    const b = [
      { id: 'due', date: await day(-30), formulaId: 'fs', formulaName: 'Oat soap', formulaType: 'Cold Process Soap', batchName: 'Due', status: 'curing', cureWeeks: 4, readyDate: await day(-2), ingredientSnapshot: [], packagingRuns: [], committed: true },
      { id: 'notyet', date: await day(-5), formulaId: 'fs', formulaName: 'Oat soap', formulaType: 'Cold Process Soap', batchName: 'Not yet', status: 'curing', cureWeeks: 4, readyDate: await day(23), ingredientSnapshot: [], packagingRuns: [], committed: true },
      { id: 'mist', date: await day(-1), formulaId: 'fm', formulaName: 'Rose mist', formulaType: 'Toner / mist', batchName: 'Mist trial', batchType: 'test', status: 'ready', ingredientSnapshot: [], packagingRuns: [], committed: true }];
    await page.evaluate("localStorage.setItem('aerie-formulations-v1', " + JSON.stringify(JSON.stringify(f)) + ");" +
      "localStorage.setItem('aerie-batches-v1', " + JSON.stringify(JSON.stringify(b)) + ");");
    await page.reload(); await page.waitForTimeout(500);
    ok('curing soap past its ready date turned Ready on load', (await page.evaluate("findBatch('due').status")) === 'ready');
    ok('and that was saved', (await page.evaluate("JSON.parse(localStorage.getItem('aerie-batches-v1')).find(function(x){return x.id==='due';}).status")) === 'ready');
    ok('soap not yet due keeps curing', (await page.evaluate("findBatch('notyet').status")) === 'curing');

    await page.evaluate("openBatchDetail('mist')"); await page.waitForTimeout(300);
    const pills = () => page.evaluate("Array.from(document.querySelectorAll('#d-status-pills .ps-chip')).map(function(e){return e.textContent + (e.classList.contains('on') ? '*' : '');}).join('|')");
    ok('a mist offers Ready, Used up and Discarded, no Curing', (await pills()) === 'Ready*|Used up|Discarded', await pills());
    await page.evaluate("PLUME_TEST_ANSWER = false; document.querySelector('#d-status-pills [data-status=\"discarded\"]').click(); PLUME_TEST_ANSWER = undefined;");
    ok('Discarded asks first; No leaves it alone', (await page.evaluate("findBatch('mist').status")) === 'ready');
    await page.evaluate("document.querySelector('#d-status-pills [data-status=\"discarded\"]').click()");
    ok('Yes marks it discarded and saves at once', (await page.evaluate("JSON.parse(localStorage.getItem('aerie-batches-v1')).find(function(x){return x.id==='mist';}).status")) === 'discarded');
    ok('the pills and note follow', (await pills()) === 'Ready|Used up|Discarded*' && /Wasted/.test(await page.evaluate("document.getElementById('d-status-note').textContent")));
    ok('the status change does not leave a Save changes behind', await page.evaluate("document.getElementById('d-save-btn').hidden"));
    await page.evaluate("closeDetail()");
    ok('the list strikes it through and says Discarded', await page.evaluate(
      "var r=document.querySelector('tr[onclick*=\"mist\"]'); r.classList.contains('discarded') && /Discarded/.test(r.innerText)"));
    ok('the summary counts discarded batches', /1 discarded/.test(await page.evaluate("document.getElementById('bl-summary').innerText")));
    await page.evaluate("blPill('f-view','status')");
    ok('By status files it under Discarded', /Discarded[\s\S]*Mist trial/.test(await page.evaluate("document.getElementById('tbody').innerText")));

    await page.evaluate("openBatchDetail('notyet')"); await page.waitForTimeout(300);
    await page.evaluate("document.querySelector('#d-status-pills [data-status=\"ready\"]').click()");
    ok('Ready ends a cure early, dated today', (await page.evaluate("findBatch('notyet').status + ' ' + (findBatch('notyet').readyDate === Plume.todayISO())")) === 'ready true');
    await page.evaluate("document.querySelector('#d-status-pills [data-status=\"depleted\"]').click()");
    ok('Used up is set by hand', (await page.evaluate("findBatch('notyet').status")) === 'depleted');
    ok('and shows as Used up', /Used up/.test(await page.evaluate("document.getElementById('d-meta').innerText")));
    await page.close();

    const cost = await open('costing');
    await cost.evaluate("localStorage.setItem('aerie-formulations-v1', " + JSON.stringify(JSON.stringify(f)) + ");" +
      "localStorage.setItem('aerie-batches-v1', " + JSON.stringify(JSON.stringify([Object.assign({}, b[2], { status: 'discarded' }), Object.assign({}, b[2], { id: 'mist2', batchName: 'Mist good', status: 'ready' })])) + ");" +
      "localStorage.setItem('plume-products-v1', " + JSON.stringify(JSON.stringify([{ id: 'pm', name: 'Rose mist 2 oz', status: 'active', formulaId: 'fm', packagingRecipe: [] }])) + ");" +
      "localStorage.setItem('plume_costing_listorder_v1', '1');");
    await cost.reload(); await cost.waitForTimeout(500);
    await cost.evaluate("openProduct('pm'); setEdTab('runs'); openProductFill()"); await cost.waitForTimeout(300);
    const opts = await cost.evaluate("Array.from(document.querySelector('[data-fl-b]').options).map(function(o){return o.textContent;}).join('|')");
    ok('a fill does not offer a discarded batch', !/Mist trial/.test(opts) && /Mist good/.test(opts), opts);
    await cost.close();
  }

  console.log('\n5. Phone width');
  {
    const page = await open('ingredients', { width: 390, height: 844 });
    ok('the page does not scroll sideways', await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
       await page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]"));
    ok('the sidebar becomes a bar along the top', await page.evaluate(
      "var r=document.getElementById('ps-side').getBoundingClientRect(); r.top===0 && r.width>=380 && r.height<80"));
    await page.close();
  }

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
