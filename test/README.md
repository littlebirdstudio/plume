# Tests

Regression suites for the parts of Plume where a quiet wrong answer is worse
than a crash: the approved-version lock, the delete guards, archiving, and the
INCI label list.

## Running them

From the repository root:

    npm ci
    npx playwright install chromium
    npm test

`npm test` runs all four suites and stops at the first failure. To run one:

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

## How they run

`test-lock.js` uses jsdom. The other three drive headless Chromium through
Playwright, because they assert on things jsdom does not model: a disabled
input's computed style, a native `confirm()` dialog's text, a rendered row.

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
