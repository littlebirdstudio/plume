// Rich text in Formulations (2026-11-01): Instructions and Formulation notes
// get the Bold / Italic / List bar, numbered lists join bullets, and the
// approval lock reaches the formatted box. Also the stored form of a
// numbered list ("1. " lines) and how it reads back.
const { chromium } = require('playwright');
const fs = require('fs');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
}

const ings = [
  { id: 'i1', name: 'Distilled Water', inci: 'Aqua', phase: 'water', functionCategory: ['Solvent'], lots: [] },
  { id: 'i2', name: 'Glycerin', inci: 'Glycerin', phase: 'water', functionCategory: ['Humectant'], lots: [] }
];
const INSTR = '1. Weigh the water.\n2. Stir in **glycerin**.\n\n*pH*\n3. Check it.\n\nWatch for:\n- haze';
function variant(vid, num, status) {
  return { vid, num, label: '', status, lines: [{ ingId: 'i1', pct: '95' }, { ingId: 'i2', pct: '5' }],
    instructions: INSTR, batchSize: '100', addinsInTotal: true, usageLog: [], history: [],
    branchedFrom: null, branchNote: '', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' };
}
const forms = [{ id: 'f1', name: 'Mist', type: 'Toner', notes: '', formNotes: 'Learned:\n- keep it simple',
  variants: [variant('v1', 1, 'draft'), variant('v2', 2, 'approved')], activeVariantId: 'v1' }];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await trackDialogs(page, []);
  await page.addInitScript(([i, f]) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.clear();
    localStorage.setItem('aerie-ingredients-v2', i);
    localStorage.setItem('aerie-formulations-v1', f);
    sessionStorage.setItem('seeded', '1');
  }, [JSON.stringify(ings), JSON.stringify(forms)]);
  await page.goto(previewUrl('formulations') + '#f=f1');
  await page.waitForTimeout(500);

  console.log('\n1. Stored marks read back');
  const h = await page.evaluate(() => [
    Plume.rt.toHtml('1. a\n2. b'),
    Plume.rt.toHtml('4. d\n5) e'),
    Plume.rt.toHtml('2.5 g of NAG\n50 g batch'),
    Plume.rt.toHtml('1. a\n- b\n2. c')
  ]);
  ok('"1. " lines make a numbered list', /^<ol class="rt-ol"><li>a<\/li><li>b<\/li><\/ol>$/.test(h[0]));
  ok('a list keeps the number it starts at, ". " or ") "', /<ol class="rt-ol" start="4"><li>d<\/li><li>e<\/li><\/ol>/.test(h[1]));
  ok('"2.5 g" and "50 g" stay as typed', h[2].indexOf('<ol') === -1 && h[2].indexOf('2.5 g of NAG') !== -1);
  ok('bullets and numbers switch lists', /<\/ol><ul class="rt-ul"><li>b<\/li><\/ul><ol class="rt-ol" start="2">/.test(h[3]));
  const round = await page.evaluate(() => {
    var d = document.createElement('div');
    d.innerHTML = Plume.rt.toHtml('3. c\n4. d\n\nnote\n- x');
    return Plume.rt.fromEl(d);
  });
  ok('a numbered list saves back with its numbers', round === '3. c\n4. d\n\nnote\n- x');

  console.log('\n2. Instructions');
  ok('the bar is there, with a Numbered list button',
    await page.evaluate(() => !!document.querySelector('#ep-method .rt-bar .rt-btn[title="Numbered list"]')));
  ok('the textarea is hidden behind the box', await page.evaluate(() => getComputedStyle(document.getElementById('f-instruct')).display === 'none'));
  ok('the stored steps show as a list', await page.evaluate(() => document.querySelectorAll('#ep-method .rt-ed ol li').length === 3));
  ok('the second list carries on at 3', await page.evaluate(() => document.querySelectorAll('#ep-method .rt-ed ol')[1].getAttribute('start') === '3'));
  await page.click('#ep-method .rt-ed');
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.click('#ep-method .rt-btn[title="Numbered list"]');
  await page.keyboard.type('Bottle it');
  const after = await page.evaluate(() => document.getElementById('f-instruct').value);
  ok('a new numbered list below a note counts on (4.)', /\n4\. Bottle it$/.test(after));
  ok('editing marks the formula changed', await page.evaluate(() => !!dirty));
  await page.evaluate(() => saveFormula(true));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('aerie-formulations-v1'))[0].variants[0].instructions);
  ok('the version saves the marked text', /^1\. Weigh the water\.\n2\. Stir in \*\*glycerin\*\*\./.test(saved) && /4\. Bottle it$/.test(saved));

  console.log('\n3. The approval lock');
  await page.evaluate(() => selectVariant('v2'));
  await page.waitForTimeout(200);
  ok('an approved version\'s box cannot be typed in', await page.evaluate(() => document.querySelector('#ep-method .rt-ed').contentEditable === 'false'));
  ok('and shows no formatting bar', await page.evaluate(() => getComputedStyle(document.querySelector('#ep-method .rt-bar')).display === 'none'));
  ok('it shows that version\'s own steps', await page.evaluate(() => document.querySelector('#ep-method .rt-ed').textContent.indexOf('Bottle it') === -1));
  await page.evaluate(() => selectVariant('v1'));
  await page.waitForTimeout(200);
  ok('back on the draft it is editable again', await page.evaluate(() => document.querySelector('#ep-method .rt-ed').contentEditable === 'true'));

  console.log('\n4. Formulation notes');
  await page.evaluate(() => selectNotes());
  await page.waitForTimeout(400);
  ok('the notes panel has the bar', await page.evaluate(() => !!document.querySelector('.np-text + .rt-wrap .rt-btn[title="Numbered list"]')));
  ok('its bullets show as a list', await page.evaluate(() => document.querySelectorAll('.np-text + .rt-wrap .rt-ed ul li').length === 1));
  await page.click('.np-text + .rt-wrap .rt-ed');
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('stir slowly');
  ok('typing reaches the field saveFormula reads', await page.evaluate(() => document.getElementById('f-formnotes').value === 'Learned:\n- keep it simple\n- stir slowly'));
  await page.evaluate(() => Plume.peek.close());
  await page.waitForTimeout(300);
  await page.evaluate(() => selectNotes());
  await page.waitForTimeout(400);
  ok('opened again, the panel gets a fresh bar', await page.evaluate(() => document.querySelectorAll('.np-text + .rt-wrap .rt-bar').length === 1 && document.querySelectorAll('.np-text + .rt-wrap .rt-ed li').length === 2));
  await page.evaluate(() => Plume.peek.close());

  console.log('\n5. Bench sheet');
  const sheet = await page.evaluate(() => Plume.buildSheet({ name: 'Mist', instructions: '1. a\n2. **b**', lines: [] }));
  ok('instructions print as a numbered list, bold kept', /<ol class="rt-ol"><li>a<\/li><li><strong>b<\/strong><\/li><\/ol>/.test(sheet));

  ok('no page errors', errors.length === 0);
  if (errors.length) console.log(errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
