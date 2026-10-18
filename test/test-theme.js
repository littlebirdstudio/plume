// Dark mode (2026-10-17): one Light / Dark / Match my computer choice for
// the whole app, kept in localStorage as 'plume-theme', with every module
// palette (and each page's own categorical colours) given a dark version by
// Plume.darkValue() rather than by hand-drawn dark palettes.
//
// Part 1 checks the colour rules in plain Node: roles map the right way and
// every palette's dark version keeps text readable. Part 2 drives the pages:
// the setting, matching the computer, other open windows, printing, the
// landing page, and a contrast sweep over the main views of every module.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');
const { ROOT, TMP, previewUrl, trackDialogs } = require('./helpers');

let pass = 0, fail = 0;
function ok(label, cond, got) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (got !== undefined ? '\n       got: ' + JSON.stringify(got) : '')); }
}

// ── Colour helpers for the checks ─────────────────────────────
function hex(c) { const m = /^#([0-9a-f]{6})$/i.exec(c); return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : null; }
function lum(rgb) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}
function contrast(a, b) { const x = lum(hex(a)), y = lum(hex(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

// ── 1. The rules, straight from core ──────────────────────────
const core = fs.readFileSync(path.join(ROOT, 'plume-core.js'), 'utf8');
const sandbox = { window: {}, document: { documentElement: { style: { setProperty() {} } } },
                  localStorage: { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 } };
vm.createContext(sandbox);
vm.runInContext(core, sandbox);
const P = sandbox.Plume;
const D = (name, v) => P.darkValue(name, v);

console.log('\n1. How each colour turns dark');
ok('the page background goes near-black', lum(hex(D('--cream', '#F7F4EF'))) < 0.02, D('--cream', '#F7F4EF'));
ok('cards sit just above the background', lum(hex(D('--white', '#FDFCFA'))) > lum(hex(D('--cream', '#F7F4EF'))));
ok('body text goes near-white', lum(hex(D('--ink', '#2C2520'))) > 0.7, D('--ink', '#2C2520'));
ok('a pale tint (-light, -bg, -wash) becomes a deep one',
   ['--sage-light', '--ph-water-bg', '--ph-oil-wash'].every(n => lum(hex(D(n, '#EDF0EA'))) < 0.05));
ok('a strong shade used for text (-dark, -fg) becomes a light one',
   ['--bark-dark', '--ph-water-fg'].every(n => lum(hex(D(n, '#2A5C8A'))) > 0.45));
const water = D('--ph-water-bg', '#E4EEF8');
ok('hue is kept: the water tint stays blue', (() => { const c = hex(water); return c[2] > c[0] && c[2] > c[1]; })(), water);
ok('values that are not plain colours are left alone',
   D('--anything', '12px') === null && D('--shadow', 'rgba(0,0,0,0.2)') === null && D('--font', "'DM Sans'") === null);

console.log('\n2. Every palette stays readable in dark');
{
  const bad = [];
  Object.keys(P.PALETTES).forEach(name => {
    const v = P.PALETTES[name].vars, d = {};
    Object.keys(v).forEach(k => { const x = D(k, v[k]); if (x) d[k] = x; });
    const need = [
      ['--ink', '--white', 7], ['--ink', '--cream', 7], ['--ink-light', '--white', 4.5], ['--ink-lighter', '--white', 4.5],
      ['--ink-lighter', '--cream-dark', 4.5], ['--bark-dark', '--white', 7], ['--bark', '--white', 3],
      ['--cream', '--bark', 4.5],          // button text on a primary button
      ['--white', '--sage', 4.5],          // text on a pinned (sage) button
      ['--sage-dark', '--sage-light', 4.5], ['--clay-dark', '--clay-light', 4.5],
      ['--warning', '--warning-bg', 4.5], ['--danger', '--danger-bg', 4.5], ['--ink', '--clay-light', 7]
    ];
    need.forEach(([fg, bg, min]) => {
      const c = contrast(d[fg], d[bg]);
      if (!(c >= min)) bad.push(name + ': ' + fg + ' on ' + bg + ' ' + c.toFixed(2) + ' < ' + min);
    });
  });
  ok('text, buttons, tints and warnings meet their contrast in all ' + Object.keys(P.PALETTES).length + ' palettes',
     bad.length === 0, bad);
}

(async () => {
  const browser = await chromium.launch();
  const SEED = `
    localStorage.setItem('aerie-ingredients-v2', JSON.stringify([{ id: 'i1', name: 'Jojoba oil', inci: 'Simmondsia Chinensis Seed Oil', phase: 'oil',
      functionCategory: ['Emollient'], chooseWhen: 'a liquid wax', lots: [{ id: 'L1', supplier: 'A', qtyPurchased: 100, qtyUnit: 'g', costPerG: 0.05 }], activeLotId: 'L1' },
      { id: 'i2', name: 'Glycerin', inci: 'Glycerin', phase: 'water', functionCategory: ['Humectant'], lots: [] }]));
    localStorage.setItem('aerie-formulations-v1', JSON.stringify([{ id: 'f1', name: 'Serum', type: 'Facial serum', activeVariantId: 'v1',
      lines: [{ ingId: 'i1', pct: 50 }, { ingId: 'i2', pct: 50 }],
      variants: [{ vid: 'v1', num: 1, label: '', status: 'testing', lines: [{ ingId: 'i1', pct: 50 }, { ingId: 'i2', pct: 50 }], usageLog: [], history: [] }] }]));
    localStorage.setItem('plume-products-v1', '[]');
    localStorage.setItem('aerie-batches-v1', '[]');`;
  const errors = [];
  async function open(module, theme, opts) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, opts || {}));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(module + ': ' + e));
    await trackDialogs(page, []);
    await page.goto(module.indexOf('://') > 0 ? module : previewUrl(module));
    await page.waitForTimeout(200);
    await page.evaluate(SEED + (theme ? `localStorage.setItem('plume-theme', ${JSON.stringify(theme)});` : `localStorage.removeItem('plume-theme');`));
    await page.reload();
    await page.waitForTimeout(400);
    return { ctx, page };
  }
  const bodyLum = page => page.evaluate(`(function(){var m=/(\\d+), (\\d+), (\\d+)/.exec(getComputedStyle(document.body).backgroundColor);
    var f=function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return 0.2126*f(+m[1])+0.7152*f(+m[2])+0.0722*f(+m[3]);})()`);
  const isDarkAttr = page => page.evaluate("document.documentElement.getAttribute('data-theme') === 'dark'");

  console.log('\n3. The setting');
  {
    const { ctx, page } = await open('packaging', 'dark');
    ok('dark: the page is dark', (await isDarkAttr(page)) && (await bodyLum(page)) < 0.03, await bodyLum(page));
    ok('form controls follow (color-scheme dark)', await page.evaluate("document.documentElement.style.colorScheme === 'dark'"));
    ok('the header uses its own dark colours', await page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--hdr-bg').trim() !== ''"));
    await page.evaluate('openSettings()');
    await page.waitForTimeout(200);
    const opts = await page.evaluate("Array.from(document.querySelectorAll('#plume-theme-choice .plume-theme-opt')).map(function(b){return b.textContent + (b.classList.contains('on') ? '*' : '');})");
    ok('Settings offers Light / Dark / Match my computer, with Dark marked', JSON.stringify(opts) === '["Light","Dark*","Match my computer"]', opts);
    ok('and says it covers every module, and so does the palette',
       /every module[\s\S]*palette/.test(await page.evaluate("document.getElementById('plume-theme-choice').innerText")));
    await page.click('#plume-theme-choice .plume-theme-opt:first-child');
    await page.waitForTimeout(150);
    ok('choosing Light turns it light at once', !(await isDarkAttr(page)) && (await bodyLum(page)) > 0.7, await bodyLum(page));
    ok('the choice is saved for every page', (await page.evaluate("localStorage.getItem('plume-theme')")) === 'light');
    const pal = await page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--cream').trim().toUpperCase()");
    ok('light brings back the module palette exactly', pal === '#F5F5F3', pal);   // Finch, the default since 2026-10-18
    ok('the header colours are gone in light', await page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--hdr-bg').trim() === ''"));
    await ctx.close();
  }

  console.log('\n4. Match my computer (the default)');
  {
    let o = await open('formulations', null, { colorScheme: 'dark' });
    ok('with nothing chosen and a dark computer, Plume is dark', await isDarkAttr(o.page));
    await o.page.emulateMedia({ colorScheme: 'light' });
    await o.page.waitForTimeout(150);
    ok('and follows the computer when it switches to light', !(await isDarkAttr(o.page)));
    await o.ctx.close();
    o = await open('formulations', 'light', { colorScheme: 'dark' });
    ok('an explicit Light wins over a dark computer', !(await isDarkAttr(o.page)));
    await o.ctx.close();
  }

  console.log('\n5. Palettes, other windows, printing');
  {
    const { ctx, page } = await open('ingredients', 'dark');
    const c1 = await page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bark').trim()");
    await page.evaluate("selectPalette('lagoon')");
    const c2 = await page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bark').trim()");
    ok('changing palette in dark gives that palette\'s dark version', c1 !== c2 && (await isDarkAttr(page)), [c1, c2]);
    const other = await ctx.newPage();
    await other.goto(previewUrl('formulations'));
    await other.waitForTimeout(300);
    ok('another open window starts dark too', await isDarkAttr(other));
    ok('one palette for the whole app: other modules pick it up',
       (await page.evaluate("localStorage.getItem('plume-palette')")) === 'lagoon' &&
       (await other.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bark').trim()")) === c2);
    await page.evaluate("Plume.setTheme('light')");
    await other.waitForTimeout(300);
    ok('and turns light when the choice changes in the first one', !(await isDarkAttr(other)));
    await page.evaluate("Plume.setTheme('dark')");
    await page.evaluate("window.dispatchEvent(new Event('beforeprint'))");
    ok('printing uses the light colours', !(await isDarkAttr(page)));
    await page.evaluate("window.dispatchEvent(new Event('afterprint'))");
    ok('and dark returns after printing', await isDarkAttr(page));
    await ctx.close();
  }

  console.log('\n6. The landing page');
  {
    let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    html = html.replace('<script src="plume-core.js"></script>', '<script>\n' + core + '\n</script>');
    const out = path.join(TMP, 'preview-index-theme.html');
    fs.mkdirSync(TMP, { recursive: true });
    fs.writeFileSync(out, html);
    const { ctx, page } = await open('file://' + out, 'dark');
    ok('it goes dark with the rest', (await isDarkAttr(page)) && (await bodyLum(page)) < 0.03, await bodyLum(page));
    ok('the logo is inverted to read light on dark',
       /invert/.test(await page.evaluate("getComputedStyle(document.querySelector('.hero-logo')).filter")));
    await ctx.close();
  }

  console.log('\n7. Nothing left unreadable in dark (text against what is behind it)');
  {
    const SWEEP = `(function(){
      function rgb(s){var m=/rgba?\\(([^)]+)\\)/.exec(s);if(!m)return null;var a=m[1].split(',').map(parseFloat);return {r:a[0],g:a[1],b:a[2],a:a.length>3?a[3]:1};}
      function lum(c){var f=function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);}
      function bgOf(el){while(el){var c=rgb(getComputedStyle(el).backgroundColor);if(c&&c.a>0.5)return c;el=el.parentElement;}return rgb(getComputedStyle(document.documentElement).backgroundColor);}
      var out=[];document.querySelectorAll('body *').forEach(function(el){
        if(!el.offsetParent&&getComputedStyle(el).position!=='fixed')return;
        if(!Array.from(el.childNodes).some(function(n){return n.nodeType===3&&n.textContent.trim();}))return;
        var cs=getComputedStyle(el);if(cs.visibility==='hidden'||+cs.opacity<0.7)return;
        var fg=rgb(cs.color),bg=bgOf(el);if(!fg||!bg)return;
        var a=lum(fg),b=lum(bg),cr=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
        if(cr<3.5)out.push(cr.toFixed(2)+' '+el.tagName.toLowerCase()+'.'+String(el.className)+' "'+el.textContent.trim().slice(0,24)+'"');
      });return out;})()`;
    const views = [['ingredients', null], ['ingredients', "setIngView('cheat')"], ['ingredients', "viewIngredient('i1')"],
                   ['formulations', null], ['formulations', "openFormula('f1')"], ['packaging', null], ['packaging', 'openSettings()'],
                   ['batchlog', null], ['costing', null]];
    for (const [m, act] of views) {
      const { ctx, page } = await open(m, 'dark');
      if (act) { await page.evaluate(act); await page.waitForTimeout(300); }
      const low = await page.evaluate(SWEEP);
      ok(m + (act ? ' (' + act + ')' : '') + ': all text at least 3.5:1', low.length === 0, low.slice(0, 8));
      await ctx.close();
    }
  }

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
