// Density resolution, and the stock arithmetic built on it.
//
// Density converts a lot bought by VOLUME into grams. Where none was
// recorded every module used 1.0, the density of water, which overstates a
// typical oil by about 7% and so inflated stock on hand and understated cost
// per gram. The tables that knew better lived in the Ingredients edit form,
// where they could only suggest a value to a human. They are in core now.
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

// Core alone, with no DOM. That is the point of the move: resolution must
// work on a plain ingredient object, not on form fields.
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'plume-core.js'), 'utf8'), sandbox);
const P = sandbox.Plume;

const oil = (inci, extra) => Object.assign(
  { inci, phase: 'oil', functionCategory: ['Emollient'], lots: [] }, extra || {});

console.log('\n1. Resolution works without a DOM');
{
  ok('core exports densityFor', typeof P.densityFor === 'function');
  ok('and the tables it reads', typeof P.DENSITY_BY_INCI === 'object' && Array.isArray(P.DENSITY_HINTS));
  ok('the reference is populated', Object.keys(P.DENSITY_BY_INCI).length > 40,
     Object.keys(P.DENSITY_BY_INCI).length);
}

console.log('\n2. Precedence: set beats reference beats category beats guess');
{
  // A value she typed must never be overridden by a table, even one that
  // disagrees. Olive is in the reference at 0.91.
  const set = P.densityFor(oil('Olea Europaea (Olive) Fruit Oil', { density: 0.88 }));
  ok('an explicit value wins over the reference', set.value === 0.88 && set.source === 'set', set);

  const byInci = P.densityFor(oil('Simmondsia Chinensis (Jojoba) Seed Oil'));
  ok('a named oil uses its own value', Math.abs(byInci.value - 0.860) < 0.0005, byInci);
  ok('and reports where it came from', byInci.source === 'inci', byInci);

  const byCat = P.densityFor(oil('Some Oil Nobody Has Heard Of'));
  ok('an unnamed carrier oil falls to the category default',
     Math.abs(byCat.value - 0.92) < 0.0005 && byCat.source === 'category', byCat);

  const nothing = P.densityFor({ inci: '', phase: '', functionCategory: [] });
  ok('with nothing to go on it says so rather than pretending',
     nothing.value === 1.0 && nothing.source === 'default', nothing);

  // The parenthetical in a real INCI must not defeat the lookup.
  ok('the common-name parenthetical is ignored',
     P.densityFor(oil('Macadamia Ternifolia Seed Oil')).source === 'inci');
  ok('and case does not matter',
     P.densityFor(oil('CANNABIS SATIVA SEED OIL')).source === 'inci');
}

console.log('\n3. The measured values are in');
{
  const cases = [
    ['Simmondsia Chinensis (Jojoba) Seed Oil', 0.860, 'jojoba, the big outlier'],
    ['Calophyllum Inophyllum Seed Oil',        0.942, 'tamanu'],
    ['Melia Azadirachta Seed Oil',             0.940, 'neem'],
    ['Linum Usitatissimum (Linseed) Seed Oil', 0.928, 'flax'],
    ['Persea Gratissima (Avocado) Oil',        0.920, 'avocado']
  ];
  cases.forEach(([inci, want, label]) => {
    const got = P.densityFor(oil(inci));
    ok(label + ' reads ' + want, Math.abs(got.value - want) < 0.0005, got);
  });

  // Previously 1.02, which is about 4% low for 1,3-propanediol.
  const pd = P.densityFor({ inci: 'Propanediol', phase: 'water', functionCategory: ['Humectant'] });
  ok('propanediol is corrected upward from 1.02',
     Math.abs(pd.value - 1.053) < 0.0005 && pd.source === 'inci', pd);
}

