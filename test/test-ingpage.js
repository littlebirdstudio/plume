// The ingredient page, the tabbed editor, rich text and label marks
// (2026-10-24, v1.43). Her picks from the "Ingredient entry options" canvas:
// the page in sections that say how full they are, empty fields folded into
// one line, each section's Edit opening the editor on its tab; bold, italic
// and lists in the text-heavy fields, saved as plain-text marks; Chelator,
// solubility and recommended usage; certification marks on product labels;
// recommended usage and solubility put to use in Formulations.
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const lot = (id, g, cost, extra) => Object.assign({ id, qtyPurchased: String(g), qtyUnit: 'g', costPerG: cost, supplier: 'Mountain Rose Herbs', lotNum: id.toUpperCase(), received: '2026-08-20' }, extra || {});
const INGS = [
  { id: 'ij', name: 'Jojoba oil', inci: 'Simmondsia Chinensis Seed Oil', phase: 'oil', solubility: 'oil', useRate: '5–30%', min: '1', max: '100', functionCategory: ['Emollient'],
    chooseWhen: '**Very stable** and *never* rancid', notes: 'Light.\n- Holds EOs\n- Warm if solid', generalInfo: 'One two three four five six seven eight nine ten eleven twelve.',
    absorptionRate: 'Medium', colour: 'Golden',
    lots: [lot('j1', 900, 0.038, { organic: true, cosmosCert: true, buyLink: 'https://example.com/jojoba' }), lot('j2', 100, 0.05)] },
  { id: 'ir', name: 'Rosehip seed oil', inci: 'Rosa Canina Seed Oil', phase: 'oil', lots: [lot('r1', 250, 0.088, { organic: true })] },
  { id: 'ie', name: 'Vitamin E', inci: 'Tocopherol', phase: 'oil', lots: [lot('e1', 100, 0.12)] },
  { id: 'ig', name: 'Glycerin', inci: 'Glycerin', phase: 'water', solubility: 'water', solNote: 'Warm to dissolve', useRate: '2–5%', lots: [lot('g1', 500, 0.01, { natural: true })] },
  { id: 'im', name: 'Mystery blend', inci: 'Glycerin, Tocopherol', phase: 'water', lots: [lot('m1', 50, 0.2)] }
];
const V = (vid, lines) => ({ vid, num: 1, label: '', status: 'draft', lines, instructions: '', batchSize: 100, usageLog: [], history: [] });
const oil = [{ ingId: 'ij', pct: 69.5 }, { ingId: 'ir', pct: 30 }, { ingId: 'ie', pct: 0.5 }];
const FORMS = [
  { id: 'fo', name: 'Face oil', type: 'Face oil', status: 'draft', lines: oil, variants: [V('vo', oil)], activeVariantId: 'vo' },
  { id: 'fm', name: 'Mist', type: 'Toner / mist', status: 'draft', lines: [], variants: [V('vm', [])], activeVariantId: 'vm' }
];
const PRODUCTS = [{ id: 'po', name: 'Face oil 30 mL', status: 'active', formulaId: 'fo', netWtG: 27, packagingRecipe: [], productionRuns: [] }];
const SEED = `
  localStorage.clear();
  localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(INGS))});
  localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});
  localStorage.setItem('plume-products-v1', ${JSON.stringify(JSON.stringify(PRODUCTS))});
  localStorage.setItem('plume_costing_listorder_v1', '1');
  localStorage.setItem('plume-theme', 'light');`;
const getIngs = "JSON.parse(localStorage.getItem('aerie-ingredients-v2'))";

