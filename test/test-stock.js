// Stock solutions (2026-10-21, v1.40). A stock solution (her 1% hyaluronic
// acid solution) is a formulation of type 'Stock solution', made as a batch
// and used as an ingredient in other formulations. The ingredient it makes
// carries madeBy: <formulation id>, linked from the formulation's Stock
// solution panel. Each batch adds a lot to that ingredient, priced from what
// went into it and coded with the batch's lot code, so a toner's trace runs
// back through the stock to the supplier lots. Labels and the effective pH
// check open the stock into its parts.
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const lot = (id, g, sup, num, rcv, cost) => ({ id, qtyPurchased: String(g), qtyUnit: 'g', costPerG: cost, supplier: sup, lotNum: num, received: rcv });
const INGS = [
  { id: 'iw', name: 'Distilled water', inci: 'Aqua', phase: 'water', lots: [lot('w1', 5000, 'Grocery', '', '2026-09-01', 0.0005)] },
  { id: 'ia', name: 'Sodium hyaluronate', inci: 'Sodium Hyaluronate', phase: 'cool-down', lots: [lot('a1', 20, 'MakingCosmetics', 'MC-1', '2026-07-30', 1)] },
  { id: 'iop', name: 'Optiphen Plus', inci: 'Phenoxyethanol (and) Caprylyl Glycol (and) Sorbic Acid', phase: 'cool-down', functionCategory: ['Preservative'], optimalPh: '4 – 6', lots: [lot('o1', 100, 'Lotioncrafter', 'LC-9', '2026-08-01', 0.1)] },
  { id: 'ig', name: 'Glycerin', inci: 'Glycerin', phase: 'water', lots: [lot('g1', 500, 'Lotioncrafter', 'LC-2', '2026-08-01', 0.01)] },
  { id: 'ih', name: 'Fireweed hydrosol', inci: 'Chamerion Angustifolium Flower Water', phase: 'water', noCost: true, lots: [lot('h1', 2000, 'Little Bird Studio', 'D-1', '2026-08-14', 0)] },
  // Her existing in-house solution, marked free before stock solutions existed.
  { id: 'iold', name: 'HA solution (old)', inci: 'Aqua, Sodium Hyaluronate', phase: 'cool-down', noCost: true, lots: [] }
];
const V = (vid, lines, extra) => Object.assign({ vid, num: 1, label: '', status: 'draft', lines, instructions: '', batchSize: 100, usageLog: [], history: [] }, extra || {});
const F = (id, name, type, lines, extra) => Object.assign({ id, name, type, status: 'draft', lines, variants: [V('v' + id, lines, extra)], activeVariantId: 'v' + id }, extra || {});
const STOCK = [{ ingId: 'iw', pct: 98 }, { ingId: 'ia', pct: 1 }, { ingId: 'iop', pct: 1 }];
const TONER = [{ ingId: 'ih', pct: 87.5 }, { ingId: 'ix', pct: 10 }, { ingId: 'ig', pct: 1.5 }, { ingId: 'iop', pct: 1 }];
const FORMS = [
  F('fs', 'HA 1% stock', 'Stock solution', STOCK),
  F('ft', 'Calming toner', 'Toner / mist', TONER, { phMin: '5.5', phMax: '6.5' })
];
const SEED = (ings, forms, batches) => `
  localStorage.clear();
  localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(ings))});
  localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(forms))});
  localStorage.setItem('aerie-batches-v1', ${JSON.stringify(JSON.stringify(batches || []))});
  localStorage.setItem('plume-products-v1', '[]');
  localStorage.setItem('plume-theme', 'light');`;
const getIngs = "JSON.parse(localStorage.getItem('aerie-ingredients-v2'))";
const getBatches = "JSON.parse(localStorage.getItem('aerie-batches-v1'))";

