// In-page dialogs (2026-10-17): Plume.tell / ask / askValue replaced the
// browser's alert / confirm / prompt, which sandboxed frames block silently.
//
// Part 1 drives the REAL dialog in a browser, with no test hook, the way a
// person would: clicking, Escape, Enter. Part 2 scans every app file to make
// sure no browser pop-up has crept back in.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { ROOT, previewUrl } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

console.log('\n1. No browser pop-ups left in the app');
{
  const files = fs.readdirSync(ROOT).filter(f => /^(plume-.*\.(html|js)|index\.html)$/.test(f));
  const hits = [];
  files.forEach(f => {
    fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
      if (/(^|[^.\w])(alert|confirm|prompt)\(/.test(code) || /window\.(alert|confirm|prompt)\(/.test(code)) {
        hits.push(f + ':' + (i + 1) + '  ' + line.trim().slice(0, 90));
      }
    });
  });
  ok('no alert, confirm or prompt calls in any app file', hits.length === 0, hits);
}

(async () => {
  const browser = await chromium.launch();
  // Packaging is the smallest module; any converted page would do.
  async function open() {
    const page = await browser.newPage();
    const errors = [];
    const native = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', d => { native.push(d.message()); d.dismiss(); });
    await page.goto(previewUrl('packaging'));
    await page.waitForTimeout(400);
    await page.evaluate('window.__log = [];');
    return { page, errors, native };
  }
  const shown = page => page.evaluate("document.querySelectorAll('.plume-dlg-ov').length");
  const log = page => page.evaluate('window.__log');

  console.log('\n2. Plume.ask, answered by a person');
  {
    const { page, errors, native } = await open();
    await page.evaluate("Plume.ask('This cannot be undone.', function(){ __log.push('yes'); }, { title: 'Delete this item?', yes: 'Delete', danger: true, onNo: function(){ __log.push('no'); } })");
    ok('a dialog appears in the page', (await shown(page)) === 1);
    const t = await page.evaluate("document.querySelector('.plume-dlg').innerText");
    ok('with its title, message and both buttons', /Delete this item\?/.test(t) && /This cannot be undone\./.test(t) && /Delete/.test(t) && /Cancel/.test(t), t);
    ok('the dangerous button is marked', await page.evaluate("document.querySelector('.plume-dlg-yes').classList.contains('danger')"));
    await page.waitForTimeout(50);
    ok('a dangerous question puts focus on Cancel', await page.evaluate("document.activeElement === document.querySelector('.plume-dlg-no')"));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
    ok('Enter on Cancel does not delete', JSON.stringify(await log(page)) === '["no"]', await log(page));
    ok('and the dialog closes', (await shown(page)) === 0);

    await page.evaluate("__log = []; Plume.ask('Sure?', function(){ __log.push('yes'); }, { onNo: function(){ __log.push('no'); } })");
    await page.waitForTimeout(50);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
    ok('Escape cancels', JSON.stringify(await log(page)) === '["no"]', await log(page));

    await page.evaluate("__log = []; Plume.ask('Sure?', function(){ __log.push('yes'); }, { onNo: function(){ __log.push('no'); } })");
    await page.waitForTimeout(50);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
    ok('Enter confirms an ordinary question', JSON.stringify(await log(page)) === '["yes"]', await log(page));

    await page.evaluate("__log = []; Plume.ask('Sure?', function(){ __log.push('yes'); }, { onNo: function(){ __log.push('no'); } })");
    await page.click('.plume-dlg-ov', { position: { x: 5, y: 5 } });
    await page.waitForTimeout(50);
    ok('a click on the backdrop cancels a question', JSON.stringify(await log(page)) === '["no"]', await log(page));

    await page.evaluate("__log = []; Plume.ask('Sure?', function(){ __log.push('yes'); })");
    await page.click('.plume-dlg-yes');
    await page.waitForTimeout(50);
    ok('clicking the main button confirms', JSON.stringify(await log(page)) === '["yes"]');
    ok('no browser pop-up was used', native.length === 0, native);
    ok('no page errors', errors.length === 0, errors);
    await page.close();
  }

  console.log('\n3. Plume.tell and Plume.askValue');
  {
    const { page, errors } = await open();
    await page.evaluate("Plume.tell('Imported 4 items.', { onClose: function(){ __log.push('closed'); } })");
    ok('a notice has one button', (await page.evaluate("document.querySelectorAll('.plume-dlg button').length")) === 1);
    await page.click('.plume-dlg-ov', { position: { x: 5, y: 5 } });
    await page.waitForTimeout(50);
    ok('a backdrop click does not dismiss a notice unread', (await shown(page)) === 1);
    await page.click('.plume-dlg-yes');
    await page.waitForTimeout(50);
    ok('OK closes it and runs onClose', JSON.stringify(await log(page)) === '["closed"]', await log(page));

    await page.evaluate("__log = []; Plume.askValue('Drops per gram:', '20', function(v){ __log.push('v:' + v); }, { inputmode: 'decimal', onCancel: function(){ __log.push('cancel'); } })");
    await page.waitForTimeout(50);
    ok('the field starts with the current value, focused',
       await page.evaluate("var i=document.querySelector('.plume-dlg-input'); i.value === '20' && document.activeElement === i"));
    await page.fill('.plume-dlg-input', '15');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
    ok('Enter returns the typed value', JSON.stringify(await log(page)) === '["v:15"]', await log(page));
    await page.evaluate("__log = []; Plume.askValue('Drops per gram:', '20', function(v){ __log.push('v:' + v); }, { onCancel: function(){ __log.push('cancel'); } })");
    await page.waitForTimeout(50);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
    ok('Escape cancels without a value', JSON.stringify(await log(page)) === '["cancel"]', await log(page));
    ok('no page errors', errors.length === 0, errors);
    await page.close();
  }

  console.log('\n4. Text, queueing, focus');
  {
    const { page } = await open();
    await page.evaluate("Plume.tell('<b>bold?</b>\\n\\nSecond paragraph\\nwith a break')");
    const html = await page.evaluate("document.querySelector('.plume-dlg-msg').innerHTML");
    ok('markup in a message is shown as text, not run', /&lt;b&gt;/.test(html) && !/<b>/.test(html), html);
    ok('a blank line makes a paragraph, a newline a break', (html.match(/<p>/g) || []).length === 2 && /<br>/.test(html), html);
    await page.click('.plume-dlg-yes');

    await page.evaluate("__log = []; Plume.tell('first', { onClose: function(){ __log.push(1); } }); Plume.tell('second', { onClose: function(){ __log.push(2); } });");
    ok('only one dialog shows at a time', (await shown(page)) === 1);
    ok('the first comes first', /first/.test(await page.evaluate("document.querySelector('.plume-dlg-msg').innerText")));
    await page.click('.plume-dlg-yes'); await page.waitForTimeout(50);
    ok('the second follows when the first closes', /second/.test(await page.evaluate("document.querySelector('.plume-dlg-msg').innerText")));
    await page.click('.plume-dlg-yes'); await page.waitForTimeout(50);
    ok('both ran in order', JSON.stringify(await log(page)) === '[1,2]', await log(page));

    await page.evaluate("var b=document.createElement('button'); b.id='opener'; b.textContent='x'; document.body.appendChild(b); b.focus(); Plume.ask('q', function(){});");
    await page.waitForTimeout(50);
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    ok('Tab keeps focus inside the dialog', await page.evaluate("!!document.activeElement.closest('.plume-dlg')"));
    await page.keyboard.press('Escape'); await page.waitForTimeout(50);
    ok('focus returns to where it was', await page.evaluate("document.activeElement && document.activeElement.id === 'opener'"));
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
