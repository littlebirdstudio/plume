// Archiving an ingredient, deleting one, and what a formulation does when the
// ingredient underneath a line stops existing.
//
// The last of those is why this suite exists. A formulation line holds an
// ingredient id, so deleting the ingredient leaves the line pointing at
// nothing. The old behaviour dropped the row from the render while the line
// kept counting toward the percentage total, so a formula displayed 100.00%
// while showing 60% of its rows. Nothing anywhere said so.
const { chromium } = require('playwright');
const { previewUrl } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const INGS = [
  { id: 'i1', name: 'Olive oil', inci: 'Olea Europaea (Olive) Fruit Oil', phase: 'oil',
    functionCategory: ['Emollient'],
    lots: [{ id: 'l1', supplier: 'Acme', qtyPurchased: 1000, qtyUnit: 'g', cost: 20, costPerG: 0.02 }] },
  { id: 'i2', name: 'Shea butter', inci: 'Butyrospermum Parkii (Shea) Butter', phase: 'oil',
    functionCategory: ['Emollient'], lots: [] },
  // Already archived at load, to prove the toggle and un-archive work on
  // data that arrives in that state rather than only on a fresh archive.
  { id: 'i3', name: 'Retired wax', inci: 'Cera Alba', phase: 'oil',
    functionCategory: ['Thickener'], lots: [], archived: true },
  { id: 'i4', name: 'Unused oil', inci: 'Nothing Uses This Oil', phase: 'oil',
    functionCategory: ['Emollient'], lots: [] }
];

function variant(vid, num, label, lines) {
  return { vid, num, label, status: 'draft', lines,
           instructions: '', batchSize: '100', addinsInTotal: false,
           usageLog: [], history: [], branchedFrom: null, branchNote: '',
           createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };
}

// f1's SECOND version is the only place Shea is used. A dependency check that
// looked at the active variant alone, or at the mirrored top-level lines,
// would report Shea as unused and wave the delete through.
const FORMS = [
  { id: 'f1', name: 'Lotion bar', type: 'balm', notes: '', formNotes: '',
    activeVariantId: 'v1',
    variants: [variant('v1', 1, '', [{ ingId: 'i1', pct: 100 }]),
               variant('v2', 2, 'With shea', [{ ingId: 'i1', pct: 60 }, { ingId: 'i2', pct: 40 }])] },
  { id: 'f2', name: 'Face oil', type: 'serum', notes: '', formNotes: '',
    activeVariantId: 'w1',
    variants: [variant('w1', 1, '', [{ ingId: 'i1', pct: 100 }])] }
];

const SEED = `
  localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(INGS))});
  localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});
  localStorage.setItem('plume-products-v1', '[]');
  localStorage.setItem('aerie-batches-v1', '[]');
`;

