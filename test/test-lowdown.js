// Drafted lowdowns (2026-10-16). The starter list carries a lowdown for every
// ingredient. Quick add and the "Fill in lowdowns" review bring them into a
// library marked chooseWhenDraft, shown as a "draft" tag until she keeps the
// line (the tick) or changes it. Her own lowdowns, and her purpose notes, are
// never touched.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { ROOT, previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const Starter = require(path.join(ROOT, 'plume-starter.js'));

console.log('\n0. Melting point is off the cheat sheet');
ok('no melting point column offered', !/meltingPoint|Melting point'/.test(fs.readFileSync(path.join(ROOT, 'plume-cheatsheet.js'), 'utf8').replace(/\/\/.*$/gm, '')));

console.log('\n1. The starter list carries lowdowns');
{
  const it = Starter.items;
  const missing = it.filter(i => !i.chooseWhen).map(i => i.name);
  ok('every starter ingredient has a lowdown', missing.length === 0, missing.slice(0, 20));
  const long = it.filter(i => i.chooseWhen && i.chooseWhen.length > 200).map(i => i.name);
  ok('every lowdown fits the field (200 characters)', long.length === 0, long);
  ok('no long dashes', it.every(i => !/—/.test(i.chooseWhen || '')),
     it.filter(i => /—/.test(i.chooseWhen || '')).map(i => i.name));
  ok('no lowdown repeats another word for word',
     new Set(it.map(i => i.chooseWhen)).size === it.length);
}

(async () => {
  const browser = await chromium.launch();
  const LIB = [
    // Matches the starter list by name, no lowdown: gets one.
    { id: 'a', name: 'Shea butter', inci: 'Butyrospermum Parkii (Shea) Butter', phase: 'oil', lots: [],
      purpose: 'my own reminder' },
    // Matches by a former name ("Rosehip oil" -> Rosehip seed oil).
    { id: 'b', name: 'Rosehip oil', inci: 'Rosa Canina Fruit Oil', phase: 'oil', lots: [] },
    // Has her own lowdown: never touched.
    { id: 'c', name: 'Jojoba oil', inci: 'Simmondsia Chinensis Seed Oil', phase: 'oil', lots: [],
      chooseWhen: 'my own words' },
    // Not in the starter list: nothing offered.
    { id: 'd', name: 'Mystery goo', inci: 'Unknownia', phase: 'water', lots: [] },
    // Archived: left alone.
    { id: 'e', name: 'Argan oil', inci: 'Argania Spinosa Kernel Oil', phase: 'oil', lots: [], archived: true }
  ];
  async function open(lib) {
    const page = await browser.newPage();
    const errors = [];
    const dialogs = [];
    page.on('pageerror', e => errors.push(String(e)));
    await trackDialogs(page, dialogs);
    await page.goto(previewUrl('ingredients'));
    await page.waitForTimeout(300);
    await page.evaluate(`localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(lib || LIB))});`);
    await page.reload();
    await page.waitForTimeout(500);
    return { page, errors, dialogs };
  }
  const stored = page => page.evaluate("JSON.parse(localStorage.getItem('aerie-ingredients-v2'))");
  const starterLine = n => (Starter.items.find(i => i.name === n) || {}).chooseWhen;

  console.log('\n2. The review offers lines only where they belong');
  {
    const { page, errors } = await open();
    await page.evaluate("openLowdownReview()");
    const plan = await page.evaluate("lowdownPlan.map(function(p){return p.ing.name + ' <- ' + p.from;})");
    ok('offers Shea butter by name', plan.indexOf('Shea butter <- Shea butter') !== -1, plan);
    ok('offers Rosehip oil through its former name', plan.indexOf('Rosehip oil <- Rosehip seed oil') !== -1, plan);
    ok('skips a lowdown she wrote', !plan.some(p => /^Jojoba/.test(p)), plan);
    ok('skips what the starter list lacks, and the archive', plan.length === 2, plan);
    ok('shows the "(as ...)" hint for a former-name match',
       /as Rosehip seed oil/.test(await page.evaluate("document.getElementById('lowdown-review-body').innerText")));
    // Untick Rosehip, apply.
    await page.evaluate("(function(){var b=document.querySelectorAll('#lowdown-review-body input');b.forEach(function(c){if(lowdownPlan[+c.getAttribute('data-k')].ing.name==='Rosehip oil')c.checked=false;});updateLowdownCount();})()");
    ok('the button counts what is ticked', /Add 1 lowdown$/.test(await page.evaluate("document.getElementById('lowdown-apply-btn').textContent")));
    await page.evaluate("applyLowdowns()");
    const lib = await stored(page);
    const f = n => lib.find(i => i.name === n);
    ok('the ticked line is added', f('Shea butter').chooseWhen === starterLine('Shea butter'));
    ok('and marked as a draft', f('Shea butter').chooseWhenDraft === true);
    ok('her purpose note is untouched', f('Shea butter').purpose === 'my own reminder');
    ok('the unticked one is not added', !f('Rosehip oil').chooseWhen);
    ok('her own lowdown is untouched and not a draft', f('Jojoba oil').chooseWhen === 'my own words' && !f('Jojoba oil').chooseWhenDraft);
    await page.evaluate("openLowdownReview()");
    ok('a second pass offers only what is left',
       JSON.stringify(await page.evaluate("lowdownPlan.map(function(p){return p.ing.name;})")) === '["Rosehip oil"]');
    ok('no page errors', errors.length === 0, errors);
    await page.close();
  }

  const DRAFTED = [{ id: 'a', name: 'Shea butter', inci: 'Butyrospermum Parkii (Shea) Butter', phase: 'oil', lots: [],
                     chooseWhen: 'drafted line', chooseWhenDraft: true },
                   { id: 'c', name: 'Jojoba oil', inci: 'Simmondsia Chinensis Seed Oil', phase: 'oil', lots: [],
                     chooseWhen: 'my own words' }];

  console.log('\n3. The draft tag');
  {
    const { page, errors } = await open(DRAFTED);
    await page.evaluate("toggleQuickLook('a')");
    await page.waitForTimeout(150);
    ok('a drafted lowdown shows the draft tag',
       await page.evaluate("!!document.querySelector('.note-edit[data-id=\"a\"][data-field=\"chooseWhen\"] .draft-tag')"));
    await page.evaluate("toggleQuickLook('a'); toggleQuickLook('c')");
    await page.waitForTimeout(150);
    ok('her own lowdown shows none',
       await page.evaluate("!document.querySelector('.note-edit[data-id=\"c\"] .draft-tag')"));
    await page.evaluate("toggleQuickLook('c'); toggleQuickLook('a')");
    await page.waitForTimeout(150);
    await page.evaluate("document.querySelector('.note-edit[data-id=\"a\"][data-field=\"chooseWhen\"] .draft-ok').click()");
    await page.waitForTimeout(100);
    const a = (await stored(page)).find(i => i.id === 'a');
    ok('the tick keeps the line and drops the draft mark', a.chooseWhen === 'drafted line' && !a.chooseWhenDraft, a);
    ok('the tag is gone at once', await page.evaluate("!document.querySelector('.note-edit[data-id=\"a\"] .draft-tag')"));
    ok('the tick did not open the editor', await page.evaluate("!document.querySelector('.note-edit[data-id=\"a\"] textarea')"));
    ok('no page errors', errors.length === 0, errors);
    await page.close();
  }

  console.log('\n4. Editing makes a draft hers; an unrelated save does not');
  {
    const { page } = await open(DRAFTED);
    // Click-to-type edit.
    await page.evaluate("var ing=ingredients.find(function(x){return x.id==='a';}); commitNote(ing,'chooseWhen','drafted line, tweaked',false);");
    let a = (await stored(page)).find(i => i.id === 'a');
    ok('a changed line is no longer a draft', a.chooseWhen === 'drafted line, tweaked' && !a.chooseWhenDraft, a);
    await page.close();
  }
  {
    const { page } = await open(DRAFTED);
    await page.evaluate("var ing=ingredients.find(function(x){return x.id==='a';}); commitNote(ing,'chooseWhen','drafted line',false);");
    ok('re-saving the same text keeps it a draft', (await stored(page)).find(i => i.id === 'a').chooseWhenDraft === true);
    // Full edit form, saved without touching the lowdown.
    await page.evaluate("viewingId='a'; editFromList=true; editCurrent();");
    await page.waitForTimeout(200);
    ok('the edit form shows the draft tag', await page.evaluate("document.getElementById('f-choose-draft').style.display !== 'none'"));
    await page.evaluate("document.getElementById('f-notes').value='changed something else'; saveIngredient();");
    await page.waitForTimeout(200);
    let a = (await stored(page)).find(i => i.id === 'a');
    ok('an unrelated form save keeps the draft', a.chooseWhenDraft === true && a.notes === 'changed something else', a);
    await page.evaluate("viewingId='a'; editFromList=true; editCurrent();");
    await page.waitForTimeout(200);
    await page.evaluate("document.getElementById('f-choose').value='my version'; saveIngredient();");
    await page.waitForTimeout(200);
    a = (await stored(page)).find(i => i.id === 'a');
    ok('changing it in the form makes it hers', a.chooseWhen === 'my version' && !a.chooseWhenDraft, a);
    await page.close();
  }

  console.log('\n5. Quick add brings the lowdown as a draft');
  {
    const { page } = await open([]);
    await page.evaluate("openSeeder()");
    await page.evaluate(`(function(){var k=SEEDER_ITEMS.findIndex(function(i){return i.name==='Argan oil';});seederPicked.add(k);})()`);
    await page.evaluate("seederAdd()");
    await page.waitForTimeout(200);
    const argan = (await stored(page)).find(i => i.name === 'Argan oil');
    ok('the starter lowdown arrives', argan && argan.chooseWhen === starterLine('Argan oil'), argan && argan.chooseWhen);
    ok('marked as a draft', argan && argan.chooseWhenDraft === true);
    await page.close();
  }

  console.log('\n6. The cheat sheet fits, and explains its highlighting');
  {
    const T = (id, name, min, max, phase, ph, heat, subs) => ({ id, name, inci: name, phase, functionCategory: ['Thickener'],
      min, max, optimalPh: ph, heatStability: heat, substitution: subs, lots: [],
      chooseWhen: 'a lowdown long enough to wrap over a few lines so the column takes its full share of the width', purpose: 'a note of my own' });
    const lib = [T('a', 'Xanthan gum', '0.1', '1', 'water', '3-12', 'Good', 'Sclerotium gum, Solagum AX'),
                 T('b', 'Sclerotium gum', '0.5', '2', 'water', '3-12', 'Good', 'Xanthan gum'),
                 T('c', 'Carbomer (Carbopol)', '0.1', '1', 'water', '5-10', 'Good', 'Sodium polyacrylate'),
                 T('d', 'Cetyl alcohol', '1', '5', 'oil', '3-12', 'Excellent', 'Cetearyl alcohol')];
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await trackDialogs(page, []);
    await page.goto(previewUrl('ingredients'));
    await page.waitForTimeout(300);
    await page.evaluate(`localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(lib))});`);
    await page.reload(); await page.waitForTimeout(500);
    await page.evaluate("setIngView('cheat')"); await page.waitForTimeout(300);
    const m = await page.evaluate("(function(){var w=document.querySelector('.cs-table-wrap');return {s:w.scrollWidth,c:w.clientWidth,cols:document.querySelectorAll('.cs-table th').length};})()");
    ok('ten columns including substitutes fit a 1280px screen without side-scrolling', m.cols === 10 && m.s <= m.c, m);
    ok('the highlighting is explained under the table', /differ from most others in this group/.test(await page.evaluate("document.getElementById('cs-body').innerText")));
    ok('highlighted values carry a tooltip', await page.evaluate("!!document.querySelector('.cs-odd[title]')"));
    await page.evaluate("viewIngredient('a')");
    ok('the details page goes back to its usual width', await page.evaluate("!document.body.classList.contains('cs-wide')"));
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
