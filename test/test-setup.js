// Setup (2026-11-01): the opening questions and what they decide. Her rule:
// the app must work whatever is chosen. A choice only hides; nothing is
// removed or changed, and everything hidden comes back from Settings.
// Checked here for every level, every "what you make" and every start, on
// the start page and on each module a level keeps: no page errors, no link
// or button into a hidden module, the data kept across a change of level,
// the maintenance tools behind their switch, and an existing app (hers)
// left exactly as it was.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ROOT, TMP, previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}

// The start page with core inlined (as test-theme does).
function indexUrl() {
  const core = fs.readFileSync(path.join(ROOT, 'plume-core.js'), 'utf8');
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace('<script src="plume-core.js"></script>', () => '<script>\n' + core + '\n</script>');
  fs.mkdirSync(TMP, { recursive: true });
  const out = path.join(TMP, 'preview-index-setup.html');
  fs.writeFileSync(out, html);
  return 'file://' + out;
}

const ings = [
  { id: 'a', name: 'Water', inci: 'Aqua', phase: 'water', lots: [{ id: 'la', costPerG: '0.01', stockG: '1000' }], activeLotId: 'la' },
  { id: 'g', name: 'Glycerin', inci: 'Glycerin', phase: 'water', lots: [{ id: 'lg', costPerG: '0.50', stockG: '1000' }], activeLotId: 'lg' }
];
const lines = [{ ingId: 'a', pct: '95' }, { ingId: 'g', pct: '5' }];
const forms = [{ id: 'f1', name: 'Mist', type: 'Toner / mist', status: 'approved', lines, batchSize: '100', addinsInTotal: true, notes: '', formNotes: '',
  variants: [{ vid: 'v1', num: 1, label: '', status: 'approved', lines, instructions: '', batchSize: '100', addinsInTotal: true, usageLog: [], history: [] }], activeVariantId: 'v1' }];
const batches = [{ id: 'b1', batchType: 'production', status: 'ready', committed: true, date: '2026-10-01', formulaId: 'f1', formulaName: 'Mist', formulaType: 'Toner / mist',
  batchName: 'Mist, October', actualYield: 300, ingredientSnapshot: [], packagingRuns: [], lotDraws: [], packagingDraws: [] }];
const products = [{ id: 'p1', name: 'Mist 60 mL', status: 'active', formulaId: 'f1', netWtG: 60, packagingRecipe: [],
  productionRuns: [{ id: 'r1', date: '2026-10-02', units: 2, fill: true, batchId: 'b1', draws: [{ batchId: 'b1', grams: 120 }] }] }];

