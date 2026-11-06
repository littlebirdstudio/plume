// Dates are the local calendar day (2026-11-05). The same bug came back
// three times: todayISO built from toISOString() (a run logged after 3 pm in
// Alaska was stamped tomorrow), fmtDate reading 'YYYY-MM-DD' as UTC (shown a
// day early), and backup dates sliced from a UTC timestamp. Every suite runs
// on a UTC machine at whatever hour CI starts, so none of them could see it.
// This one runs in Alaska at 5:30 in the evening, when UTC is already
// tomorrow, and scans the source for the pattern that caused it.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { ROOT, previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

console.log('\n1. The source');
{
  const files = ['plume-core.js', 'index.html'].concat(fs.readdirSync(ROOT).filter((f) => /^plume-.*\.html$/.test(f)));
  const bad = [];
  // A saved moment sliced to a day, or a UTC timestamp cut to a day.
  const MOMENT = /\b(createdAt|updatedAt|imported|committedAt|addedAt|resurrectedAt|created|madeAt|savedAt|at|movedAt)\b[^;\n]{0,24}\.(slice|substr|substring)\(0,\s*10\)/;
  const ISO_DAY = /toISOString\(\)\s*\.\s*(slice|substr|substring|split)\(/;
  files.forEach((f) => {
    fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return;
      if (MOMENT.test(line) || ISO_DAY.test(line)) bad.push(f + ':' + (i + 1) + '  ' + line.trim().slice(0, 120));
    });
  });
  ok('no saved moment is cut to a day by slicing (use localDay)', bad.length === 0, bad);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  // 5:30 pm on Nov 5 in Anchorage is 02:30 on Nov 6 in UTC.
  const EVENING = new Date('2026-11-06T02:30:00Z');
  const ctx = await browser.newContext({ timezoneId: 'America/Anchorage', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install({ time: EVENING });
  await trackDialogs(page, []);
  await page.goto(previewUrl('batchlog'));
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('aerie-ingredients-v2', '[{"id":"a","name":"Olive oil","lots":[]}]'); });
  await page.goto(previewUrl('batchlog')); await page.waitForTimeout(300);

  console.log('\n2. In Alaska at 5:30 pm (UTC is already tomorrow)');
  ok('the clock is set where it should be', (await page.evaluate('new Date().toISOString()')) .startsWith('2026-11-06T02:3'));
  ok('today is the 5th', (await page.evaluate('Plume.todayISO()')) === '2026-11-05');
  ok('a moment saved now is the 5th', (await page.evaluate('Plume.localDay(new Date().toISOString())')) === '2026-11-05');
  ok('and one saved at 11 pm the night before is the 4th', (await page.evaluate("Plume.localDay('2026-11-05T08:00:00Z')")) === '2026-11-04');
  ok('a day string shows as that day', /Nov 5, 2026/.test(await page.evaluate("Plume.fmtDate('2026-11-05')")), await page.evaluate("Plume.fmtDate('2026-11-05')"));
  await page.evaluate('openNewBatch && openNewBatch()'); await page.waitForTimeout(150);
  ok('a new batch starts on the 5th', (await page.evaluate("document.getElementById('f-date').value")) === '2026-11-05', await page.evaluate("document.getElementById('f-date').value"));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate('Plume.backup.now()')]);
  ok('a backup made now is named for the 5th', /backup-2026-11-05\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  await page.evaluate('closeModal && closeModal("m-new")').catch(() => {});
  await page.evaluate('Plume.openSettings()'); await page.waitForTimeout(200);
  const t = await page.evaluate("document.getElementById('plume-backup-box').innerText");
  ok('and Settings says Nov 5, today', /Nov 5, 2026 \(today\)/.test(t), t);

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
