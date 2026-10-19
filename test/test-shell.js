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