const HIDDEN_LINKS = ['plume-costing.html', 'plume-packaging.html', 'plume-analytics.html'];
// Links and buttons a person can see that lead into a hidden module.
const leaksJs = "(function(){var out=[];Array.prototype.forEach.call(document.querySelectorAll('a[href],button,[onclick]'),function(el){" +
  "if(!el.offsetParent&&getComputedStyle(el).position!=='fixed')return;" +
  "var h=(el.getAttribute('href')||'')+' '+(el.getAttribute('onclick')||'');" +
  "if(/plume-costing\\.html|plume-packaging\\.html|plume-analytics\\.html|Plume\\.stock\\./.test(h))out.push(el.textContent.trim().slice(0,40)||h.slice(0,60));});return out;})()";

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const fresh = async (seed) => {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await trackDialogs(page, []);
    if (seed) {
      await page.goto(previewUrl('formulations'));
      await page.evaluate((s) => { localStorage.clear(); Object.keys(s).forEach(function (k) { localStorage.setItem(k, s[k]); }); }, seed);
    }
    return page;
  };
  const data = (extra) => Object.assign({
    'aerie-ingredients-v2': JSON.stringify(ings), 'aerie-formulations-v1': JSON.stringify(forms),
    'aerie-batches-v1': JSON.stringify(batches), 'plume-products-v1': JSON.stringify(products)
  }, extra || {});

  console.log('\n1. An existing app (hers) is left as it was');
  {
    const page = await fresh(data());
    await page.goto(indexUrl()); await page.waitForTimeout(400);
    ok('no opening questions over existing data', await page.evaluate("!document.getElementById('ffs-ov') || document.getElementById('ffs-ov').hidden"));
    ok('every card shows', await page.evaluate("Array.prototype.filter.call(document.querySelectorAll('.module-card'),function(c){return c.offsetParent;}).length === 5"));
    ok('everything shows and the maintenance tools are on', await page.evaluate("JSON.stringify(Plume.setup()) === JSON.stringify({ make: 'both', level: 'sell', maint: true, done: true })"));
    ok('nothing is written until she changes something', await page.evaluate("localStorage.getItem('plume-setup') === null"));
    await page.goto(previewUrl('ingredients')); await page.waitForTimeout(400);
    await page.evaluate('openSettings()'); await page.waitForTimeout(200);
    ok('her maintenance tools show in Ingredients Settings', await page.evaluate("Array.prototype.filter.call(document.querySelectorAll('.ff-maint-only'),function(e){return e.offsetParent;}).length === 4"));
    await page.close();
  }

  console.log('\n2. The opening questions, for every choice');
  for (const level of ['make', 'sell']) {
    for (const make of ['skincare', 'soap', 'both']) {
      for (const start of ['empty', 'starter']) {
        const tag = level + '/' + make + '/' + start;
        const page = await fresh(null);
        await page.goto(indexUrl()); await page.waitForTimeout(400);
        const shown = await page.evaluate("!!document.getElementById('ffs-ov') && !document.getElementById('ffs-ov').hidden");
        if (!shown) { ok(tag + ': the questions open in an empty app', false); await page.close(); continue; }
        await page.fill('#ffs-biz', 'Test Studio');
        await page.click('#ffs-next');
        await page.click('.ffs-opt[data-v="' + make + '"]'); await page.click('#ffs-next');
        await page.click('.ffs-opt[data-v="' + level + '"]'); await page.click('#ffs-next');
        await page.click('.ffs-opt[data-v="' + start + '"]');
        // The other pages are not beside this preview, so watch where it goes.
        const went = [];
        page.on('request', (r) => { if (r.isNavigationRequest()) went.push(r.url()); });
        await page.click('#ffs-next');
        await page.waitForTimeout(start === 'starter' ? 600 : 200);
        const su = await page.evaluate("JSON.stringify(Plume.setup())").catch(() => null);
        const want = JSON.stringify({ make, level, maint: false, done: true });
        if (start === 'starter') {
          ok(tag + ': goes on to the starter list', went.some((u) => /plume-ingredients\.html$/.test(u)), went);   // a request carries no #fragment
        } else {
          ok(tag + ': choices saved, maintenance off for a new app', su === want, su);
          ok(tag + ': the questions close', await page.evaluate("getComputedStyle(document.getElementById('ffs-ov')).display === 'none'"));
          const cards = await page.evaluate("Array.prototype.filter.call(document.querySelectorAll('.module-card'),function(c){return c.offsetParent;}).map(function(c){return c.querySelector('.card-step').firstChild.nodeValue+':'+c.dataset.step;}).join(',')");
          ok(tag + ': the right cards, numbered in order', cards === (level === 'make' ? '1:ingredients,2:formulations,3:batches' : '1:ingredients,2:packaging,3:formulations,4:batches,5:costing'), cards);
          ok(tag + ': the business name shows', await page.evaluate("document.getElementById('hero-biz-name').textContent === 'Test Studio'"));
          ok(tag + ': no way into a hidden module', JSON.stringify(await page.evaluate(leaksJs)) === '[]' || level === 'sell');
        }
        await page.close();
      }
    }
  }
  {
    const page = await fresh(null);
    await page.goto(indexUrl()); await page.waitForTimeout(400);
    await page.click('.ffs-link');   // Skip, use everything
    ok('Skip uses everything and asks no more', await page.evaluate("Plume.setup().level === 'sell' && Plume.setup().done === true && getComputedStyle(document.getElementById('ffs-ov')).display === 'none'"));
    await page.reload(); await page.waitForTimeout(400);
    ok('and it does not ask again', await page.evaluate("document.getElementById('ffs-ov') === null || document.getElementById('ffs-ov').hidden"));
    await page.close();
  }

  console.log('\n3. Each module a level keeps works, with no way into a hidden one');
  for (const level of ['make', 'sell']) {
    for (const make of ['skincare', 'soap', 'both']) {
      const tag = level + '/' + make;
      const page = await fresh(data({ 'plume-setup': JSON.stringify({ make, level, maint: false, done: true }) }));
      for (const mod of ['ingredients', 'formulations', 'batchlog']) {
        await page.goto(previewUrl(mod)); await page.waitForTimeout(450);
        const side = await page.evaluate("Array.prototype.map.call(document.querySelectorAll('#ps-side .ps-nav-label'),function(s){return s.textContent;}).join(',')");
        const wantSide = level === 'make' ? 'Ingredients,Suppliers,Formulations,Batches,Settings'
          : 'Ingredients,Packaging,Suppliers,Formulations,Batches,Products & Costing,Update stock,Stock history,Analytics,Settings';
        if (mod === 'ingredients') ok(tag + ': the sidebar', side === wantSide, side);
        if (level === 'make') ok(tag + ' ' + mod + ': no way into a hidden module', JSON.stringify(await page.evaluate(leaksJs)) === '[]', await page.evaluate(leaksJs));
        if (mod === 'formulations') {
          await page.evaluate("openFormula('f1')"); await page.waitForTimeout(200);
          ok(tag + ': a formulation opens', await page.evaluate("document.getElementById('f-name').value === 'Mist'"));
          await page.evaluate("newFormula()"); await page.waitForTimeout(150);
          const first = await page.evaluate("Array.prototype.filter.call(document.getElementById('new-type').options,function(o){return o.value && !o.disabled;})[0].value");
          ok(tag + ': product types offered first', first === (make === 'soap' ? 'Cold Process Soap' : 'Facial serum'), first);
        }
        if (mod === 'batchlog') {
          await page.evaluate("openBatchDetail('b1')"); await page.waitForTimeout(250);
          ok(tag + ': a batch opens', await page.evaluate("!!document.getElementById('bt-details') && document.getElementById('bt-details').offsetParent !== null"));
          ok(tag + ': Filled ' + (level === 'make' ? 'hidden' : 'shows'), (await page.evaluate("document.getElementById('bt-runs').offsetParent !== null")) === (level === 'sell'));
          await page.evaluate("setBatchTab('trace')"); await page.waitForTimeout(150);
          const went = await page.evaluate("/Where it went/.test(document.getElementById('bp-trace') ? document.getElementById('bp-trace').innerText : document.body.innerText)");
          ok(tag + ': trace ' + (level === 'make' ? 'without' : 'with') + ' the fills', went === (level === 'sell'));
          if (level === 'make') ok(tag + ' batch detail: no way into a hidden module', JSON.stringify(await page.evaluate(leaksJs)) === '[]', await page.evaluate(leaksJs));
        }
        if (mod === 'ingredients') {
          await page.evaluate("openSeeder()"); await page.waitForTimeout(250);
          const types = await page.evaluate("Array.prototype.map.call(document.getElementById('seeder-type').options,function(o){return o.value;}).filter(Boolean)");
          const sm = types.indexOf('Soap making');
          ok(tag + ': Quick add offers every type, soap making ' + (make === 'soap' ? 'first' : 'last'),
            types.length >= 19 && (make === 'soap' ? sm === 0 : sm === types.length - 1), types);   // last is also its place in the standard order
        }
      }
      await page.close();
    }
  }

  console.log('\n4. Changing the level later keeps everything');
  {
    const page = await fresh(data({ 'plume-setup': JSON.stringify({ make: 'both', level: 'sell', maint: false, done: true }) }));
    await page.goto(previewUrl('costing')); await page.waitForTimeout(450);
    await page.evaluate("openProduct('p1')"); await page.waitForTimeout(250);
    ok('Products & Costing works at the full level', await page.evaluate("!!document.querySelector('#ps-side') && /Mist 60 mL/.test(document.body.innerText)"));
    const opts = await page.evaluate("Array.prototype.map.call(document.querySelectorAll('select[id^=\"run-b\"] option'),function(o){return o.textContent;})");
    ok('a new owner fills from a logged batch only', opts.length > 0 && !opts.some((t) => /Not from a logged batch/.test(t)), opts);
    await page.evaluate('openSettings()'); await page.waitForTimeout(150);
    const went = [];
    page.on('request', (r) => { if (r.isNavigationRequest()) went.push(r.url()); });
    await page.evaluate("Plume.setLevel('make')"); await page.waitForTimeout(500);
    ok('switching down from a hidden page goes to the start page', went.some((u) => /\/index\.html$/.test(u)), went);
    await page.goto(previewUrl('formulations')); await page.waitForTimeout(400);
    // Products & Costing tidies a product's fields when it opens it, so compare what matters.
    const st = await page.evaluate("(function(){var p=JSON.parse(localStorage.getItem('plume-products-v1')),b=JSON.parse(localStorage.getItem('aerie-batches-v1'));return [p.length,p[0].id,p[0].productionRuns.length,b.length,b[0].id];})()");
    ok('the products, their fills and the batches are all still stored', JSON.stringify(st) === '[1,"p1",1,1,"b1"]', st);
    await page.evaluate('openSettings()'); await page.waitForTimeout(150);
    ok('Settings says the products are kept', /your 1 product are kept|your 1 product/.test(await page.evaluate("document.getElementById('plume-theme-choice').innerText")));
    await page.evaluate("Plume.setLevel('sell')"); await page.waitForTimeout(200);
    ok('switching back shows them again', await page.evaluate("/Products & Costing/.test(document.getElementById('ps-side').innerText)"));
    await page.close();
  }

  console.log('\n5. The maintenance tools follow their switch');
  {
    const page = await fresh(data({ 'plume-setup': JSON.stringify({ make: 'both', level: 'sell', maint: false, done: true }) }));
    await page.goto(previewUrl('ingredients')); await page.waitForTimeout(400);
    await page.evaluate('openSettings()'); await page.waitForTimeout(200);
    const vis = "Array.prototype.filter.call(document.querySelectorAll('.ff-maint-only'),function(e){return e.offsetParent;}).length";
    ok('hidden when off', await page.evaluate(vis) === 0);
    await page.evaluate("Plume.setMaint(true)"); await page.waitForTimeout(100);
    ok('shown when on', await page.evaluate(vis) === 4);
    await page.close();
  }

  ok('no page errors anywhere', errors.length === 0, errors.slice(0, 5));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
