// Installable app and offline copy (2026-10-17): manifest.webmanifest, sw.js
// and the app pieces in plume-core.js (isInstalled, openPage, install,
// resetAppCache, links that stay in the window when installed).
//
// Part 1 is static: the manifest, the icons, the tags on every page, and the
// service worker's file list (every local file a page loads must be in
// APP_FILES, or it would be missing offline).
// Parts 2 onward serve the real repo over http://localhost from a small Node
// server (a service worker cannot register on file://), then stop the server
// to prove the app opens offline from its saved copy.
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { chromium } = require('playwright');
const { ROOT, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const PAGES = ['index.html', 'plume-ingredients.html', 'plume-formulations.html',
  'plume-packaging.html', 'plume-batchlog.html', 'plume-costing.html', 'plume-analytics.html'];

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 1, 4) !== 'PNG') return null;
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

// APP_FILES, read by running sw.js with stand-ins for the worker globals.
function appFiles() {
  const box = { self: { addEventListener() {} }, caches: {}, fetch() {}, URL };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8') + '\n;this.__files = APP_FILES;', box);
  return box.__files;
}

console.log('\n1. Manifest, icons, page tags, saved-file list');
{
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  ok('manifest has a name, short name and start page',
     !!m.name && m.short_name === 'Plume' && m.start_url === './index.html', m);
  ok('opens as its own window (standalone)', m.display === 'standalone');
  ok('scope is the app folder, so every module is inside the app', m.scope === './');
  const want = { '192x192|any': 192, '512x512|any': 512, '512x512|maskable': 512 };
  Object.keys(want).forEach(k => {
    const [sizes, purpose] = k.split('|');
    const icon = (m.icons || []).find(i => i.sizes === sizes && i.purpose === purpose);
    const file = icon && path.join(ROOT, icon.src);
    const px = file && fs.existsSync(file) ? pngSize(file) : null;
    ok('icon ' + sizes + ' (' + purpose + ') exists at that size',
       px && px[0] === want[k] && px[1] === want[k], px);
  });
  [['icons/favicon-32.png', 32], ['icons/apple-touch-icon.png', 180]].forEach(([f, n]) => {
    const px = fs.existsSync(path.join(ROOT, f)) ? pngSize(path.join(ROOT, f)) : null;
    ok(f + ' is ' + n + 'px', px && px[0] === n && px[1] === n, px);
  });

  const files = appFiles();
  const missingOnDisk = files.filter(f => f !== './' && !fs.existsSync(path.join(ROOT, f)));
  ok('every file in APP_FILES exists', missingOnDisk.length === 0, missingOnDisk);
  ok('every page is in APP_FILES', PAGES.every(p => files.indexOf(p) !== -1),
     PAGES.filter(p => files.indexOf(p) === -1));

  const notSaved = [];
  PAGES.forEach(p => {
    const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    ok(p + ' links the manifest, theme colour and icons',
       /rel="manifest" href="manifest\.webmanifest"/.test(head) && /name="theme-color"/.test(head) &&
       /rel="icon"/.test(head) && /rel="apple-touch-icon"/.test(head));
    const re = /<(?:script|img|link)\b[^>]*?\s(?:src|href)="([^"]+)"/g;
    let mm;
    while ((mm = re.exec(html))) {
      const u = mm[1];
      if (/^(https?:|data:|blob:|#|mailto:)/.test(u) || /['+]/.test(u)) continue;
      const clean = u.split('#')[0].split('?')[0];
      if (clean && files.indexOf(clean) === -1) notSaved.push(p + ' -> ' + clean);
    }
  });
  ok('every local file a page loads is in APP_FILES (else it is missing offline)',
     notSaved.length === 0, notSaved);
}

// ── A tiny static server for the repo, with a switch to change or slow a file ──
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const override = {};   // path -> { body?, delay? }
const sockets = new Set();
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const o = override[p] || {};
  const send = () => {
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream',
                         'Cache-Control': 'no-cache' });
    res.end(o.body !== undefined ? o.body : fs.readFileSync(file));
  };
  if (o.delay) setTimeout(send, o.delay); else send();
});
server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
const listen = port => new Promise(r => server.listen(port || 0, '127.0.0.1', () => r(server.address().port)));
const stop = () => new Promise(r => { server.close(() => r()); sockets.forEach(s => s.destroy()); });