(async () => {
  const browser = await chromium.launch();
  const errors = [], dialogs = [];
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await trackDialogs(page, dialogs);
  await page.goto(previewUrl('ingredients')); await page.evaluate(SEED); await page.reload(); await page.waitForTimeout(500);

  console.log('\n1. Rich text, the marks');
  const rt = await page.evaluate(`(function () {
    var h = Plume.rt.toHtml('**Bold** and *it* <script>x</script>\\n- one\\n- two\\nafter');
    var d = document.createElement('div');
    d.innerHTML = '<div>Hello <b>bold</b> and <i>italic</i></div><ul><li>one</li><li><b>two</b></li></ul><div>end<br>line</div>';
    return { h: h, plain: Plume.rt.plain('**B** *i*\\n- x'), back: Plume.rt.fromEl(d) };
  })()`);
  ok('marks become bold, italic and a list; HTML typed in stays text', rt.h === '<strong>Bold</strong> and <em>it</em> &lt;script&gt;x&lt;/script&gt;<ul class="rt-ul"><li>one</li><li>two</li></ul>after', rt.h);
  ok('the words alone, for one-line summaries', rt.plain === 'B i\nx', rt.plain);
  ok('an edited box turns back into marks', rt.back === 'Hello **bold** and *italic*\n- one\n- **two**\nend\nline', rt.back);

  console.log('\n2. The page');
  await page.evaluate("viewIngredient('ij')"); await page.waitForTimeout(250);
  const body = await page.evaluate("document.getElementById('d-body').innerText.replace(/\\s+/g, ' ')");
  ok('At a glance shows usage in one line and solubility', /USAGE Recommended 5–30% · no upper limit/i.test(body) && /SOLUBILITY Oil-soluble/i.test(body), body.slice(0, 400));
  ok('empty fields fold into one line', /Not filled in: substitutes, secondary functions\./.test(body), body);
  ok('Properties says how full it is, and names what is missing (dermal limits now live in the usage note)', /PROPERTIES & CHARACTERISTICS 2 of 9 filled/i.test(body) && /Not filled in: heat stability, melting point, oxidation stability, scent, effective pH range, claims, density/.test(body), body);
  await page.evaluate("viewIngredient('ir')"); await page.waitForTimeout(150);
  await page.evaluate("Array.from(document.querySelectorAll('#d-body .ds-empty button')).filter(function (b) { return b.textContent === 'usage'; })[0].click()"); await page.waitForTimeout(250);
  ok('each missing field links to the tab that holds it, cursor in the field (usage is in Basics)', await page.evaluate("ingTab === 'basics' && document.activeElement && document.activeElement.id === 'f-recmin'"));
  await page.evaluate("closeModal('modal-add')");
  await page.evaluate("Array.from(document.querySelectorAll('#d-body .ds-empty button')).filter(function (b) { return b.textContent === 'claims'; })[0].click()"); await page.waitForTimeout(250);
  ok('a rich field gets the cursor in its box', await page.evaluate("ingTab === 'props' && document.activeElement && document.activeElement.classList.contains('rt-ed')"));
  await page.evaluate("closeModal('modal-add'); viewIngredient('ij')"); await page.waitForTimeout(150);
  ok('Color, not Colour', /COLOR Golden/i.test(body) && !/colour/i.test(body));
  ok('the lowdown and notes show their formatting', await page.evaluate("!!document.querySelector('#d-body .note-edit strong') && document.querySelectorAll('#d-body .notes-box li').length === 2"));
  ok('expanded details show a short preview with Read more', await page.evaluate("document.getElementById('general-info-body').classList.contains('ds-clamp') && document.getElementById('general-info-toggle').textContent === 'Read more'"));
  await page.evaluate("toggleGeneralInfo()");
  ok('which opens the rest', await page.evaluate("document.getElementById('general-info-body').classList.contains('open') && document.getElementById('general-info-toggle').textContent === 'Show less'"));
  ok('empty sections are one line with Add', /RESOURCE LINKS none yet Add/i.test(body) && /SOAP DATA not filled in Add/i.test(body));
  const lots = await page.evaluate("Array.from(document.querySelectorAll('#d-body .lt-row:not(.lt-h)')).map(function (r) { return r.innerText.replace(/\\s+/g, ' '); })");
  ok('lots are a compact table: the active one first-class, with certifications and Reorder', lots.length === 2 && /Mountain Rose Herbs ACTIVE \(DEFAULT\)/i.test(lots[0]) && /ORGANIC COSMOS CERTIFIED/i.test(lots[0]) && /Reorder/.test(lots[0]) && /Set as active/.test(lots[1]), lots);
  await page.evaluate("Array.from(document.querySelectorAll('#d-body .ds-edit')).filter(function (b) { return /props/.test(b.getAttribute('onclick')); })[0].click()"); await page.waitForTimeout(200);
  ok('a section\'s Edit opens the editor on its tab', await page.evaluate("document.getElementById('modal-add').classList.contains('open') && ingTab === 'props' && !document.querySelector('.ed-pane[data-pane=props]').hidden && document.querySelector('.ed-pane[data-pane=basics]').hidden"));

  console.log('\n3. The editor');
  const dots = await page.evaluate("Array.from(document.querySelectorAll('#ed-tabs .ed-tab')).map(function (t) { var d = t.querySelector('.ed-dot'); return t.getAttribute('data-tab') + ':' + (d ? (d.hidden ? '-' : 'dot') : 'x'); }).join(' ')");
  ok('a dot marks each tab with something in it', dots === 'basics:x glance:dot props:dot notes:dot stock:dot soap:-', dots);
  await page.evaluate("setIngTab('soap'); document.getElementById('f-sap-naoh').value = '0.07'; document.getElementById('f-sap-naoh').dispatchEvent(new Event('input', { bubbles: true }))");
  ok('typing in a tab gives it a dot', await page.evaluate("!document.querySelector('#ed-tabs [data-tab=soap] .ed-dot').hidden"));
  ok('Chelator is a function', await page.evaluate("Array.from(document.querySelectorAll('#f-function-cats input')).some(function (b) { return b.value === 'Chelator'; })"));
  ok('solubility and usage load (an older record reads its old fields)', await page.evaluate("document.getElementById('f-solubility').value === 'oil' && document.getElementById('f-recmin').value === '5' && document.getElementById('f-recmax').value === '30' && document.getElementById('f-safe-kind').value === 'none'"));
  ok('the phase list includes Active and Other', await page.evaluate("Array.from(document.getElementById('f-phase').options).map(function (o) { return o.value; }).join() === 'water,oil,cool-down,active,add-in,other'"));
  ok('the text-heavy fields are rich boxes, the hidden field keeping the marks', await page.evaluate("document.getElementById('f-choose').style.display === 'none' && document.querySelectorAll('#modal-add .rt-wrap').length === 5 && !!document.querySelector('#modal-add .rt-wrap .rt-ed strong')"));
  // Bold a word the way the toolbar does, then save.
  await page.evaluate(`(function () {
    setIngTab('notes');
    var ed = document.getElementById('f-notes').nextSibling.querySelector('.rt-ed');
    ed.innerHTML = '<div>Now <b>bolder</b></div><ul><li>a</li></ul>';
    ed.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('f-solubility').value = 'both';
    document.getElementById('f-solnote').value = 'Melt with the oils';
    document.getElementById('f-recmin').value = '10';
    saveIngredient(false);
  })()`); await page.waitForTimeout(250);
  let ij = (await page.evaluate(getIngs)).find(i => i.id === 'ij');
  ok('saving keeps the marks, solubility and recommended usage', ij.notes === 'Now **bolder**\n- a' && ij.solubility === 'both' && ij.solNote === 'Melt with the oils' && ij.usageV2 === true && ij.recMin === '10' && ij.recMax === '30' && ij.safeMax === 'none' && ij.useRate === undefined && ij.min === undefined && ij.usageOld && ij.usageOld.useRate === '5–30%' && ij.soap && ij.soap.naoh === 0.07, ij);
  ok('fields it did not touch keep their marks', ij.chooseWhen === '**Very stable** and *never* rancid', ij.chooseWhen);

  console.log('\n4. Typing straight onto the page');
  await page.evaluate("viewIngredient('ij'); document.querySelector('#d-body .note-edit[data-field=purpose]').click()"); await page.waitForTimeout(150);
  ok('the reminder note opens as a rich box with a list button', await page.evaluate("!!document.querySelector('#d-body .note-edit[data-field=purpose] .rt-wrap') && document.querySelectorAll('#d-body .note-edit[data-field=purpose] .rt-btn').length === 3"));
  await page.evaluate("var ed = document.querySelector('#d-body .note-edit[data-field=purpose] .rt-ed'); ed.innerHTML = 'For the <i>beard</i> oil'; ed.dispatchEvent(new Event('blur'))"); await page.waitForTimeout(200);
  ij = (await page.evaluate(getIngs)).find(i => i.id === 'ij');
  ok('clicking away saves it with its marks', ij.purpose === 'For the *beard* oil', ij.purpose);
  ok('and shows it formatted', await page.evaluate("!!document.querySelector('#d-body .note-edit[data-field=purpose] em')"));

  console.log('\n5. Formulations');
  await page.goto(previewUrl('formulations')); await page.waitForTimeout(400);
  await page.evaluate("openFormula('fm'); addIng('ig')"); await page.waitForTimeout(200);
  // A new line starts blank since the usage review (2026-10-26); the numbers show under the name.
  ok('a new line starts blank', await page.evaluate("fLines[fLines.length - 1].pct === ''"));
  ok('and the line shows the usage, Recommended and the safe limit', /Recommended 2–5% · safe limit not established/.test(await page.evaluate("document.getElementById('phase-groups').innerText")));
  await page.evaluate("addIng('ir')"); await page.waitForTimeout(100);
  ok('an ingredient with no recommendation starts empty', await page.evaluate("fLines[fLines.length - 1].pct === ''"));
  await page.evaluate("fLines[0].phase = 'oil'; renderLines()"); await page.waitForTimeout(100);
  ok('a water-soluble ingredient in the oil phase gets a gentle note', /Water-soluble, but in the oil phase/.test(await page.evaluate("document.getElementById('phase-groups').innerText")));
  await page.evaluate("fLines[0].phase = 'cool-down'; renderLines()");
  ok('the cool-down phase takes either', !/Water-soluble, but/.test(await page.evaluate("document.getElementById('phase-groups').innerText")));
  // Cost per gram came back to the popup 2026-10-25 (her call); suppliers and
  // the recommended % stay out.
  ok('the ingredient popup shows solubility with its note, the effective pH and cost per gram, not suppliers or recommended', await page.evaluate("(function () { showIngDetail('ig'); var t = document.getElementById('id-body').innerText; return /Solubility\\s*Water-soluble\\s*Warm to dissolve/i.test(t) && /Effective pH\\s*--/i.test(t) && /Cost per gram/i.test(t) && !/Suppliers/i.test(t) && !/Recommended/i.test(t) && /Safe limit\\s*Safe limit not established/i.test(t) && !/Caution/.test(t); })()"), await page.evaluate("document.getElementById('id-body').innerText"));
  ok('the ingredient popup shows the formatted lowdown', await page.evaluate("showIngDetail('ij'); !!document.querySelector('strong') && /Very stable/.test(document.body.innerText)"));

  console.log('\n6. Label marks');
  await page.goto(previewUrl('costing')); await page.waitForTimeout(400);
  await page.evaluate("openProduct('po')"); await page.waitForTimeout(250);
  const lab = () => page.evaluate("document.getElementById('label-preview').innerText.replace(/\\s+/g, ' ')");
  ok('every certification is offered, Naturally derived included, none on by default', await page.evaluate("document.querySelectorAll('#lbl-marks input[data-mk]').length === 6 && !document.querySelector('#lbl-marks input:checked') && !!document.querySelector('#lbl-marks input[data-mk=natural]')"));
  ok('with none ticked the list is unmarked', /Simmondsia Chinensis Seed Oil, Rosa Canina Seed Oil, Tocopherol/.test(await lab()) && !/\*/.test(await lab()));
  await page.evaluate("toggleMark('organic', true); toggleMark('cosmosCert', true)"); await page.waitForTimeout(100);
  let l1 = await lab();
  ok('ticked ones mark the ingredients whose lot in use carries them', /Simmondsia Chinensis Seed Oil\*†, Rosa Canina Seed Oil\*, Tocopherol Certified/.test(l1.replace(/\*Certified/g, ' Certified')) || /Simmondsia Chinensis Seed Oil\*†, Rosa Canina Seed Oil\*, Tocopherol/.test(l1), l1);
  ok('with a footnote for each mark used', /\*Certified organic ingredient †COSMOS Certified ingredient/.test(l1), l1);
  await page.evaluate("setMark('organic', 'sym', '°°'); setMark('organic', 'note', 'Organically grown')"); await page.waitForTimeout(50);
  ok('symbol and footnote can be changed', /Rosa Canina Seed Oil°°/.test(await lab()) && /°°Organically grown/.test(await lab()), await lab());
  await page.evaluate("toggleMark('ecocert', true)");
  ok('a ticked certification no ingredient carries adds no footnote', !/Ecocert/.test(await lab()));
  await page.evaluate("document.getElementById('lbl-common').checked = true; renderLabel()");
  ok('common names are marked too', /Jojoba oil°°†, Rosehip seed oil°°, Vitamin E/.test(await lab()), await lab());
  await page.evaluate("saveProduct ? saveProduct() : null"); await page.waitForTimeout(100);
  const saved = await page.evaluate("JSON.parse(localStorage.getItem('plume-products-v1'))[0].labelMarks");
  ok('marks save with the product', saved && saved.length === 3 && saved[0].key === 'organic' && saved[0].sym === '°°', saved);
  ok('activeLot follows the cost cascade', await page.evaluate("Plume.activeLot({ lots: [{ id: 'a', costPerG: 0.5 }, { id: 'b', costPerG: 0.2 }, { id: 'c', referenceOnly: true, costPerG: 0.1 }] }).id === 'b' && Plume.activeLot({ activeLotId: 'a', lots: [{ id: 'a', costPerG: 0.5 }, { id: 'b', costPerG: 0.2 }] }).id === 'a'"));
  ok('a blend component is marked only when every source carries the mark', await page.evaluate("(function () { markUsed = {}; return marksFor([findIng('ig'), findIng('im')], [{ key: 'natural', sym: '°', note: '' }]) === '' && marksFor([findIng('ig')], [{ key: 'natural', sym: '°', note: '' }]) === '°'; })()"));

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
