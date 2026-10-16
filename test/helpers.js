// Shared paths and the preview builder the browser-driven suites need.
//
// Three of the four suites drive a real page in headless Chromium rather than
// jsdom, because what they assert is partly visual (a disabled input, a
// rendered dialog) and partly dependent on the browser actually running the
// page. Those suites need a SELF-CONTAINED copy of the module: the real file
// loads plume-core.js with <script src>, which a file:// page in a fresh
// profile will not reliably fetch. buildPreview() inlines core (and the cheat
// sheet, where the module loads it) into a copy under test/tmp/.
//
// test/tmp/ is gitignored. It is a build artifact, rebuilt on every run, so a
// stale copy can never be what a test passed against.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(__dirname, 'tmp');

const INLINE = ['plume-core.js', 'plume-cheatsheet.js'];

function buildPreview(module) {
  fs.mkdirSync(TMP, { recursive: true });
  const srcPath = path.join(ROOT, 'plume-' + module + '.html');
  let page = fs.readFileSync(srcPath, 'utf8');

  for (const dep of INLINE) {
    const tag = '<script src="' + dep + '"></script>';
    if (page.indexOf(tag) === -1) continue;
    const js = fs.readFileSync(path.join(ROOT, dep), 'utf8');
    page = page.replace(tag, '<script>\n' + js + '\n</script>');
  }

  if (/<script src="plume-/.test(page)) {
    throw new Error('buildPreview(' + module + '): a local <script src> was left '
      + 'un-inlined. Add it to INLINE in test/helpers.js.');
  }

  const out = path.join(TMP, 'preview-' + module + '.html');
  fs.writeFileSync(out, page);
  return out;
}

function previewUrl(module) {
  return 'file://' + buildPreview(module);
}

module.exports = { ROOT, TMP, buildPreview, previewUrl };
