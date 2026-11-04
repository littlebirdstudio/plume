// Backups (2026-11-04, her ask on the way to storage safety): one file with
// everything (each module's Export saved only that module, and brands,
// shops and the setup choices were in none of them); Restore shows what is
// in the file, downloads what is here first, then replaces it; a quiet
// reminder in the sidebar when there has never been a full backup, or the
// last is a week old and something changed since; the browser asked to
// keep the data. Also: Settings did nothing on Analytics (her report); it
// now opens the shared settings in the slide-in panel there.
const { chromium } = require('playwright');
const fs = require('fs');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}
const DAY = 86400000;
const ings = [{ id: 'a', name: 'Olive oil', inci: 'Olea Europaea Fruit Oil', phase: 'oil', lots: [] },
              { id: 'b', name: 'Shea butter', inci: 'Butyrospermum Parkii Butter', phase: 'oil', lots: [] }];
const forms = [{ id: 'f', name: 'Lip balm', variants: [], lines: [] }];
const base = {
  'aerie-ingredients-v2': JSON.stringify(ings),
  'aerie-formulations-v1': JSON.stringify(forms),
  'aerie-suppliers-v1': JSON.stringify([{ id: 's', name: 'Lotioncrafter' }]),
  'aerie-brands-v1': JSON.stringify([{ id: 'br', name: 'Plume' }]),
  'plume-business': 'Plume by Little Bird Studio',
  'other-site-key': 'not ours'
};

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (module, seed, extra) => {
    const ctx = await browser.newContext({ acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(module + ': ' + e.message));
    const said = [];
    await trackDialogs(page, said);
    await page.goto(previewUrl(module));
    await page.evaluate((s) => { localStorage.clear(); Object.keys(s).forEach(function (k) { localStorage.setItem(k, s[k]); }); },
      Object.assign({}, seed, extra || {}));
    await page.goto(previewUrl(module)); await page.waitForTimeout(450);
    return { page, ctx, said };
  };
  const nudge = (page) => page.evaluate("(function(){var e=document.getElementById('ps-backup');return e&&!e.hidden?e.innerText.replace(/\\s+/g,' ').trim():'';})()");
  const meta = (at, sig) => ({ 'plume-backup-meta': JSON.stringify({ at: new Date(Date.now() - at * DAY).toISOString(), sig }) });

  console.log('\n1. Settings on Analytics (her report)');
  {
    const { page, ctx } = await open('analytics', base);
    await page.click('.ps-nav[title="Settings"]'); await page.waitForTimeout(300);
    ok('the sidebar\'s Settings opens a panel', await page.evaluate("document.getElementById('ps-peek').classList.contains('open') && document.getElementById('ps-peek-label').textContent === 'Settings'"));
    const txt = await page.evaluate("document.getElementById('ps-peek-body').innerText");
    ok('with the shared settings', /Your business/.test(txt) && /How you use Formula Finch/.test(txt) && /Light or dark/.test(txt), txt.slice(0, 200));
    ok('the palettes, styled', await page.evaluate("document.querySelectorAll('#ps-peek .palette-swatch').length >= 4 && getComputedStyle(document.querySelector('#ps-peek .palette-swatch-grid')).display === 'grid'"));
    ok('and Backups and space used', /Backups/.test(txt) && /Back up everything/.test(txt) && /Space used/.test(txt));
    await ctx.close();
  }
  {
    const { page, ctx } = await open('formulations', base);
    await page.click('.ps-nav[title="Settings"]'); await page.waitForTimeout(300);
    ok('a module with its own Settings dialog still opens it', await page.evaluate("document.getElementById('m-settings').classList.contains('open') && !(document.getElementById('ps-peek') || {classList:{contains:function(){return false;}}}).classList.contains('open')"));
    ok('with Backups in its Storage section', /Back up everything/.test(await page.evaluate("document.getElementById('storage-body').innerText")));
    await ctx.close();
  }

  console.log('\n2. What a full backup holds');
  {
    const { page, ctx } = await open('formulations', base, meta(2, 'x'));
    const d = await page.evaluate('Plume.backup.data()');
    ok('marked as a Formula Finch backup, with version and business', d.kind === 'formula-finch-backup' && d.format === 1 && /^1\.\d+$/.test(d.appVersion) && d.business === 'Plume by Little Bird Studio');
    ok('every Formula Finch key, exactly as stored', d.keys['aerie-ingredients-v2'] === base['aerie-ingredients-v2'] && d.keys['aerie-brands-v1'] === base['aerie-brands-v1'] && d.keys['plume-business'] === base['plume-business']);
    ok('not another site\'s keys', !('other-site-key' in d.keys));
    ok('not the backup record itself', !('plume-backup-meta' in d.keys) && !('plume-backup-snooze' in d.keys));
    await ctx.close();
  }

  console.log('\n3. The reminder');
  {
    let o = await open('formulations', base);
    ok('data and no full backup yet: shown', /Back up now/.test(await nudge(o.page)) && /No full backup yet/.test(await nudge(o.page)), await nudge(o.page));
    await o.ctx.close();
    o = await open('formulations', {});
    ok('an empty app: not shown', (await nudge(o.page)) === '');
    await o.ctx.close();
    o = await open('formulations', base, meta(3, 'x'));
    ok('a backup three days old: not shown, even with changes', (await nudge(o.page)) === '');
    await o.ctx.close();
    o = await open('formulations', base, meta(12, 'changed'));
    ok('twelve days old with changes since: shown, with its age', /Last backup 12 days ago/.test(await nudge(o.page)), await nudge(o.page));
    // Same storage, the fingerprint of what is there now (a fresh seed would
    // run the formulation migration again, which makes new ids).
    await o.page.evaluate("localStorage.setItem('plume-backup-meta', JSON.stringify({ at: new Date(Date.now() - 12 * 86400000).toISOString(), sig: Plume.backup.sig() }))");
    await o.page.reload(); await o.page.waitForTimeout(400);
    ok('twelve days old, nothing changed: not shown', (await nudge(o.page)) === '');
    await o.ctx.close();
    o = await open('formulations', base, meta(12, 'changed'));
    await o.page.click('.ps-bk-later'); await o.page.waitForTimeout(100);
    ok('Later hides it', (await nudge(o.page)) === '');
    await o.page.reload(); await o.page.waitForTimeout(400);
    ok('and it stays hidden after a reload', (await nudge(o.page)) === '');
    const snooze = await o.page.evaluate("localStorage.getItem('plume-backup-snooze')");
    ok('for three days', Math.abs(Date.parse(snooze) - Date.now() - 3 * DAY) < 60000, snooze);
    await o.ctx.close();
    o = await open('formulations', base, Object.assign(meta(12, 'changed'), { 'plume-backup-snooze': new Date(Date.now() - 1000).toISOString() }));
    ok('and comes back once the three days are up', /Back up now/.test(await nudge(o.page)));
    await o.ctx.close();
  }

  console.log('\n4. Back up everything');
  {
    const { page, ctx } = await open('analytics', base, meta(12, 'changed'));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.ps-bk-go')]);
    const name = dl.suggestedFilename();
    ok('downloads one file, named with the date', /^formula-finch-backup-\d{4}-\d{2}-\d{2}\.json$/.test(name), name);
    const file = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    ok('which is a full backup with the ingredients in it', file.kind === 'formula-finch-backup' && JSON.parse(file.keys['aerie-ingredients-v2']).length === 2);
    await page.waitForTimeout(100);
    ok('the reminder goes away', (await nudge(page)) === '');
    const m = await page.evaluate("JSON.parse(localStorage.getItem('plume-backup-meta'))");
    ok('the backup is recorded with today\'s date and the data\'s fingerprint',
       Date.now() - Date.parse(m.at) < 60000 && m.sig === (await page.evaluate('Plume.backup.sig()')), m);
    await page.evaluate('Plume.openSettings()'); await page.waitForTimeout(200);
    ok('Settings says when, and that nothing changed since', /\(today\), nothing changed since/.test(await page.evaluate("document.getElementById('plume-backup-box').innerText")));
    await ctx.close();
  }

  console.log('\n5. Restore');
  {
    const { page, ctx, said } = await open('formulations', base, meta(1, 'x'));
    const backup = await page.evaluate('Plume.backup.data()');
    backup.created = '2026-10-30T12:00:00.000Z';
    backup.keys['aerie-ingredients-v2'] = JSON.stringify([ings[0]]);
    backup.keys['aerie-batches-v1'] = JSON.stringify([{ id: 'b1', batchName: 'Balm, October' }]);
    delete backup.keys['aerie-brands-v1'];
    const fpath = '/tmp/ff-backup-test.json';
    fs.writeFileSync(fpath, JSON.stringify(backup));
    // Preview only: answer No.
    await page.evaluate('window.PLUME_TEST_ANSWER = false');
    await page.evaluate('Plume.backup.pick()');
    await page.setInputFiles('#plume-restore-file', fpath); await page.waitForTimeout(300);
    const prev = said.find((t) => /Restore this backup/.test(t)) || '';
    ok('a preview first: when it was made and for whom', /Backup made Oct 30, 2026 for Plume by Little Bird Studio/.test(prev), prev.slice(0, 200));
    ok('what is in it beside what is here now', /<td>Ingredients<\/td><td>1<\/td><td>2<\/td>/.test(prev) && /<td>Batches<\/td><td>1<\/td><td>0<\/td>/.test(prev) && /<td>Brands<\/td><td>0<\/td><td>1<\/td>/.test(prev), prev);
    ok('fewer than here is marked', /class="fewer"><td>Ingredients/.test(prev));
    ok('saying it replaces everything, and a copy downloads first', /replaces everything here/.test(prev) && /copy of what is here now downloads/.test(prev));
    ok('No changes nothing', (await page.evaluate("JSON.parse(localStorage.getItem('aerie-ingredients-v2')).length")) === 2);
    // Now Yes.
    await page.evaluate('window.PLUME_TEST_ANSWER = true');
    await page.evaluate('Plume.backup.pick()');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.setInputFiles('#plume-restore-file', fpath)]);
    ok('Yes downloads what was here first', /^formula-finch-backup-\d{4}-\d{2}-\d{2}-before-restore\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    const before = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    ok('and that copy holds the data as it was', JSON.parse(before.keys['aerie-ingredients-v2']).length === 2 && !!before.keys['aerie-brands-v1']);
    await page.waitForTimeout(700);
    const after = await page.evaluate("({ ing: JSON.parse(localStorage.getItem('aerie-ingredients-v2')).length, bat: (JSON.parse(localStorage.getItem('aerie-batches-v1')||'[]')).length, brands: localStorage.getItem('aerie-brands-v1'), other: localStorage.getItem('other-site-key'), meta: JSON.parse(localStorage.getItem('plume-backup-meta')) })");
    ok('then the backup replaces what was here', after.ing === 1 && after.bat === 1, after);
    ok('a part not in the backup is removed', after.brands === null, after);
    ok('another site\'s keys are left alone', after.other === 'not ours');
    ok('the last backup is now the restored one', after.meta.at === '2026-10-30T12:00:00.000Z');
    ok('it says so and reloads', said.some((t) => /^Restored/.test(t)));
    await ctx.close();
  }
  {
    const { page, ctx, said } = await open('formulations', base);
    fs.writeFileSync('/tmp/ff-not-full.json', JSON.stringify({ formulations: forms }));
    await page.evaluate('Plume.backup.pick()');
    await page.setInputFiles('#plume-restore-file', '/tmp/ff-not-full.json'); await page.waitForTimeout(300);
    ok('a one-module Export file is turned away, pointing to that module\'s Import', said.some((t) => /Not a full backup/.test(t) && /Import/.test(t)), said);
    // A full backup through a module's Import goes to Restore.
    said.length = 0;
    await page.evaluate('window.PLUME_TEST_ANSWER = false');
    await page.setInputFiles('#import-file-input', '/tmp/ff-backup-test.json'); await page.waitForTimeout(300);
    ok('a full backup opened with a module\'s Import goes to the restore preview', said.some((t) => /Restore this backup/.test(t)), said.map((t) => t.slice(0, 60)));
    ok('and is not merged into that module', (await page.evaluate("JSON.parse(localStorage.getItem('aerie-formulations-v1')).length")) === 1);
    await ctx.close();
  }

  console.log('\n6. Other windows');
  {
    const { page, ctx } = await open('formulations', base, meta(1, 'x'));
    const other = await ctx.newPage();
    await other.goto(previewUrl('analytics')); await other.waitForTimeout(400);
    await other.evaluate('window.__still = 1');
    await page.evaluate("localStorage.setItem('plume-restored', String(Date.now()))");
    await other.waitForTimeout(800);
    ok('a restore in one window reloads the others', await other.evaluate('typeof window.__still === "undefined"'));
    await ctx.close();
  }

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
