// Lot codes and the formulation log (2026-10-20, v1.36). The lot is the BATCH: its
// code is the date made as YYMMDD, with a letter only for a second batch
// that day (261020, 261020B). Plume assigns it, she can change it, and no two
// batches may share one. Fills keep a copy of the code. A batch records the
// version it was made from. The formulation log (was the usage log) holds one
// entry per batch, linked by hand, in two sections: Making and How it turned
// out. Trace runs back to supplier lots and forward to fills. A lot sticker
// prints the code as plain text.
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const lot = (id, g, sup, num, rcv, cost) => ({ id: id, qtyPurchased: String(g), qtyUnit: 'g', costPerG: cost || 0.05, supplier: sup, lotNum: num, received: rcv });
const INGS = [
  { id: 'iw', name: 'Distilled water', inci: 'Aqua', phase: 'water', lots: [lot('w1', 5000, 'Grocery', '', '2026-09-01', 0.001)] },
  { id: 'ig', name: 'Glycerin', inci: 'Glycerin', phase: 'water',
    lots: [lot('g1', 6, 'Lotioncrafter', 'LC-2207', '2026-06-02', 0.01), lot('g2', 500, 'Lotioncrafter', 'LC-2291', '2026-09-15', 0.012)] },
  { id: 'io', name: 'Jojoba oil', inci: 'Simmondsia Chinensis Seed Oil', phase: 'oil', lots: [lot('o1', 1000, 'Mountain Rose', 'MR-551', '2026-08-20', 0.04)] }
];
const V = (vid, num, label, lines, extra) => Object.assign({ vid: vid, num: num, label: label, status: 'approved', lines: lines, instructions: '', batchSize: 100,
  usageLog: [], history: [], branchedFrom: null, branchNote: '' }, extra || {});
const F = (id, name, type, variants, active) => {
  const av = variants.filter(v => v.vid === active)[0];
  return { id: id, name: name, type: type, status: av.status, notes: '', instructions: '', lines: av.lines, variants: variants, activeVariantId: active,
    createdAt: '2026-06-01T12:00:00.000Z', updatedAt: '2026-06-01T12:00:00.000Z' };
};
const toner = [{ ingId: 'iw', pct: 90 }, { ingId: 'ig', pct: 10 }];
const FORMS = [
  F('fa', 'Rose toner', 'Toner / mist', [V('va', 1, '', toner, { usageLog: [{ id: 'm1', date: '2026-07-01', batch: '50', version: 'Version 1', notes: 'Hand logged before batches', ph: [{ v: '6.2', m: 'strip', add: '2 drops citric' }, { v: '5.1', m: 'meter' }] },
    { id: 'e2', date: '2026-10-01', batch: '300', version: 'Version 1', batchId: 'b2', lot: '261001B', making: 'Hydrosol from the August still.', notes: '' },
    { id: 'x1', date: '2026-10-19', batch: '120', version: 'Version 1', batchId: 'gone', lot: '261019', notes: 'Sprayed unevenly.' }] })], 'va'),
  F('fb', 'Face oil', 'Face oil', [V('vb1', 1, 'Jojoba', [{ ingId: 'io', pct: 100 }]), V('vb2', 2, 'Squalane sub', [{ ingId: 'io', pct: 100 }], { status: 'testing' })], 'vb1')
];
const B = (o) => Object.assign({ batchType: 'production', status: 'ready', ingredientSnapshot: [], packagingRuns: [], committed: true, lotDraws: [], packagingDraws: [] }, o);
const BATCHES = [
  // Two on one day: made-time order decides which gets the letter.
  B({ id: 'b2', date: '2026-10-01', createdAt: '2026-10-01T15:00:00Z', formulaId: 'fa', formulaName: 'Rose toner', formulaType: 'Toner / mist', batchName: 'Toner, afternoon', actualYield: 300,
      lotDraws: [{ ingredientId: 'iw', ingredientName: 'Distilled water', lotId: 'w1', lotLabel: 'Lot w1', grams: 270 },
                 { ingredientId: 'ig', ingredientName: 'Glycerin', lotId: 'g1', lotLabel: 'LC-2207', grams: 6 },
                 { ingredientId: 'ig', ingredientName: 'Glycerin', lotId: 'g0', lotLabel: 'LC-1999 (rcv 2026-01-01)', grams: 24 }] }),
  B({ id: 'b1', date: '2026-10-01', createdAt: '2026-10-01T09:00:00Z', formulaId: 'fa', formulaName: 'Rose toner', formulaType: 'Toner / mist', batchName: 'Toner, morning', actualYield: 200 }),
  B({ id: 'b0', date: '2026-09-12', formulaId: 'fb', formulaName: 'Face oil', formulaType: 'Face oil', batchName: 'Face oil, September', actualYield: 400 })
];
const PRODUCTS = [
  { id: 'pt', name: 'Rose toner 100 mL', status: 'active', formulaId: 'fa', netWtG: 100, packagingRecipe: [],
    productionRuns: [{ id: 'r1', date: '2026-10-03', units: 2, batchId: 'b2', fill: true, draws: [{ batchId: 'b2', formulaId: 'fa', grams: 200 }], packaging: [] }] },
  { id: 'pk', name: 'Travel kit', status: 'active', productKind: 'kit', kitParts: [{ id: 'kp', productId: 'pt', qty: 1 }], packagingRecipe: [], productionRuns: [] }
];
const SEED = `
  localStorage.clear();
  localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(INGS))});
  localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});
  localStorage.setItem('aerie-packaging-v2', '[]');
  localStorage.setItem('aerie-batches-v1', ${JSON.stringify(JSON.stringify(BATCHES))});
  localStorage.setItem('plume-products-v1', ${JSON.stringify(JSON.stringify(PRODUCTS))});
  localStorage.setItem('plume_costing_listorder_v1', '1');
  localStorage.setItem('plume-theme', 'light');`;

