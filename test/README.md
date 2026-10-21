# Tests

Regression suites for the parts of Plume where a quiet wrong answer is worse
than a crash: the approved-version lock, the delete guards, archiving, the
INCI label list, and the SAP and density reference data.

## Running them

From the repository root:

    npm ci
    npx playwright install chromium
    npm test

`npm test` runs every suite and stops at the first failure. To run one:

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
| `test-sap.js` | 78 | The SAP reference data and the review that applies it: the KOH/NaOH ratio on every row, profiles predicting their own SAP, name lookup surviving the INCI collisions, and applying changes without destroying anything |
| `test-ing-archive.js` | 69 | Archiving and un-archiving an ingredient; the delete guard naming which formulations break; an archived ingredient still resolving where used but gone from the add picker; a deleted ingredient rendering a marked row instead of vanishing |
| `test-density.js` | 29 | Density resolution without a DOM: explicit beats reference beats category beats guess; the measured values; the categories that refuse to guess; and the stock arithmetic that now stops treating a litre of oil as a kilogram |
| `test-search.js` | 18 | Search ordering: names starting with the query first, then a later word of the name, then INCI, then mid-word, then notes; checked in the Ingredients list and the Formulations dropdown |
| `test-ph.js` | 75 | pH records: parsing and range checks; which formulas get pH (water phase only, never soap); the bench sheet block; the version target (validation, history, mirroring, new versions, approval lock); usage-log steps; a batch's final pH against the target it was made with |
| `test-version.js` | 25 | One app version: no footer types its own, and every page (landing page included) shows core's version |
| `test-starter.js` | 84 | Quick add: the by-type starter list (one entry per ingredient, grades kept apart, no borrowed prose, no stored SAP, former names recognised), search and chips, SAP from SoapCalc as oils are added, in-library marking, the removed buttons |
| `test-lowdown.js` | 35 | Drafted lowdowns: every starter ingredient has one that fits; the Fill in lowdowns review (blank only, name or former name, never her own words or purpose notes); the draft tag, its keep tick, and editing as confirmation; Quick add brings drafts; melting point off the cheat sheet; the cheat sheet fits at 1280px with no highlighting |
| `test-dialogs.js` | 28 | In-page dialogs driven by real clicks and keys (danger focus, Escape, Enter, queue, escaping, focus return), plus a scan that fails if any browser pop-up returns to an app file |
| `test-pwa.js` | 41 | Installable app and offline copy: manifest, icon sizes and page tags; every file a page loads is in the service worker's `APP_FILES`; served over a local http server, the worker saves every file, a site change shows on the next load (network first), a slow network falls back after about 4 seconds, every page opens with the server stopped, installed-mode links stay in the window, Settings shows the status, and clearing the saved copy leaves data alone |
| `test-theme.js` | 37 | Dark mode: each colour's role turns the right way and keeps its hue; every palette's dark version meets contrast for text, buttons, tints and warnings; the Light / Dark / Match my computer setting, following the computer, other open windows, printing in light, the landing page logo, and a contrast sweep over the main views of every module |
| `test-packaging.js` | 95 | Packaging kinds: reading old free-text names (sizes like .5 oz, 1.5x.5 and 28mm, PET, cobalt, front/back, the product a label is for); the one display name; grouping and search; old items under Needs sorting, and giving one a kind without touching stock; the edit panel's Details and Stock tabs; the edit panel (kind first, fields by kind, Other needs a name, duplicate warning, Used in, photo removal); literal colors in dark mode; the shared picker in Batches and Products & Costing writing through the original select |
| `test-suppliers.js` | 36 | Suppliers as a slide-in panel on every page: what each supplies, matched by name; rename following the name onto lots and items; names not saved, with a match for another spelling; the Library section |
| `test-kits.js` | 88 | Kits built from filled products, units on hand, Not for individual sale, Update stock (reasons, Returned, Reconcile, the over-limit stop), unit cost on the day, Stock history, and fills that cannot be reversed below zero |
| `test-lots.js` | 79 | Lot codes and the formulation log: the code from the date with a letter for a second batch that day, codes for older batches in made-time order, no two batches sharing one, fills keeping a copy; the version a batch was made from; log entries linked to one batch by hand, in two sections (Making, How it turned out), never empty, never two for one batch; older entries; Trace back to supplier lots and forward to fills and kits; the lot sticker |
| `test-effective-ph.js` | 23 | Effective pH ranges: reading free-text ranges (open sides, the first range in a sentence); the warning when a version's target or a batch's final pH falls outside an ingredient's range, and the note for a preservative with none; the relabelled field; the starter preservatives' ranges and sources; the review that fills them in |
| `test-costs.js` | 27 | Incomplete costs: in Products & Costing a missing ingredient or packaging price makes a cost a floor ("at least"), flagged in the list and named, margins "at most"; packs and kits inherit it; core's unit cost still agrees. Formulations names what is not counted, quietly (soap too). Made in-house or free counts as $0 and flags nothing |
| `test-links.js` | 12 | Links into a page that is already open: a new hash reloads the page so the link acts (lot sticker, back to batch, make batch, log entry, ingredient); unsaved edits ask first; links are cleared once followed so the same one works twice |
| `test-consign.js` | 25 | Consignment: consigning moves units from the shelf to a shop; Update stock's Consign mode (shop picker, adding a shop, the over-shelf stop); the Consignment panel and settling up (sold, back, what stays, the over-shop stop, shop history); a product's shelf and shops; stock history counting shop sales only, By shop; a consignment that cannot be removed once its units moved on; shops in the export |
| `test-stock.js` | 51 | Stock solutions: a stock's parts and their real share in a finished formula; INCI order with a stock opened (and unchanged without one); a stock is never free by the switch; the Stock solution panel (create, link, unlink); a stock line's parts, the INCI panel, the pH check and the cost note in Formulations; making a stock adds a priced lot with its lot code; a toner drawing on it, its trace through the stock to the supplier lots, Used in; yield and lot code edits following to the lot, and no delete or decommit while it is used; adding a batch made before the link; Ingredients' made-from note and keeping the batch link on save; the product label in P&C |

## How they run

`test-lock.js` uses jsdom. The others drive headless Chromium through
Playwright, because they assert on things jsdom does not model: a disabled
input's computed style, a native `confirm()` dialog's text, a rendered row.
`test-pwa.js` serves the real files from a small Node http server instead of a
preview, since a service worker cannot register on `file://`.
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
