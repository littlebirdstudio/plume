// Ingredient search ordering: the best match first, so typing the first
// letters of a name puts that name at the top.
//
// The bug this guards (2026-10-16): the Ingredients list sorted every match
// alphabetically, whatever matched, so typing "na" opened on Activated
// charcoal because "natural" appeared in its notes. Formulations ranked name
// above notes but treated "contains" the same as "starts with".
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');
const { ROOT, previewUrl } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const INGS = [
  { id: 's1', name: 'Activated charcoal', inci: 'Charcoal Powder', phase: 'other',
    functionCategory: ['Other'], function: 'detoxifying, natural colourant' },
  { id: 's2', name: 'Bakuchiol', inci: 'Bakuchiol', phase: 'oil',
    functionCategory: ['Active'], function: 'natural retinol alternative' },
  { id: 's3', name: 'Hemp seed oil', inci: 'Cannabis Sativa Seed Oil', phase: 'oil',
    functionCategory: ['Emollient'], function: 'light, dry oil' },
  { id: 's4', name: 'Niacinamide', inci: 'Niacinamide', phase: 'water',
    functionCategory: ['Active'], function: 'vitamin B3' },
  { id: 's5', name: 'Natural vitamin E', inci: 'Tocopherol', phase: 'oil',
    functionCategory: ['Antioxidant'], function: 'slows rancidity' },
  { id: 's6', name: 'Neem oil', inci: 'Melia Azadirachta Seed Oil', phase: 'oil',
    functionCategory: ['Emollient'], function: 'strong scent' },
  { id: 's7', name: 'Shea butter', inci: 'Butyrospermum Parkii (Shea) Butter', phase: 'oil',
    functionCategory: ['Emollient'], function: 'rich butter' },
  { id: 's8', name: 'Sodium lactate', inci: 'Sodium Lactate', phase: 'water',
    functionCategory: ['Humectant'], function: 'hardens soap' },
  { id: 's9', name: 'Jojoba oil', inci: 'Simmondsia Chinensis Seed Oil', phase: 'oil',
    functionCategory: ['Emollient'], function: 'wax ester',
    lots: [{ id: 'l9', supplier: 'Naturally Thinking', qtyPurchased: 100, qtyUnit: 'g' }] }
];
const FORMS = [{ id: 'f1', name: 'Test serum', type: 'Facial serum', lines: [],
  variants: [{ vid: 'v1', num: 1, label: '', status: 'draft', lines: [] }], activeVariantId: 'v1' }];

// ── 1. The rank itself, straight from core ──────────────────────
const core = fs.readFileSync(path.join(ROOT, 'plume-core.js'), 'utf8');
const sandbox = { window: {}, document: { documentElement: { style: { setProperty() {} } } },
                  localStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 } };
vm.createContext(sandbox);
vm.runInContext(core, sandbox);
const P = sandbox.Plume;
const byId = id => INGS.find(i => i.id === id);
const r = (id, q) => P.ingMatchRank(byId(id), q);

console.log('\n1. How good a match is');
ok('a name starting with the query is best (1)', r('s5', 'na') === 1, r('s5', 'na'));
ok('case and surrounding spaces do not matter', r('s5', '  NA ') === 1);
ok('a later word of the name is next (2)', r('s3', 'seed') === 2, r('s3', 'seed'));
ok('a word of the INCI is next (3)', r('s7', 'parkii') === 3, r('s7', 'parkii'));
ok('a word inside parentheses counts as a word start', r('s7', 'shea) b') === 3 && r('s1', 'powder') === 3,
   [r('s7', 'shea) b'), r('s1', 'powder')]);
ok('mid-word in the name or INCI is next (4)', r('s4', 'na') === 4 && r('s3', 'na') === 4,
   [r('s4', 'na'), r('s3', 'na')]);
ok('notes and functions come last (5)', r('s1', 'na') === 5 && r('s2', 'nat') === 5,
   [r('s1', 'na'), r('s2', 'nat')]);
ok('no match is 0, so it still reads as false', r('s8', 'zzz') === 0);
ok('an empty query matches nothing', r('s5', '') === 0 && r('s5', '   ') === 0);
ok('a missing ingredient matches nothing', P.ingMatchRank(null, 'na') === 0);
ok('a bare-string functionCategory still matches',
   P.ingMatchRank({ name: 'X', functionCategory: 'Thickener' }, 'thick') === 5);

const NA_ORDER = ['Natural vitamin E', 'Hemp seed oil', 'Niacinamide', 'Activated charcoal', 'Bakuchiol'];

(async () => {
  const browser = await chromium.launch();
  const SEED = `
    localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(INGS))});
    localStorage.setItem('aerie-formulations-v1', ${JSON.stringify(JSON.stringify(FORMS))});
    localStorage.setItem('plume-products-v1', '[]');
    localStorage.setItem('aerie-batches-v1', '[]');`;
  async function open(module) {
    const page = await browser.newPage();
    page.on('dialog', d => d.accept());
    await page.goto(previewUrl(module));
    await page.waitForTimeout(300);
    await page.evaluate(SEED);
    await page.reload();
    await page.waitForTimeout(500);
    return page;
  }

  console.log('\n2. The Ingredients list');
  {
    const page = await open('ingredients');
    const names = async (q) => page.evaluate(`(function () {
      var s = document.getElementById('search'); s.value = ${JSON.stringify(q)}; renderTable();
      return Array.from(document.querySelectorAll('#tbody tr[data-ing] .td-name'))
        .map(function (td) { return td.childNodes[0].textContent.trim(); });
    })()`);
    const browse = await names('');
    ok('browsing is still plain alphabetical',
       same(browse, INGS.map(i => i.name).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))), browse);
    const na = await names('na');
    ok('"na" opens on the name that starts with it, not Activated charcoal', na[0] === 'Natural vitamin E', na);
    ok('then mid-word, then notes, then supplier-only',
       same(na, NA_ORDER.concat(['Jojoba oil'])), na);
    const n = await names('n');
    ok('"n" puts every name starting with N first, alphabetically',
       same(n.slice(0, 3), ['Natural vitamin E', 'Neem oil', 'Niacinamide']), n);
    const nat = await names('nat');
    ok('"nat" opens on Natural vitamin E, not Bakuchiol', nat[0] === 'Natural vitamin E', nat);
    await page.close();
  }

  console.log('\n3. The Formulations ingredient dropdown');
  {
    const page = await open('formulations');
    await page.evaluate("openFormula('f1')");
    await page.waitForTimeout(300);
    const names = async (q) => page.evaluate(`(function () {
      searchIngs(${JSON.stringify(q)});
      var ids = Array.from(document.querySelectorAll('#ing-dd .dd-item')).map(function (d) {
        return (d.getAttribute('onclick') || '').replace(/^.*addIng\\('([^']+)'\\).*$/, '$1'); });
      return ids.map(function (id) { var i = ings.find(function (x) { return x.id === id; }); return i ? i.name : id; });
    })()`);
    const na = await names('na');
    ok('"na" in the same order as the list (supplier is not searched here)', same(na, NA_ORDER), na);
    const n = await names('n');
    ok('"n" leads with names starting with N',
       same(n.slice(0, 3), ['Natural vitamin E', 'Neem oil', 'Niacinamide']), n);
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
