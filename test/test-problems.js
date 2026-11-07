// Recent problems (2026-11-07, her ask after the app froze once and she
// could not remember what she had been doing): errors, stalls, windows that
// did not close normally, and failed saves, each with the module, what was
// open and the last clicks. Shown in Settings, with Copy for support.
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}
const seed = {
  'aerie-ingredients-v2': JSON.stringify([{ id: 'a', name: 'Olive oil', phase: 'oil', lots: [] }]),
  'aerie-formulations-v1': JSON.stringify([{ id: 'f', name: 'Lip balm', type: 'Lip balm', status: 'draft', lines: [], variants: [{ vid: 'v', num: 1, lines: [], instructions: '', history: [], usageLog: [] }], activeVariantId: 'v' }]),
  'plume-backup-meta': JSON.stringify({ at: new Date().toISOString(), sig: 'x' })
};
const ago = (ms) => new Date(Date.now() - ms).toISOString();

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const open = async (module, extra) => {
    const page = await ctx.newPage();
    await trackDialogs(page, []);
    await page.goto(previewUrl(module));
    await page.evaluate((s) => { localStorage.clear(); Object.keys(s).forEach((k) => localStorage.setItem(k, s[k])); }, Object.assign({}, seed, extra || {}));
    await page.goto(previewUrl(module)); await page.waitForTimeout(400);
    return page;
  };
  const probs = (page) => page.evaluate('Plume.problems.list()');

  console.log('\n1. A window that did not close normally');
  // One heartbeat key per window (plume-alive-<id>): a shared list lost a
  // closing page's removal when the next page started at the same moment.
  {
    const alive = {
      dead: { at: ago(10 * 60000), module: 'Formulations', open: 'Formula: Lip balm', trail: ['4:40 Lip balm', '4:41 Save', '4:41 Batches'], version: '1.73' },
      sleeping: { at: ago(3 * 60000), module: 'Batches', paused: true, trail: [] },
      slept: { at: ago(20 * 60000), module: 'Batches', paused: true, trail: [] },
      busy: { at: ago(20000), module: 'Packaging', trail: [] }
    };
    const extra = {}; Object.keys(alive).forEach((k) => { extra['plume-alive-' + k] = JSON.stringify(alive[k]); });
    const page = await open('batchlog', extra);
    const l = await probs(page);
    const u = l.filter((p) => p.kind === 'unclosed');
    ok('it is noted once, from its last heartbeat', u.length === 1 && u[0].at === alive.dead.at, l);
    ok('with where it was and what was open', u[0] && u[0].module === 'Formulations' && u[0].open === 'Formula: Lip balm');
    ok('and the last clicks before it stopped', u[0] && u[0].trail.join('|') === '4:40 Lip balm|4:41 Save|4:41 Batches');
    const a = await page.evaluate('Plume.problems.alive()');
    ok('its heartbeat is cleared; a sleeping page and a live one are left alone', !a.dead && !!a.sleeping && !!a.busy, Object.keys(a));
    ok('a page asleep over 10 minutes is dropped, not reported', !a.slept && u.length === 1);
    ok('this window keeps its own heartbeat, as Batches', Object.keys(a).filter((k) => ['sleeping', 'busy'].indexOf(k) === -1 && !a[k].paused && a[k].module === 'Batches').length === 1, a);
    ok('heartbeats are device keys: never moved into the database, never in a backup', await page.evaluate("Plume.Store.isDeviceKey('plume-alive-abc') && !Plume.Store.isDataKey('plume-alive-abc') && !('plume-alive-busy' in Plume.backup.data().keys)"));
    await page.close();
  }
  {
    const p1 = await open('formulations');
    const p2 = await ctx.newPage(); await trackDialogs(p2, []);
    await p2.goto(previewUrl('packaging')); await p2.waitForTimeout(400);
    const awake = "(function(){var a=Plume.problems.alive();return Object.keys(a).filter(function(k){return !a[k].paused;}).length;})()";
    const before = await p2.evaluate(awake);
    await p1.close({ runBeforeUnload: true }); await p2.waitForTimeout(300);
    const after = await p2.evaluate(awake);
    ok('a window closed normally takes its heartbeat with it', before === 2 && after === 1, [before, after]);
    await p2.reload(); await p2.waitForTimeout(400);
    ok('so nothing is reported for it', (await probs(p2)).filter((p) => p.kind === 'unclosed').length === 0);
    await p2.close();
  }
  {
    // A window in the background is still open: it keeps beating.
    const front = await open('ingredients');
    const back = await ctx.newPage(); await trackDialogs(back, []);
    await back.goto(previewUrl('batchlog')); await back.waitForTimeout(300);
    await front.bringToFront();
    const id = await back.evaluate("Object.keys(Plume.problems.alive()).filter(function(k){ return Plume.problems.alive()[k].module === 'Batches'; })[0]");
    const t1 = await front.evaluate((k) => Plume.problems.alive()[k].at, id);
    await front.waitForTimeout(5600);
    const t2 = await front.evaluate((k) => Plume.problems.alive()[k].at, id);
    // (Headless pages never report hidden; the code beats whatever the page's
    // visibility, which is what this checks.)
    ok('a window in the background keeps its heartbeat going', !!id && t2 > t1, [t1, t2]);
    await back.close(); await front.close();
  }

  console.log('\n2. Errors, with the last clicks');
  {
    const page = await open('formulations');
    await page.evaluate("openFormula('f')"); await page.waitForTimeout(200);
    await page.evaluate("var b = document.createElement('button'); b.id = 'tb'; b.textContent = 'Mix the oils'; b.style.cssText = 'position:fixed;top:4px;left:300px;z-index:99999'; document.body.appendChild(b)");
    await page.click('#tb');
    await page.evaluate("setTimeout(function () { throw new Error('Something broke'); }, 0)"); await page.waitForTimeout(150);
    let l = await probs(page);
    ok('an error is noted with its message and where', l[0] && l[0].kind === 'error' && l[0].msg === 'Uncaught Error: Something broke' || (l[0] && /Something broke/.test(l[0].msg)), l[0]);
    ok('in which module, with what was open', l[0] && l[0].module === 'Formulations' && /Lip balm/.test(l[0].open), l[0]);
    ok('and the last clicks, with the time', l[0] && l[0].trail.length >= 1 && /^\d{1,2}:\d\d Mix the oils$/.test(l[0].trail[l[0].trail.length - 1]), l[0]);
    for (let i = 0; i < 2; i++) await page.evaluate("setTimeout(function () { throw new Error('Something broke'); }, 0)");
    await page.waitForTimeout(150);
    l = await probs(page);
    ok('the same error again within seconds is counted, not repeated', l.filter((p) => /Something broke/.test(p.msg)).length === 1 && l[0].count === 3, l.map((p) => [p.msg, p.count]));
    await page.evaluate("setTimeout(function () { Promise.reject(new Error('A promise failed')); }, 0)"); await page.waitForTimeout(150);
    ok('a failed promise is noted too', /A promise failed/.test((await probs(page))[0].msg));

    console.log('\n3. Stalls');
    await page.evaluate("(function(){ var t = Date.now(); while (Date.now() - t < 5200) {} })()");
    await page.waitForTimeout(1500);
    const s = (await probs(page)).find((p) => p.kind === 'stall');
    ok('a 5 second freeze that recovers is noted, with how long', s && s.secs >= 5 && s.secs <= 7 && /about \d seconds/.test(s.msg), s);

    console.log('\n4. Saving');
    await page.evaluate("Plume.noteSaveFailed('aerie-formulations-v1')");
    const f = (await probs(page))[0];
    ok('a save that did not go through is noted', f.kind === 'storage' && /Formulations/.test(f.msg), f);

    console.log('\n5. Settings');
    await page.evaluate('closeModal && document.querySelector(".modal-ov.open") ? closeModal(document.querySelector(".modal-ov.open").id) : 0').catch(() => {});
    await page.evaluate('Plume.openSettings()'); await page.waitForTimeout(250);
    const box = await page.evaluate("document.getElementById('plume-prob-box').innerText");
    ok('Settings lists them, newest first, with labels', /Saving/.test(box) && /Stopped responding/.test(box) && /Error/.test(box) && box.indexOf('Saving') < box.indexOf('Stopped responding'), box.slice(0, 300));
    ok('with the last clicks', /Last clicks:/.test(box));
    await page.click('#plume-prob-box button:text-is("Copy for support")'); await page.waitForTimeout(200);
    const clip = await page.evaluate('navigator.clipboard.readText()');
    ok('Copy for support copies a report: version, storage, browser, counts', /^Formula Finch problem report/.test(clip) && /Version: 1\.\d+/.test(clip) && /Storage: localStorage/.test(clip) && /Browser: /.test(clip) && /Formulations 1/.test(clip), clip.slice(0, 400));
    ok('and every problem', /Something broke/.test(clip) && /Stopped responding/.test(clip) && /Last clicks: /.test(clip));
    ok('and says it was copied', /Copied/.test(await page.evaluate("document.getElementById('plume-prob-said').textContent")));
    await page.click('#plume-prob-box button:text-is("Clear")'); await page.waitForTimeout(100);
    ok('Clear empties it', (await probs(page)).length === 0 && /None recorded/.test(await page.evaluate("document.getElementById('plume-prob-box').innerText")));

    console.log('\n6. Kept apart from the data');
    const d = await page.evaluate('Plume.backup.data()');
    ok('never in a backup', !('plume-problems' in d.keys) && !Object.keys(d.keys).some((k) => k.indexOf('plume-alive-') === 0));
    const sig1 = await page.evaluate('Plume.backup.sig()');
    await page.evaluate("Plume.problems.note('error', 'x')"); await page.click('#tb').catch(() => {});
    ok('and the heartbeat and list do not count as changes for the backup reminder', sig1 === (await page.evaluate('Plume.backup.sig()')));
    ok('they stay in this browser\'s small storage, even with the database', await page.evaluate("Plume.Store.isDeviceKey('plume-problems')"));
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
