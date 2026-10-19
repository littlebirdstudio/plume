// Packaging kinds (core v1.22, 2026-10-18).
//
// Heide's packaging list had outgrown free-text names: every size and color
// of dropper bottle had to be phrased exactly like its relatives to sort
// together, and the Batches dropdown made them hard to tell apart. An item
// now has a KIND (one pick: name, drawing and type), a size, and a color and
// material or a product and part, and every list and picker builds the same
// display from those: "Dropper bottle · 1 oz · Blue glass".
//
// What this suite holds in place:
//   1. core's parser, display, grouping and search
//   2. old items (no kind) still list, under Needs sorting, and the Tidy
//      screen converts only the ticked rows without touching stock or cost
//   3. the edit panel: kind first, the fields that follow it, Other needs a
//      name, the duplicate warning, name/type still written for old readers
//   4. photos: no upload, per-item and all-at-once removal
//   5. drawings keep their literal colors in dark mode
//   6. the picker in Batches and Products & Costing writes through the
//      original <select>, so the modules' own change handlers run
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const PHOTO = 'data:image/jpeg;base64,' + 'A'.repeat(4000);
function item(id, name, qty, cost, extra) {
  return Object.assign({ id, name, type: 'container', supplier: 'SKS Bottle', moq: '', capacity: '', link: '', notes: '',
    purchases: [{ date: '2026-09-01', qty, totalCost: String(cost), shipping: '' }], adjustments: [] }, extra || {});
}
const OLD = [
  item('p1', '1oz amber glass dropper bottle', 24, 14.88, { image: PHOTO }),
  item('p2', '1oz blue glass dropper bottle', 12, 8.52, { image: PHOTO, moq: '24', notes: 'Black bulb' }),
  item('p3', '.5 oz amber dropper bottle (samples)', 60, 28.80),
  item('p4', 'Serum label front 3.5x1.25', 120, 7.20, { type: 'label' }),
  item('p5', 'Tissue paper sheets', 100, 5.00, { type: 'other' })
];
const PRODUCTS = [
  { id: 'pr1', name: 'Hydrating facial serum', packagingRecipe: [{ packagingId: 'p1', quantity: 1 }, { packagingId: 'p4', quantity: 1 }] },
  { id: 'pr2', name: 'Glow face oil', packagingRecipe: [{ packagingId: 'p1', quantity: 1 }] }
];

