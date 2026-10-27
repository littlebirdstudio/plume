// One app version, everywhere (decided 2026-10-16).
//
// The footers used to carry hand-typed versions that drifted apart (v0.4,
// v0.5, v0.6 across five pages, one with a "May 2026" date, Formulations
// with no footer at all) while core's own number moved with every update.
// Every footer now shows Plume.VERSION, stamped by core, so they cannot
// disagree with each other or with Settings -> Storage.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { ROOT, TMP, previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const core = fs.readFileSync(path.join(ROOT, 'plume-core.js'), 'utf8');
const VERSION = (core.match(/var VERSION = '([^']+)'/) || [])[1];
const PAGES = ['index.html', 'plume-ingredients.html', 'plume-formulations.html',
               'plume-packaging.html', 'plume-batchlog.html', 'plume-costing.html', 'plume-analytics.html'];

console.log('\n1. No hand-typed versions left');
ok('core declares a version', !!VERSION, VERSION);
PAGES.forEach(p => {
  const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
  const footer = (html.match(/<footer[\s\S]*?<\/footer>/) || [''])[0];
  ok(p + ' has a footer with the version slot', /class="plume-version"/.test(footer), footer.slice(0, 120));
  ok(p + ' types no version of its own', !/\bv\d+\.\d+/.test(footer), footer.slice(0, 120));
});

(async () => {
  const browser = await chromium.launch();

  console.log('\n2. Every page shows the core version');
  for (const mod of ['ingredients', 'formulations', 'packaging', 'batchlog', 'costing']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await trackDialogs(page, []);
    await page.goto(previewUrl(mod));
    await page.waitForTimeout(400);
    const txt = await page.evaluate("Array.from(document.querySelectorAll('.plume-version')).map(function(e){return e.textContent;})");
    ok(mod + ' footer reads v' + VERSION, txt.length === 1 && txt[0] === 'v' + VERSION, txt);
    ok(mod + ' loads without errors', errors.length === 0, errors);
    await page.close();
  }

  // The landing page loads core only to stamp the version; it must not
  // need boot, storage, or anything else from it.
  {
    fs.mkdirSync(TMP, { recursive: true });
    let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    html = html.replace('<script src="plume-core.js"></script>', () => '<script>\n' + core + '\n</script>');
    const out = path.join(TMP, 'preview-index.html');
    fs.writeFileSync(out, html);
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto('file://' + out);
    await page.waitForTimeout(300);
    const txt = await page.evaluate("document.querySelector('.plume-version').textContent");
    ok('landing page footer reads v' + VERSION, txt === 'v' + VERSION, txt);
    ok('landing page loads without errors', errors.length === 0, errors);
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
