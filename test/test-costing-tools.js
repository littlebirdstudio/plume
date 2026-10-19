// Products & Costing tools (2026-10-19): the barcode panel's pills, and
// the line sheet (pick products, columns, heading, remembered on the
// device, print and copy).
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const FORMS = [
  { id: 'f1', name: 'Whipped butter', type: 'Body butter', lines: [] },
  { id: 'f2', name: 'Calendula oil', type: 'Face oil', lines: [] }
];
const PRODUCTS = [
  { id: 'w4', name: 'Whip 4 oz', sku: 'W4', barcode: 'W4OZ', status: 'active', formulaId: 'f1', netWtG: 113, netWtDisplay: '4 oz / 113 g', retail: 26, wholesale: 13, packagingRecipe: [] },
  { id: 'w2', name: 'Whip 2 oz', sku: 'W2', status: 'active', formulaId: 'f1', netWtG: 56, retail: 16, wholesale: 8, packagingRecipe: [] },
  { id: 'c30', name: 'Calendula 30 mL', sku: 'C30', status: 'active', formulaId: 'f2', netWtG: 27, netWtDisplay: '1 fl oz / 30 mL', retail: 28, packagingRecipe: [] },
  { id: 'c10', name: 'Calendula 10 mL', sku: 'C10', status: 'draft', formulaId: 'f2', netWtG: 9, retail: 12, wholesale: 6, packagingRecipe: [] },
  { id: 'old', name: 'Old serum', sku: 'OLD', status: 'discontinued', formulaId: 'f2', retail: 18, wholesale: 9, packagingRecipe: [] },
  { id: 'kit', name: 'Duo', sku: 'DUO', status: 'active', productKind: 'multi', components: [], netWtDisplay: '3 mL + 5 mL', retail: 8, wholesale: 2.25, packagingRecipe: [] }
];

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await trackDialogs(page, []);
  await page.goto(previewUrl('costing'));
  await page.waitForTimeout(300);
  await page.evaluate(`
    localStorage.clear();
    localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});
    localStorage.setItem('plume-products-v1', ${JSON.stringify(JSON.stringify(PRODUCTS))});
    localStorage.setItem('plume_costing_listorder_v1', '1');
    localStorage.setItem('plume-theme', 'light');`);
  await page.reload();
  await page.waitForTimeout(500);

  console.log('\n1. Barcode panel');
  await page.evaluate("openBarcode('W4OZ', 'Whip 4 oz')");
  await page.waitForTimeout(200);
  ok('it opens as a panel at the right edge', await page.evaluate(
    "var r=document.querySelector('#m-barcode .modal').getBoundingClientRect(); document.getElementById('m-barcode').classList.contains('open') && Math.round(r.right) === window.innerWidth && r.top === 0"));
  const on = () => page.evaluate("Array.from(document.querySelectorAll('#m-barcode .ps-chip.on')).map(e => e.getAttribute('data-bc-pill') || e.textContent.trim()).join('|')");
  ok('Sticker roll and Code 39 start selected', /mode:roll/.test(await on()) && /fmt:c39/.test(await on()), await on());
  await page.click('[data-bc-pill="fmt:c128"]');
  ok('the Code 128 pill sets the format', (await page.evaluate("bcFormat()")) === 'c128' && /fmt:c128/.test(await on()) && !/fmt:c39/.test(await on()));
  ok('the preview redraws in the new format', /Code 128/.test(await page.evaluate("document.getElementById('bc-meta').textContent")));
  await page.click('[data-bc-pill="mode:sheet"]');
  ok('the Sticker sheet pill switches mode and fields', (await page.evaluate("bcMode()")) === 'sheet' &&
     await page.evaluate("document.getElementById('bc-sheet-fields').style.display === '' && document.getElementById('bc-roll-fields').style.display === 'none'"));
  ok('the print button says what it prints', /Print sheet/.test(await page.evaluate("document.getElementById('bc-btn-print').textContent")));
  ok('one pill per sheet layout', (await page.evaluate("document.querySelectorAll('#bc-preset-pills .ps-chip').length")) === 4);
  await page.click('[data-bc-pill="preset:a5163"]');
  ok('an Avery pill applies its geometry', (await page.evaluate("[document.getElementById('bc-slw').value, document.getElementById('bc-scols').value, document.getElementById('bc-srows').value].join()")) === '4,2,5');
  await page.click('label.bc-tog:has(#bc-scut)');
  ok('a toggle pill flips its checkbox', (await page.evaluate("document.getElementById('bc-scut').checked")) === false);
  await page.click('[data-bc-pill="mode:card"]');
  await page.click('[data-bc-pill="cols:3"]');
  ok('scan-card column pills set the columns', (await page.evaluate("document.getElementById('bc-cols').value")) === '3' && /cols:3/.test(await on()));
  await page.keyboard.press('Escape');
  ok('Escape closes the panel', await page.evaluate("!document.getElementById('m-barcode').classList.contains('open')"));
  await page.evaluate("openProduct('w4')"); await page.waitForTimeout(150);
  await page.evaluate("openBarcodeForProduct()"); await page.waitForTimeout(150);
  ok('opened from a product, it starts on a sticker roll with that product chosen', (await page.evaluate("bcMode()")) === 'roll' &&
     (await page.evaluate("document.getElementById('bc-product').value")) === 'w4' &&
     (await page.evaluate("document.getElementById('bc-value').value")) === 'W4OZ');
  await page.evaluate("closeModal('m-barcode'); leaveEditor()");

  console.log('\n2. Line sheet');
  await page.evaluate("openLineSheet()"); await page.waitForTimeout(200);
  ok('it opens as its own view', await page.evaluate(
    "document.getElementById('view-sheet').style.display === '' && document.getElementById('view-list').style.display === 'none'"));
  const picked = () => page.evaluate("Array.from(document.querySelectorAll('#ls-pick input[data-ls]:checked')).map(e => e.getAttribute('data-ls')).join(',')");
  ok('the first sheet starts with every active product', (await picked()) === 'w4,w2,c30,kit', await picked());
  ok('discontinued products are not offered', (await page.evaluate("document.querySelector('#ls-pick [data-ls=\"old\"]')")) === null);
  ok('a product with no wholesale price says so', /no wholesale price/.test(await page.evaluate(
    "document.querySelector('#ls-pick [data-ls=\"c30\"]').closest('label').textContent")));
  const paper = () => page.evaluate("document.getElementById('ls-paper').innerText");
  ok('the sheet groups by type, in list order', /Body butter[\s\S]*Whip 4 oz[\s\S]*Whip 2 oz[\s\S]*Face oil[\s\S]*Calendula 30 mL[\s\S]*Sample packs & kits[\s\S]*Duo/i.test(await paper()), await paper());
  ok('prices print as money; a missing wholesale price prints "ask"', /\$13\.00[\s\S]*\$26\.00/.test(await paper()) && /Calendula 30 mL[^\n]*\n?[\s\S]*ask/i.test(await paper()));
  ok('the size uses the label line, or grams', /4 oz \/ 113 g/.test(await paper()) && /56 g/.test(await paper()));
  await page.evaluate("document.querySelector('#ls-pick [data-ls=\"c10\"]').click()");
  ok('ticking a draft adds it', /Calendula 10 mL/.test(await paper()));
  await page.evaluate("document.querySelector('#ls-pick label.t').click()");
  ok('a type box unticks the whole type', !/Whip 4 oz/.test(await paper()) && !/Whip 2 oz/.test(await paper()));
  await page.evaluate("lsQuick('wholesale')");
  ok('"Active with a wholesale price" picks only those', (await picked()) === 'w4,w2,kit', await picked());
  await page.evaluate("lsQuick('none')");
  ok('Clear empties the sheet', (await picked()) === '' && /Pick products on the left/.test(await paper()));
  await page.evaluate("lsQuick('active')");
  await page.evaluate("document.querySelector('[data-ls-col=\"sku\"]').click()");
  ok('a column pill removes the column', !/SKU/.test(await page.evaluate("document.querySelector('#ls-paper thead').innerText")));
  await page.evaluate("document.querySelector('[data-ls-col=\"group\"]').click()");
  ok('grouping can be turned off', (await page.evaluate("document.querySelectorAll('#ls-paper tr.g').length")) === 0);
  await page.fill('#ls-from', 'Little Bird Studio');
  await page.fill('#ls-web', 'little-bird-studio.com');
  await page.fill('#ls-to', 'Corner Shop');
  await page.fill('#ls-note', 'Minimum order $150.');
  ok('the heading shows the studio, website, shop and note', /Little Bird Studio · little-bird-studio\.com/.test(await paper()) &&
     /Prepared for Corner Shop/.test(await paper()) && /Minimum order \$150\./.test(await paper()), await paper());

  const tsv = await page.evaluate("lsTableText()");
  ok('Copy as a table is tab-separated with a header row', tsv.split('\n')[0] === 'Product\tSize\tWholesale\tMSRP' &&
     tsv.split('\n')[1] === 'Whip 4 oz\t4 oz / 113 g\t$13.00\t$26.00', tsv);

  const printed = await page.evaluate(`(function () {
    var html = '';
    var w = window.open;
    window.open = function () { return { document: { write: function (h) { html += h; }, close: function () {} } }; };
    printLineSheet();
    window.open = w;
    return html;
  })()`);
  ok('Print opens just the sheet, letter size', /@page \{ size: letter/.test(printed) && /Corner Shop/.test(printed) && !/ls-pick/.test(printed));
  ok('the print carries the sheet styles', /\.lsx th/.test(printed));

  await page.reload(); await page.waitForTimeout(500);
  await page.evaluate("openLineSheet()"); await page.waitForTimeout(150);
  ok('the last sheet is remembered: picks, columns and heading', (await picked()) === 'w4,w2,c30,kit' &&
     (await page.evaluate("document.getElementById('ls-to').value")) === 'Corner Shop' &&
     !/SKU/.test(await page.evaluate("document.querySelector('#ls-paper thead').innerText")));
  ok('it is labelled in the storage report', /Line sheet/.test(await page.evaluate("JSON.stringify(Plume.storageReport().rows)")));
  await page.evaluate("closeLineSheet()");
  ok('the breadcrumb goes back to the list', await page.evaluate(
    "document.getElementById('view-list').style.display === '' && document.getElementById('view-sheet').style.display === 'none'"));
  await ctx.close();

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  phone.on('pageerror', e => errors.push(String(e)));
  await phone.goto(previewUrl('costing'));
  await phone.evaluate(`localStorage.setItem('plume-products-v1', ${JSON.stringify(JSON.stringify(PRODUCTS))});
    localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});`);
  await phone.reload(); await phone.waitForTimeout(400);
  await phone.evaluate("openLineSheet()"); await phone.waitForTimeout(150);
  ok('the line sheet does not scroll sideways on a phone', await phone.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"));
  await phone.evaluate("closeLineSheet(); openBarcode('W4OZ','Whip')"); await phone.waitForTimeout(150);
  ok('nor does the barcode panel', await phone.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"));
  await phone.close();

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