(async () => {
  const browser = await chromium.launch();
  const errors = [], dialogs = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await trackDialogs(page, dialogs);
  const stored = (k) => page.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(k)}))`);
  const batch = async (id) => (await stored('aerie-batches-v1')).filter(b => b.id === id)[0];
  const today = await (async () => { await page.goto(previewUrl('batchlog')); return page.evaluate('Plume.todayISO()'); })();
  const todayLot = today.slice(2, 4) + today.slice(5, 7) + today.slice(8, 10);

  console.log('\n1. Core rules');
  ok('the code is the date as YYMMDD', await page.evaluate("Plume.lotBase('2026-10-20') === '261020' && Plume.lotBase('') === ''"));
  ok('a second batch that day gets B, a third C', await page.evaluate(`
    Plume.nextLotCode('2026-10-20', [], []) === '261020' &&
    Plume.nextLotCode('2026-10-20', [{ id: 'x', lotCode: '261020' }], []) === '261020B' &&
    Plume.nextLotCode('2026-10-20', [{ id: 'x', lotCode: '261020' }, { id: 'y', lotCode: '261020b' }], []) === '261020C'`));
  ok('a code kept on a fill from a deleted batch is not given out again', await page.evaluate(`
    Plume.nextLotCode('2026-10-20', [], [{ productionRuns: [{ draws: [{ batchId: 'gone', lot: '261020' }] }] }]) === '261020B'`));
  ok('a code is stored in capitals without spaces', await page.evaluate("Plume.lotCheck(' 261020 b ', [], null).code === '261020B' && !Plume.lotCheck('261020b', [], null).error"));
  const dup = await page.evaluate("Plume.lotCheck('261020', [{ id: 'x', lotCode: '261020', batchName: 'Toner, morning', date: '2026-10-20' }], 'y')");
  ok('two batches cannot share a code, and the message names the other one', /already Toner, morning \(Oct 20, 2026\)/.test(dup.error || ''), dup);
  ok('a batch keeps its own code when edited', await page.evaluate("!Plume.lotCheck('261020', [{ id: 'x', lotCode: '261020' }], 'x').error"));
  ok('blank or odd characters are refused', await page.evaluate("!!Plume.lotCheck('', [], null).error && !!Plume.lotCheck('26/10', [], null).error && !!Plume.lotCheck('A'.repeat(21), [], null).error"));
  const mig = await page.evaluate(`(function () {
    var bs = [{ id: 'l', date: '2026-10-01', createdAt: '2026-10-01T15:00Z', formulaId: 'one' }, { id: 'e', date: '2026-10-01', createdAt: '2026-10-01T09:00Z', formulaId: 'two' },
              { id: 'k', date: '2026-10-01', lotCode: '261001', formulaId: 'two' }];
    var fs = [{ id: 'one', variants: [{ vid: 'v1', num: 1, label: '' }] }, { id: 'two', variants: [{ vid: 'a', num: 1 }, { vid: 'b', num: 2 }] }];
    var first = Plume.migrateBatches(bs, fs, []), again = Plume.migrateBatches(bs, fs, []);
    return { codes: bs.map(function (b) { return b.id + ':' + b.lotCode; }).join(' '), ver: bs[0].variantId + '/' + bs[0].variantLabel, none: bs[1].variantId || '', first: first, again: again };
  })()`);
  ok('older batches get codes in made-time order, around one that has a code', mig.codes === 'l:261001C e:261001B k:261001', mig);
  ok('a formulation with one version fills in the version; with two it stays unrecorded', mig.ver === 'v1/Version 1' && mig.none === '', mig);
  ok('running it again changes nothing', mig.first === true && mig.again === false, mig);
  ok('a fill keeps each batch\'s code, read live while the batch exists', await page.evaluate(`(function () {
    var bs = [{ id: 'b', lotCode: '261020' }], p = { id: 'p', productionRuns: [] };
    var r = Plume.makeFill(p, { units: 1, draws: [{ batchId: 'b', formulaId: 'f', grams: 5 }] }, [], bs);
    var kept = r.draws[0].lot === '261020';
    bs[0].lotCode = '261020X';
    return kept && Plume.drawLot(r.draws[0], bs) === '261020X' && Plume.drawLot(r.draws[0], []) === '261020';
  })()`));

  console.log('\n2. Batches: codes for what is already there');
  await page.evaluate(SEED); await page.reload(); await page.waitForTimeout(500);
  ok('the earlier of two batches that day gets the plain code, the later one B', (await batch('b1')).lotCode === '261001' && (await batch('b2')).lotCode === '261001B' && (await batch('b0')).lotCode === '260912');
  ok('versions: one version is filled in, two stay unrecorded', (await batch('b2')).variantLabel === 'Version 1' && !(await batch('b0')).variantId);
  ok('the list shows each lot code under the date', await page.evaluate("Array.from(document.querySelectorAll('#tbody tr.bl-row .bl-date .ps-lot')).map(x => x.innerText.replace(/\\s+/g, '')).sort().join(',')") === 'LOT260912,LOT261001,LOT261001B');
  await page.fill('#search', '261001b'); await page.waitForTimeout(150);
  ok('search finds a batch by its lot code', await page.evaluate("Array.from(document.querySelectorAll('#tbody tr.bl-row')).map(r => r.innerText).join('|')").then(t => /Toner, afternoon/.test(t) && !/morning/.test(t)));
  await page.fill('#search', ''); await page.waitForTimeout(100);

  console.log('\n3. Making a batch');
  await page.evaluate("openNewBatch()"); await page.waitForTimeout(200);
  ok('the lot code starts as today\'s', await page.inputValue('#f-lot') === todayLot, await page.inputValue('#f-lot'));
  await page.fill('#f-date', '2026-10-01'); await page.dispatchEvent('#f-date', 'change');
  ok('a different date gives that day\'s next free code', await page.inputValue('#f-lot') === '261001C', await page.inputValue('#f-lot'));
  await page.fill('#f-lot', '261001'); await page.waitForTimeout(100);
  ok('typing a code already in use says so', /already Toner, morning/.test(await page.evaluate("document.getElementById('f-lot-err').textContent")));
  await page.fill('#f-date', '2026-10-05'); await page.dispatchEvent('#f-date', 'change');
  ok('once typed, the code no longer follows the date', await page.inputValue('#f-lot') === '261001');
  await page.selectOption('#f-formula', 'fb'); await page.waitForTimeout(150);
  ok('the hint names the version it will make', /makes Jojoba, the version in use/.test(await page.evaluate("document.getElementById('formula-hint').textContent")));
  await page.fill('#f-yield', '250'); await page.evaluate("recalcPreview()");
  const before = (await stored('aerie-batches-v1')).length;
  await page.evaluate("saveBatch()"); await page.waitForTimeout(200);
  ok('a duplicate code stops Make it', (await stored('aerie-batches-v1')).length === before && await page.evaluate("document.getElementById('m-new').classList.contains('open')"));
  await page.fill('#f-lot', 'fo-261005'); await page.evaluate("saveBatch()"); await page.waitForTimeout(300);
  const nb = (await stored('aerie-batches-v1')).filter(b => b.formulaId === 'fb' && b.date === '2026-10-05')[0] || {};
  ok('her own code is saved, in capitals', nb.lotCode === 'FO-261005', nb.lotCode);
  ok('the batch records the version it was made from', nb.variantId === 'vb1' && nb.variantLabel === 'Jojoba', [nb.variantId, nb.variantLabel]);
  const fbS = (await stored('aerie-formulations-v1')).filter(f => f.id === 'fb')[0];
  ok('making a batch writes nothing in the formulation log (she links entries herself)', !(fbS.variants[0].usageLog || []).length && !(fbS.variants[1].usageLog || []).length && !nb.journalId);

  console.log('\n4. A batch: header, lot code, trace');
  await page.evaluate(`openBatchDetail(${JSON.stringify(nb.id)})`); await page.waitForTimeout(300);
  const meta = await page.evaluate("document.getElementById('d-meta').innerText.replace(/\\s+/g, ' ')");
  ok('the header shows the lot code and the version', /LOT ?FO-261005/.test(meta) && /Jojoba/.test(meta), meta);
  const wl = await page.evaluate("[document.getElementById('d-log').innerText.trim(), document.getElementById('d-log').getAttribute('href')]");
  ok('with no entry yet, Write a log entry starts one on its version with this batch', wl[0] === 'Write a log entry' && wl[1] === 'plume-formulations.html#f=fb&v=vb1&b=' + encodeURIComponent(nb.id), wl);
  ok('the lot sticker is closed until asked for', await page.evaluate("document.getElementById('d-sticker').hidden"));
  await page.click('#d-lot-sticker'); await page.waitForTimeout(150);
  ok('Lot sticker opens it right in the batch, with the code and the formulation', await page.evaluate("!document.getElementById('d-sticker').hidden && /LOT FO-261005/.test(document.querySelector('#d-st-prev svg').textContent)") &&
     await page.inputValue('#d-st-line2') === 'Face oil');
  await page.fill('#d-st-w', '2'); await page.dispatchEvent('#d-st-w', 'input');
  ok('the size is remembered on this device', await page.evaluate("JSON.parse(localStorage.getItem('plume-lot-sticker')).w === 2"));
  const printed = await page.evaluate(`(function () {
    var html = '', w = { document: { write: function (h) { html += h; }, close: function () {} } };
    var orig = window.open; window.open = function () { return w; };
    document.getElementById('d-st-copies').value = '3'; printBatchSticker(); window.open = orig;
    return { n: (html.match(/class="lbl"/g) || []).length, page: /@page \{ size: 2in 0\.5in/.test(html), code: /LOT FO-261005/.test(html) };
  })()`);
  ok('Print stickers prints one sticker per page at that size', printed.n === 3 && printed.page && printed.code, printed);
  await page.evaluate("toggleSticker(false)");
  await page.evaluate("closeDetail()"); await page.waitForTimeout(250);
  await page.evaluate("openBatchDetail('b0')"); await page.waitForTimeout(300);
  ok('an older batch says its version was not recorded; its log link names no version', /version not recorded/.test(await page.evaluate("document.getElementById('d-meta').innerText")) &&
     await page.evaluate("document.getElementById('d-log').getAttribute('href')") === 'plume-formulations.html#f=fb&b=b0');
  await page.fill('#d-lot', '261001'); await page.waitForTimeout(100);
  await page.evaluate("saveBatchEdits()"); await page.waitForTimeout(200);
  ok('editing to a code in use does not save', (await batch('b0')).lotCode === '260912' && /already/.test(await page.evaluate("document.getElementById('d-lot-err').textContent")));
  await page.fill('#d-lot', '260912-a'); await page.fill('#d-date', '2026-09-13');
  await page.evaluate("saveBatchEdits()"); await page.waitForTimeout(200);
  ok('a free code saves, and changing the date leaves it alone', (await batch('b0')).lotCode === '260912-A' && (await batch('b0')).date === '2026-09-13');
  await page.evaluate("closeDetail()"); await page.waitForTimeout(250);
  await page.evaluate("openBatchDetail('b2'); setBatchTab('trace')"); await page.waitForTimeout(300);
  const tr = await page.evaluate("document.getElementById('d-trace').innerText.replace(/\\s+/g, ' ')");
  ok('the fourth tab is Trace', (await page.evaluate("document.getElementById('bt-trace').innerText")).trim() === 'Trace' && await page.evaluate("!document.getElementById('bp-trace').hidden"));
  ok('back: each supplier lot with supplier, lot number and date received', /Glycerin Lotioncrafter LC-2207 received Jun 2, 2026 6 g/.test(tr) && /Distilled water Grocery no lot number/.test(tr), tr);
  ok('a lot deleted since keeps the label the batch recorded', /lot since deleted LC-1999/.test(tr), tr);
  ok('it says the record is first-in-first-out, not what was on the bench', /first-in-first-out/.test(tr) && /mixed lots/.test(tr));
  ok('forward: the fills from it, and the kits those products go into', /Rose toner 100 mL 2 200 g/.test(tr) && /Travel kit/.test(tr) && /may hold this lot/.test(tr), tr);
  ok('the Ingredients tab points to Trace instead of its old fold-out', await page.evaluate("!document.getElementById('d-trace-pointer').hidden && !document.getElementById('d-receipt')"));
  ok('a batch with an entry links to it as Log entry', await page.evaluate("[document.getElementById('d-log').innerText.trim(), document.getElementById('d-log').getAttribute('href')].join(' ')") === 'Log entry plume-formulations.html#f=fa&v=va&j=e2');
  await page.evaluate("setBatchTab('runs')"); await page.waitForTimeout(100);
  ok('the Filled tab shows the lot beside bulk left', /LOT ?261001B/.test(await page.evaluate("document.querySelector('#d-fills .bulk-card').innerText.replace(/\\s+/g, '')")));
  dialogs.length = 0;
  await page.evaluate("window.PLUME_TEST_ANSWER = false; deleteBatch(); window.PLUME_TEST_ANSWER = undefined;"); await page.waitForTimeout(150);
  ok('deleting says fills keep the lot code, and the log entry stays', /keeps lot code 261001B/.test(dialogs.join(' ')) && /log entry stays/.test(dialogs.join(' ')), dialogs);
  await page.evaluate("closeDetail()"); await page.waitForTimeout(250);
  await page.evaluate(`openBatchDetail(${JSON.stringify(nb.id)})`); await page.waitForTimeout(250);
  dialogs.length = 0;
  await page.evaluate("window.PLUME_TEST_ANSWER = false; deleteBatch(); window.PLUME_TEST_ANSWER = undefined;"); await page.waitForTimeout(150);
  ok('a batch with no entry says nothing about one', dialogs.length === 1 && !/log entry/.test(dialogs[0]), dialogs);
  await page.evaluate("closeDetail()"); await page.waitForTimeout(250);

  console.log('\n5. Formulations: the formulation log');
  const fbLog = async () => (await stored('aerie-formulations-v1')).filter(f => f.id === 'fb')[0].variants[0].usageLog || [];
  await page.goto(previewUrl('formulations') + '#f=fb&v=vb1&b=' + encodeURIComponent(nb.id)); await page.waitForTimeout(1000);
  ok('the tabs read Instructions, Formulation log, Change history', await page.evaluate("['et-method','et-log','et-hist'].map(function(i){return document.getElementById(i).innerText.replace(/\\d+$/,'').trim();}).join(' | ')") === 'Instructions | Formulation log | Change history');
  ok('Write a log entry opens a new entry with that batch chosen', await page.evaluate("document.getElementById('m-use').classList.contains('open') && document.getElementById('et-log').classList.contains('on')") &&
     await page.inputValue('#ul-bsel') === nb.id);
  ok('the batch stands in for date and size', await page.evaluate("document.getElementById('ul-own').hidden && /FO-261005/.test(document.getElementById('ul-linked').innerText) && /250 g/.test(document.getElementById('ul-linked').innerText)"));
  ok('the batches offered are this version\'s, plus older ones with no version, then Not tied to a batch',
     await page.evaluate("Array.from(document.getElementById('ul-bsel').options).map(o => o.value).join(',')") === nb.id + ',b0,');
  ok('two sections: Making and How it turned out', await page.evaluate("Array.from(document.querySelectorAll('#m-use .ul-sec-h')).map(h => h.firstChild.textContent.trim()).join('|')") === 'Making|How it turned out');
  ok('an oil has no pH readings to fill in', await page.evaluate("document.getElementById('ul-ph-wrap').style.display === 'none'"));
  await page.evaluate("saveUseEntry()"); await page.waitForTimeout(150);
  ok('an empty entry is not saved, and the form says why', !(await fbLog()).length && /Write something/.test(await page.evaluate("document.getElementById('ul-err').textContent")));
  await page.fill('#ul-making', 'Warmed the jojoba to 40 C first.');
  await page.evaluate("saveUseEntry()"); await page.waitForTimeout(200);
  let e1 = (await fbLog())[0] || {};
  ok('a linked entry takes the batch\'s lot, date and size', e1.batchId === nb.id && e1.lot === 'FO-261005' && e1.date === '2026-10-05' && e1.batch === '250' && e1.making === 'Warmed the jojoba to 40 C first.' && !e1.notes, e1);
  const ent = await page.evaluate(`document.getElementById('je-${e1.id}').innerText.replace(/\\s+/g, ' ')`);
  ok('it shows the lot, the batch, and Making, with a way to add how it turned out', /LOT ?FO-261005/.test(ent) && /Production batch · 250 g/.test(ent) && /Making Warmed the jojoba/i.test(ent) && /\+ How it turned out/.test(ent), ent);
  ok('the lot links to the batch', await page.evaluate(`document.querySelector('#je-${e1.id} a.ps-lot').getAttribute('href')`) === 'plume-batchlog.html#b=' + encodeURIComponent(nb.id));
  await page.evaluate("openUsage()"); await page.waitForTimeout(150);
  ok('a new entry starts on the newest batch without one', await page.inputValue('#ul-bsel') === 'b0');
  ok('and marks the batch that has one', await page.evaluate(`document.querySelector('#ul-bsel option[value="${nb.id}"]').textContent`).then(t => /has an entry/.test(t)));
  await page.selectOption('#ul-bsel', nb.id); await page.waitForTimeout(200);
  ok('picking a batch that has an entry opens that entry instead', await page.inputValue('#ul-id') === e1.id && await page.inputValue('#ul-making') === 'Warmed the jojoba to 40 C first.');
  await page.fill('#ul-notes', 'Absorbs fast. Try 2% squalane next time.');
  await page.evaluate("saveUseEntry()"); await page.waitForTimeout(200);
  e1 = (await fbLog())[0];
  ok('later notes go on the same entry, and it is not doubled', (await fbLog()).length === 1 && e1.notes === 'Absorbs fast. Try 2% squalane next time.' && e1.making === 'Warmed the jojoba to 40 C first.', await fbLog());
  ok('both sections show', /Making Warmed.*How it turned out Absorbs fast/i.test(await page.evaluate(`document.getElementById('je-${e1.id}').innerText.replace(/\\s+/g, ' ')`)));
  await page.evaluate("openUsage()"); await page.waitForTimeout(150);
  await page.evaluate(`document.getElementById('ul-bsel').value = ${JSON.stringify(nb.id)};`);
  await page.fill('#ul-notes', 'A second note'); await page.evaluate("saveUseEntry()"); await page.waitForTimeout(150);
  ok('saving a second entry for a batch is refused', (await fbLog()).length === 1 && /already has a log entry/.test(await page.evaluate("document.getElementById('ul-err').textContent")));
  await page.evaluate("closeModal('m-use')");
  await page.goto(previewUrl('formulations') + '#f=fb&v=vb1&j=' + encodeURIComponent(e1.id)); await page.waitForTimeout(1000);
  ok('a Log entry link opens it picked out', await page.evaluate(`!!document.querySelector('#je-${e1.id}.hl') && document.getElementById('et-log').classList.contains('on')`));
  await page.goto(previewUrl('formulations') + '#f=fb&b=' + encodeURIComponent(nb.id)); await page.waitForTimeout(1000);
  ok('Write a log entry for a batch that has one meanwhile opens that one', await page.evaluate("document.getElementById('m-use').classList.contains('open')") && await page.inputValue('#ul-id') === e1.id);
  await page.evaluate("closeModal('m-use'); openFormula('fa'); setEdTab('log')"); await page.waitForTimeout(250);
  const m1t = await page.evaluate("document.getElementById('je-m1').innerText.replace(/\\s+/g, ' ')");
  ok('an older entry shows its readings under Making and its notes under How it turned out', /Jul 1, 2026 50g/.test(m1t) && /Making pH 6\.2/i.test(m1t) && /How it turned out Hand logged/i.test(m1t), m1t);
  await page.evaluate("openUsage('m1')"); await page.waitForTimeout(100);
  ok('editing it keeps it untied, with its date, size and readings', await page.inputValue('#ul-bsel') === '' && await page.evaluate("!document.getElementById('ul-own').hidden && document.getElementById('ul-date').value === '2026-07-01' && document.getElementById('ul-batch').value === '50'") &&
     await page.evaluate("Array.from(document.querySelectorAll('#ul-ph-steps .ph-step')).map(r => r.querySelector('.ph-v').value + '/' + r.querySelector('.ph-m').value + '/' + r.querySelector('.ph-a').value).join(' ')") === '6.2/strip/2 drops citric 5.1/meter/');
  await page.fill('#ul-date', '2026-07-02'); await page.evaluate("saveUseEntry()"); await page.waitForTimeout(150);
  const faLog = async () => (await stored('aerie-formulations-v1')).filter(f => f.id === 'fa')[0].variants[0].usageLog;
  const m1 = (await faLog()).filter(e => e.id === 'm1')[0];
  ok('and saves them, readings kept', m1.date === '2026-07-02' && m1.ph.length === 2 && m1.ph[1].v === '5.1' && m1.ph[0].add === '2 drops citric' && !m1.batchId, m1);
  const x1t = await page.evaluate("document.getElementById('je-x1').innerText.replace(/\\s+/g, ' ')");
  ok('an entry for a deleted batch keeps its lot and says so', /LOT ?261019/.test(x1t) && /batch deleted/.test(x1t), x1t);
  await page.evaluate("openUsage('x1')"); await page.waitForTimeout(100);
  ok('editing it keeps the link to the deleted batch', await page.inputValue('#ul-bsel') === 'gone' && /deleted/.test(await page.evaluate("document.getElementById('ul-linked').innerText")));
  await page.evaluate("closeModal('m-use'); openUsage()"); await page.waitForTimeout(100);
  await page.selectOption('#ul-bsel', ''); await page.waitForTimeout(100);
  ok('Not tied to a batch asks for a date and size', await page.evaluate("!document.getElementById('ul-own').hidden"));
  await page.fill('#ul-notes', 'Scent faded by week 3.'); await page.evaluate("saveUseEntry()"); await page.waitForTimeout(150);
  ok('and saves an entry with no batch', (await faLog()).some(e => e.notes === 'Scent faded by week 3.' && !e.batchId));

  console.log('\n6. Products & Costing: fills and the lot sticker');
  await page.goto(previewUrl('costing')); await page.waitForTimeout(500);
  await page.evaluate("openProduct('pt'); setEdTab('runs')"); await page.waitForTimeout(250);
  ok('the fill list shows the lot, linked to the batch', await page.evaluate("(document.querySelector('#runs-list .rr-batch a.ps-lot') || {}).getAttribute ? document.querySelector('#runs-list .rr-batch a.ps-lot').getAttribute('href') : ''") === 'plume-batchlog.html#b=b2');
  await page.fill('#run-units', '1'); await page.evaluate("fillTakes()");
  await page.evaluate("addRun()"); await page.waitForTimeout(300);
  const runs = (await stored('plume-products-v1')).filter(p => p.id === 'pt')[0].productionRuns;
  const newest = runs[runs.length - 1];
  ok('a new fill keeps its batch\'s lot code', newest.draws && newest.draws[0] && /^2610/.test(newest.draws[0].lot || ''), newest.draws);
  await page.evaluate(`(function () {
    var bs = JSON.parse(localStorage.getItem('aerie-batches-v1')).filter(function (b) { return b.id !== 'b2'; });
    localStorage.setItem('aerie-batches-v1', JSON.stringify(bs));
  })()`);
  await page.reload(); await page.waitForTimeout(500);
  await page.evaluate("openProduct('pt'); setEdTab('runs')"); await page.waitForTimeout(250);
  const rl = await page.evaluate("document.getElementById('runs-list').innerText.replace(/\\s+/g, ' ')");
  ok('a fill from a deleted batch still shows its lot', /LOT ?261001B batch deleted/.test(rl), rl);
  await page.goto(previewUrl('costing') + '#lot=b1'); await page.waitForTimeout(1000);
  ok('#lot= opens the panel on Lot sticker', await page.evaluate("document.getElementById('m-barcode').classList.contains('open') && bcMode() === 'lot' && document.querySelector('[data-bc-pill=\"mode:lot\"]').classList.contains('on')"));
  ok('with the batch\'s code and formulation filled in', await page.inputValue('#bc-lot-code') === '261001' && await page.inputValue('#bc-lot-line2') === 'Rose toner');
  ok('the preview is plain text, no bars', await page.evaluate("/LOT 261001/.test(document.querySelector('#bc-preview svg').textContent) && !document.querySelector('#bc-preview svg rect')"));
  ok('barcode format is hidden, and the button prints lot stickers', await page.evaluate("document.getElementById('bc-fmt-grp').style.display === 'none' && /Print lot stickers/.test(document.getElementById('bc-btn-print').innerText)"));
  await page.fill('#bc-lot-code', 'zz99'); await page.waitForTimeout(100);
  ok('a code no batch has is flagged', /No batch has this lot code/.test(await page.evaluate("document.getElementById('bc-meta').innerText")));
  await page.evaluate("bcPill('mode','roll')"); await page.waitForTimeout(100);
  ok('back on Sticker roll, the barcode fields return', await page.evaluate("document.getElementById('bc-fmt-grp').style.display === '' && document.getElementById('bc-lot-fields').style.display === 'none'"));
  await page.setViewportSize({ width: 390, height: 800 }); await page.evaluate("bcPill('mode','lot')"); await page.waitForTimeout(150);
  ok('the lot fields fit a phone', await page.evaluate("document.getElementById('bc-lot-fields').scrollWidth <= document.getElementById('bc-lot-fields').clientWidth + 1"));

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
