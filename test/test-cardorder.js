// The formulation board (2026-10-25): cards sit in slots. Drag a card's grip
// to an empty slot (blank slots stay blank) or onto a card to swap the two;
// arrow keys on the grip move it one slot. Positions are saved on each
// formulation (f.board), so they stay. Too narrow for two columns: a list in
// board order.
const { chromium } = require('playwright');
const { previewUrl } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}
const F = (id, name, status) => ({ id: id, name: name, type: 'Face cream', status: status || 'draft', lines: [],
  variants: [{ vid: 'v' + id, num: 1, label: '', status: status || 'draft', lines: [], batchSize: '100', usageLog: [], history: [] }], activeVariantId: 'v' + id });
const FORMS = [F('a', 'Alpha'), F('b', 'Bravo', 'approved'), F('c', 'Charlie'), F('d', 'Delta', 'approved')];
const SEED = `
  localStorage.clear();
  localStorage.setItem('aerie-ingredients-v2', '[]');
  localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});
  localStorage.setItem('plume-theme', 'light');`;
// "Alpha 0,0; Bravo 0,1; ..." from storage
const where = "JSON.parse(localStorage.getItem('aerie-formulations-v1')).map(function (f) { return f.name + ' ' + (f.board ? f.board.r + ',' + f.board.c : '-'); }).join('; ')";
const cardAt = "Array.from(document.querySelectorAll('#fcard-container .fcard')).map(function (c) { return c.querySelector('.fcard-name').textContent + ' ' + c.getAttribute('data-r') + ',' + c.getAttribute('data-c'); }).join('; ')";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(previewUrl('formulations')); await page.evaluate(SEED); await page.reload(); await page.waitForTimeout(500);
  const cols = await page.evaluate("parseInt(document.querySelector('.fboard').style.gridTemplateColumns.match(/repeat\\((\\d+)/)[1], 10)");

  console.log('\n1. Placing cards');
  ok('the board has 3 columns at this width', cols === 3, cols);
  ok('cards without a slot take the first open ones, and that is saved', await page.evaluate(where) === 'Alpha 0,0; Bravo 0,1; Charlie 0,2; Delta 1,0', await page.evaluate(where));
  ok('empty slots are invisible until a card is moved', await page.evaluate("getComputedStyle(document.querySelector('.fslot')).borderTopColor") === 'rgba(0, 0, 0, 0)');
  const center = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 60) }; };
  const drag = async (name, sel) => {
    const g = await page.locator('.fcard', { hasText: name }).locator('.fcard-grip').boundingBox();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + 20, g.y + 20, { steps: 3 });
    const t = await center(sel);
    await page.mouse.move(t.x, t.y, { steps: 8 });
    const seen = await page.evaluate("({ over: (document.querySelector('.fc-over') || {}).className || '', slotsShow: getComputedStyle(document.querySelector('.fslot')).borderTopColor !== 'rgba(0, 0, 0, 0)' })");
    await page.mouse.up(); await page.waitForTimeout(150);
    return seen;
  };
  let seen = await drag('Delta', '.fslot[data-r="1"][data-c="2"]');
  ok('while dragging, the empty slots show and the one under the card lights up', seen.slotsShow && /fslot/.test(seen.over) && /fc-over/.test(seen.over), seen);
  ok('Delta dropped in an empty slot goes there, leaving blanks beside it', await page.evaluate(where) === 'Alpha 0,0; Bravo 0,1; Charlie 0,2; Delta 1,2', await page.evaluate(where));
  ok('and is drawn there', /Delta 1,2/.test(await page.evaluate(cardAt)) && (await page.evaluate("document.querySelector('.fcard[data-fid=\"d\"]').style.gridColumn")).startsWith('3'));
  ok('the drag left nothing behind', await page.evaluate("!document.querySelector('.fc-ghost, .fc-dragging, .fc-over') && !document.body.classList.contains('fc-moving')"));
  ok('no editor opened', await page.evaluate("!curId"));
  await page.reload(); await page.waitForTimeout(400);
  ok('the layout stays after a reload', /Delta 1,2/.test(await page.evaluate(cardAt)) && await page.evaluate(where) === 'Alpha 0,0; Bravo 0,1; Charlie 0,2; Delta 1,2');
  seen = await drag('Alpha', '.fcard[data-fid="c"]');
  ok('dropping on a card lights it up', /fcard/.test(seen.over) && /fc-over/.test(seen.over), seen);
  ok('and swaps the two', await page.evaluate(where) === 'Alpha 0,2; Bravo 0,1; Charlie 0,0; Delta 1,2', await page.evaluate(where));
  await drag('Bravo', '.fslot[data-r="2"][data-c="1"]');
  ok('the spare row below lets a card start a new row', await page.evaluate(where) === 'Alpha 0,2; Bravo 2,1; Charlie 0,0; Delta 1,2', await page.evaluate(where));
  ok('a new spare row appears below it', await page.evaluate("!!document.querySelector('.fslot.fslot-spare[data-r=\"3\"]')"));

  console.log('\n2. Things that should not move or open');
  await page.locator('.fcard', { hasText: 'Charlie' }).locator('.fcard-grip').click(); await page.waitForTimeout(150);
  ok('a click on the grip neither moves the card nor opens it', await page.evaluate(where) === 'Alpha 0,2; Bravo 2,1; Charlie 0,0; Delta 1,2' && await page.evaluate("!curId"));
  const own = await page.locator('.fcard', { hasText: 'Charlie' }).boundingBox(), cg = await page.locator('.fcard', { hasText: 'Charlie' }).locator('.fcard-grip').boundingBox();
  await page.mouse.move(cg.x + 5, cg.y + 5); await page.mouse.down();
  await page.mouse.move(own.x + 40, own.y + own.height / 2, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(150);
  ok('let go over its own card: nothing moves and it does not open', await page.evaluate(where) === 'Alpha 0,2; Bravo 2,1; Charlie 0,0; Delta 1,2' && await page.evaluate("!curId"));
  await page.mouse.move(cg.x + 5, cg.y + 5); await page.mouse.down(); await page.mouse.move(60, 60, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(150);
  ok('dropping off the board changes nothing', await page.evaluate(where) === 'Alpha 0,2; Bravo 2,1; Charlie 0,0; Delta 1,2');
  await page.locator('.fcard', { hasText: 'Bravo' }).click(); await page.waitForTimeout(200);
  ok('an ordinary click on a card still opens it', await page.evaluate("curId") === 'b');
  await page.evaluate("goList()"); await page.waitForTimeout(150);

  console.log('\n3. Keyboard, new formulations, filters');
  await page.locator('.fcard', { hasText: 'Delta' }).locator('.fcard-grip').focus();
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowUp'); await page.waitForTimeout(100);
  ok('arrow keys move a card one slot at a time', await page.evaluate(where) === 'Alpha 0,2; Bravo 2,1; Charlie 0,0; Delta 0,1', await page.evaluate(where));
  ok('focus stays on its grip', await page.evaluate("document.activeElement && document.activeElement.closest('.fcard').getAttribute('data-fid') === 'd'"));
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100);
  ok('into an occupied slot it swaps', await page.evaluate(where) === 'Alpha 0,1; Bravo 2,1; Charlie 0,0; Delta 0,2', await page.evaluate(where));
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp'); await page.waitForTimeout(100);
  ok('not past the edge', await page.evaluate(where) === 'Alpha 0,1; Bravo 2,1; Charlie 0,0; Delta 0,2');
  await page.evaluate(`(function () { forms.push(${JSON.stringify(F('e', 'Echo'))}); saveAll(); renderCards(); })()`); await page.waitForTimeout(100);
  ok('a new formulation takes the first open slot', /Echo 1,0$/.test(await page.evaluate(where)), await page.evaluate(where));
  await page.evaluate("listStatus = 'approved'; renderCards();"); await page.waitForTimeout(100);
  ok('filtered: the shown cards keep their slots, with blanks for the rest', await page.evaluate(cardAt) === 'Delta 0,2; Bravo 2,1', await page.evaluate(cardAt));
  await drag('Bravo', '.fslot[data-r="0"][data-c="1"]');
  ok('moving into a slot a hidden card holds swaps with the hidden card', await page.evaluate(where) === 'Alpha 2,1; Bravo 0,1; Charlie 0,0; Delta 0,2; Echo 1,0', await page.evaluate(where));
  await page.evaluate("listStatus = ''; renderCards();");
  ok('all shown again, no two cards share a slot', await page.evaluate(cardAt) === 'Charlie 0,0; Bravo 0,1; Delta 0,2; Echo 1,0; Alpha 2,1', await page.evaluate(cardAt));

  console.log('\n4. Window sizes');
  await page.setViewportSize({ width: 1600, height: 900 }); await page.waitForTimeout(400);
  const wide = await page.evaluate("parseInt(document.querySelector('.fboard').style.gridTemplateColumns.match(/repeat\\((\\d+)/)[1], 10)");
  ok('a wider window shows more columns; the cards stay in their slots', wide > 3 && await page.evaluate(cardAt) === 'Charlie 0,0; Bravo 0,1; Delta 0,2; Echo 1,0; Alpha 2,1', wide);
  await page.setViewportSize({ width: 1100, height: 900 }); await page.waitForTimeout(400);
  const ctx = await browser.newContext({ viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: true });
  const m = await ctx.newPage(); m.on('pageerror', e => errors.push(String(e)));
  await m.goto(previewUrl('formulations'));
  await m.evaluate(`localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(await page.evaluate("localStorage.getItem('aerie-formulations-v1')"))}); localStorage.setItem('plume-theme', 'light');`);
  await m.reload(); await m.waitForTimeout(500);
  const names = await m.evaluate("Array.from(document.querySelectorAll('#fcard-container .fcard .fcard-name')).map(function (n) { return n.textContent; }).join(',')");
  ok('on a phone: a list in board order (row by row)', names === 'Charlie,Bravo,Delta,Echo,Alpha', names);
  ok('with a note to arrange on a wider screen, and no grips', /wider screen/.test(await m.evaluate("document.getElementById('fcard-container').innerText")) &&
     await m.evaluate("getComputedStyle(document.querySelector('.fcard-grip')).display") === 'none');
  ok('and nothing was moved by looking at it there', await m.evaluate(where) === await page.evaluate(where));
  await ctx.close();

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
