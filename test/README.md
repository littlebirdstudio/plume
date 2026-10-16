# Tests

Regression suites for the parts of Plume where a quiet wrong answer is worse
than a crash: the approved-version lock, the delete guards, archiving, the
INCI label list, and the SAP and density reference data.

## Running them

From the repository root:

    npm ci
    npx playwright install chromium
    npm test

`npm test` runs all nine suites and stops at the first failure. To run one:

    node test/test-lock.js

CI runs the same thing on every pull request (`.github/workflows/tests.yml`).

### Why Playwright is pinned to an exact version

Every Playwright release expects one specific Chromium build, so the two move
together. Most sandboxes and CI images ship a prebuilt Chromium, and if the
installed Playwright wants a different build number it refuses to start with
"Executable doesn't exist" — which reads like a broken test suite but is only
a version mismatch.

`playwright` is therefore pinned exactly (not `^`) in package.json, and
`package-lock.json` is committed. Upgrading is a deliberate act: bump the
version, run the suites, and commit the new lockfile together.

## What each one covers

| Suite | Checks | Covers |
|---|---|---|
| `test-lock.js` | 33 | Approved versions open read-only; unlocking in place; the unlock expiring when you leave the version; branching from an approved version starting as a draft |
| `test-guards.js` | 21 | What the delete confirmations say — which products break, which batches survive, which version inherits the in-use role |
| `test-archive.js` | 32 | Archived formulations leaving the list and the pickers while staying resolvable for products that already use them; retired versions leaving the tab strip |
| `test-inci.js` | 29 | Splitting blend INCI strings; merging a shared component once; the merge note; common-name mode left alone |
| `test-sap.js` | 65 | The SAP reference data and the review that applies it: the KOH/NaOH ratio on every row, profiles predicting their own SAP, name lookup surviving the INCI collisions, and applying changes without destroying anything |
| `test-ing-archive.js` | 47 | Archiving and un-archiving an ingredient; the delete guard naming which formulations break; an archived ingredient still resolving where used but gone from the add picker; a deleted ingredient rendering a marked row instead of vanishing |
| `test-density.js` | 29 | Density resolution without a DOM: explicit beats reference beats category beats guess; the measured values; the categories that refuse to guess; and the stock arithmetic that now stops treating a litre of oil as a kilogram |
| `test-search.js` | 18 | Search ordering: names starting with the query first, then a later word of the name, then INCI, then mid-word, then notes; checked in the Ingredients list and the Formulations dropdown |
| `test-ph.js` | 75 | pH records: parsing and range checks; which formulas get pH (water phase only, never soap); the bench sheet block; the version target (validation, history, mirroring, new versions, approval lock); usage-log steps; a batch's final pH against the target it was made with |

## How they run

`test-lock.js` uses jsdom. The others drive headless Chromium through
Playwright, because they assert on things jsdom does not model: a disabled
input's computed style, a native `confirm()` dialog's text, a rendered row.
`test-sap.js` is split: the data checks are plain Node against
`plume-sapdata.js`, and only the review UI needs a browser.

The browser suites need a self-contained copy of each module, since a
`file://` page will not reliably fetch `plume-core.js` through a `<script
src>`. `helpers.js` builds one into `test/tmp/` by inlining core, on every
run. `test/tmp/` is gitignored, so a stale build can never be what a test
passed against.

## Writing more

Two things these suites learned the hard way and are worth keeping:

**Assert on what the user sees, not on internal state.** The delete guards are
tested by capturing the actual dialog text, because the wording *is* the
feature. Asserting that a flag was set would have passed while the dialog said
nothing useful.

**Re-render is where features fall off.** The lock was correct on load and
silently lost when a batch-size change re-rendered the rows. The test that
caught it changes the batch size and re-checks, and that pattern is worth
copying for anything that applies state after a render.

**Check reference data against a law, not against itself.** Every SAP row is
verified by the fixed KOH/NaOH molar ratio and every fatty acid profile by
predicting SAP from its own composition. Both hold whatever the source says,
so a transposed column or an invented profile fails without anyone having to
notice it by eye. That is what caught the previous SAP values, most of which
turned out to be one placeholder number stamped across unrelated oils.

**A row that cannot be resolved must still be drawn.** Twice now a line has
vanished from the formula editor while still counting toward the total: once
from a stray phase key, once from an ingredient that had been deleted. Both
times the formula went on reporting 100% while rendering less than that, which
is the worst possible failure for something you print and then weigh against.
Render a marked placeholder instead of returning early, and assert that the
number of rows equals the number of lines.

**Use the real entry point, not the internals.** The first draft of the
archive suite set `activeVariantId` by hand and called a module-local
`syncActive`, which does not exist on the page. `selectVariant(vid)` is what
the version tabs call, so it is what the test should call.

**Name the buckets after the thing, not the fix.** The review first grouped
oils by which way the number moved when corrected, while labelling the groups
by whether the stored value read high. Those are opposites, so every oil sat
under a heading saying the reverse of the truth. The test now asserts the
bucket *and* that the oil is absent from its opposite.