(async () => {
  const port = await listen();
  const BASE = 'http://127.0.0.1:' + port + '/';
  const browser = await chromium.launch();
  // Google Fonts are not part of what is being tested; keep them off the wire.
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const errors = [];
  const newPage = async () => {
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    await trackDialogs(page, []);
    return page;
  };
  const footer = page => page.evaluate("(document.querySelector('.plume-version') || {}).textContent || ''");

  console.log('\n2. Online: the service worker saves the app');
  const page = await newPage();
  await page.goto(BASE + 'index.html');
  await page.evaluate("localStorage.setItem('pwa-test-data', 'keep me')");
  const ready = await page.evaluate(`navigator.serviceWorker.ready.then(function () { return true; })`);
  ok('a service worker registers and activates', ready === true);
  const saved = await page.evaluate(`caches.open('plume-app-v1').then(function (c) { return c.keys(); })
    .then(function (ks) { return ks.map(function (r) { return new URL(r.url).pathname.slice(1) || './'; }); })`);
  const files = appFiles();
  const notCached = files.filter(f => saved.indexOf(f === './' ? './' : f) === -1);
  ok('every app file is in the saved copy', notCached.length === 0, notCached);
  ok('the landing page footer shows the version', /^v\d/.test(await footer(page)), await footer(page));
  const realVersion = await footer(page);

  console.log('\n3. Network first: a change on the site shows on the next load');
  {
    const core = fs.readFileSync(path.join(ROOT, 'plume-core.js'), 'utf8');
    override['/plume-core.js'] = { body: core.replace(/var VERSION = '[^']+';/, "var VERSION = '9.99';") };
    await page.reload();
    await page.waitForTimeout(300);
    ok('the new version shows right away, not one load late', /9\.99/.test(await footer(page)), await footer(page));
    delete override['/plume-core.js'];
    await page.reload();
    await page.waitForTimeout(300);
    ok('and back again', (await footer(page)) === realVersion, await footer(page));
  }

  console.log('\n4. A slow network falls back to the saved copy');
  {
    override['/plume-core.js'] = { delay: 7000 };
    const t0 = Date.now();
    await page.reload();
    await page.waitForFunction("typeof Plume !== 'undefined'", null, { timeout: 6500 });
    const took = Date.now() - t0;
    ok('the page opens from the saved copy after about 4 seconds', took < 6500, took);
    ok('with the app working', (await footer(page)) === realVersion, await footer(page));
    delete override['/plume-core.js'];
    await page.waitForTimeout(3200);   // let the slow request finish before moving on
  }

  console.log('\n5. Installed app: module links stay in the window');
  {
    await page.goto(BASE + 'plume-packaging.html');
    await page.waitForTimeout(400);
    let popups = 0;
    const onPage = () => { popups++; };
    context.on('page', onPage);
    await page.click('a[href="plume-ingredients.html"]');
    await page.waitForTimeout(600);
    ok('in a browser tab, a module link still opens its own tab', popups === 1, popups);
    context.pages().filter(p => p !== page).forEach(p => p.close());

    const app = await newPage();
    await app.addInitScript(() => { window.PLUME_TEST_STANDALONE = true; });
    await app.goto(BASE + 'plume-packaging.html');
    await app.waitForTimeout(400);
    ok('Plume.isInstalled() reads the installed mode', await app.evaluate('Plume.isInstalled()'));
    popups = 0;
    await app.click('a[href="plume-ingredients.html"]');
    await app.waitForURL(/plume-ingredients\.html$/, { timeout: 5000 }).catch(() => {});
    ok('as an app, the same link opens in the same window', /plume-ingredients\.html$/.test(app.url()) && popups === 0,
       [app.url(), popups]);
    await app.evaluate("Plume.openPage('plume-batchlog.html#new=x')");
    await app.waitForURL(/plume-batchlog\.html/, { timeout: 5000 }).catch(() => {});
    ok('Plume.openPage stays in the window as an app', /plume-batchlog\.html#new=x$/.test(app.url()) && popups === 0,
       [app.url(), popups]);
    context.off('page', onPage);
    await app.close();
  }

  console.log('\n6. Settings shows the app status');
  {
    await page.goto(BASE + 'plume-packaging.html');
    await page.waitForTimeout(400);
    await page.evaluate('openSettings()');
    await page.waitForTimeout(400);
    const t = await page.evaluate("(document.getElementById('plume-app-status') || {}).innerText || ''");
    ok('it says how Plume is running and that the offline copy is ready',
       /browser tab/.test(t) && /Offline copy: ready/.test(t) && /Clear the saved app copy/.test(t), t);
  }

  console.log('\n7. Offline: the server stops and Plume still opens');
  {
    await stop();
    for (const p of PAGES) {
      const before = errors.length;
      const pg = await newPage();
      let loaded = true;
      try { await pg.goto(BASE + p, { timeout: 8000 }); } catch (e) { loaded = false; }
      await pg.waitForTimeout(300);
      const plume = loaded && await pg.evaluate("typeof Plume !== 'undefined'");
      ok(p + ' opens offline with the app working', loaded && plume && errors.length === before,
         [loaded, plume, errors.slice(before)]);
      await pg.close();
    }
    const pg = await newPage();
    await pg.goto(BASE + 'plume-packaging.html?from=somewhere');
    ok('a page with a query string still finds its saved copy',
       await pg.evaluate("typeof Plume !== 'undefined'"));
    await pg.close();
  }

  console.log('\n8. Clearing the saved app copy leaves her data alone');
  {
    await listen(port);   // back online on the same address, so the reload works
    await page.goto(BASE + 'plume-packaging.html');
    await page.waitForTimeout(400);
    await page.evaluate("caches.open('plume-junk').then(function (c) { return c.put('/junk', new Response('x')); })");
    await page.evaluate("caches.open('someone-else').then(function (c) { return c.put('/other', new Response('x')); })");
    const nav = page.waitForNavigation({ timeout: 8000 }).catch(() => null);
    await page.evaluate('Plume.resetAppCache()');
    await nav;
    await page.waitForTimeout(400);
    const keys = await page.evaluate('caches.keys()');
    ok('the saved Plume copies are gone', keys.indexOf('plume-junk') === -1, keys);
    ok('caches that are not Plume\'s are left alone', keys.indexOf('someone-else') !== -1, keys);
    ok('her data is untouched', (await page.evaluate("localStorage.getItem('pwa-test-data')")) === 'keep me');
    ok('and the page reloaded working', await page.evaluate("typeof Plume !== 'undefined'"));
  }

  ok('no page errors anywhere', errors.length === 0, errors);
  await browser.close();
  await stop();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
