// SAP reference data, and the review that applies it.
//
// Two halves. The first runs in plain Node against plume-sapdata.js and checks
// the data itself: the KOH/NaOH ratio is fixed by chemistry, so every row can
// be verified without trusting the source's column order. The second drives
// the real Ingredients page in headless Chromium, because what matters about
// the review is which bucket each oil lands in and, above all, that applying
// it never destroys data the reference has nothing to say about.
const { chromium } = require('playwright');
const { previewUrl, ROOT } = require('./helpers');
const path = require('path');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

const Sap = require(path.join(ROOT, 'plume-sapdata.js'));

// KOH is 56.105 g/mol, NaOH is 39.997, so for any oil the KOH SAP must be
// 1.4027x the NaOH one. This is the invariant that proves the column order.
const RATIO = 56.105 / 39.997;

// Acids heavy enough to be worth naming, for the profile sanity check.
const FA_MW = {
  caprylic: 144.21, capric: 172.26, lauric: 200.32, myristic: 228.37,
  palmitic: 256.42, palmitoleic: 254.41, stearic: 284.48, oleic: 282.46,
  ricinoleic: 298.46, linoleic: 280.45, linolenic: 278.43,
  arachidic: 312.53, behenic: 340.58, erucic: 338.57, gadoleic: 310.51
};

