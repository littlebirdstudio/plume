// Packaging additions (her asks, 2026-11-04):
//   1. Vial with cap, its own kind beside Bottle with cap.
//   2. Caps, pumps and tops bought on their own: a group of their own
//      (Screw cap, Cap / closure, Pump top, Spray top, Dropper top, Orifice
//      reducer), next to the bottles. Cap / closure moved there from
//      "Caps and other".
//   3. Extras included with products (reusable wipes and cloths, spatulas,
//      cards, other): stocked and costed like packaging, listed with a
//      product's packaging, taken from stock by each fill.
//   4. Kinds fold up in the Packaging list, remembered on this device; a
//      search shows every match.
const { chromium } = require('playwright');
const { previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}
const P = (id, kind, cap, color, material, qty, cost, extra) => Object.assign({ id, kind, capacity: cap, color, material, supplier: 'SKS Bottle',
  purchases: qty ? [{ date: '2026-10-01', qty: String(qty), totalCost: String(cost) }] : [], adjustments: [] }, extra || {});
const items = [
  P('d1', 'dropper', '1 oz', 'Amber', 'Glass', 24, 18), P('d2', 'dropper', '2 oz', 'Blue', 'Glass', 12, 12),
  P('v1', 'vial', '5 ml', 'Clear', 'Glass', 30, 9), P('s1', 'screwcap', '20-410', 'Black', 'Plastic', 50, 6),
  P('c1', 'cap', '24 mm', 'White', 'Plastic', 10, 2), P('pt', 'pumpTop', '24-410', 'White', 'Plastic', 24, 12),
  P('r1', 'reducer', '18 mm', 'Clear', 'Plastic', 100, 5), P('w1', 'cloth', '8 × 8 in', 'White', 'Bamboo', 20, 30),
  { id: 'old', name: 'Gold lids (old)', type: 'closure', purchases: [], adjustments: [] }
];

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await trackDialogs(page, []);
  await page.goto(previewUrl('packaging'));
  await page.evaluate((it) => { localStorage.clear(); localStorage.setItem('aerie-packaging-v2', JSON.stringify(it)); }, items);
  await page.goto(previewUrl('packaging')); await page.waitForTimeout(500);

  console.log('\n1-3. The kinds and groups');
  const k = await page.evaluate(`(function(){var g=function(x){var k=Plume.pkKind(x);return k?k.group:null;};
    return { vial:g('vial'), vialLabel:(Plume.pkKind('vial')||{}).label, bottle:(Plume.pkKind('bottle')||{}).label,
      closures:['screwcap','cap','pumpTop','sprayTop','dropperTop','reducer'].map(g), extras:['cloth','spatula','insert','extra'].map(g),
      other:g('other'), groups:Plume.PK_GROUPS.map(function(x){return x.key;}),
      types:['screwcap','cloth','other','vial'].map(Plume.pkTypeFor),
      extraIsOther:Plume.pkIsOther('extra'), clothColored:Plume.pkColored('cloth'), reducerColored:Plume.pkColored('reducer') }; })()`);
  ok('Vial with cap is its own kind among the bottles, and Bottle with cap stays', k.vial === 'bottles' && k.vialLabel === 'Vial with cap' && k.bottle === 'Bottle with cap');
  ok('caps, pumps and tops have a group of their own', k.closures.every((x) => x === 'closures'), k.closures);
  ok('extras have a group of their own', k.extras.every((x) => x === 'extras'), k.extras);
  ok('caps and tops sit next to the bottles; Other comes last', JSON.stringify(k.groups) === JSON.stringify(['bottles', 'closures', 'boxes', 'labels', 'bands', 'extras', 'other']), k.groups);
  ok('types for the rest of the app: closure, extra, other, container', JSON.stringify(k.types) === JSON.stringify(['closure', 'extra', 'other', 'container']), k.types);
  ok('Other extra asks for a name, like Other', k.extraIsOther);
  ok('caps and extras take a color and material', k.clothColored && k.reducerColored);
  const guess = await page.evaluate("['Black screw cap 20-410','Orifice reducer 18mm','5 ml glass vial','Bamboo wipes','Wooden spatula','Gold lids'].map(function(n){return Plume.pkGuess(n).kind;})");
  ok('old names are read into the new kinds', JSON.stringify(guess) === JSON.stringify(['screwcap', 'reducer', 'vial', 'cloth', 'spatula', 'cap']), guess);
  ok('an extra of any kind asks a name when unknown', await page.evaluate("Plume.pkGuess('Thank-you note').kind === 'other' && Plume.pkGuess('Thank-you note').other === 'Thank-you note'"));

  console.log('\nThe list');
  const heads = await page.evaluate("Array.prototype.map.call(document.querySelectorAll('tr.pk-g'),function(r){return r.querySelector('.gn').textContent+'|'+r.querySelector('.type-badge').textContent;})");
  ok('in order: bottles, then caps and tops, then extras, then old items', JSON.stringify(heads) === JSON.stringify(['Dropper bottle|Container', 'Vial with cap|Container', 'Screw cap|Cap / top', 'Cap / closure|Cap / top', 'Pump top|Cap / top', 'Orifice reducer|Cap / top', 'Reusable wipe / cloth|Extra', 'Needs sorting|Not sorted yet']), heads);
  const chips = await page.evaluate("Array.prototype.map.call(document.querySelectorAll('#pk-chips .ps-chip'),function(c){return c.textContent;})");
  ok('a chip for each group present', chips.indexOf('Caps, pumps and tops') !== -1 && chips.indexOf('Extras included with products') !== -1, chips);
  await page.evaluate("Array.prototype.find.call(document.querySelectorAll('#pk-chips .ps-chip'),function(c){return c.textContent==='Extras included with products';}).click()");
  ok('and the Extras chip shows only extras', JSON.stringify(await page.evaluate("Array.prototype.map.call(document.querySelectorAll('tr.pk-g .gn'),function(e){return e.textContent;})")) === JSON.stringify(['Reusable wipe / cloth']));
  await page.evaluate("Array.prototype.find.call(document.querySelectorAll('#pk-chips .ps-chip'),function(c){return c.textContent==='All';}).click()");

  console.log('\n4. Folding');
  const rows = () => page.evaluate("document.querySelectorAll('tr.pk-row').length");
  const all = await rows();
  await page.click('tr.pk-g[data-g="bottles|Dropper bottle"]');
  ok('clicking a kind closes it', (await rows()) === all - 2 && await page.evaluate("document.querySelector('tr.pk-g[data-g=\"bottles|Dropper bottle\"]').getAttribute('aria-expanded') === 'false'"));
  ok('a closed kind shows its count and stock', /2 items · 36 in stock/.test(await page.evaluate("document.querySelector('tr.pk-g[data-g=\"bottles|Dropper bottle\"] .gc').textContent")));
  await page.reload(); await page.waitForTimeout(400);
  ok('and stays closed after a reload', (await rows()) === all - 2);
  await page.fill('#search', 'amber');
  await page.dispatchEvent('#search', 'input'); await page.waitForTimeout(100);
  ok('a search shows matches in closed kinds', (await rows()) === 1 && await page.evaluate("document.getElementById('pk-fold-all').hidden"));
  await page.fill('#search', ''); await page.dispatchEvent('#search', 'input');
  await page.focus('tr.pk-g[data-g="bottles|Dropper bottle"]'); await page.keyboard.press('Enter');
  ok('Enter on a heading opens it again', (await rows()) === all);
  await page.click('#pk-fold-all');
  ok('Close all closes every kind', (await rows()) === 0 && (await page.evaluate("document.getElementById('pk-fold-all').textContent")) === 'Open all');
  await page.click('#pk-fold-all');
  ok('Open all opens them', (await rows()) === all && (await page.evaluate("document.getElementById('pk-fold-all').textContent")) === 'Close all');

  console.log('\nThe edit panel');
  await page.evaluate("openAdd()"); await page.waitForTimeout(200);
  const secs = await page.evaluate("Array.prototype.map.call(document.querySelectorAll('#e-kinds .kind-sec'),function(e){return e.textContent;})");
  ok('the kind picker shows the new groups', secs.indexOf('Caps, pumps and tops') === 1 && secs.indexOf('Extras included with products') !== -1, secs);
  await page.evaluate("setKind('screwcap')");
  ok('a cap asks for its neck size', /20-410/.test(await page.evaluate("document.getElementById('f-capacity').placeholder")));
  await page.evaluate("setKind('cloth')");
  const mats = await page.evaluate("document.getElementById('sugg-material').innerText");
  ok('an extra suggests fabric materials', /Cotton/.test(mats) && /Bamboo/.test(mats), mats);
  await page.fill('#f-capacity', '6 × 6 in'); await page.fill('#f-color', 'Natural'); await page.fill('#f-material', 'Cotton');
  await page.evaluate("saveItem()"); await page.waitForTimeout(300);
  const saved = await page.evaluate("JSON.parse(localStorage.getItem('aerie-packaging-v2')).filter(function(i){return i.capacity==='6 × 6 in';})[0]");
  ok('saved as an extra, with type and display name for older readers', saved && saved.kind === 'cloth' && saved.type === 'extra' && saved.name === 'Reusable wipe / cloth · 6 × 6 in · Natural cotton', saved);

  console.log('\nExtras in a product cost and a fill');
  const cost = await page.evaluate(`(function(){
    var p = { id:'p', name:'Face oil', netWtG:0, packagingRecipe:[{packagingId:'d1',quantity:'1'},{packagingId:'w1',quantity:'1'},{packagingId:'r1',quantity:'1'}] };
    return { cost: Plume.productCostParts(p, { pkgs: JSON.parse(localStorage.getItem('aerie-packaging-v2')), forms: [], ings: [], products: [] }).pkg,
             needs: Plume.fillPkgNeeds(p, 3) };
  })()`);
  ok('a product\'s packaging cost counts its wipe and reducer', Math.abs(cost.cost - (0.75 + 1.5 + 0.05)) < 1e-9, cost);
  ok('and a fill of three takes three of each from stock', cost.needs.length === 3 && cost.needs.every((n) => n.quantity === 3) && cost.needs.some((n) => n.packagingId === 'w1'), cost.needs);

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
