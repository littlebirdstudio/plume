// Storage safety, step 2 (2026-11-05): Formula Finch's data moves from
// localStorage (about 5MB, fixed) to the browser's database, IndexedDB (a
// share of the disk). The move is copy, read back, compare, and only then
// remove the old copy; anything that does not check out leaves localStorage
// as it was. Display choices some code reads straight from localStorage stay
// there. Other windows hear each saved write. A browser that cleared the
// moved data is reported, with Restore.
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}
const ings = [{ id: 'a', name: 'Olive oil', inci: 'Olea Europaea Fruit Oil', phase: 'oil', lots: [] },
              { id: 'b', name: 'Shea butter', inci: 'Butyrospermum Parkii Butter', phase: 'oil', lots: [] }];
const seed = {
  'aerie-ingredients-v2': JSON.stringify(ings),
  'aerie-suppliers-v1': JSON.stringify([{ id: 's', name: 'Lotioncrafter' }]),
  'plume-business': 'Plume by Little Bird Studio',
  'plume-theme': 'dark',
  'other-site-key': 'not ours'
};
const U = (m) => previewUrl(m, { store: 'idb' });
// What the database holds, read straight from IndexedDB.
const idbAll = (page) => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('formula-finch', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => {
    const out = {}, tx = r.result.transaction('kv', 'readonly'), c = tx.objectStore('kv').openCursor();
    c.onsuccess = () => { const x = c.result; if (x) { out[x.key] = x.value; x.continue(); } };
    tx.oncomplete = () => { r.result.close(); res(out); };
  };
  r.onerror = () => res(null);
}));
const lsAll = (page) => page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const fresh = async (initScript) => {
    const ctx = await browser.newContext({ acceptDownloads: true });
    if (initScript) await ctx.addInitScript(initScript);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    const said = [];
    await trackDialogs(page, said);
    // Seed localStorage as the app had it before the move.
    await page.goto(previewUrl('ingredients'));
    await page.evaluate((s) => { localStorage.clear(); Object.keys(s).forEach((k) => localStorage.setItem(k, s[k])); }, seed);
    return { ctx, page, said };
  };

  console.log('\n1. The move');
  {
    const { ctx, page } = await fresh();
    await page.goto(U('ingredients')); await page.waitForTimeout(600);
    ok('the page now keeps its data in the browser\'s database', (await page.evaluate('Plume.Store.driverName()')) === 'IndexedDB');
    ok('it says it moved just now, every data key', await page.evaluate("Plume.Store.moveState().state === 'moved-now' && Plume.Store.moveState().keys === 3"), await page.evaluate('Plume.Store.moveState()'));
    ok('the ingredients show', (await page.evaluate("document.querySelectorAll('#ing-tbody tr[data-id], #ing-tbody tr.ing-row').length")) >= 2 ||
       /Shea butter/.test(await page.evaluate('document.body.innerText')));
    const db = await idbAll(page), ls = await lsAll(page);
    ok('the database holds the data, exactly', db['aerie-ingredients-v2'] === seed['aerie-ingredients-v2'] && db['plume-business'] === seed['plume-business'] && db['aerie-suppliers-v1'] === seed['aerie-suppliers-v1']);
    ok('and not the display choices or other sites\' keys', !('plume-theme' in db) && !('other-site-key' in db), Object.keys(db));
    ok('the old copy is removed only after the check', !('aerie-ingredients-v2' in ls) && !('plume-business' in ls), Object.keys(ls));
    ok('display choices and other sites\' keys stay in localStorage', ls['plume-theme'] === 'dark' && ls['other-site-key'] === 'not ours');
    const mk = JSON.parse(ls['plume-storage-moved'] || 'null');
    ok('a marker says when it moved', mk && mk.keys === 3 && Date.now() - Date.parse(mk.at) < 60000, mk);
    ok('Store still sees every key, the display choices too', await page.evaluate("Plume.Store.get('plume-theme') === 'dark' && JSON.parse(Plume.Store.get('aerie-ingredients-v2')).length === 2"));

    console.log('\n2. After the move');
    await page.reload(); await page.waitForTimeout(500);
    ok('a reload reads from the database', await page.evaluate("Plume.Store.moveState().state === 'in-idb' && JSON.parse(Plume.Store.get('aerie-ingredients-v2')).length === 2"));
    await page.evaluate("var l = JSON.parse(Plume.Store.get('aerie-ingredients-v2')); l.push({ id: 'c', name: 'Beeswax', phase: 'oil', lots: [] }); Plume.Store.setJSON('aerie-ingredients-v2', l)");
    await page.evaluate('new Promise(function (r) { Plume.Store.whenSaved(r); })');
    ok('a save goes to the database', JSON.parse((await idbAll(page))['aerie-ingredients-v2']).length === 3);
    ok('and never to localStorage', !('aerie-ingredients-v2' in (await lsAll(page))));
    await page.reload(); await page.waitForTimeout(500);
    ok('it is there after a reload', await page.evaluate("JSON.parse(Plume.Store.get('aerie-ingredients-v2')).length === 3"));
    await page.evaluate("Plume.Store.set('plume-theme', 'light')");
    ok('a display choice still saves to localStorage', (await page.evaluate("localStorage.getItem('plume-theme')")) === 'light');

    console.log('\n3. Settings');
    await page.evaluate('Plume.openSettings()'); await page.waitForTimeout(500);
    const where = await page.evaluate("document.getElementById('stor-where').textContent");
    ok('says where it is kept', /database \(IndexedDB\)/.test(where), where);
    const used = await page.evaluate("document.getElementById('storage-body').innerText");
    ok('and the room this browser allows, not 5 MB', /this browser allows/.test(used) && !/of about 5 MB/.test(used), used.slice(0, 300));

    console.log('\n4. Other windows');
    const other = await ctx.newPage();
    other.on('pageerror', (e) => errors.push(e.message));
    await other.goto(U('formulations')); await other.waitForTimeout(500);
    // Both pages hold the ingredient list; each changes a different record.
    await page.evaluate("window.L = JSON.parse(Plume.Store.get('aerie-ingredients-v2')); Plume.trackList('aerie-ingredients-v2', L)");
    await other.evaluate("window.L = JSON.parse(Plume.Store.get('aerie-ingredients-v2')); Plume.trackList('aerie-ingredients-v2', L)");
    await page.evaluate("L[0].name = 'Olive oil, extra virgin'; Plume.saveList('aerie-ingredients-v2', L)");
    await page.evaluate('new Promise(function (r) { Plume.Store.whenSaved(r); })');
    await other.waitForTimeout(300);
    ok('the other window heard the write', /extra virgin/.test(await other.evaluate("Plume.Store.refresh('aerie-ingredients-v2'), Plume.Store.get('aerie-ingredients-v2')")));
    await other.evaluate("L[1].name = 'Shea butter, unrefined'; Plume.saveList('aerie-ingredients-v2', L)");
    await other.evaluate('new Promise(function (r) { Plume.Store.whenSaved(r); })');
    const names = JSON.parse((await idbAll(page))['aerie-ingredients-v2']).map((i) => i.name);
    ok('so its save keeps the first window\'s change', names.indexOf('Olive oil, extra virgin') !== -1 && names.indexOf('Shea butter, unrefined') !== -1, names);
    await other.close();

    console.log('\n5. A stray from an old page');
    await page.evaluate("localStorage.setItem('aerie-formulations-v1', JSON.stringify([{ id: 'f', name: 'Lip balm', variants: [], lines: [] }]))");
    await page.reload(); await page.waitForTimeout(500);
    ok('is taken into the database, which keeps the rest', await page.evaluate("Plume.Store.moveState().state === 'stray' && JSON.parse(Plume.Store.get('aerie-formulations-v1')).length === 1 && JSON.parse(Plume.Store.get('aerie-ingredients-v2')).length === 3"));
    ok('and removed from localStorage', !('aerie-formulations-v1' in (await lsAll(page))) && 'aerie-formulations-v1' in (await idbAll(page)));

    console.log('\n6. Restore, in the database');
    const backup = await page.evaluate('Plume.backup.data()');
    backup.keys['aerie-ingredients-v2'] = JSON.stringify([ings[0]]);
    delete backup.keys['aerie-formulations-v1'];
    await page.evaluate('window.PLUME_TEST_ANSWER = true');
    await Promise.all([page.waitForEvent('download'), page.evaluate((d) => Plume.backup.preview(d), backup)]);
    await page.waitForTimeout(1200);
    const db2 = await idbAll(page);
    ok('the backup is what the database holds once it reloads', JSON.parse(db2['aerie-ingredients-v2']).length === 1 && !('aerie-formulations-v1' in db2), Object.keys(db2));
    ok('and the page shows it', await page.evaluate("JSON.parse(Plume.Store.get('aerie-ingredients-v2')).length === 1"));
    await ctx.close();
  }

  console.log('\n7. The browser cleared the database');
  {
    const { ctx, page } = await fresh();
    await page.goto(U('ingredients')); await page.waitForTimeout(500);
    await page.evaluate(() => new Promise((r) => { const d = indexedDB.deleteDatabase('formula-finch'); d.onsuccess = d.onerror = d.onblocked = () => r(); }));
    await page.goto(U('packaging')); await page.waitForTimeout(500);
    ok('it is noticed, not shown as an empty app', await page.evaluate("Plume.Store.moveState().state === 'lost'"));
    const b = await page.evaluate("(document.querySelector('.stor-banner.crit') || {}).innerText || ''");
    ok('a red banner says so, with Restore', /data in this browser is gone/.test(b) && /Restore from a backup/.test(b), b);
    await ctx.close();
  }

  console.log('\n8. When the database cannot be used');
  {
    const { ctx, page } = await fresh("try { Object.defineProperty(window, 'indexedDB', { value: { open: function () { throw new Error('no'); } } }); } catch (e) {}");
    await page.goto(U('ingredients')); await page.waitForTimeout(500);
    ok('it carries on with localStorage', await page.evaluate("Plume.Store.driverName() === 'localStorage' && Plume.Store.moveState().state === 'fallback'"));
    ok('with every key where it was', JSON.stringify(await lsAll(page)) === JSON.stringify(Object.assign({}, seed)) || ('aerie-ingredients-v2' in (await lsAll(page)) && !('plume-storage-moved' in (await lsAll(page)))));
    await page.evaluate('Plume.openSettings()'); await page.waitForTimeout(300);
    ok('and Settings says why', /could not be used here, so nothing was moved/.test(await page.evaluate("document.getElementById('stor-where').textContent")));
    await ctx.close();
  }
  {
    // The copy into the database fails part way: nothing is removed.
    const { ctx, page } = await fresh("(function(){ var put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (v, k) { if (k === 'aerie-suppliers-v1' && !window.__letIn) throw new DOMException('full', 'QuotaExceededError'); return put.apply(this, arguments); }; })();");
    await page.goto(U('ingredients')); await page.waitForTimeout(600);
    ok('a copy that fails leaves localStorage as it was', await page.evaluate("Plume.Store.driverName() === 'localStorage' && Plume.Store.moveState().state === 'fallback'") &&
       'aerie-ingredients-v2' in (await lsAll(page)) && !('plume-storage-moved' in (await lsAll(page))), await page.evaluate('Plume.Store.moveState()'));
    ok('and the app still shows the data', await page.evaluate("JSON.parse(Plume.Store.get('aerie-ingredients-v2')).length === 2"));
    await ctx.close();
  }

  console.log('\n9. A write that fails later');
  {
    const { ctx, page } = await fresh("(function(){ var put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (v, k) { if (window.__full) throw new DOMException('full', 'QuotaExceededError'); return put.apply(this, arguments); }; })();");
    await page.goto(U('ingredients')); await page.waitForTimeout(500);
    await page.evaluate("window.__full = true; Plume.Store.set('aerie-brands-v1', '[]')");
    await page.evaluate('new Promise(function (r) { Plume.Store.whenSaved(r); })');
    await page.waitForTimeout(200);
    const b = await page.evaluate("(document.querySelector('.stor-banner.crit') || {}).innerText || ''");
    ok('shows the storage-full banner', /Storage is full/.test(b), b);
    await ctx.close();
  }

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