(async () => {

  console.log('\n1. Reference data integrity');
  {
    const oils = Sap.oils();
    ok('reference is populated', oils.length > 50, oils.length);
    ok('count matches the array', Sap.count === oils.length);

    const offRatio = oils.filter(o => Math.abs(o.koh / o.naoh - RATIO) > 0.025);
    ok('every row satisfies the KOH/NaOH ratio', offRatio.length === 0,
       offRatio.map(o => o.name + ' ' + (o.koh / o.naoh).toFixed(4)));

    const nonPositive = oils.filter(o => !(o.naoh > 0) || !(o.koh > 0));
    ok('no row has a missing or zero SAP value', nonPositive.length === 0,
       nonPositive.map(o => o.name));

    // KOH must exceed NaOH for the same oil; a transposed row would invert.
    ok('KOH always exceeds NaOH', oils.every(o => o.koh > o.naoh));

    const noName = oils.filter(o => !o.name || !o.inci);
    ok('every row has a name and an INCI', noName.length === 0, noName.map(o => o.name));

    const badAcid = [];
    oils.forEach(o => {
      if (!o.fa) return;
      Object.keys(o.fa).forEach(a => { if (!FA_MW[a]) badAcid.push(o.name + ':' + a); });
    });
    ok('no unrecognised fatty acid keys', badAcid.length === 0, badAcid);

    // A profile that is present should account for most of the oil. A partial
    // one silently skews anything computed from it.
    const thin = oils.filter(o => o.fa &&
      Object.keys(o.fa).reduce((s, k) => s + o.fa[k], 0) < 90);
    ok('present profiles account for at least 90% of the oil', thin.length === 0,
       thin.map(o => o.name));

    // A missing profile must read as "unknown", never as an empty object that
    // downstream code could mistake for a real all-zero composition.
    const emptyObj = oils.filter(o => o.fa !== null && Object.keys(o.fa).length === 0);
    ok('unknown profiles are null, not an empty object', emptyObj.length === 0,
       emptyObj.map(o => o.name));

    // Any value not taken from the reference chart has to say so on its own
    // row. An unsourced number that looks like a sourced one is the exact
    // failure this whole dataset exists to undo.
    const est = oils.filter(o => o.estimated);
    ok('estimated values are flagged, not left to pass as sourced',
       est.length > 0 && est.length <= 3, est.map(o => o.name));
    ok('and each flagged row still carries a usable value',
       est.every(o => o.naoh > 0 && o.koh > 0), est.map(o => [o.name, o.naoh]));
  }

  console.log('\n2. Profiles predict their own SAP');
  {
    // A triglyceride of an acid with molar mass M weighs 3M + 38.04 and takes
    // 3 KOH to saponify, so a profile implies a SAP value. Real measured SAP
    // sits slightly BELOW theoretical because oils carry unsaponifiable
    // matter, so predictions should run a little high and never wildly off.
    const kohPerG = a => 3 * 56.105 / (3 * FA_MW[a] + 38.04);
    const diffs = [];
    Sap.oils().forEach(o => {
      if (!o.fa) return;
      const tot = Object.keys(o.fa).reduce((s, k) => s + o.fa[k], 0);
      const pred = Object.keys(o.fa).reduce((s, k) => s + o.fa[k] / tot * kohPerG(k), 0);
      diffs.push({ name: o.name, pct: (pred - o.koh) / o.koh * 100 });
    });
    ok('enough profiles to be worth checking', diffs.length > 40, diffs.length);

    const wild = diffs.filter(d => Math.abs(d.pct) > 8);
    ok('no profile is more than 8% from its SAP value', wild.length === 0,
       wild.map(d => d.name + ' ' + d.pct.toFixed(1) + '%'));

    const mean = diffs.reduce((s, d) => s + d.pct, 0) / diffs.length;
    ok('mean bias is small and positive, as unsaponifiables imply',
       mean > -1 && mean < 3, mean.toFixed(2) + '%');
  }

  console.log('\n3. Lookup and the collisions it has to survive');
  {
    ok('exact name', Sap.lookup('Shea butter') !== null);
    ok('case and punctuation ignored', Sap.lookup('SHEA  BUTTER') !== null);
    ok('unknown name returns null', Sap.lookup('dragon fruit oil') === null);
    ok('empty input returns null', Sap.lookup('') === null && Sap.lookup(null) === null);

    const frac = Sap.lookup('Fractionated coconut oil');
    const d76 = Sap.lookup('Coconut oil (76°)');
    ok('fractionated and 76-degree coconut resolve separately',
       frac && d76 && frac.name !== d76.name);
    ok('and carry genuinely different SAP values',
       Math.abs(frac.naoh - d76.naoh) > 0.04, [frac.naoh, d76.naoh]);
    ok('the degree symbol is not required to match',
       Sap.lookup('coconut oil 76 deg') === d76);

    // Fractionating strips the long-chain acids out, so the result is MCT and
    // not the oil it came from. Carrying the botanical INCI over would pair a
    // 0.232 SAP with coconut's 0.183 under one key.
    ok('fractionated coconut carries the MCT INCI, not the botanical one',
       /caprylic\/capric triglyceride/i.test(frac.inci), frac.inci);
    ok('and its profile is the C8/C10 pair that defines it',
       frac.fa && frac.fa.caprylic > 40 && frac.fa.capric > 30, frac.fa);
    ok('76-degree coconut keeps the botanical INCI',
       /cocos nucifera/i.test(d76.inci), d76.inci);

    // The collision that survives: INCI names the botanical source, grade
    // changes the SAP, and these two grades share a source.
    const sf = Sap.lookup('Safflower oil');
    const sfh = Sap.lookup('Safflower oil (high oleic)');
    ok('both safflower grades share one INCI',
       Sap._norm(sf.inci) === Sap._norm(sfh.inci), [sf.inci, sfh.inci]);
    ok('but saponify differently, so name-keying is load-bearing',
       Math.abs(sf.naoh - sfh.naoh) > 0.001, [sf.naoh, sfh.naoh]);

    // Any INCI shared by rows with DIFFERENT SAP would be silently
    // mis-resolved by an INCI-keyed lookup. Catch new ones as they appear.
    const byInci = {};
    Sap.oils().forEach(o => {
      const k = Sap._norm(String(o.inci).replace(/\([^)]*\)/g, ' '));
      (byInci[k] = byInci[k] || []).push(o);
    });
    const risky = Object.keys(byInci).filter(k => {
      const v = byInci[k].map(o => o.naoh);
      return v.length > 1 && Math.max.apply(null, v) - Math.min.apply(null, v) > 0.002;
    });
    ok('only safflower shares an INCI across differing SAP values',
       risky.length === 1 && /carthamus/.test(risky[0]), risky);

    // Stripping a qualifier must not let one oil answer for another.
    const olive = Sap.lookup('Olive oil');
    const pomace = Sap.lookup('Olive oil (pomace)');
    ok('olive and olive pomace stay distinct', olive && pomace && olive.name !== pomace.name);
    ok('plain "Olive oil" resolves to olive, not pomace', olive.name === 'Olive oil');

    const saff = Sap.lookup('Safflower oil');
    ok('plain "Safflower oil" is not the high-oleic row', saff.name === 'Safflower oil');

    // No alias may shadow another oil's primary name.
    const primaries = {};
    Sap.oils().forEach(o => { primaries[Sap._norm(o.name)] = o.name; });
    const shadowed = [];
    Sap.oils().forEach(o => (o.aliases || []).forEach(a => {
      const k = Sap._norm(a);
      if (primaries[k] && primaries[k] !== o.name) shadowed.push(o.name + ' -> ' + primaries[k]);
    }));
    ok('no alias shadows another oil primary name', shadowed.length === 0, shadowed);

    // Every primary name must win its own key.
    const selfMiss = Sap.oils().filter(o => Sap.lookup(o.name) !== o);
    ok('every oil resolves to itself by name', selfMiss.length === 0, selfMiss.map(o => o.name));
  }

  const browser = await chromium.launch();

  // Deliberately mixed: a wrong value, a right value, a missing value, an
  // oil with a profile the reference withholds, and an oil absent from the
  // reference entirely.
  const INGS = [
    { id: 'i1', name: 'Coconut oil (76°)', inci: 'Cocos Nucifera (Coconut) Oil',
      phase: 'oil', lots: [], soap: { naoh: 0.190, koh: 0.266,
      fa: { lauric: 49, myristic: 18, palmitic: 9, stearic: 3, oleic: 8, linoleic: 2 } } },
    { id: 'i2', name: 'Olive oil', inci: 'Olea Europaea (Olive) Fruit Oil',
      phase: 'oil', lots: [], soap: { naoh: 0.135, koh: 0.190 } },
    { id: 'i3', name: 'Shea butter', inci: 'Butyrospermum Parkii (Shea) Butter',
      phase: 'oil', lots: [] },
    { id: 'i4', name: 'Jojoba oil', inci: 'Simmondsia Chinensis (Jojoba) Seed Oil',
      phase: 'oil', lots: [], soap: { naoh: 0.069, koh: 0.097,
      fa: { oleic: 10, linoleic: 2 } } },
    { id: 'i5', name: 'Unobtainium oil', inci: 'Unobtainium Seed Oil',
      phase: 'oil', lots: [], soap: { naoh: 0.111, koh: 0.156 } },
    { id: 'i6', name: 'Cupuacu butter', inci: 'Theobroma Grandiflorum Seed Butter',
      phase: 'oil', lots: [], soap: { naoh: 0.130, koh: 0.182 } },
    { id: 'i7', name: 'Glycerin', inci: 'Glycerin', phase: 'water', lots: [] },
    // Correct SAP *and* a matching profile, so it should be counted as
    // agreeing and appear in no bucket at all.
    { id: 'i8', name: 'Kokum butter', inci: 'Garcinia Indica Seed Butter',
      phase: 'oil', lots: [], soap: { naoh: 0.135, koh: 0.190,
      fa: { palmitic: 2, stearic: 57, oleic: 39, linoleic: 2 } } }
  ];

  const SEED = `localStorage.setItem('aerie-ingredients-v2', ${JSON.stringify(JSON.stringify(INGS))});`;

  async function open() {
    const page = await browser.newPage();
    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
    await page.goto(previewUrl('ingredients'));
    await page.waitForTimeout(300);
    await page.evaluate(SEED);
    await page.reload();
    await page.waitForTimeout(500);
    return { page, dialogs };
  }

  console.log('\n4. The review sorts oils into the right buckets');
  {
    const { page } = await open();
    ok('reference loaded into the page',
       (await page.evaluate('typeof PlumeSap')) === 'object');

    const plan = await page.evaluate(`(function () {
      var p = buildSapPlan();
      function n(a) { return a.map(function (i) { return i.ing.name; }); }
      return {
        overstated:  n(p.overstated),
        understated: n(p.understated),
        add:         n(p.add),
        faOnly:      n(p.faOnly),
        unmatched:   n(p.unmatched),
        agree:       p.agree
      };
    })()`);
    const anyBucket = [].concat(plan.overstated, plan.understated, plan.add, plan.faOnly);

    // Stored 0.190 against a reference of 0.183: the stored value is too high,
    // so the calculator has been asking for lye the oils cannot consume.
    ok('coconut is reported as overstated, matching its heading',
       plan.overstated.indexOf('Coconut oil (76°)') !== -1, plan.overstated);
    ok('and not as understated',
       plan.understated.indexOf('Coconut oil (76°)') === -1);
    // Stored 0.130 against 0.137: too low, the harmless direction.
    ok('cupuacu is reported as understated',
       plan.understated.indexOf('Cupuacu butter') !== -1, plan.understated);
    ok('shea, which has no SAP data, lands in "no value yet"',
       plan.add.indexOf('Shea butter') !== -1, plan.add);

    // Olive's SAP is already right but it carries no profile, so it belongs in
    // the profile-only bucket rather than being called a SAP change.
    ok('olive is a profile-only change, not a SAP change',
       plan.faOnly.indexOf('Olive oil') !== -1 &&
       plan.overstated.indexOf('Olive oil') === -1 &&
       plan.understated.indexOf('Olive oil') === -1, plan.faOnly);

    // Right SAP and a matching profile, so nothing to do.
    ok('a fully correct oil is counted as agreeing', plan.agree >= 1, plan.agree);
    ok('and appears in no bucket', anyBucket.indexOf('Kokum butter') === -1, anyBucket);

    ok('an oil absent from the reference is reported, not changed',
       plan.unmatched.indexOf('Unobtainium oil') !== -1, plan.unmatched);
    ok('a non-soap ingredient is ignored entirely',
       anyBucket.concat(plan.unmatched).indexOf('Glycerin') === -1);
    await page.close();
  }

  console.log('\n5. Applying changes, and what it must not touch');
  {
    const { page } = await open();
    await page.evaluate('openSapReview()');
    await page.waitForTimeout(200);

    ok('the modal opens',
       (await page.evaluate("document.getElementById('modal-sap').classList.contains('open')")) === true);
    const btn = await page.evaluate("document.getElementById('sap-apply-btn').textContent");
    ok('the button states how many changes it will make', /Apply \d+ change/.test(btn), btn);
    const body = await page.evaluate("document.getElementById('sap-review-body').innerText");
    ok('the review explains the lye direction', /more lye/.test(body) && /superfat/.test(body), body.slice(0, 160));
    ok('the unverifiable oil is named in the review', /Unobtainium/.test(body));

    const before = await page.evaluate(`(function () {
      var g = ingredients.filter(function (i) { return i.name === 'Glycerin'; })[0];
      return { glycerinSoap: g.soap === undefined, jojobaFa: JSON.stringify(
        ingredients.filter(function (i) { return i.name === 'Jojoba oil'; })[0].soap.fa) };
    })()`);

    await page.evaluate('applySapRefresh()');
    await page.waitForTimeout(250);

    const after = await page.evaluate(`(function () {
      function f(n) { return ingredients.filter(function (i) { return i.name === n; })[0]; }
      return {
        coconut: f('Coconut oil (76°)').soap,
        shea:    f('Shea butter').soap,
        cupuacu: f('Cupuacu butter').soap,
        unob:    f('Unobtainium oil').soap,
        jojobaFa: JSON.stringify(f('Jojoba oil').soap.fa),
        glycerin: f('Glycerin').soap === undefined,
        names:   ingredients.map(function (i) { return i.name; }).length,
        lots:    f('Coconut oil (76°)').lots.length,
        inci:    f('Coconut oil (76°)').inci
      };
    })()`);

    ok('coconut NaOH corrected downward to the reference',
       Math.abs(after.coconut.naoh - 0.183) < 0.0001, after.coconut.naoh);
    ok('coconut KOH corrected in step',
       Math.abs(after.coconut.koh - 0.257) < 0.0001, after.coconut.koh);
    ok('coconut profile gained the caprylic and capric SoapCalc omits',
       after.coconut.fa.caprylic > 0 && after.coconut.fa.capric > 0, after.coconut.fa);
    ok('shea gained a SAP value where it had none',
       after.shea && Math.abs(after.shea.naoh - 0.128) < 0.0001, after.shea);
    ok('cupuacu corrected upward', Math.abs(after.cupuacu.naoh - 0.137) < 0.0001, after.cupuacu.naoh);

    // The load-bearing one: the reference withholds jojoba's profile because
    // it is a wax ester, and a withheld profile must leave hers alone rather
    // than wipe it.
    ok('a withheld profile does not erase the existing one',
       after.jojobaFa === before.jojobaFa, [before.jojobaFa, after.jojobaFa]);

    ok('an oil absent from the reference is left untouched',
       Math.abs(after.unob.naoh - 0.111) < 0.0001, after.unob.naoh);
    ok('a non-soap ingredient gains no soap object', after.glycerin === true);
    ok('nothing was added or removed from the library', after.names === INGS.length, after.names);
    ok('lots were not disturbed', after.lots === 0);
    ok('INCI was not rewritten', after.inci === 'Cocos Nucifera (Coconut) Oil', after.inci);

    // Re-running must now find nothing, or the plan is not converging.
    const second = await page.evaluate(`(function () {
      var p = buildSapPlan();
      return p.overstated.length + p.understated.length + p.add.length + p.faOnly.length;
    })()`);
    ok('a second pass finds nothing left to change', second === 0, second);
    await page.close();
  }

  console.log('\n6. A library already correct offers nothing to do');
  {
    const page = await browser.newPage();
    page.on('dialog', async (d) => { await d.accept(); });
    await page.goto(previewUrl('ingredients'));
    await page.waitForTimeout(300);
    await page.evaluate(`localStorage.setItem('aerie-ingredients-v2', JSON.stringify([
      { id: 'z1', name: 'Olive oil', inci: 'Olea Europaea (Olive) Fruit Oil',
        phase: 'oil', lots: [], soap: { naoh: 0.135, koh: 0.190,
        fa: { palmitic: 13, stearic: 3, oleic: 71, linoleic: 10, linolenic: 1 } } }
    ]));`);
    await page.reload();
    await page.waitForTimeout(500);
    await page.evaluate('openSapReview()');
    await page.waitForTimeout(200);
    const btn = await page.evaluate("document.getElementById('sap-apply-btn')");
    const label = await page.evaluate("document.getElementById('sap-apply-btn').textContent");
    const disabled = await page.evaluate("document.getElementById('sap-apply-btn').disabled");
    ok('the apply button is disabled', disabled === true);
    ok('and says there is nothing to apply', /Nothing to apply/.test(label), label);
    const body = await page.evaluate("document.getElementById('sap-review-body').innerText");
    ok('the body says everything matches', /Everything matches/.test(body), body.slice(0, 120));
    await page.close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