(async () => {
  const browser = await chromium.launch();

  async function open(module, seed) {
    const page = await browser.newPage();
    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
    await page.goto(previewUrl(module));
    await page.waitForTimeout(300);
    await page.evaluate(seed === undefined ? SEED : seed);
    await page.reload();
    await page.waitForTimeout(500);
    return { page, dialogs };
  }

  console.log('\n1. Finding what uses an ingredient');
  {
    const { page } = await open('ingredients');
    const dep = await page.evaluate(`(function () {
      function s(id) { return ingredientDependents(id).map(function (d) {
        return d.name + ' [' + d.versions.join('|') + ']'; }); }
      return { olive: s('i1'), shea: s('i2'), unused: s('i4') };
    })()`);

    ok('an ingredient used by two formulations reports both',
       dep.olive.length === 2, dep.olive);
    // The trap: Shea exists only on v2 of f1.
    ok('an ingredient used only in a NON-active version is still found',
       dep.shea.length === 1 && /With shea/.test(dep.shea[0]), dep.shea);
    ok('and names the version it is used in',
       /v2/.test(dep.shea[0]), dep.shea);
    ok('an unused ingredient reports nothing', dep.unused.length === 0, dep.unused);
    await page.close();
  }

  console.log('\n2. Deleting states the damage first');
  {
    const { page, dialogs } = await open('ingredients');
    await page.evaluate("viewIngredient('i2')");
    await page.waitForTimeout(150);
    await page.evaluate('deleteCurrent()');
    await page.waitForTimeout(200);
    const msg = dialogs.join('\n');

    ok('the confirm names the formulation at risk', /Lotion bar/.test(msg), msg);
    ok('it says the line is left behind rather than removed',
       /does not remove those lines/i.test(msg), msg);
    ok('it explains the formula will be short', /short/i.test(msg), msg);
    ok('it offers archiving as the alternative', /Archive instead/i.test(msg), msg);

    // An unused ingredient should not be dressed up as dangerous.
    const { page: p2, dialogs: d2 } = await open('ingredients');
    await p2.evaluate("viewIngredient('i4')");
    await p2.waitForTimeout(150);
    await p2.evaluate('deleteCurrent()');
    await p2.waitForTimeout(200);
    ok('an unused ingredient gets a plain confirm with no dependency talk',
       !/Archive instead/i.test(d2.join('\n')), d2);
    await page.close(); await p2.close();
  }

  console.log('\n3. Archiving says it is safe, because it is');
  {
    const { page, dialogs } = await open('ingredients');
    await page.evaluate("viewIngredient('i1')");
    await page.waitForTimeout(150);
    ok('the button reads Archive for a live ingredient',
       (await page.evaluate("document.getElementById('d-archive-btn').textContent")) === 'Archive');

    await page.evaluate('toggleArchiveCurrent()');
    await page.waitForTimeout(250);
    const msg = dialogs.join('\n');
    ok('the confirm names what still uses it', /Lotion bar/.test(msg) && /Face oil/.test(msg), msg);
    ok('and says those keep working', /keep working/i.test(msg), msg);
    ok('it does not claim a backup is needed to restore',
       !/backup/i.test(msg), msg);
    ok('the flag is set', (await page.evaluate("ingredients.find(function(i){return i.id==='i1';}).archived")) === true);
    await page.close();
  }

  console.log('\n4. The list hides archived, and can show them');
  {
    const { page } = await open('ingredients');
    let names = await page.evaluate("Array.from(document.querySelectorAll('#tbody .td-name')).map(function(e){return e.textContent;}).join('|')");
    ok('an archived ingredient is not listed', !/Retired wax/.test(names), names);
    ok('live ingredients are listed', /Olive oil/.test(names) && /Shea butter/.test(names), names);

    const bar = await page.evaluate("document.getElementById('ing-arch-bar').innerText");
    ok('the bar offers the archived count', /Show 1 archived/.test(bar), bar);
    ok('and says where they are hidden from', /add-ingredient search/.test(bar), bar);

    await page.evaluate('toggleShowArchivedIngs()');
    await page.waitForTimeout(200);
    names = await page.evaluate("Array.from(document.querySelectorAll('#tbody .td-name')).map(function(e){return e.textContent;}).join('|')");
    ok('archived shown when asked', /Retired wax/.test(names), names);
    ok('and tagged as archived', /archived/.test(names), names);
    await page.close();
  }

  console.log('\n5. Un-archiving, with no dialog in the way');
  {
    const { page, dialogs } = await open('ingredients');
    await page.evaluate("viewIngredient('i3')");
    await page.waitForTimeout(200);
    ok('the button reads Unarchive for an archived ingredient',
       (await page.evaluate("document.getElementById('d-archive-btn').textContent")) === 'Unarchive');
    const ban = await page.evaluate("document.getElementById('d-arch-banner').innerText");
    ok('a banner explains the state', /Archived/.test(ban) && /Unarchive/.test(ban), ban);

    await page.evaluate('toggleArchiveCurrent()');
    await page.waitForTimeout(250);
    ok('the flag is cleared',
       (await page.evaluate("ingredients.find(function(i){return i.id==='i3';}).archived")) === undefined);
    ok('restoring asks for no confirmation', dialogs.length === 0, dialogs);
    ok('the button flips back',
       (await page.evaluate("document.getElementById('d-archive-btn').textContent")) === 'Archive');
    ok('the banner goes away',
       (await page.evaluate("document.getElementById('d-arch-banner').style.display")) === 'none');
    await page.close();
  }

  console.log('\n6. An archived ingredient still works where already used');
  {
    // Archive Olive, which both formulations use, then open one.
    const seed = SEED + `
      (function () {
        var ings = JSON.parse(localStorage.getItem('aerie-ingredients-v2'));
        ings.find(function (i) { return i.id === 'i1'; }).archived = true;
        localStorage.setItem('aerie-ingredients-v2', JSON.stringify(ings));
      })();`;
    const { page } = await open('formulations', seed);
    await page.evaluate("openFormula('f2')");
    await page.waitForTimeout(400);

    const rows = await page.evaluate("Array.from(document.querySelectorAll('.ing-row')).map(function(r){return r.innerText.replace(/\\n+/g,' ');})");
    ok('the row still renders', rows.length === 1, rows);
    ok('with the real ingredient name, not a stub',
       /Olive oil/.test(rows.join(' ')) && !/Missing ingredient/.test(rows.join(' ')), rows);
    ok('and is not flagged as missing',
       (await page.evaluate("document.querySelectorAll('.ing-missing').length")) === 0);

    // But it must be gone from the picker, or archiving means nothing.
    const found = await page.evaluate(`(function () {
      var q = 'olive';
      return ings.filter(function (i) {
        return !i.archived && Plume.ingMatchRank(i, q) > 0;
      }).length;
    })()`);
    ok('but cannot be added to another formula', found === 0, found);
    await page.close();
  }

  console.log('\n7. A deleted ingredient leaves a visible hole, not a silent one');
  {
    // i2 is referenced by f1 v2 but absent from the library entirely.
    const ingsNoShea = INGS.filter(i => i.id !== 'i2');
    const seed = `
      localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(ingsNoShea))});
      localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});
      localStorage.setItem('plume-products-v1', '[]');
      localStorage.setItem('aerie-batches-v1', '[]');`;
    const { page } = await open('formulations', seed);
    await page.evaluate("openFormula('f1')");
    await page.waitForTimeout(300);
    // Switch to the version that uses the now-deleted ingredient, through the
    // same entry point the version tabs use.
    await page.evaluate("selectVariant('v2')");
    await page.waitForTimeout(400);

    const info = await page.evaluate(`(function () {
      var sum = 0; fLines.forEach(function (l) { sum += parseFloat(l.pct) || 0; });
      return { linesInData: fLines.length,
               rowsRendered: document.querySelectorAll('.ing-row').length,
               missingRows: document.querySelectorAll('.ing-missing').length,
               pctInData: sum,
               text: document.body.innerText };
    })()`);

    ok('the line survives in the data', info.linesInData === 2, info.linesInData);
    ok('every line renders a row, including the broken one',
       info.rowsRendered === info.linesInData, [info.rowsRendered, info.linesInData]);
    ok('the broken row is marked', info.missingRows === 1, info.missingRows);
    ok('it is named as missing', /Missing ingredient/.test(info.text));
    ok('and says the formula is short until it is dealt with',
       /still counts toward the total/.test(info.text));
    ok('the percentage total is unchanged, which is why the row had to be shown',
       info.pctInData === 100, info.pctInData);

    // No dead button: there is no detail to open for something that is gone.
    const dead = await page.evaluate(`(function () {
      var btns = Array.from(document.querySelectorAll('.ing-row.ing-missing button.ing-name-btn'));
      return btns.length;
    })()`);
    ok('the missing row has no detail button to click', dead === 0, dead);
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