console.log('\n4. Categories that deliberately refuse to guess');
{
  // An unrecognised humectant could be anywhere between propanediol and
  // glycerin, so no figure is better than a wrong one.
  const h = P.densityFor({ inci: 'Mystery Humectant', phase: 'water', functionCategory: ['Humectant'] });
  ok('an unknown humectant gets no category guess', h.source === 'default', h);

  const w = P.densityFor({ inci: 'Rose Hydrosol', phase: 'water', functionCategory: ['Soothing'] });
  ok('but a plain water-phase ingredient does', w.source === 'category' && w.value === 1.0, w);

  const eo = P.densityFor({ inci: 'Lavandula Angustifolia Oil', phase: 'oil', functionCategory: ['Essential oil'] });
  ok('essential oils have their own default', Math.abs(eo.value - 0.90) < 0.0005, eo);
}

console.log('\n5. Stock arithmetic uses the resolved value');
{
  // The behaviour change. A litre of sunflower oil is not a kilogram.
  const sun = oil('Helianthus Annuus (Sunflower) Seed Oil',
                  { lots: [{ qtyPurchased: 1000, qtyUnit: 'mL' }] });
  const g = P.stockG(sun);
  ok('a 1000 mL oil lot no longer reads as 1000 g', Math.abs(g - 918) < 1, g);
  ok('which is the measured 0.918, not the 0.92 category default',
     Math.abs(g - 918) < 0.5, g);

  // Weight units must be untouched: density has no business in them.
  const byWeight = oil('Helianthus Annuus (Sunflower) Seed Oil',
                       { lots: [{ qtyPurchased: 500, qtyUnit: 'g' }] });
  ok('a lot bought by weight is unaffected', P.stockG(byWeight) === 500, P.stockG(byWeight));
  const lb = oil('Helianthus Annuus (Sunflower) Seed Oil',
                 { lots: [{ qtyPurchased: 1, qtyUnit: 'lb' }] });
  ok('and so is a pound', Math.abs(P.stockG(lb) - 453.592) < 0.01, P.stockG(lb));

  // fl oz is a volume, so it does depend on density.
  const floz = oil('Simmondsia Chinensis (Jojoba) Seed Oil',
                   { lots: [{ qtyPurchased: 10, qtyUnit: 'fl oz' }] });
  ok('fl oz uses density too', Math.abs(P.stockG(floz) - 10 * 29.5735 * 0.86) < 0.1, P.stockG(floz));

  // An explicit density still governs the arithmetic.
  const explicit = oil('Helianthus Annuus (Sunflower) Seed Oil',
                       { density: 0.80, lots: [{ qtyPurchased: 1000, qtyUnit: 'mL' }] });
  ok('an explicit density still wins in the arithmetic', Math.abs(P.stockG(explicit) - 800) < 0.5,
     P.stockG(explicit));

  // Water should be unchanged, which is the proof that nothing was broken
  // for the ingredients that were already correct.
  const water = { inci: 'Aqua', phase: 'water', functionCategory: [],
                  lots: [{ qtyPurchased: 500, qtyUnit: 'mL' }] };
  ok('water-based ingredients are unchanged at 1.0', P.stockG(water) === 500, P.stockG(water));
}

console.log('\n6. The old field name trap still holds');
{
  // stockG reads qtyPurchased/qtyUnit with legacy fallbacks to stock/stockUnit.
  // There is no l.unit. Reading the wrong name returns the raw number as
  // grams and every figure silently goes wrong, so it is worth a test.
  const legacy = oil('Helianthus Annuus (Sunflower) Seed Oil',
                     { lots: [{ stock: 1000, stockUnit: 'mL' }] });
  ok('legacy stock/stockUnit still resolve', Math.abs(P.stockG(legacy) - 918) < 1, P.stockG(legacy));

  const wrongField = oil('Helianthus Annuus (Sunflower) Seed Oil',
                         { lots: [{ qtyPurchased: 1000, unit: 'mL' }] });
  ok('a lot with only l.unit falls back to grams, as documented',
     P.stockG(wrongField) === 1000, P.stockG(wrongField));

  const refOnly = oil('Helianthus Annuus (Sunflower) Seed Oil',
                      { lots: [{ qtyPurchased: 1000, qtyUnit: 'mL', referenceOnly: true }] });
  ok('a reference-only lot is not counted as stock', P.stockG(refOnly) === 0, P.stockG(refOnly));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
