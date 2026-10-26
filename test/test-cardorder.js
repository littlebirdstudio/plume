// Formulation card order (2026-10-25): drag a card's grip to move it, or use
// the arrow keys on the grip. The order is the saved order of the
// formulations, so it stays after a reload.
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
const stored = "JSON.parse(localStorage.getItem('aerie-formulations-v1')).map(function (f) { return f.name; }).join(',')";
const shown = "Array.from(document.querySelectorAll('#fcard-container .fcard')).map(function (c) { return c.querySelector('.fcard-name').textContent; }).join(',')";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(previewUrl('formulations')); await page.evaluate(SEED); await page.reload(); await page.waitForTimeout(500);

  console.log('\n1. Drag a card');
  ok('cards show in saved order, each with a grip', await page.evaluate(shown) === 'Alpha,Bravo,Charlie,Delta' && await page.locator('.fcard-grip').count() === 4);
  const box = async (name) => (await page.locator('.fcard', { hasText: name }).boundingBox());
  const drag = async (from, to, side) => {
    const g = await page.locator('.fcard', { hasText: from }).locator('.fcard-grip').boundingBox();
    const t = await box(to);
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + 20, g.y + 20, { steps: 3 });
    const x = side === 'after' ? t.x + t.width * 0.8 : t.x + t.width * 0.2;
    await page.mouse.move(x, t.y + t.height / 2, { steps: 8 });
    const mark = await page.evaluate("(function(){ var b = document.querySelector('.fcard.fc-before, .fcard.fc-after'); return b ? b.querySelector('.fcard-name').textContent + (b.classList.contains('fc-after') ? ':after' : ':before') : ''; })()");
    await page.mouse.up(); await page.waitForTimeout(150);
    return mark;
  };
  let mark = await drag('Delta', 'Alpha', 'before');
  ok('while dragging, a line shows where it will land', mark === 'Alpha:before', mark);
  ok('Delta dropped before Alpha moves to the front', await page.evaluate(shown) === 'Delta,Alpha,Bravo,Charlie', await page.evaluate(shown));
  ok('and is saved in that order', await page.evaluate(stored) === 'Delta,Alpha,Bravo,Charlie', await page.evaluate(stored));
  ok('the drag left nothing behind (no ghost, no marks)', await page.evaluate("!document.querySelector('.fc-ghost, .fc-dragging, .fc-before, .fc-after') && !document.body.classList.contains('fc-moving')"));
  ok('no editor opened', await page.evaluate("!document.getElementById('editor-view') || getComputedStyle(document.getElementById('editor-view')).display === 'none' || !curId"));
  await drag('Alpha', 'Charlie', 'after');
  ok('Alpha dropped after Charlie goes to the end', await page.evaluate(stored) === 'Delta,Bravo,Charlie,Alpha', await page.evaluate(stored));
  await page.reload(); await page.waitForTimeout(400);
  ok('the order stays after a reload', await page.evaluate(shown) === 'Delta,Bravo,Charlie,Alpha', await page.evaluate(shown));
  // A click on the grip without moving does nothing.
  await page.locator('.fcard', { hasText: 'Bravo' }).locator('.fcard-grip').click(); await page.waitForTimeout(150);
  ok('a click on the grip neither moves the card nor opens it', await page.evaluate(stored) === 'Delta,Bravo,Charlie,Alpha' && await page.evaluate("typeof curId === 'undefined' || !curId"));
  // Dropping outside any card changes nothing.
  const g = await page.locator('.fcard', { hasText: 'Charlie' }).locator('.fcard-grip').boundingBox();
  await page.mouse.move(g.x + 5, g.y + 5); await page.mouse.down(); await page.mouse.move(g.x + 40, g.y + 400, { steps: 6 }); await page.mouse.up();
  ok('dropping on empty space changes nothing', await page.evaluate(stored) === 'Delta,Bravo,Charlie,Alpha');
  // Dragged around and let go over its own card: no move, and it does not open.
  const own = await box('Charlie'), cg = await page.locator('.fcard', { hasText: 'Charlie' }).locator('.fcard-grip').boundingBox();
  await page.mouse.move(cg.x + 5, cg.y + 5); await page.mouse.down();
  await page.mouse.move(own.x + 40, own.y + own.height / 2, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(150);
  ok('let go over its own card: nothing moves and it does not open', await page.evaluate(stored) === 'Delta,Bravo,Charlie,Alpha' && await page.evaluate("!curId"), await page.evaluate("curId"));
  await page.locator('.fcard', { hasText: 'Bravo' }).click(); await page.waitForTimeout(200);
  ok('an ordinary click on a card still opens it', await page.evaluate("curId") === 'b');
  await page.evaluate("goList()"); await page.waitForTimeout(150);

  console.log('\n2. Keyboard and filters');
  await page.locator('.fcard', { hasText: 'Charlie' }).locator('.fcard-grip').focus();
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(100);
  ok('Left arrow on the grip moves it one place earlier', await page.evaluate(stored) === 'Delta,Charlie,Bravo,Alpha', await page.evaluate(stored));
  ok('focus stays on its grip', await page.evaluate("document.activeElement && document.activeElement.classList.contains('fcard-grip') && document.activeElement.closest('.fcard').getAttribute('data-fid') === 'c'"));
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100);
  ok('Right arrow moves it later', await page.evaluate(stored) === 'Delta,Bravo,Alpha,Charlie', await page.evaluate(stored));
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100);
  ok('at the end it stays put', await page.evaluate(stored) === 'Delta,Bravo,Alpha,Charlie');
  // With a filter on, the move is among the cards shown; hidden ones keep their place.
  await page.evaluate("listStatus = 'approved'; renderCards();"); await page.waitForTimeout(100);
  ok('filtered to approved: Delta, Bravo', await page.evaluate(shown) === 'Delta,Bravo', await page.evaluate(shown));
  await drag('Bravo', 'Delta', 'before');
  ok('moving Bravo before Delta leaves the others where they were', await page.evaluate(stored) === 'Bravo,Delta,Alpha,Charlie', await page.evaluate(stored));
  await page.evaluate("listStatus = ''; renderCards();");

  console.log('\n3. Touch-sized screen');
  const ctx = await browser.newContext({ viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: true });
  const m = await ctx.newPage(); m.on('pageerror', e => errors.push(String(e)));
  await m.goto(previewUrl('formulations')); await m.evaluate(SEED); await m.reload(); await m.waitForTimeout(500);
  ok('the grip is visible without hovering', parseFloat(await m.evaluate("getComputedStyle(document.querySelector('.fcard-grip')).opacity")) >= 0.8);
  ok('and does not let the page scroll while dragging', await m.evaluate("getComputedStyle(document.querySelector('.fcard-grip')).touchAction") === 'none');
  // One column: dropping on the lower half of a card puts it below.
  await m.evaluate("window.scrollTo(0, 0)");
  const tb = await m.locator('.fcard', { hasText: 'Alpha' }).boundingBox(), dg = await m.locator('.fcard', { hasText: 'Bravo' }).locator('.fcard-grip').boundingBox();
  await m.mouse.move(dg.x + 5, dg.y + 5); await m.mouse.down();
  await m.mouse.move(tb.x + tb.width / 2, tb.y + tb.height * 0.8, { steps: 10 });
  const mk = await m.evaluate("(function(){ var b = document.querySelector('.fcard.fc-before, .fcard.fc-after'); return b ? b.className : ''; })()");
  await m.mouse.up(); await m.waitForTimeout(150);
  ok('in one column the line goes below the card, and the card lands there', /fc-after/.test(mk) && /fc-col/.test(mk) && await m.evaluate(stored) === 'Alpha,Bravo,Charlie,Delta', [mk, await m.evaluate(stored)]);
  await m.mouse.move(dg.x + 5, dg.y + 5); await m.mouse.down();
  await m.mouse.move(tb.x + tb.width / 2, tb.y + tb.height * 0.2, { steps: 10 });
  await m.mouse.up(); await m.waitForTimeout(150);
  ok('and on the upper half, above it', await m.evaluate(stored) === 'Bravo,Alpha,Charlie,Delta', await m.evaluate(stored));
  await ctx.close();

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