(async () => {
  const browser = await chromium.launch();
  const errors = [], dialogs = [];
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await trackDialogs(page, dialogs);

  console.log('\n1. The parts of a stock');
  await page.goto(previewUrl('formulations'));
  const core = await page.evaluate(`(function () {
    var ings = [{ id: 'w', name: 'Water', inci: 'Aqua' }, { id: 'a', name: 'HA', inci: 'Sodium Hyaluronate' }, { id: 'p', name: 'Pres', inci: 'Phenoxyethanol' },
                { id: 's', name: 'Stock', inci: 'x', madeBy: 'fs' }, { id: 'g', name: 'Glycerin', inci: 'Glycerin' }, { id: 'loop', name: 'Loop', inci: 'L', madeBy: 'fl' }];
    var forms = [{ id: 'fs', type: 'Stock solution', lines: [{ ingId: 'w', pct: 49 }, { ingId: 'a', pct: 0.5 }, { ingId: 'p', pct: 0.5 }] },
                 { id: 'fl', type: 'Stock solution', lines: [{ ingId: 'loop', pct: 50 }, { ingId: 'g', pct: 50 }] }];
    var parts = Plume.stockParts(forms[0]).map(function (p) { return p.ingId + p.pct; }).join(' ');
    var opened = Plume.stockExpand([{ ingId: 's', w: 10 }], ings, forms).map(function (e) { return e.ingId + ':' + e.w.toFixed(2) + ':' + (e.via && e.via.id); }).join(' ');
    var lbl = Plume.stockLabelItems([{ ingId: 'g', w: 80 }, { ingId: 's', w: 10 }, { ingId: 'w', w: 9 }, { ingId: 'p', w: 1 }], ings, forms)
      .map(function (e) { return e.inci + ' ' + e.w.toFixed(2); }).join(', ');
    var plain = Plume.stockLabelItems([{ ingId: 'p', w: 1 }, { ingId: 'g', w: 80 }], ings, forms).map(function (e) { return e.inci; }).join(', ');
    var loop = Plume.stockExpand([{ ingId: 'loop', w: 100 }], ings, forms).map(function (e) { return e.ingId + ':' + e.w; }).join(' ');
    var notStock = Plume.stockFormFor({ madeBy: 'fs' }, [{ id: 'fs', type: 'Face oil', lines: [] }]);
    return { parts: parts, opened: opened, lbl: lbl, plain: plain, loop: loop, notStock: notStock };
  })()`);
  ok('a stock is made of its lines, as shares of 100', core.parts === 'w98 a1 p1', core.parts);
  ok('10% of the stock opens into its parts at their real share', core.opened === 'w:9.80:s a:0.10:s p:0.10:s', core.opened);
  ok('on a label, water from the stock and water on its own add up, and the list re-sorts', core.lbl === 'Glycerin 80.00, Aqua 18.80, Phenoxyethanol 1.10, Sodium Hyaluronate 0.10', core.lbl);
  ok('a formula with no stock solution keeps its order exactly', core.plain === 'Phenoxyethanol, Glycerin', core.plain);
  ok('a stock that contains itself stops instead of looping', /g:/.test(core.loop) && /loop:/.test(core.loop), core.loop);
  ok('an ingredient whose formulation is no longer a stock solution is just an ingredient', core.notStock === null);
  const cpg = await page.evaluate(`[
    Plume.costPerG({ madeBy: 'fs', noCost: true, lots: [] }),
    Plume.costPerG({ madeBy: 'fs', activeLotId: 'm', lots: [{ id: 'm', costPerG: '', madeCost: 0 }] }),
    Plume.costPerG({ noCost: true, lots: [] })
  ]`);
  ok('a stock is never free by the switch; free only when its batch cost nothing', cpg[0] === null && cpg[1] === 0 && cpg[2] === 0, cpg);

  console.log('\n2. Formulations: the Stock solution panel');
  await page.evaluate(SEED(INGS, FORMS)); await page.reload(); await page.waitForTimeout(500);
  ok('Stock solution is a type', await page.evaluate("Plume.PRODUCT_TYPES.indexOf('Stock solution') !== -1"));
  await page.evaluate("openFormula('ft')"); await page.waitForTimeout(300);
  ok('the panel stays hidden for a toner', await page.evaluate("document.getElementById('sb-stock').style.display === 'none'"));
  await page.evaluate("openFormula('fs')"); await page.waitForTimeout(300);
  ok('it shows for a stock solution: the first batch creates its ingredient, or link one', await page.evaluate("document.getElementById('sb-stock').style.display !== 'none' && /Its first batch creates HA 1% stock in Ingredients/.test(document.getElementById('stock-panel').innerText) && !!document.getElementById('stock-link-sel')"));
  await page.evaluate("linkStockIng('iold')"); await page.waitForTimeout(300);
  ok('linking one she already has', await page.evaluate(getIngs + ".filter(function (i) { return i.id === 'iold'; })[0].madeBy === 'fs'"));
  ok('the panel then names it', /Each batch adds stock to\s+HA solution \(old\)/.test(await page.evaluate("document.getElementById('stock-panel').innerText")));
  await page.evaluate("unlinkStock()"); await page.waitForTimeout(300);
  ok('Unlink asks, says the next batch would create a new one, then takes the link off', /Unlink HA solution \(old\)/.test(dialogs.join(' ')) && /the next one creates a new ingredient/.test(dialogs.join(' ')) &&
     (await page.evaluate(getIngs + ".filter(function (i) { return i.madeBy === 'fs'; }).length")) === 0);

  console.log('\n3. Batches: the first batch of a stock');
  await page.goto(previewUrl('batchlog')); await page.waitForTimeout(500);
  await page.evaluate("openNewBatch(); document.getElementById('f-formula').value = 'fs'; onFormulaChange(); document.getElementById('f-yield').value = '200'; document.getElementById('f-date').value = '2026-10-12'; onNewDate(); recalcPreview();");
  await page.waitForTimeout(200);
  ok('New batch says the first batch creates the ingredient', /first batch\. Making it creates HA 1% stock in Ingredients/.test(await page.evaluate("document.getElementById('new-stock-note').innerText")));
  await page.evaluate("saveBatch()"); await page.waitForTimeout(300);
  let ings = await page.evaluate(getIngs);
  let made = ings.filter(i => i.madeBy === 'fs');
  ok('making it creates the ingredient, linked, named for it, with INCI read off its parts', made.length === 1 && made[0].name === 'HA 1% stock' &&
     made[0].inci === 'Aqua, Sodium Hyaluronate, Phenoxyethanol, Caprylyl Glycol, Sorbic Acid' && made[0].phase === 'water', made);
  const stockId = made[0].id;
  let st = made[0], sl = st.lots[0];
  let bs = await page.evaluate(getBatches);
  const sb = bs[0];
  // 196 g water at 0.0005 + 2 g HA at 1 + 2 g Optiphen at 0.1 = 2.298, over 200 g.
  ok('and its first lot: 200 g, the lot code and date, priced from the draws', st.lots.length === 1 && sl.qtyPurchased === '200' && sl.lotNum === '261012' && sl.received === '2026-10-12' &&
     Math.abs(parseFloat(sl.costPerG) - 0.01149) < 0.00001 && sl.supplier === 'Made in-house' && sl.madeBatchId === sb.id, sl);
  ok('which prices it', st.activeLotId === sl.id);
  ok('the batch records its lot', sb.madeIngId === stockId && sb.madeLotId === sl.id);
  ok('the powder went down', Math.abs(parseFloat(ings.find(i => i.id === 'ia').lots[0].qtyPurchased) - 18) < 0.01);
  await page.evaluate(`openBatchDetail('${sb.id}')`); await page.waitForTimeout(300);
  const mn = await page.evaluate("document.getElementById('d-made').innerText");
  ok('its details say it created the ingredient, what it added and what is left', /This batch created HA 1% stock in Ingredients and added 200 g to it as lot 261012, at \$0\.0115 per gram\. 200 g left\./.test(mn), mn);
  await page.evaluate("closeDetail()");
  // A second batch adds to the same ingredient; deleting it (unused) hands the price back.
  await page.evaluate("openNewBatch(); document.getElementById('f-formula').value = 'fs'; onFormulaChange();");
  ok('the next batch says it adds to that ingredient', /Making it adds the yield to HA 1% stock/.test(await page.evaluate("document.getElementById('new-stock-note').innerText")));
  await page.evaluate("document.getElementById('f-yield').value = '100'; recalcPreview(); saveBatch();"); await page.waitForTimeout(300);
  ings = await page.evaluate(getIngs); made = ings.filter(i => i.madeBy === 'fs');
  bs = await page.evaluate(getBatches);
  ok('it adds a second lot to the same ingredient, which now prices it', made.length === 1 && made[0].lots.length === 2 && made[0].activeLotId === bs[1].madeLotId);
  await page.evaluate(`openBatchDetail('${bs[1].id}')`); await page.evaluate("deleteBatch()"); await page.waitForTimeout(300);
  ings = await page.evaluate(getIngs); st = ings.find(i => i.id === stockId);
  ok('deleting it takes its lot out and the first batch prices it again', st.lots.length === 1 && st.activeLotId === sl.id);

  console.log('\n4. Formulations: a toner using the stock');
  // The toner's 10% line becomes the new stock ingredient.
  await page.goto(previewUrl('formulations')); await page.waitForTimeout(300);
  await page.evaluate(`(function () { var fs = JSON.parse(localStorage.getItem('aerie-formulations-v1'));
    fs.forEach(function (f) { if (f.id !== 'ft') return; [f.lines, f.variants[0].lines].forEach(function (ls) { ls[1].ingId = '${stockId}'; }); });
    localStorage.setItem('aerie-formulations-v1', JSON.stringify(fs)); })()`);
  await page.reload(); await page.waitForTimeout(400);
  await page.evaluate("openFormula('ft')"); await page.waitForTimeout(300);
  const partsLine = await page.evaluate("Array.from(document.querySelectorAll('.stock-parts')).map(function (e) { return e.innerText; }).join('|')");
  ok('its line says what it puts into this formula', /Distilled water 9\.80% · Sodium hyaluronate 0\.10% · Optiphen Plus 0\.10%/.test(partsLine), partsLine);
  const inci = await page.evaluate("Array.from(document.querySelectorAll('#inci-panel .inci-item')).map(function (e) { return e.innerText.replace(/^\\d+\\.\\s*/, ''); }).join(', ')");
  ok('the INCI list opens the stock: Optiphen adds up to 1.1% and sits above the 0.1% hyaluronate', inci === 'Chamerion Angustifolium Flower Water, Aqua, Glycerin, Phenoxyethanol, Caprylyl Glycol, Sorbic Acid, Sodium Hyaluronate', inci);
  ok('Copy copies the same list', await page.evaluate("curInciNames.join(', ')") === inci);
  const phw = await page.evaluate("document.getElementById('ph-range-warn').innerText");
  ok('the effective pH check still names Optiphen Plus', /above where Optiphen Plus is effective/.test(phw), phw);
  ok('the stock is priced from its batch', /\$/.test(await page.evaluate("document.getElementById('cost-panel').innerText")) && !/Not counted/.test(await page.evaluate("document.getElementById('cost-panel').innerText")));
  const miss = await page.evaluate("(function () { ings.push({ id: 'tmp', name: 'Unmade stock', madeBy: 'fs', lots: [] }); var h = costMissingNote([{ ingId: 'tmp' }]); ings.pop(); return h; })()");
  ok('a stock with no priced batch is not counted, and the note says why', /Unmade stock<\/a> \(a stock solution, priced by its batches; none priced yet\)/.test(miss), miss);

  console.log('\n5. Batches: a toner made with it, and the trace');
  await page.goto(previewUrl('batchlog')); await page.waitForTimeout(400);
  await page.evaluate("openNewBatch(); document.getElementById('f-formula').value = 'ft'; onFormulaChange(); document.getElementById('f-yield').value = '300'; document.getElementById('f-date').value = '2026-10-16'; onNewDate(); recalcPreview(); saveBatch();");
  await page.waitForTimeout(300);
  bs = await page.evaluate(getBatches);
  const tb = bs[1];
  ings = await page.evaluate(getIngs); st = ings.find(i => i.id === stockId);
  ok('the toner drew 30 g from the stock lot', tb.lotDraws.some(d => d.lotId === sb.madeLotId && d.grams === 30) && st.lots[0].qtyPurchased === '170', tb.lotDraws);
  await page.evaluate(`openBatchDetail('${tb.id}'); setBatchTab('trace')`); await page.waitForTimeout(300);
  const tr = await page.evaluate("document.getElementById('d-trace').innerText.replace(/\\s+/g, ' ')");
  ok('its trace names the stock\'s lot and when it was made', /HA 1% stock Made in-house LOT ?261012 made Oct 12, 2026 30 g/.test(tr), tr);
  ok('and, under it, the stock\'s own supplier lots, scaled to the 30 g used', /Sodium hyaluronate MakingCosmetics MC-1 0\.3 g/.test(tr) && /Optiphen Plus Lotioncrafter LC-9 0\.3 g/.test(tr) && /Distilled water Grocery no lot number 29\.4 g/.test(tr), tr);
  await page.evaluate("document.querySelector('#d-trace a.ps-lot').click()"); await page.waitForTimeout(300);
  ok('the lot code opens the stock batch', await page.evaluate(`editingBatchId === '${sb.id}'`));
  await page.evaluate("setBatchTab('trace')");
  const fw = await page.evaluate("document.getElementById('d-trace').innerText.replace(/\\s+/g, ' ')");
  ok('the stock batch lists where it was used', /Used in batches made with this stock .*LOT ?\S+ Calming toner .*30 g/.test(fw), fw);
  ok('and its details count what was used', /170 g left; 30 g used/.test(await page.evaluate("document.getElementById('d-made').innerText")));

  console.log('\n6. Batches: edits, decommit and delete');
  dialogs.length = 0;
  await page.evaluate("deleteBatch()"); await page.waitForTimeout(200);
  ok('a used stock batch cannot be deleted, and says which batch holds it', /This batch cannot be deleted yet/.test(dialogs.join(' ')) && /Calming toner/.test(dialogs.join(' ')) && (await page.evaluate(getBatches)).length === 2, dialogs);
  dialogs.length = 0;
  await page.evaluate("decommitBatch(false)"); await page.waitForTimeout(200);
  ok('nor decommitted', /This batch cannot be decommitted yet/.test(dialogs.join(' ')) && (await page.evaluate(getBatches))[0].committed === true);
  dialogs.length = 0;
  await page.evaluate("document.getElementById('d-yield').value = '20'; detDirty(); saveBatchEdits();"); await page.waitForTimeout(200);
  ok('its yield cannot drop below what was used', /The yield cannot go that low/.test(dialogs.join(' ')) && (await page.evaluate(getBatches))[0].actualYield === 200, dialogs);
  await page.evaluate("document.getElementById('d-yield').value = '190'; document.getElementById('d-lot').value = '261012X'; detDirty(); saveBatchEdits();"); await page.waitForTimeout(200);
  ings = await page.evaluate(getIngs); sl = ings.find(i => i.id === stockId).lots[0];
  ok('a lower yield takes the difference off what is left, and reprices it', sl.qtyPurchased === '160' && sl.madeG === 190 && Math.abs(parseFloat(sl.costPerG) - 2.298 / 190) < 0.00001, sl);
  ok('a new lot code follows to the lot', sl.lotNum === '261012X');
  // Undo the toner, then the stock can go, and its lot with it.
  await page.evaluate(`closeDetail(); openBatchDetail('${tb.id}')`); await page.evaluate("deleteBatch()"); await page.waitForTimeout(300);
  ings = await page.evaluate(getIngs);
  ok('deleting the toner returns its 30 g to the stock lot', ings.find(i => i.id === stockId).lots[0].qtyPurchased === '190');
  await page.evaluate(`openBatchDetail('${sb.id}')`); dialogs.length = 0;
  await page.evaluate("deleteBatch()"); await page.waitForTimeout(300);
  ings = await page.evaluate(getIngs); st = ings.find(i => i.id === stockId);
  ok('the delete message mentions the lot', /Its lot of HA 1% stock \(190 g\) comes out of Ingredients/.test(dialogs.join(' ')), dialogs);
  ok('unused, the stock batch deletes, its lot comes out and nothing prices it', (await page.evaluate(getBatches)).length === 0 && st.lots.length === 0 && !st.activeLotId);
  ok('the ingredient stays, linked, for the next batch', st.madeBy === 'fs');
  ok('and the powder is back', Math.abs(parseFloat(ings.find(i => i.id === 'ia').lots[0].qtyPurchased) - 20) < 0.01);

  console.log('\n7. A stock batch made before stock solutions');
  // Made as a plain batch: committed, its draws recorded, no lot added anywhere.
  const B0 = { id: 'b0', date: '2026-09-20', lotCode: '260920', formulaId: 'fs', formulaName: 'HA 1% stock', formulaType: 'Stock solution', batchName: 'HA stock', actualYield: 100, targetYield: 100,
    status: 'ready', batchType: 'production', committed: true, packagingRuns: [], packagingDraws: [],
    ingredientSnapshot: [{ ingredientId: 'iw', ingredientName: 'Distilled water', grams: 98 }, { ingredientId: 'ia', ingredientName: 'Sodium hyaluronate', grams: 1 }, { ingredientId: 'iop', ingredientName: 'Optiphen Plus', grams: 1 }],
    lotDraws: [{ ingredientId: 'iw', ingredientName: 'Distilled water', lotId: 'w1', grams: 98 }, { ingredientId: 'ia', ingredientName: 'Sodium hyaluronate', lotId: 'a1', grams: 1 }, { ingredientId: 'iop', ingredientName: 'Optiphen Plus', lotId: 'o1', grams: 1 }] };
  await page.evaluate(SEED(INGS, FORMS, [B0])); await page.reload(); await page.waitForTimeout(400);
  await page.evaluate("openBatchDetail('b0')"); await page.waitForTimeout(200);
  ok('unlinked, its details offer to add it to Ingredients, creating the ingredient', /Add 100 g to Ingredients/.test(await page.evaluate("document.getElementById('d-made').innerText")) &&
     /This creates HA 1% stock/.test(await page.evaluate("document.getElementById('d-made').innerText")));
  // She links her old solution in Formulations (another window) first.
  await page.evaluate(`(function () { var l = ${getIngs}; l.forEach(function (i) { if (i.id === 'iold') i.madeBy = 'fs'; }); localStorage.setItem('aerie-ingredients-v2', JSON.stringify(l)); })()`);
  await page.evaluate("closeDetail(); openBatchDetail('b0')"); await page.waitForTimeout(200);
  ok('linked, they offer to add it to that one', /has not added stock to HA solution \(old\)/.test(await page.evaluate("document.getElementById('d-made').innerText")));
  await page.evaluate("addMadeLotNow()"); await page.waitForTimeout(200);
  ings = await page.evaluate(getIngs); const old = ings.find(i => i.id === 'iold');
  ok('it adds the lot, creates nothing new, and the old free switch no longer prices it at $0', old.lots.length === 1 && old.lots[0].qtyPurchased === '100' &&
     ings.filter(i => i.madeBy === 'fs').length === 1 && (await page.evaluate("Plume.costPerG(" + getIngs + ".filter(function (i) { return i.id === 'iold'; })[0])")) > 0, old.lots);
  bs = [B0];

  console.log('\n8. Ingredients');
  await page.goto(previewUrl('ingredients')); await page.waitForTimeout(500);
  await page.evaluate("viewIngredient('iold')"); await page.waitForTimeout(300);
  const view = await page.evaluate("document.body.innerText.replace(/\\s+/g, ' ')");
  ok('its details say it is made from the stock solution', /Made in-house from HA 1% stock, a stock solution/.test(view));
  ok('and each lot names the batch that made it', /Made in-house in batch LOT ?\d{6}/.test(view), view.slice(0, 0));
  await page.evaluate("editCurrent()"); await page.waitForTimeout(300);
  ok('the editor shows the link and hides the $0 switch', await page.evaluate("!document.getElementById('f-madefrom').hidden && document.getElementById('f-nocost-row').style.display === 'none'"));
  await page.evaluate("saveIngredient()"); await page.waitForTimeout(300);
  ok('saving the ingredient keeps the lot\'s link to its batch', await page.evaluate(getIngs + ".filter(function (i) { return i.id === 'iold'; })[0].lots[0].madeBatchId") === bs[0].id);

  console.log('\n9. Products & Costing: the label');
  const forms2 = FORMS.map(f => JSON.parse(JSON.stringify(f)));
  forms2[1].lines[1].ingId = 'iold'; forms2[1].variants[0].lines[1].ingId = 'iold';
  await page.evaluate(`localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(forms2))});
    localStorage.setItem('plume-products-v1', JSON.stringify([{ id: 'p1', name: 'Toner 60 mL', status: 'active', formulaId: 'ft', netWtG: 60, packagingRecipe: [], productionRuns: [] }]));`);
  await page.goto(previewUrl('costing')); await page.waitForTimeout(500);
  const label = await page.evaluate("singleFormulaIngredients(findForm('ft'), 'inci')");
  ok('the product label lists the stock as its parts, in order', label === 'Chamerion Angustifolium Flower Water, Aqua, Glycerin, Phenoxyethanol, Caprylyl Glycol, Sorbic Acid, Sodium Hyaluronate', label);
  const common = await page.evaluate("singleFormulaIngredients(findForm('ft'), 'common')");
  ok('so does the common-name list', common === 'Fireweed hydrosol, Distilled water, Glycerin, Optiphen Plus, Sodium hyaluronate', common);

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
