// Formula Finch (2026-11-01): the app's own name and finch mark everywhere,
// the owner's business name (Settings, Your business) under it, and no
// old "Plume by Little Bird Studio" text left on any page.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { ROOT, previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}

console.log('\n1. No old name in what anyone sees');
const pages = ['index.html', 'plume-ingredients.html', 'plume-formulations.html', 'plume-packaging.html',
  'plume-batchlog.html', 'plume-costing.html', 'plume-analytics.html'];
pages.forEach(function (f) {
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const title = (/<title>([^<]*)<\/title>/.exec(s) || [])[1] || '';
  ok(f + ': title says Formula Finch', /Formula Finch/.test(title), title);
  ok(f + ': no "Little Bird Studio" or "Plume by"', !/Little Bird Studio|Plume by/.test(s));
});
const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
ok('install name is Formula Finch', man.name === 'Formula Finch' && man.short_name === 'Formula Finch');
ok('the finch mark is in the offline copy', /'formula-finch-mark\.svg'/.test(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8')));
ok('the landing page shows the botanical artwork', /<img src="formula-finch-botanical\.svg"[^>]*class="hero-mark"/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')));
ok('the old logo file is gone', !fs.existsSync(path.join(ROOT, 'plume-logo.svg')));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await trackDialogs(page, []);
  // No clearing script: a new page starts with empty storage, and a script
  // that cleared "once" sometimes ran again on reload before the browser had
  // read its flag back, wiping the data (the flaky "it is kept", 2026-11-01).
  await page.goto(previewUrl('formulations'));
  await page.waitForTimeout(400);

  console.log('\n2. Sidebar');
  ok('the name is Formula Finch', await page.evaluate("document.querySelector('.ps-ws-name').textContent === 'Formula Finch'"));
  ok('the mark is the finch', await page.evaluate("/formula-finch-mark\\.svg$/.test(document.querySelector('.ps-ws-mark img').getAttribute('src'))"));
  ok('with no business set, no line under it', await page.evaluate("document.querySelector('.ps-ws-sub').hidden === true"));

  console.log('\n3. Your business');
  await page.evaluate('openSettings()');
  await page.waitForTimeout(200);
  ok('Settings has the field, empty', await page.evaluate("document.getElementById('plume-business').value === ''"));
  await page.fill('#plume-business', '  Little   Bird Studio ');
  await page.press('#plume-business', 'Enter');
  await page.waitForTimeout(100);
  ok('Enter saves it, tidied', await page.evaluate("Plume.businessName() === 'Little Bird Studio'"));
  ok('the sidebar shows it at once', await page.evaluate("var s=document.querySelector('.ps-ws-sub');!s.hidden && s.textContent === 'Little Bird Studio'"));
  await page.reload();
  // Wait for the sidebar to be drawn after boot, not a fixed time (flaky in a full run).
  const kept = await page.waitForFunction("(function(){var s=document.querySelector('.ps-ws-sub');return s && s.textContent === 'Little Bird Studio';})()", null, { timeout: 5000 }).then(() => true, () => false);
  ok('it is kept', kept);
  await page.evaluate('openSettings()'); await page.waitForTimeout(200);
  await page.fill('#plume-business', '');
  await page.evaluate("document.getElementById('plume-business').blur()");
  ok('clearing it removes the line', await page.evaluate("Plume.businessName() === '' && document.querySelector('.ps-ws-sub').hidden === true"));
  ok('a name with markup is shown as text', await page.evaluate("Plume.setBusinessName('<b>x</b>'); document.querySelector('.ps-ws-sub').innerHTML === '&lt;b&gt;x&lt;/b&gt;'"));

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