(async () => {
  const browser = await chromium.launch();
  async function open(module, data, theme) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [], dialogs = [];
    page.on('pageerror', e => errors.push(String(e)));
    await trackDialogs(page, dialogs);
    await page.addInitScript(([d, th]) => {
      if (sessionStorage.getItem('seeded')) return;
      localStorage.clear();
      Object.keys(d).forEach(k => localStorage.setItem(k, JSON.stringify(d[k])));
      localStorage.setItem('plume-theme', th);
      sessionStorage.setItem('seeded', '1');
    }, [data, theme || 'light']);
    await page.goto(previewUrl(module));
    await page.waitForTimeout(400);
    return { ctx, page, errors, dialogs };
  }
  const stored = page => page.evaluate("JSON.parse(localStorage.getItem('aerie-packaging-v2'))");
  const base = { 'aerie-packaging-v2': OLD, 'plume-products-v1': PRODUCTS };

  console.log('\n1. Core: reading old names, the display, grouping, search');
  {
    const { ctx, page, errors } = await open('packaging', base);
    const g = await page.evaluate(`(function () {
      var P = [{ id: 'pr1', name: 'Hydrating facial serum' }];
      var r = {};
      ['1oz amber glass dropper bottle', '.5 oz amber dropper bottle (samples)', 'Amber pump bottle 4oz PET',
       'Kraft box small (2x2x4)', 'Serum label front 3.5x1.25', 'barcode sticker 1.5x.5', 'Shrink bands 28mm clear',
       '4oz clear mister', '30ml airless pump clear plastic', 'Cobalt dropper 2oz', 'Tissue paper sheets'].forEach(function (n) {
        r[n] = Plume.pkGuess(n, P);
      });
      return r;
    })()`);
    const d = g['1oz amber glass dropper bottle'];
    ok('a dropper bottle reads as kind, size, color and material', d.kind === 'dropper' && d.capacity === '1 oz' && d.color === 'Amber' && d.material === 'Glass', d);
    ok('".5 oz" reads as 0.5 oz', g['.5 oz amber dropper bottle (samples)'].capacity === '0.5 oz', g['.5 oz amber dropper bottle (samples)']);
    ok('PET reads as plastic', g['Amber pump bottle 4oz PET'].material === 'Plastic' && g['Amber pump bottle 4oz PET'].kind === 'pump');
    ok('box dimensions read as inches', g['Kraft box small (2x2x4)'].capacity === '2 × 2 × 4 in' && g['Kraft box small (2x2x4)'].color === 'Kraft');
    const l = g['Serum label front 3.5x1.25'];
    ok('a label finds its product and part, and takes no color', l.kind === 'label' && l.forProduct === 'pr1' && l.part === 'Front' && l.color === '', l);
    ok('"1.5x.5" reads as 1.5 × 0.5 in', g['barcode sticker 1.5x.5'].capacity === '1.5 × 0.5 in', g['barcode sticker 1.5x.5']);
    ok('mm sizes read', g['Shrink bands 28mm clear'].capacity === '28 mm' && g['Shrink bands 28mm clear'].kind === 'shrink');
    ok('a mister is a spray bottle', g['4oz clear mister'].kind === 'mist');
    ok('airless wins over pump', g['30ml airless pump clear plastic'].kind === 'airless' && g['30ml airless pump clear plastic'].capacity === '30 ml');
    ok('cobalt reads as blue', g['Cobalt dropper 2oz'].color === 'Blue');
    ok('an unknown thing is Other, named after its old name', g['Tissue paper sheets'].kind === 'other' && g['Tissue paper sheets'].other === 'Tissue paper sheets');

    const disp = await page.evaluate(`[
      Plume.pkDisplay({ kind: 'dropper', capacity: '1 oz', color: 'Blue', material: 'Glass' }),
      Plume.pkDisplay({ kind: 'label', capacity: '3.5 × 1.25 in', forProduct: 'pr1', part: 'Front', color: 'Red' }),
      Plume.pkDisplay({ kind: 'other', other: 'Tissue paper', capacity: '' }),
      Plume.pkDisplay({ name: 'old free text' })
    ]`);
    ok('display: "Dropper bottle · 1 oz · Blue glass"', disp[0] === 'Dropper bottle · 1 oz · Blue glass', disp[0]);
    ok('display: a label names its product (live from Products) and part, never a color',
       disp[1] === 'Product label · 3.5 × 1.25 in · Hydrating facial serum · Front', disp[1]);
    ok('display: Other uses its typed name', disp[2] === 'Tissue paper', disp[2]);
    ok('display: an item without a kind keeps its old name', disp[3] === 'old free text', disp[3]);

    const grp = await page.evaluate(`Plume.pkGroups([
      { id: 'a', kind: 'dropper', capacity: '2 oz', color: 'Amber' },
      { id: 'b', name: 'mystery' },
      { id: 'c', kind: 'label', capacity: '2 in' },
      { id: 'd', kind: 'dropper', capacity: '0.5 oz', color: 'Amber' },
      { id: 'e', kind: 'dropper', capacity: '1 oz', color: 'Blue' },
      { id: 'f', kind: 'dropper', capacity: '1 oz', color: 'Amber' }
    ]).map(function (g) { return g.name + ':' + g.items.map(function (i) { return i.id; }).join(''); })`);
    ok('groups in section order, sizes small to large then color, Needs sorting last',
       JSON.stringify(grp) === '["Dropper bottle:dfea","Product label:c","Needs sorting:b"]', grp);
    const m = await page.evaluate(`(function () { var it = { kind: 'dropper', capacity: '1 oz', color: 'Blue', material: 'Glass', supplier: 'SKS' };
      return [Plume.pkMatches(it, '1oz blue'), Plume.pkMatches(it, 'dropper sks'), Plume.pkMatches(it, 'amber')]; })()`);
    ok('search: every word must match, "1oz" finds "1 oz"', JSON.stringify(m) === '[true,true,false]', m);
    ok('no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  console.log('\n2. Old items, and the Tidy screen');
  {
    const { ctx, page, errors, dialogs } = await open('packaging', base);
    ok('the page is in the shell (sidebar, colour-block head)', await page.evaluate("!!document.getElementById('ps-side') && !!document.querySelector('.ps-page-head h1')"));
    ok('the old dark header is gone', await page.evaluate("!document.querySelector('header.app-header')"));
    ok('old items are listed under Needs sorting', await page.evaluate("document.querySelector('.pk-g .gn').textContent === 'Needs sorting' && document.querySelectorAll('.pk-row').length === 5"));
    ok('with a note pointing at Tidy up names', /saved before kinds/.test(await page.evaluate("document.getElementById('pk-sort-note').innerText")));
    ok('and the Tidy tab shows their count', await page.evaluate("document.getElementById('vt-tidy').style.display !== 'none' && document.getElementById('tidy-n').textContent === '(5)'"));

    await page.evaluate("setPkView('tidy')");
    await page.waitForTimeout(100);
    ok('the Tidy screen has a row per old item', await page.evaluate("document.querySelectorAll('#tidy-body tbody tr').length") === 5);
    // Untick the label row; clear the Other's name to prove Apply refuses it.
    await page.evaluate("tidyRows[3].on = false; tidyRows[4].g.other = ''; renderTidy()");
    await page.evaluate("applyTidy()");
    await page.waitForTimeout(100);
    ok('Apply refuses an Other without a name, and says which', /needs a name: Tissue paper sheets/.test(dialogs.join('|')), dialogs);
    ok('and changed nothing', (await stored(page)).every(i => !i.kind));
    await page.evaluate("tidyRows[4].g.other = 'Tissue paper'; applyTidy()");
    await page.waitForTimeout(100);
    const s = await stored(page);
    const p1 = s.find(i => i.id === 'p1'), p4 = s.find(i => i.id === 'p4'), p5 = s.find(i => i.id === 'p5');
    ok('a ticked row gets its kind, size, color and material', p1.kind === 'dropper' && p1.capacity === '1 oz' && p1.color === 'Amber' && p1.material === 'Glass', p1);
    ok('its name becomes the display string, for readers that only know .name', p1.name === 'Dropper bottle · 1 oz · Amber glass', p1.name);
    ok('its type follows the kind', p1.type === 'container' && p5.type === 'closure', [p1.type, p5.type]);
    ok('purchases and stock are untouched', JSON.stringify(p1.purchases) === JSON.stringify(OLD[0].purchases) && p1.image === PHOTO);
    ok('the unticked row keeps its old name and no kind', !p4.kind && p4.name === 'Serum label front 3.5x1.25', p4);
    ok('Other keeps the name typed for it', p5.kind === 'other' && p5.name === 'Tissue paper', p5);
    ok('it says how many changed', dialogs.some(t => /4 items updated/.test(t)), dialogs);
    ok('the Tidy screen now lists only what is left', await page.evaluate("document.querySelectorAll('#tidy-body tbody tr').length") === 1);

    await page.evaluate("setPkView('list')");
    const groups = await page.evaluate("Array.from(document.querySelectorAll('.pk-g .gn')).map(function(e){return e.textContent})");
    ok('each kind heading carries its drawing, with a gap before the next kind', await page.evaluate("document.querySelectorAll('.pk-g .pk-g-ic svg').length === 3 && document.querySelectorAll('.pk-gap').length === 2"));
    ok('items sit indented under their heading', await page.evaluate("parseFloat(getComputedStyle(document.querySelector('.pk-row td')).paddingLeft) >= 50"));
    ok('the list groups by kind now (an Other groups under its own name)', JSON.stringify(groups) === '["Dropper bottle","Tissue paper","Needs sorting"]', groups);
    const sizes = await page.evaluate("Array.from(document.querySelectorAll('.pk-row .pk-size')).slice(0,3).map(function(e){return e.textContent})");
    ok('sizes small to large inside a kind', JSON.stringify(sizes) === '["0.5 oz","1 oz","1 oz"]', sizes);
    ok('rows with stock keep their tint', await page.evaluate("document.querySelectorAll('.pk-row.has-stock').length") === 5);
    await page.fill('#search', 'blue 1oz');
    ok('search narrows to the one blue 1 oz', await page.evaluate("document.querySelectorAll('.pk-row').length") === 1);
    await page.fill('#search', '');
    await page.evaluate("groupFilter='sort'; renderChips(); renderTable()");
    ok('the Needs sorting chip shows only old items', await page.evaluate("document.querySelectorAll('.pk-row').length") === 1);
    ok('no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  console.log('\n3. The edit panel');
  {
    const { ctx, page, errors, dialogs } = await open('packaging', base);
    await page.evaluate("openAdd()");
    await page.waitForTimeout(400);
    ok('it opens as a panel on the right', await page.evaluate("(function(){var r=document.querySelector('#m-add .modal').getBoundingClientRect();return Math.round(r.right)===innerWidth && r.top===0;})()"));
    ok('with no Name field and no photo upload', await page.evaluate("!document.getElementById('f-name') && !document.querySelector('#m-add input[type=file]')"));
    ok('it starts with "What is it?" and the fields wait for a pick', await page.evaluate("document.querySelectorAll('#e-kinds button').length === 22 && document.getElementById('e-fields').style.display === 'none'"));
    await page.evaluate("saveItem()");
    ok('saving without a kind says to pick one', dialogs.some(t => /Pick what it is/.test(t)), dialogs);
    await page.click('#e-kinds button[data-kind="dropper"]');
    ok('a bottle asks for size, color and material, not a product', await page.evaluate("['row-color','row-material'].every(function(i){return document.getElementById(i).style.display!=='none'}) && document.getElementById('row-for').style.display==='none' && document.getElementById('row-other').style.display==='none'"));
    await page.fill('#f-capacity', '1 oz');
    await page.click('#sugg-color button:has-text("Blue")');
    await page.click('#sugg-material button:has-text("Glass")');
    ok('the color chip fills the field', await page.inputValue('#f-color') === 'Blue');
    ok('the panel shows how it will be named', /Dropper bottle · 1 oz · Blue glass/.test(await page.evaluate("document.getElementById('ed-as').innerText")));
    ok('the drawing takes the color', /#2D4E8C/.test(await page.evaluate("document.getElementById('ed-icon').innerHTML")));
    await page.fill('#f-supplier', 'SKS Bottle');
    await page.evaluate("saveItem()");
    await page.waitForTimeout(100);
    let s = await stored(page);
    const nw = s[s.length - 1];
    ok('saved with its kind fields, display name and type', nw.kind === 'dropper' && nw.color === 'Blue' && nw.material === 'Glass' &&
       nw.name === 'Dropper bottle · 1 oz · Blue glass' && nw.type === 'container' && !('image' in nw), nw);

    await page.evaluate("openAdd()");
    await page.click('#e-kinds button[data-kind="label"]');
    ok('a label asks for a product and part, not a color', await page.evaluate("document.getElementById('row-for').style.display!=='none' && document.getElementById('row-part').style.display!=='none' && document.getElementById('row-color').style.display==='none'"));
    ok('the product list comes from Products & Costing', await page.evaluate("Array.from(document.querySelectorAll('#f-for option')).map(function(o){return o.textContent}).join('|')") === 'Any product|Glow face oil|Hydrating facial serum');
    await page.click('#e-kinds button[data-kind="other"]');
    await page.evaluate("saveItem()");
    ok('Other needs a typed name', dialogs.some(t => /Give it a name/.test(t)), dialogs);
    await page.evaluate("closeModal('m-add')");

    // Opening an old item: Plume's reading, to check and save.
    await page.evaluate("openEdit('p2')");
    await page.waitForTimeout(100);
    ok('an old item opens with what Plume reads from its name', await page.evaluate("document.querySelector('#e-kinds button.on').getAttribute('data-kind')") === 'dropper' && (await page.inputValue('#f-color')) === 'Blue');
    ok('there is no Minimum order qty field', await page.evaluate("!document.getElementById('f-moq')"));
    ok('an old minimum order shows as a line in the notes', (await page.inputValue('#f-notes')) === 'Black bulb\nMinimum order: 24', await page.inputValue('#f-notes'));
    ok('and says what it was called', /1oz blue glass dropper bottle/.test(await page.evaluate("document.getElementById('ed-was').innerText")));
    ok('the duplicate check sees it matches the item just added', /You already have this one/.test(await page.evaluate("document.getElementById('ed-dup').innerText")));
    ok('Used in is empty for it', /Not in any product/.test(await page.evaluate("document.getElementById('e-used').innerText")));
    ok('it offers to remove its photo', /Remove the photo/.test(await page.evaluate("document.getElementById('ed-photo').innerText")));
    await page.click('#ed-photo button');
    await page.fill('#f-capacity', '2 oz');
    ok('changing the size clears the duplicate warning', (await page.evaluate("document.getElementById('ed-dup').innerText")) === '');
    await page.evaluate("saveItem()");
    await page.waitForTimeout(100);
    s = await stored(page);
    const p2 = s.find(i => i.id === 'p2');
    ok('saving it gives it a kind and drops the photo', p2.kind === 'dropper' && p2.capacity === '2 oz' && !p2.image, p2);
    ok('and keeps its purchases', JSON.stringify(p2.purchases) === JSON.stringify(OLD[1].purchases));
    ok('saving moves the minimum order into the notes for good', !('moq' in p2) && p2.notes === 'Black bulb\nMinimum order: 24', p2);

    await page.evaluate("openEdit('p1')");
    await page.waitForTimeout(100);
    const used = await page.evaluate("Array.from(document.querySelectorAll('#e-used .pk-used')).map(function(e){return e.textContent})");
    ok('Used in lists the products whose packaging recipe has it', JSON.stringify(used) === '["Glow face oil","Hydrating facial serum"]', used);
    await page.evaluate("closeModal('m-add'); openEdit(" + JSON.stringify(nw.id) + "); duplicateItem()");
    ok('Duplicate keeps the kind fields and says it is the same item', (await page.inputValue('#f-capacity')) === '1 oz' && /You already have this one/.test(await page.evaluate("document.getElementById('ed-dup').innerText")));
    ok('but not its purchases', await page.evaluate("document.querySelectorAll('#purchase-rows .purchase-row').length") === 0);
    await page.evaluate("closeModal('m-add')");
    ok('no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  console.log('\n4. Removing every photo');
  {
    const { ctx, page, errors } = await open('packaging', base);
    await page.evaluate("openSettings()");
    await page.waitForTimeout(150);
    ok('Settings counts the old photos', /2 old photos/.test(await page.evaluate("document.getElementById('photo-stats').innerText")));
    await page.evaluate("removeAllPhotos()");
    await page.waitForTimeout(150);
    const s = await stored(page);
    ok('Remove every photo clears them all, nothing else', s.every(i => !i.image) && s.length === 5 && s[0].purchases.length === 1);
    ok('and says none are left', /No photos stored/.test(await page.evaluate("document.getElementById('photo-stats').innerText")));
    ok('no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  console.log('\n5. Dark mode leaves the packaging colors alone');
  {
    const tidy = OLD.slice(0, 2).map(i => Object.assign({}, i, { kind: 'dropper', capacity: '1 oz', color: i.id === 'p1' ? 'Amber' : 'Blue', material: 'Glass' }));
    const { ctx, page, errors } = await open('packaging', { 'aerie-packaging-v2': tidy, 'plume-products-v1': PRODUCTS }, 'dark');
    ok('the page is dark', await page.evaluate("document.documentElement.getAttribute('data-theme') === 'dark'"));
    const html = await page.evaluate("document.getElementById('tbody').innerHTML");
    ok('the drawings and swatches keep their literal colors', /#9A5B1E/.test(html) && /#2D4E8C/.test(html) && !/fill="var\(/.test(html));
    ok('the drawing tiles stay light', await page.evaluate("getComputedStyle(document.querySelector('.pk-row .pk-thumb')).backgroundColor") === 'rgb(246, 243, 238)');
    ok('no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  console.log('\n6. The picker in Batches and Products & Costing');
  {
    const tidy = [
      Object.assign({}, OLD[0], { kind: 'dropper', capacity: '1 oz', color: 'Amber', material: 'Glass', name: 'Dropper bottle · 1 oz · Amber glass' }),
      Object.assign({}, OLD[1], { kind: 'dropper', capacity: '1 oz', color: 'Blue', material: 'Glass', name: 'Dropper bottle · 1 oz · Blue glass' }),
      Object.assign({}, OLD[3], { kind: 'label', capacity: '3.5 × 1.25 in', forProduct: 'pr1', part: 'Front', name: 'x' }),
      OLD[4]
    ];
    const batch = { id: 'b1', batchName: 'Serum batch 12', formulaName: 'Hydrating facial serum', date: '2026-10-10', status: 'ready', notes: '',
      ingredientSnapshot: [], packagingRuns: [], committed: true, committedAt: '2026-10-10T00:00:00.000Z', lotDraws: [], packagingDraws: [] };
    const data = { 'aerie-packaging-v2': tidy, 'plume-products-v1': PRODUCTS, 'aerie-batches-v1': [batch] };
    {
      const { ctx, page, errors } = await open('batchlog', data);
      await page.evaluate("openBatchDetail('b1'); pendingRunReset();");
      await page.waitForTimeout(150);
      ok('Batches: the run builder shows the picker, the select hidden behind it',
         await page.evaluate("!!document.querySelector('#d-pkg-builder-comps .pk-pick-btn') && document.querySelector('#d-pkg-builder-comps select').style.display === 'none'"));
      await page.click('#d-pkg-builder-comps .pk-pick-btn');
      await page.waitForTimeout(100);
      const groups = await page.evaluate("Array.from(document.querySelectorAll('.pk-pop-g')).map(function(e){return e.textContent})");
      ok('the list is grouped by kind, old items last', JSON.stringify(groups) === '["Dropper bottle","Product label","Needs sorting"]', groups);
      ok('each line has a drawing and its stock', await page.evaluate("document.querySelectorAll('.pk-pop-i .pk-thumb svg').length === 4 && /24 in stock/.test(document.querySelector('.pk-pop-list').innerText)"));
      await page.keyboard.type('blue');
      await page.waitForTimeout(80);
      ok('typing narrows it', await page.evaluate("document.querySelectorAll('.pk-pop-i').length") === 1);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(80);
      ok('Enter picks it, through the select, so the run records it', (await page.evaluate("pendingRun.components[0].packagingId")) === 'p2');
      ok('the button shows the display name', /Dropper bottle · 1 oz · Blue glass/.test(await page.evaluate("document.querySelector('#d-pkg-builder-comps .pk-pick-btn').innerText")));
      ok('the list has closed', await page.evaluate("!document.querySelector('.pk-pop')"));
      await page.click('#d-pkg-builder-comps .pk-pick-btn');
      await page.waitForTimeout(80);
      await page.keyboard.press('Escape');
      ok('Escape closes it without changing the pick', await page.evaluate("!document.querySelector('.pk-pop') && pendingRun.components[0].packagingId === 'p2'"));
      ok('no page errors', errors.length === 0, errors);
      await ctx.close();
    }
    {
      const { ctx, page, errors } = await open('costing', data);
      await page.evaluate("openProduct('pr2')");
      await page.waitForTimeout(200);
      ok('Costing: the packaging recipe row shows the picker with its item',
         /Dropper bottle · 1 oz · Amber glass/.test(await page.evaluate("document.querySelector('#pkg-recipe-body .pk-pick-btn').innerText")));
      await page.click('#pkg-recipe-body .pk-pick-btn');
      await page.waitForTimeout(80);
      await page.click('.pk-pop-i[data-id="p4"]');
      await page.waitForTimeout(120);
      ok('picking a different item changes the recipe', (await page.evaluate("findProduct('pr2').packagingRecipe[0].packagingId")) === 'p4');
      ok('the cost breakdown uses the display name, with the product read live',
         /Product label · 3\.5 × 1\.25 in · Hydrating facial serum · Front/.test(await page.evaluate("document.body.innerText")));
      ok('no page errors', errors.length === 0, errors);
      await ctx.close();
    }
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
