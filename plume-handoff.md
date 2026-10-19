# Plume by Little Bird Studio — Project Handoff

**Last updated:** 16 October 2026 (sessions 6-16)

> **READ THE SESSIONS 15-16 SECTION AT THE END FIRST.** Claude now has write
> access to the repository and work goes through pull requests, which changes
> the working loop described further down. Several statements in the older
> sections are superseded there, including the claim that the GitHub connector
> is read-only.
**Previously known as:** Aerie by Little Bird Studio (renamed to Plume in session 1)

**Business context:** Skincare and soap formulation management system. Currently scoped for personal use by Heide, with active plans to package and sell a version to other small formulators. The market gap is real and now well-characterized — see "Sellable-version strategy" near the end of this document. Little Bird Studio also has pottery and sewing arms; Plume is its cosmetic/skincare branch.

**Brand architecture:** Little Bird Studio is the parent maker identity (pottery, skincare, sewing — unified by Heide's taste, not category). Plume is specifically the skincare/formulation line under Little Bird Studio. The formulation tool currently sharing the Plume name will eventually need its own name when packaged for sale to other formulators. Current plan: keep "Plume" for the personal-edition tool; build a separately-named "clean fork" later as the sellable product. **The sellable fork still has no name — this is an open decision that gates domain, positioning, and copy.**

**Status as of session 12:** The app is in real production use. Heide has published the Little Bird Studio website and is actively making products with Plume rather than test-clicking it. Sessions 9 and 10 work came entirely from lived friction, which is the intended source.

**Live context — an in-person market is coming up.** Session 10 was largely driven by preparing for it: point-of-sale decisions, barcode generation, and label printing. Heide is roughly two weeks ahead of schedule, which she explicitly contrasted with a previous sale where barcodes were attempted the night before and did not work. Preserve that slack — the remaining tasks are physical tests that need lead time to fail and recover from.

**Session 11 changed the architecture; session 12 finished the job.** Formulation *versions* became parallel variant tabs rather than an archive pile, and a shared `plume-core.js` now holds the storage layer, palettes, helpers and — critically — the one canonical cost function. **All five modules are converted as of session 12.** Read "Shared core" below before editing any module.

---

## What exists — seven files sharing localStorage

All files are HTML with **vanilla ES5 JavaScript** (`var`, no arrow functions, no template literals), no frameworks, no build step. **As of session 11 they are no longer fully standalone** — converted modules require `plume-core.js` in the same folder. They live in the same folder; data lives in browser localStorage. **Hosted on GitHub Pages** at `https://littlebirdstudio.github.io/plume/`. Repository: `https://github.com/littlebirdstudio/plume`.

**Version stamp:** Footers show `v0.6` (bumped in session 7). Session 9 work did **not** bump the stamp — worth deciding whether to move to v0.7. Note also that the *print* footer inside `plume-formulations.html` still says `v0.4`, which is stale and worth fixing when convenient.

| File | Purpose | localStorage keys |
|---|---|---|
| `plume-core.js` | **Shared library** — storage layer, palettes, cost/stock helpers, storage reporting. Loaded by converted modules via `<script src>`. | (owns access to all keys) |
| `index.html` | Landing page with logo + module cards | (none) |
| `plume-ingredients.html` | Ingredients library | `aerie-ingredients-v2`, `aerie-suppliers-v1`, `aerie-brands-v1`, `plume-palette-ingredients` |
| `plume-formulations.html` | Formula editor | `aerie-formulations-v1`, `plume-palette-formulations` |
| `plume-packaging.html` | Packaging item library | `aerie-packaging-v2`, `plume-palette-packaging` |
| `plume-batchlog.html` | Production batch log | `aerie-batches-v1`, `plume-palette-batchlog` |
| `plume-costing.html` | **Products & Costing** | `plume-products-v1`, `plume-palette-products`, `plume-pricing-custom-mult`, `plume_costing_listorder_v1` |

The filename `plume-costing.html` is kept for GitHub continuity; the module display name is "Products & Costing." Data-storage keys retain the `aerie-` prefix where they predate the rename; new keys use `plume-`. **Do not change existing keys** — it would break user data.

In session 7 the old `aerie-costing-v1` key was wiped via `removeItem` on first load of the rebuilt module, since the old per-batch-pricing data didn't map cleanly to the new product-centric model.

---

## Shared core — `plume-core.js` (session 11) — READ FIRST

### Why it exists
Every module carried its own copy of the storage code, the palettes, `esc`, the modal helpers, and the cost logic. Copies drift. That is not hypothetical — it is exactly how the $0.06 vs $0.091 bug happened (see Module 1). By session 11 the same cost logic existed in four modules under three names (`bestCpg`, `ingCostPerG`, plus `lotQtyToG`/`lotQtyToGrams`), and the palettes had *already* silently diverged: three modules carried a `family` attribute Batchlog and Costing had lost.

One copy means two screens cannot disagree.

### Conversion status
| Module | Converted? |
|---|---|
| `plume-formulations.html` | ✅ session 11 |
| `plume-ingredients.html` | ✅ session 11 |
| `plume-costing.html` | ✅ session 12 |
| `plume-batchlog.html` | ✅ session 12 |
| `plume-packaging.html` | ✅ session 12 |

**The conversion is complete, which unblocks the driver swap.** While it was half-finished the state was safe only because `Store` writes through to localStorage synchronously; a converted module and an unconverted one saw the same data. That would have broken the moment the driver became async. Every module now reads and writes through `Store`, so `Store.useDriver()` is genuinely usable — nothing bypasses the seam.

**Verified by test, not by inspection.** `test-cross-module.js` loads all five pages against one seeded library and asserts that `bestCpg`, both `ingCostPerG`s, `activeCost` and `Plume.costPerG` return the identical value for every ingredient shape. The bug that started this cannot recur silently.

### How a module uses it
```html
<script src="plume-core.js"></script>
<script>
  /* ...module code... */
  Plume.setModule('formulations');   // names the palette key
  Plume.boot(function () { loadAll(); });
</script>
```
`Plume.boot` injects shared CSS, wires the quota handler, hydrates storage, applies the module's saved palette, then calls back and renders the storage banner.

All five modules guard against a missing core with a plain-language red banner (`if (typeof Plume === 'undefined')`) that says where the file goes, to hard-refresh, and that **data is safe because it lives in the browser, not in these files**.

**Session 12 note:** this document previously claimed both converted modules had the guard. Formulations did not — it called `Plume.setModule` unconditionally and would simply have thrown. Added in session 12, so the claim is now true. *Lesson: a handoff assertion about code is a claim to verify, not a fact to rely on.*

### What core provides
- `Plume.Store` — the storage seam (see below)
- `Plume.costPerG(ing)`, `qtyToGrams(qty, unit, density)`, `stockG(ing)`, `stockGOrNull(ing)`, `stockState(ing, needG)`
- `Plume.esc`, `openModal`, `closeModal`, `todayISO`, `parseLocalDate`, `fmtDate`, `fmtBytes`
- Palettes: `setModule`, `applyPalette`, `selectPalette`, `renderPaletteSwatches`, `loadPaletteChoice`
- Storage reporting: `storageReport`, `renderStorage`, `renderStorBanner`, `noteSaveFailed`, `noteSaveOk`
- `Plume.KEYS`, `Plume.KEY_LABELS`, `Plume.VERSION`

### Global aliases — the conversion mechanism
Core defines globals with the names modules already use, so **converting a module means DELETING its local copies; no call sites change.** `bestCpg` and `ingCostPerG` both alias `Plume.costPerG` — that is the whole point. Also aliased: `esc`, `openModal`, `closeModal`, `lotQtyToG`, `lotQtyToGrams`, `calcIngStockG`, `stockG`, `stockState`, `fmtKB`, `fmtDate`, `todayISO`, and the palette functions.

**A module may override an alias by defining its own function** — this is the intended escape hatch. `plume-ingredients.html` keeps a local `openModal` because it snapshots form state to detect unsaved edits. Share the common case; keep the exception local.

### Versioning
`Plume.VERSION` is displayed at the bottom of every converted module's Settings → Storage panel, alongside the active driver name. **Bump it on every core change.** Browsers cache `.js` far more stubbornly than they re-fetch a replaced HTML file, so "is core loaded, and is it the one I just uploaded?" must be answerable by looking. Current: **v1.10** (v1.8 added INCI blend splitting; v1.9 added density resolution; v1.10 ranked search results, best match first; v1.11 added pH records; v1.12 made it the one app version, shown in every footer; v1.13 rebuilt Quick add; v1.14 drafted lowdowns; v1.15 replaced the browser pop-ups with in-page dialogs).

### Upload order matters
`plume-core.js` **first**, then the HTML. A module that arrives before core shows the missing-core banner until core lands. Core alone breaks nothing.

---

## `Plume.Store` — the storage seam (session 11)

### Why it holds a cache
localStorage is synchronous; IndexedDB and any web API are not. A shim that merely wrapped `getItem`/`setItem` would keep the synchronous shape and could therefore never be backed by anything async — swapping the backend would still mean rewriting every call site. So `Store` hydrates an in-memory cache at boot; **reads are synchronous because they come from memory**, and the only async moment in a Plume page is `Plume.boot`.

### Driver interface
```js
{ name, load(cb), save(k, v) -> bool, remove(k) }
```
`Store.useDriver(d)` then `Store.init(cb)` is the entire migration. **A driver that returns `true` on a failed write makes a full disk look like a working app. Return `false`.** This is verified by test: an async driver was swapped in and the app rendered and saved identically with zero app-code changes.

### Save-failure contract
`Store.set`/`setJSON` return `false` rather than throwing. Module save functions must check and call `Plume.noteSaveFailed()`, which shows a red banner offering an immediate backup download and alerts **once** (not per save). Since saving is now automatic in Formulations, a silent write failure would otherwise go unnoticed for a whole session.

---

## Browser storage limits — the hard ceiling (session 11)

**~5MB per origin, shared across all Plume modules, not raisable.** Not a setting; browsers hardcode it. Chrome and Chromium browsers are fixed at 5MB.

**Safari/iOS caveat:** Safari's ITP deletes *all* script-writable storage — localStorage **and IndexedDB** — after 7 days without user interaction with the site. This applies to every browser on iOS, since they must use WebKit. Adding the site to the home screen exempts it. **Heide uses Chrome, which has no equivalent rule**, so this is not currently a live risk — but it means migrating to IndexedDB would raise the ceiling and do *nothing* for eviction. Only a real backend fixes both.

### Measured reality (session 11, Heide's actual data)
Total 1.96MB / 39%. **Packaging photos were 74% of everything** — 1.44MB of base64 images, with `image` at 99% of the packaging module. Ingredients was 455KB (`generalInfo` 62%, `lots` 13%). Formulations 35KB.

### Photo optimisation (Packaging, session 11)
Photos were stored at 800px/q0.75 but only ever displayed as a 48px list thumbnail and a 180px modal preview — roughly 4× the pixels that can be seen. New uploads now use `PHOTO_MAX_W = 480`, `PHOTO_QUALITY = 0.72`. Settings → Photo storage has a **Shrink stored photos** button that re-encodes existing images, writing back only when the result is smaller (so re-running is a safe no-op). **Real result: 1.44MB → 892KB across 32 photos.** JPEG size does not scale linearly with pixel count — downscaling concentrates detail — so a 4× pixel reduction gave ~40%, not 65%.

**Do not trim `generalInfo` to save space.** It is ~240KB (12% of total) and is the Formula Botanica reference text, most useful for ingredients not yet purchased. One re-compressed photo beats the whole thing.

### Storage diagnostics
Settings → Storage shows total usage against 5MB, a per-module breakdown, and **"What is using the room?"** which walks records and reports bytes per field for the two largest keys. A warning banner appears past 75%.

**It enumerates actual keys rather than checking a list of expected names.** A hardcoded list already misreported once — `aerie-packaging-v2` and `plume-products-v1` were being looked for under wrong names, landing in an unlabelled "Other" bucket and hiding the single largest consumer. The drilldown also picked the largest *recognised* key rather than the largest key. Both fixed; do not reintroduce a hardcoded key list.

---

## Module 1: `plume-ingredients.html` — Ingredients library

### Header
Nav: `Formulations` · `Packaging` · `Products & Costing` · `Batches` · `Export` · `Import` · `⚙ Settings`
Section header: `Ingredients` title with `+ New ingredient` button next to it.

### Settings modal sections
- **Appearance** — palette switcher (12 presets)
- **Data import** — Quick add (the starter list in `plume-starter.js`, which since session 17 includes the Formula Botanica directory). The separate reference-JSON import was removed in session 17.
- **Maintenance** — Check SAP values against reference. "Patch soap data" was removed in session 17: it copied the stale seeder SAP values back in.

Buttons inside settings modal use `.btn` (not `.btn-ghost`) — ghost styling is for the dark header and is invisible on white modal backgrounds.

### Stats row
Total ingredients · Suppliers count (unique suppliers actually assigned to ingredient lots, not total in database).

### List view
- Search by name, INCI, or supplier
- Function filter dropdown of 14 primary functions
- Recently viewed pills (last 6 ingredients opened)
- Low-stock filter toggle (off by default — unobtrusive)
- Library grid: Name · INCI · Function · Active supplier · Cost/g · Stock
- **In-stock rows get a `--clay-light` row tint** (this is the visual convention session 9 mirrored into Formulations)

### Ingredient record fields
- Identity: name, INCI, function, sub-function, notes, resources (URLs)
- Soap data: SAP NaOH, SAP KOH, fatty acid profile, soap properties (oils + butters only)
- Lots: array of purchase lots with supplier, brand, qty, unit, cost/g, lot#, best-by, received date

### Lot system
Each ingredient has one or more **lots**. A lot represents a specific purchase:
- `costPerG` is the cost per gram, auto-computed from purchase price + size when both filled
- `referenceOnly: true` is the "watchlist" flag — ingredients you're considering but haven't bought. These don't contribute to cost calcs and don't count toward stock.
- `activeLotId` on the ingredient marks one lot as the "current" lot — used as the cost source when multiple lots have valid `costPerG` values.

### Canonical stock and cost helpers — NOW IN `plume-core.js` (session 11)
These no longer live here. `lotQtyToGrams` was deleted and `activeCost(ing)` delegates to `Plume.costPerG(ing)`. Verified case-by-case against the previous local implementation before switching.

**Stays local:** `getActiveLot(ing)` returns the lot *object* (needed for supplier, lot number, best-by). Core only answers cost. `migrateLots(ing)` and `calcTotalStockG(ing)` also stay — `migrateLots` synthesises a lot from legacy `supplier`/`cost` fields and is this module's own concern.

**Cost cascade (canonical — now one implementation in core):**
1. No real lots but top-level `ing.cost` exists (legacy) → use it
2. `activeLotId` set → **that lot is AUTHORITATIVE**. Its `costPerG` if usable, otherwise `null`
3. No `activeLotId` (or it points at a deleted lot) → cheapest **non-`referenceOnly`** lot with a usable cost
4. Nothing usable → `null`

**Step 2 changed in session 11.** Ingredients always behaved this way; Costing and Formulations fell *through* to another lot when the active lot had no cost — pricing a product at a number never chosen, the same failure as the watchlist bug. Core now returns `null`. **Visible effect:** an ingredient whose active lot has a blank cost now shows a missing cost in Formulations/Costing where it previously showed a figure. That is missing data becoming visible, not a regression; filling in the lot's cost/g resolves it.

**Lot field names — read before touching stock code.** Quantity is `qtyPurchased` with legacy fallback `stock`; unit is `qtyUnit` with legacy fallback `stockUnit`. **There is no `l.unit` field.** Reading a wrong field name does not throw — `qtyToGrams` falls through and returns the raw number as grams, so an 8 oz lot silently reads as 8 g. This exact bug shipped in session 11 and reached production before Heide caught it.

### Resurrection / reversal banners
When the Batchlog decommits a batch (delete/etc.):
- If the original lot still exists, its stock is restored — gets a **sage ↺ "Resurrected"** banner if the lot had been depleted
- If the original lot was deleted between commit and decommit, a "ghost reversal" lot is created with a **clay ↺ "Reversal"** banner and explanatory notes

---

## Module 2: `plume-formulations.html` — Formulations editor

### Header
Nav: `Ingredients` · `Packaging` · `Products & Costing` · `Batches` · `Export` · `Import` · `⚙ Settings`
Section header: `Formulations` title with `+ New formulation` button next to it.

### Coverage
Supports cold process (CP) and hot process (HP) soap formulations alongside lotions, creams, balms, oil blends.

### Soap-specific behavior
- Oil weight model — soap lines use `gramsFixed` (absolute grams) instead of `pct`
- Lye calculator (auto-computed from oils + SAP values + superfat %)
- Soap quality bar (cleansing/conditioning/bubbly/creamy/hardness/iodine/INS)
- Soap-specific print page
- "Add-ins" (fragrance, EOs, etc.) flagged with `soapAddin: true` — excluded from the 100% total. The "Add-ins in total %" toggle controls whether they're included in the percentage math per-formula.

### Line shape (CRITICAL — used by Products & Batchlog to read formulation data)
```js
{
  ingId:       "...",      // NOT "ingredientId"
  pct:         50,          // NOT "percent"
  gramsFixed:  100,         // for soap oils; mutually exclusive with pct per formula
  pinned:      false,
  soapAddin:   false,
  addin:       false,       // skincare drops-based add-in (opt-in mode)
  phase:       "cool-down", // OPTIONAL per-line phase override (session 9)
  drops:       "",
  dropsPerG:   20
}
```

Anyone reading formulations from another module must use `ingId`, `pct`, `gramsFixed`. Getting the field names wrong silently produces zero costs and missing label data (caught in session 7).

### Add-in semantics — the two kinds are NOT the same
This caused confusion in session 9 and is worth stating plainly:

- **Skincare add-ins** (`addin: true`) are an **opt-in mode** you toggle before adding an ingredient. They're drops-based and sit outside the percentage math. The *default* for a skincare ingredient — including essential oils and actives — is a normal `pct` line that **is** counted in the % total. So an active at 2% of formula weight is just a regular line.
- **Soap add-ins** (`soapAddin: true`) default the *other* way: fragrance, EOs, colorants, exfoliants are measured in absolute grams (PPO convention) and excluded from the oil-weight percentage total.

The asymmetry is correct and intentional — it matches each craft's convention, not internal consistency.

### Stock-on-hand indicator (session 9)
Mirrors the Ingredients module's visual convention so the two feel coherent. Helper functions live near `bestCpg`:

```js
lotQtyToG(qty, unit, density)   // same conversions as Ingredients
stockG(ing)                     // total grams, 0 when nothing usable; excludes referenceOnly
stockState(ing, needG)          // 'enough' | 'partial' | 'none'
```

`stockState` semantics: when `needG` is 0 or absent (no amount entered yet), *any* positive stock reads as `'enough'`. When `needG > 0`, it compares against required grams with a 0.001g float-fuzz tolerance.

**Three visual states:**
- `enough` → `--clay-light` row tint
- `partial` → warning-color left border (3px) + a small note reading `240g on hand · need 500g`
- `none` → no tint (default look)

**Where it appears:**
- **Search dropdown** — `.dd-item.in-stock` tint, plus a `.dd-stock` gram readout next to the phase pill (formats as kg at ≥1000g). Always in "any stock" mode since no amount exists yet at pick time.
- **Line rows** — skincare rows, soap oil rows, and soap add-in rows.
- **Ingredient quick-detail snapshot** — a "Stock on hand" field below the four-cell grid, clay-dark when stocked, gray "None on hand" when not.

**Live updates:** state recomputes on every `renderLines()`, which already fires on batch-size change, pct entry, pinning, etc. So bumping batch size from 100g to 500g lights up partial-stock indicators automatically.

**Precedence:** formulation warnings (`.warn` over/under min-max, `.no-sap`) win visually over stock states — a broken formula is more urgent than a shopping reminder. Selectors use `:not(.warn)` / `:not(.no-sap)` to enforce this.

**Known asymmetry:** skincare add-in rows do *not* get the clay tint (`:not(.addin)`) because they keep their cream + dashed-border identity. Soap add-in rows *do* get it, since `.soap-row.addin` has no distinct styling. User-visible behavior is consistent even though the CSS differs.

### Per-line phase override + drag-to-reorder (session 9)
Two separate affordances, deliberately not unified into one drag gesture — reordering is a visual preference, re-phasing is a formulation decision, and Heide wanted both visible.

**Phase resolution:**
```js
function effPhase(line, ing) {
  if (!line) return 'other';
  if (line.addin) return 'addin';        // pseudo-phase; keeps add-ins out of phase groups
  if (line.phase) return line.phase;     // per-line override
  return (ing && ing.phase) ? ing.phase : 'other';
}
```

**The override lives on the formulation line, never on the ingredient.** This is the whole point: rosehip's master phase is "oil" because that's its chemical home, but a given emulsion may need it in cool-down. Overriding per-line means the same ingredient can sit in different phases across different formulas. `setLinePhase()` **deletes** `line.phase` when the chosen phase equals the ingredient default, so data stays clean rather than storing redundant values.

Why this exists: some oils are heat-intolerant and must go in cool-down even though they're chemically oil-phase. There is no automatic trigger for this — it still relies on formulator knowledge. The override just makes the intent recordable. (Polarity-compatibility warnings would be a deeper feature; not attempted.)

**UI:** a `.phase-pill` after any pinned/add-in badges shows the effective phase with its colored dot. Click opens `openPhaseMenu()` — a fixed-position menu listing all five phases, marking the ingredient's default, plus a "↵ Reset to ingredient default" row when an override is active. Overridden pills get `.overridden` styling (clay tint + `*` mark).

**Drag-to-reorder:** HTML5 drag-and-drop, `.drag-handle` (⋮⋮) at the left of each row name. Constrained to **same effective phase only** — cross-phase movement goes through the pill, not the drag. Drop position shown via `.drag-over-top` / `.drag-over-bottom` inset box-shadow in `--clay`. The `dragstart` class add is deferred with `setTimeout(…, 0)` so the browser snapshots the drag image first.

**Reorder splice arithmetic** (verified against 9 cases):
```js
var item = fLines.splice(srcIdx, 1)[0];
var adjTarget = (srcIdx < targetIdx) ? targetIdx - 1 : targetIdx;
fLines.splice(insertBefore ? adjTarget : adjTarget + 1, 0, item);
```

**Both `renderLines()` and the skincare print view group by `effPhase`**, so printed formula cards reflect overrides. Overrides save with the formula and its versions.

### Cost resolution — `bestCpg()` (rewritten session 9)
**This was a real bug.** The old implementation was a plain `Math.min` across all lots, ignoring `activeLotId` and including `referenceOnly` lots. Result: Formulations priced a product at $0.06/g while Costing said $0.091/g for the same thing — a ~50% gap, because a cheap watchlist or superseded lot was winning the min while Costing correctly read the active lot.

It now mirrors the canonical cascade documented under Module 1. The function name `bestCpg` is a misnomer (it's no longer "best" as in cheapest) but was kept to minimise the diff across its six call sites.

**Session 11: `bestCpg` is now a one-line alias for `Plume.costPerG`.** So is Costing's and Batchlog's `ingCostPerG`. They cannot drift because there is nothing left to drift from. Note that Ingredients — not Costing — turned out to have the most correct behaviour for the active-lot-without-a-cost case; see Module 1.

### Variants — versions as tabs (REPLACED the snapshot model, session 11)

**The old model was wrong about what versions are.** It treated them as *iteration history* — a working copy plus an archive pile, where "Restore" rewound the working copy **and its version number**, so archived version numbers could repeat and the history described things that hadn't happened.

Heide's actual use is *parallel variants*: a lotion bar made with candelilla and one made with beeswax when candelilla ran out. Both permanently valid, neither superseding the other, switched between based on what is in stock. That is a different shape entirely.

**Data model.** A formulation owns `variants[]` and an `activeVariantId`.

Formulation-level (shared by every variant): `name`, `type`, `notes` (intention/purpose), `formNotes` (the Notes tab).
Variant-level: `vid`, `num`, `label`, `status`, `lines[]`, `instructions`, `batchSize`, `addinsInTotal`, `soapSettings`, `usageLog[]`, `history[]`, `branchedFrom`, `branchNote`.

**Downstream compatibility — important.** `syncActive(f)` mirrors the active variant onto the formulation's top-level `lines`, `status`, `instructions`, `addinsInTotal`, `soapSettings`, `version`. **Costing and Batchlog read `f.lines` directly and need no changes** — they always see whichever variant is in use.

**THE TRAP:** a future module that *writes* to a formulation must write to the active variant, not the top level, or the mirror is clobbered on the next sync.

**`batchSize` is deliberately NOT mirrored.** Batchlog reads `f.batchSize` with a fallback of 100 and Formulations never wrote it. Writing it now would silently change how pinned-gram lines scale in existing batches. It lives inside the variant only.

**UI.** Tabs under the formula name, each with an optional short name (e.g. "Candelilla", "Beeswax sub"); a dot marks the variant in use. Action bar below: "Use this version" / Rename / Delete. `+ New version` branches from the variant being viewed. A separate **Notes** tab at the right end of the strip holds formulation-level notes; it is styled differently so it doesn't read as selectable-for-use.

Meta fields carry `all versions` / `this version` scope badges. Status is per-variant — candelilla can be approved while an experiment is still testing.

**Migration is conservative.** Each formulation becomes ONE variant holding its current content; every archived snapshot becomes a revertable entry in that variant's history, labels preserved. Nothing is guessed into being a separate tab. **The legacy `f.versions` and `f.usageLog` arrays are left in place untouched** rather than deleted, so nothing is destroyed if the migration is wrong. Migration runs on load and on import, and is idempotent.

### Change history (per variant, session 11)
Auto-diffed on every save — the app records *what* changed ("Shea butter 75% → 72%", "Added Beeswax at 28%"), the user optionally adds *why* via `+ why?`. A save that changes nothing meaningful logs nothing.

**Append-only.** Reverting logs the current state first, applies the old content, then records the revert as its own entry. Nothing is erased and version numbers never move backward — that was the old model's central defect.

**Retention:** a "why" note makes an entry permanent (as do `created`/`revert`/`archived` kinds). Unnoted automatic entries: most recent 60 kept as text, most recent 12 keep restorable snapshots. Noted entries: 25 keep snapshots, text kept forever. Caps: `HIST_SNAP_CAP`, `HIST_NOTED_CAP`, `HIST_TEXT_CAP`.

**Panel display:** 5 entries by default with "Show all N"; expanding scrolls inside the panel rather than stretching the page. A "Show only the N noted" filter appears once anything is noted.

### Saving is automatic (session 11)
Switching variants, opening the Notes tab, leaving for the list, duplicating, and Make batch all save quietly. **All "unsaved changes?" prompts were removed** — nothing is at risk either way, since every meaningful change is logged in history and revertable, so the prompt was friction protecting against something already protected.

**Batch size does not mark the formula dirty.** It is a preview control (click 250g to see the amounts), remembered per variant but never putting the formula in an unsaved state. A variant with no saved batch size falls back to the type default rather than inheriting the previous variant's.

The one remaining confirm: Make batch while viewing a variant that isn't in use, which names which one it will actually make.

- "Duplicate" button: copies the whole formulation with all variants; each copy gets status:draft, fresh usage log, fresh history, and a `branchNote`

### "Make batch"
Bottom of batch-size panel. Opens Batchlog with `#new=<id>&y=<grams>` deep-link to pre-fill yield and select formula.

---

## Module 3: `plume-packaging.html` — Packaging items library

### Header
Nav: `Ingredients` · `Formulations` · `Products & Costing` · `Batches` · `Export` · `Import` · `⚙ Settings`
Section header: `Packaging items` title with `+ New item` button next to it.

### Each packaging item
- name, capacity (free text like "1oz" or "30ml"), category, notes, photo (with auto-compression on upload)
- `purchases[]`: each purchase has `date`, `qty`, `totalCost`, `shipping`, `supplier`, `lotNum`, `notes`
- `adjustments[]`: positive (manual restock) or negative (committed to a batch) adjustments

### Stock = sum of purchase qty + sum of adjustments

### Unit cost (used by Products & Costing)
`(totalCost + shipping) / qty` from the most recent purchase with valid data. **CRITICAL:** the field is `totalCost` plus `shipping`, NOT a single `price` field.

### Converted to core (session 12)
`esc`, `openModal`/`closeModal` and the palette block were deleted; `loadData`/`saveData` route through `Store`. `fmtSize` is kept as a one-line delegation to `Plume.fmtBytes` rather than a deletion, because the photo panel calls it in four places and core reaches the same implementation under two other names already — the implementation is shared, only the name is local.

`optimisePhotos()` now **checks the result of `saveData()`** before reporting bytes reclaimed. It previously announced a saving whether or not the write landed, which in the one module most likely to hit the storage ceiling was exactly backwards.

### Image storage
Inline base64 data URLs in localStorage. `PHOTO_MAX_W = 480`, `PHOTO_QUALITY = 0.72` (was 800/0.75 before session 11 — roughly 4× more pixels than the 48px thumbnail and 180px preview can show). Settings → Photo storage has a **Shrink stored photos** button for existing images. See "Browser storage limits" above — packaging photos were 74% of all Plume storage.

---

## Module 4: `plume-batchlog.html` — Batch log

### Header
Nav: `Ingredients` · `Formulations` · `Packaging` · `Products & Costing` · `Export` · `Import` · `⚙ Settings`
Section header: `Batches` title with `+ Add batch` button next to it.

### Concept
Tracks actual production runs of the **bulk recipe**. When you "Make it!" from a formulation, a batch is created. The batch holds the ingredient snapshot at make-time, tracks curing status for soaps, and records packaging runs.

### Auto-commit model
Ingredients commit on batch save; packaging commits per-run on add. There is no manual commit/decommit step in the UI anymore. The legacy `commitBatch()` is kept as a safety belt but its UI button is hidden.

**Atomic blocking:** If `Make it!` finds insufficient ingredient stock, the batch is NOT created. The popup stays open with all form values preserved, and a blocked-message panel shows per-shortage with deep-links to the affected ingredients (`plume-ingredients.html#ing=<id>`). Same atomic rule for packaging.

### Multi-component packaging runs
A packaging run is a **single event grouping multiple components together**, not one row per component:
```js
{
  id:          "...",
  date:        "2026-05-18",
  notes:       "First batch of 1oz tins",
  components:  [
    { packagingId: "tin1oz",    packagingName: "1oz tin",      quantity: 6 },
    { packagingId: "labelTop",  packagingName: "Top label",    quantity: 6 }
  ],
  committed:   true,
  committedAt: "..."
}
```

**Legacy single-component runs** still render correctly — `runComponents(r)` normalizes both shapes. No data migration needed.

### Converted to core (session 12)
`esc`, `todayISO`, `lotQtyToGrams`, `calcIngStockG`, `ingCostPerG`, the modal helpers and the palette block were all deleted. `gramsToLotQty` stays — it is the inverse converter and only this module writes decremented quantities back.

**`fmtDate` stays local as a three-line wrapper**, not because the date maths differs but because this module renders `'--'` for a missing date where core returns `''`, and that dash is load-bearing in the batch list. The wrapper checks for empty and delegates everything else to `Plume.fmtDate`. This is the documented escape hatch — share the common case, keep the exception local — and it is the right shape when the difference is presentational rather than logical.

All three save functions (`saveBatches`, `saveIngredients`, `savePackaging`) now return a boolean and call `Plume.noteSaveFailed()`. This matters more here than anywhere: a commit writes decremented lot quantities *and* the batch record, so a silent half-write would leave stock figures and batch history disagreeing.

**The deep link moved inside `Plume.boot`'s callback.** It used to run immediately after a synchronous `loadData()`; boot is asynchronous, so `handleDeepLink()` had to move with it or it would check an empty `forms` array and silently decline to open the popup. Covered by `test-batchlog-deeplink.js`.

### Date timezone fix
`fmtDate` parses `YYYY-MM-DD` strings as local time rather than UTC. Previously, negative-offset zones (Alaska, US Pacific) displayed dates one day earlier than entered:
```js
if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
  var parts = iso.split('-');
  d = new Date(+parts[0], +parts[1]-1, +parts[2]);
} else {
  d = new Date(iso);
}
```

### Soap-formula handling
- Curing weeks (4 or 6) shown only for soap types
- Ready date = batch date + cure weeks
- Status: `curing` → `ready` → `depleted`
- "Mark ready now" button visible only for currently-curing batches (no auto-transition)

### Batch object shape
```js
{
  id, date, formulaId, formulaName, formulaType, batchName, batchType,
  targetYield, actualYield, cureWeeks, readyDate, status, notes,
  ingredientSnapshot: [{ ingredientId, ingredientName, grams }],
  packagingRuns:       [...],     // multi-component runs
  committed:           true,      // always true in auto-commit model
  committedAt,
  lotDraws:            [...],     // receipt of what came from which lot
  packagingDraws:      [...],     // flat list of {runId, packagingId, packagingName, quantity}
  createdAt, updatedAt
}
```

### Deep-link contracts
- `#new=<formulaId>&y=<grams>` — auto-opens new-batch popup with formula and yield pre-filled
- `#batch=<id>` — auto-opens batch detail modal

---

## Module 5: `plume-costing.html` — Products & Costing

### Header
Nav: `Ingredients` · `Formulations` · `Packaging` · `Batches` · `Export` · `Import` · `⚙ Settings`
Section header: `Products` title with `+ Add product` button next to it.

### What it is
The salable thing. A "product" defines what you sell — name, SKU, what it's made from, packaging recipe, net weight per unit, retail and wholesale prices.

### Product object shape (updated session 9)
```js
{
  id, name, sku, barcode, status,           // status: 'active' | 'draft' | 'discontinued', defaults 'active'
  productKind: 'single' | 'multi',          // session 9; absent = 'single'
  formulaId, netWtG,                        // single mode
  components: [                             // multi mode (sample packs / kits / sets)
    { id, formulaId, netWtG, label }
  ],
  netWtDisplay, notes,
  packagingRecipe: [{ packagingId, quantity }],
  retail, wholesale,
  labelMode:         'inci' | 'common',
  labelOverrideOn:   false,
  labelOverrideText: '',
  productionRuns:    [{ id, date, units, batchId, notes, addedAt }],
  createdAt, updatedAt
}
```

**Backward compatibility:** a product with no `productKind` is treated as `'single'` and behaves exactly as before. Verified explicitly in tests.

### Multi-component products — sample packs, kits, gift sets (session 9)
The problem: a sample pack contains a 3mL face oil and a 5mL cleansing oil, in mini bottles never sold individually. It doesn't pull from a single formulation, so the single-`formulaId` model couldn't express it.

**Solution chosen:** first-class multi-component products. A **Product type** radio at the top of the editor switches between "Single formulation" and "Multi-component (sample pack / kit / set)". Multi mode reveals a **Components** editor — one row per piece with formulation picker, net weight in grams, optional label, and a live per-component ingredient cost. Packaging is shared across the whole pack via the existing packaging recipe.

Cost math: `Σ (formulationCostPerG(component.formulaId) × component.netWtG) + packaging`.

**Two alternatives were considered and rejected:**
- Hand-entering mini-costs as packaging line items — fast, but the cost goes stale when ingredient prices change and it isn't linked to real formulations
- Creating standalone "mini" products and bundling them — clutters the catalog with things never sold individually

The live link to real formulations was the deciding factor: sample-pack cost updates automatically when face oil ingredient costs change.

**Related behaviors:**
- Multi products group under a dedicated **"Sample packs & kits"** list header via `prodGroupKey()`
- Labels render **per component** (each mini bottle needs its own ingredient list). `buildIngredientList()` joins components with `\n`; the preview converts to `<br>`. `singleFormulaIngredients()` was factored out as the shared per-formula helper.
- A component missing a formula or net weight, or whose formulation lacks cost data, sets `ingCostKnown = false` and is named in a warning line in the rollup
- Production runs are unchanged — one "unit" is one sample pack

### List view
- Grouped by formulation (multi-component products group separately)
- Columns: Name+SKU · Formula · Units made · Unit cost · Retail · Margin · Wholesale · Status pill
- Search across name, SKU, formula name
- Status filter pills: All / Active / Draft / Discontinued
- Margin colors: green ≥30%, amber <30%, red negative
- **Drag-to-reorder within group** (session 9) — `.prod-drag` handle (⋮⋮) in the name cell, `draggable` on the handle only so row-click still opens the product. Constrained to same group.

### Within-group ordering (session 9)
Products used to be force-sorted alphabetically within each group, which sorts sizes wrong — `"100ml"` lands before `"15ml"` because it's a character comparison. That sort was **removed**; within-group order now follows array order and is manually draggable.

`migrateListOrder()` runs once, flagged by `plume_costing_listorder_v1`, freezing the existing alphabetical-within-group display into array order so nothing visibly jumps on first load. After that, drags are authoritative. **Consequence to expect:** new products land at the bottom of their group and need dragging into size position — a deliberate trade, since automatic sorting produced wrong size order anyway.

Group headers remain alphabetical.

### Editor
- **Identity**: name, SKU, barcode (text field), status, notes
- **Product type**: single vs multi radio (session 9)
- **What it is**: linked formulation + **"Net weight per unit (g)"** (relabeled in session 9 — the old "Net weight (g)" left it ambiguous whether it meant per-unit or per-batch)
- **Components** editor when in multi mode
- **Display weight / description (label text)** — shared by both modes
- **Packaging recipe**: multi-row picker with quantity per unit and live unit cost display
- **Pricing**: retail, wholesale
- **Cost rollup panel**: live calculation, per-component lines in multi mode, per-ingredient diagnostics when data is missing
- **Pricing helper**: multiplier-based suggestions
- **Label preview** with INCI/common toggle and override textarea, plus copy-to-clipboard
- **Production runs** sub-list, batch dropdown filtered to batches with matching `formulaId`

### Pricing helper
A thinking tool below the cost rollup. Custom multiplier row (stored in `plume-pricing-custom-mult`, defaults 4), quick-reference grid of 2×/3×/4×/5×, each cell with "→ Wholesale" / "→ Retail" promote buttons. Rule of thumb noted: 2× cost wholesale, 4-5× retail. Only renders when total cost > 0.

### Label output
Text-only. Ingredient list sorted by descending weight (`pct` for non-soap, `gramsFixed` for soap). INCI/common toggle picks the field. Override textarea can replace the auto list. Copy-to-clipboard for Etsy/Canva/Square.

### Barcode label generator (session 10)

A self-contained label tool inside `plume-costing.html`. Two entry points: a **Barcodes** button in the header nav (opens blank), and a **Label** button beside the barcode field in the product editor (opens prefilled with that product's barcode value, falling back to its SKU, with the product name as the caption).

**No external dependency.** Both symbologies are implemented inline. This was deliberate — the encoding tables are small, it preserves the project's zero-dependency architecture, and it means the tool works without a CDN.

#### Symbologies

Square Handheld reads UPC-A, UPC-E, EAN-8, EAN-13, **Code 39**, and **Code 128** (1D), plus QR and PDF417 (2D). The UPC/EAN family needs a purchased GS1 company prefix and is digits-only, so the two self-issuable alphanumeric options are Code 39 and Code 128. Both are implemented and selectable.

| | Code 39 | Code 128 (Set B) |
|---|---|---|
| Modules per character | 15 + 1 gap | 11 |
| Total width | `16N + 51` | `11N + 55` |
| Charset | 43 chars: A–Z 0–9 space `- . $ / + %` | all printable ASCII |
| Check digit | none (mod-43 optional, omitted) | mandatory mod-103 |

**Code 128 confirmed working on Heide's Handheld in session 10.** Code 39 remains the default in the UI; Heide declined persisting the format choice to localStorage, so it resets to Code 39 each time the modal opens. That was a deliberate choice, not an oversight — don't "fix" it without asking.

**Both formats uppercase their input.** This is intentional so switching format never changes the value Square receives for a code that works in both. Don't remove the uppercasing from Code 128 just because Set B could carry lowercase.

**Code 128 Set C is deliberately not implemented.** Digit-pair packing only pays off on runs of 4+ digits, which SKUs like `HSL-1OZ` and `MUG32` don't have, and it would add mode-switching complexity for no practical gain.

**Practical density ceiling** at the 7.5 mil minimum module width, with the barcode drawn at 90% of sticker width:

| Sticker width | Code 39 | Code 128 |
|---|---|---|
| 1.25 in | 6 chars | 8 chars |
| 1.5 in | 8 chars | 11 chars |
| 1.75 in | 9 chars | 14 chars |
| 2 in | 11 chars | 16 chars |
| 2.625 in | 16 chars | 23 chars |

Code 128 raises the ceiling but doesn't remove it — a 13-character code still won't scan reliably on a 1.5 in sticker in either format.

#### Architecture

```js
BC_QUIET   = 10     // quiet zone each side, in narrow-module units
BC_MIN_MIL = 7.5    // minimum module width for reliable scanning

c39Clean / c128Clean    (raw)          -> { clean, bad }
c39Modules / c128Modules(clean)        -> [{ bar:bool, w:modules }, ...]
bcClean   (raw, fmt)                   // dispatch
bcModules (clean, fmt)                 // dispatch
bcUnits   (clean, fmt)                 // total width incl. quiet zones
bcSvg     (clean, fmt, widthIn, barHeightIn, showText, caption) -> SVG
bcHeightIn(barHeightIn, showText, caption)
```

One shared renderer (`bcSvg`) consumes the module sequence from either symbology, so quiet zones, captions, human-readable text, and mil-scaling exist in exactly one place. SVG coordinates are in **mils (1/1000 inch)** so the viewBox scales uniformly and prints at exact physical size.

**Captions live inside the SVG**, not as sibling HTML, so they survive the SVG and PNG downloads as well as printing. Long captions auto-shrink to fit the barcode width.

#### Three print modes

1. **Sticker roll** — one code, N copies, one label per page at exact sticker dimensions. `page-break-after` per label is what makes a thermal roll feed correctly. Defaults are tuned for an add-on sticker (1.5 × 0.5 in, 0.3 in bars, 30 copies) because Heide's existing product labels were already printed *without* barcodes; the barcode goes on as a small additional sticker.
2. **Sticker sheet** — one code repeated across a full page. Custom auto-fitting grid plus three Avery presets. Cut guides (dashed cell borders) on by default.
3. **Multiple item scan card** — several *different* codes on one page, each with a caption. Parsed from a textarea as `CODE = caption`, one per line. Built for pottery price tiers: print once, keep it by the register, scan the card rather than the piece.

Modes 2 and 3 share a grid renderer; modes 1 and 2 share the single-code input block.

#### Avery presets

All three verified to close to exactly 8.5 × 11 with symmetric margins:

| Preset | Label | Grid | Top / Left margin | H gap |
|---|---|---|---|---|
| 5160 / 8160 | 2.625 × 1 in | 3 × 10 (30) | 0.5 / 0.1875 | 0.125 |
| 5163 / 8163 | 4 × 2 in | 2 × 5 (10) | 0.5 / 0.15625 | 0.1875 |
| 5167 / 8167 | 1.75 × 0.5 in | 4 × 20 (80) | 0.5 / 0.28125 | 0.3125 |

The 5167 left margin was wrong on the first pass (0.3) and overflowed the page by 0.0375 in; an arithmetic check caught it. **Keep that check when touching preset geometry.**

**Behavioral subtlety:** editing label dimensions re-fits columns and rows *only* on the custom layout. On an Avery preset the counts are fixed by the die-cut, so nudging a margin to correct alignment must not change them. This is what makes the margin fields usable for alignment tuning.

**Browser print scaling is the real alignment risk, not the numbers.** The in-modal note tells the user to test on plain paper held against a sheet, and to set Chrome to 100% scale, margins None, headers and footers off.

#### Guardrails

Live warnings, because these are the failure modes only discovered after printing:
- Module width below `BC_MIN_MIL`, with the actual mil measurement shown so it can be tuned rather than guessed
- Content taller than the label (accounts for caption and code text)
- Sheet columns or rows exceeding the page
- Scan card content spilling to a second page
- Characters dropped as unencodable in the chosen format

#### Testing approach worth repeating

Beyond structural table checks, both symbologies are validated by **decoding the rendered SVG geometry back to text** — reading bar and space widths the way a scanner would, reclassifying narrow/wide (Code 39) or module counts (Code 128), reversing the lookup, and for Code 128 verifying the start symbol and recomputing the mod-103 checksum. This proves the *renderer*, not just the table. Nine test codes round-trip in both formats.

The Code 128 checksum was cross-checked against two independently worked examples. One of the expected values in the test was wrong and the implementation was right, which is the reassuring direction for that to go.

---

### Converted to core (session 12)
`esc`, `todayISO`, `fmtDate`, the modal helpers, `ingCostPerG` and the palette block were deleted; all eleven `localStorage` calls route through `Store`. `uid` stays local. 2,870 → 2,745 lines.

**Two date bugs fixed by deletion.** This module's `todayISO` was built from `toISOString()`, which is UTC — a production run logged after 3pm Alaska time was stamped the next day. Its `fmtDate` parsed `YYYY-MM-DD` with `new Date()`, also UTC, displaying the day before. Core's local-parts versions fix both. Batchlog had already fixed `fmtDate` locally; Costing had not, which is a small illustration of why the copies had to go.

`saveProducts()` returns a boolean and reports failure through `Plume.noteSaveFailed()` rather than alerting from a `catch` block that a quota failure does not reliably reach.

### What's NOT in Products & Costing
- Three-tier wholesale analysis (wholesale + shop's resale + profit gap) — explicitly declined
- Margin-target reverse calculation ("what price hits 60%?")
- Cross-product margin ranking
- Cost trend awareness
- Inventory of finished products (only run records, not "I have 17 on hand")
- Auto-linking batch packaging runs to product runs — explicitly declined
- Parent/child variant hierarchy

---

## How the three layers relate (clarified session 9)

Heide asked how the data connects "in a big picture way," which is worth recording because it's the mental model the whole system rests on:

**Formulations** = the recipe. Percentage blueprint, batch-size-independent.
**Batchlog** = a production event of the *bulk*. "On May 12 I made 800g of the face oil formula, drawing from these lots." Measured in grams of finished bulk.
**Products & Costing** = the sellable SKU. "I sell face oil in a 30ml amber bottle for $24." Measured in units.

The bridge from bulk to units is the **production run** — bottling 800g of bulk into 25 units. `productionRuns[].batchId` optionally links a run to its bulk origin. One batch can feed multiple runs; one product accumulates runs over time.

Why record in both places: the batch answers production/traceability questions (how much bulk, which lots, trace a customer complaint back to a lot); the run answers inventory/sales-readiness questions (how many sellable units exist). They're different questions.

**Honest caveat given to Heide:** the system currently *records* this well but doesn't *surface* it in any dashboard. The payoff views ("what did I make this week," finished-goods inventory) are pending. The recording isn't busywork — those views can't be built retroactively — but the utility is deferred, and that's why it feels abstract in use.

**Also flagged:** if Heide bottles immediately and never holds bulk, the batch→run distinction may be more ceremony than she needs. The batch layer earns its keep when bulk is bottled over time or when traceability matters.

---

## Cost estimation philosophy (decided session 9)

**Neither Formulations nor Costing does FIFO cost blending.** Both resolve one cost-per-gram per ingredient (active lot, per the cascade) and apply it to the full amount used.

The scenario examined: a formula needs 70g of olive oil; 10g remains in a cheap old lot and 60g comes from the newer active lot. True blended cost would be $5.30; the system reports $5.60 using the active lot price throughout. A slight **overestimate**.

**This was deliberately kept.** Three options were weighed:
- **Live with the overestimate** — conservative, zero complexity ✅ chosen
- **FIFO-aware preview costing** — accurate but makes product cost shift unpredictably as lots deplete ("why did my unit cost change since yesterday?")
- **Split estimated vs actual** — products show estimates; batch detail shows real cost from `lotDraws[]`. Rejected as unnecessary complexity for now; it splits the cost concept into two numbers users must learn to distinguish, which is a real onboarding cost for the eventual sellable version.

**Heide's decisive reasoning, worth preserving:** none of the costing accounts for real-world losses — residue in the bowl, cure-off in soap, leftovers that don't fill a container and get discarded. All of those push actual per-unit cost *up*. So the conservative overestimate is arguably not conservative at all; it may simply be accurate.

The `lotDraws[]` data already exists on batch records if actual-cost reporting is ever wanted. A small "actual ingredient cost from lot draws" readout in batch detail was offered and declined.

---

## In-person selling — Square vs Squarespace (session 10)

Heide has a Squarespace site with commerce, and a **Square Handheld** ($399, built-in barcode scanner). The two are unrelated companies with confusingly similar names, and the integration between them is narrower than it appears.

**Squarespace POS supports only a Square *Reader*** (magstripe, or contactless and chip). It explicitly does not support Square Register, Stand, or Terminal. The Handheld is in that same category — a self-contained POS running Square's own software, not a Bluetooth accessory — so plan on it not working with Squarespace POS.

**The two inventories are separate.** Squarespace POS syncs to *Squarespace* inventory; Square POS uses Square's item library. There is no sync. You pick which is the source of truth.

**Decision reached: Square-native for the market.** The initial recommendation was Squarespace POS with Tap to Pay (free, no hardware, automatic inventory sync), but that reversed once Heide clarified: the pottery won't be listed on the website until *after* the sale, she has enough products that scanning is genuinely faster, and her cell service at the venue is unreliable. Inventory sync was the whole argument for Squarespace POS, and it evaporated.

**Offline payments matter and must be enabled in advance.** Key risks: contactless is unavailable while offline (cards must be dipped), the upload window is 24 hours recommended / 72 hours hard, and the seller is liable for declined or expired offline payments. A transaction limit can cap exposure. Non-obvious trap: if the device isn't *forced* offline during flaky signal, transactions simply keep declining and are never retried.

**Square item setup:** the code goes in the **SKU** field, not GTIN. Standard Square Point of Sale supports SKU only; GTIN belongs to Square for Retail (separate paid subscription) and sellers report it doesn't match on standard POS. Items must be **items**, not services — services can't carry SKUs. Do the setup in Square Dashboard on a desktop, and avoid the "Auto create" scan flow, which populates GTIN.

**Barcode strategy split by product type:**
- **Skincare** — barcode on a small add-on sticker, bulk printed per SKU. Existing labels were already printed without barcodes.
- **Pottery** — price-tier items in Square (`MUG32`, `BOWL45`) rather than one item per piece, with the codes on a printed scan card. One-of-a-kind pieces don't justify per-piece items and barcodes.

**Testing shortcut:** the Handheld's "Scanning for screens" setting lets codes be scanned directly off a monitor, so encoding can be verified before anything is printed. Physical print is a separate test — thermal contrast and print speed are their own variables.

---

## Data structure reference

### Formulation line
See "Line shape" under Module 2 — note `phase` (optional override), `addin`, `soapAddin`.

### Packaging purchase
```js
{ date, qty, totalCost, shipping, supplier, lotNum, notes }
```
Unit cost = `(totalCost + shipping) / qty`. NOT a single `price` field.

### Product
See "Product object shape" under Module 5 — note `productKind` and `components`.

---

## Session 6-13 work summary

### Session 6 — Batchlog Block 3-4 (Phase 4)
- Batch detail view with editable fields, ingredient snapshot, packaging runs, cost rollup
- Commit/decommit with FIFO across lots, resurrection of depleted lots, ghost reversal lots
- Reworked to auto-commit model
- Formulation versioning rebuild: snapId-based snapshots, restore-as-current with auto-parachute, Duplicate *(**superseded in session 11** — replaced by variant tabs; see Module 2)*
- Cross-module Batches nav link (Phase 5)

### Session 7 — Products & Costing rebuild (Phase 6)
- Complete rebuild from per-batch-pricing to product-centric
- Product schema, cost rollup with per-ingredient diagnostics, label preview, production runs
- Cross-module rename: "Costing" → "Products & Costing"
- Old `aerie-costing-v1` wiped on first load
- Bug fixes: wrong field names, wrong packaging cost calc, missing soap handling

### Session 8 — Polish + multi-component packaging runs
- "Save and close", "+ Add" button relocation, active-by-default status, example placeholders
- "Units made" column with hover tooltip
- Multi-component packaging runs as grouped event cards
- Date timezone fix (`fmtDate` local parsing)
- Pricing helper with custom multiplier dial and promote buttons

### Session 9 — Real-use refinements + sellable-version strategy
All six code changes came from actual production friction, not speculation.

1. **Stock-on-hand indicator in Formulations** — three-state (enough/partial/none) across search dropdown, line rows, and ingredient quick-detail snapshot; live-updating with batch size
2. **`bestCpg()` cost alignment** — fixed a real ~50% discrepancy ($0.06/g vs $0.091/g) by honoring `activeLotId` and excluding `referenceOnly` lots
3. **"Net weight per unit (g)"** relabel in Costing
4. **Drag-to-reorder + per-line phase override** in Formulations, with print view respecting overrides
5. **Drag-to-reorder products within groups** in Costing, plus `migrateListOrder()` one-time migration replacing the broken alphabetical size sort
6. **Multi-component products** for sample packs / kits / sets

Also covered: new-computer migration guidance, and an extended strategy conversation about the sellable version (below).

**All six confirmed working in real use.** Item 6 (multi-component sample packs) was verified in session 10 — Heide had already created a production run with it about a month earlier and confirmed it behaves as intended.

---

### Session 10 — Market prep: barcodes, labels, and point of sale

Driven entirely by an upcoming in-person market.

1. **Square vs Squarespace POS decision** — landed on Square-native (see section above)
2. **Barcode label generator** built in `plume-costing.html` — Code 39 first, Code 128 added after Heide corrected a wrong assumption
3. **Three print modes** — sticker roll, sticker sheet (with Avery presets), multiple item scan card
4. **Product picker + captions** — fills code and caption from an existing product; captions render above the bars in every mode
5. **Multi-component sample packs confirmed working** in real production use, clearing session 9's open verification gap

**A correction worth recording:** Claude initially stated Code 128 was unsupported, based on Square's Handheld *support article*, which lists only Code 39 among alphanumeric 1D formats. Heide checked the **hardware specs page** (`squareup.com/us/en/hardware/handheld/specs`), which lists Code 128 explicitly. She was right. The lesson generalizes: **for what hardware does, the device spec sheet beats the support article** — a support article is a how-to and may be incomplete or stale. Sourcing a capability claim from a single help page was the weak step.

---

### Session 11 — Variants, storage, and the shared core

Started as "the versions feature is quirky" and became the session that changed the architecture.

1. **Versions → variant tabs** (`plume-formulations.html`). The old model conflated two axes — parallel variants and sequential revisions — into one counter, which is why restoring rewound version numbers and produced duplicates. Tabs take the variant axis; per-variant change history takes the revision axis. Auto-diffed history, append-only reverts, formulation-level Notes tab.
2. **All save prompts removed.** Switching, leaving, duplicating and Make batch now save quietly. Batch size stopped counting as an edit.
3. **History retention capped** after measuring that uncapped history plus automatic saving would eat the storage budget. Notes make entries permanent; unnoted ones age out.
4. **Storage diagnostics** — usage panel, per-field drilldown, 75% warning banner, loud save-failure handling.
5. **Packaging photo optimisation** — 800px → 480px, plus a shrink tool for existing photos. **1.44MB → 892KB on real data.**
6. **`plume-core.js` extracted**; Formulations and Ingredients converted.

**Corrections Heide caught, and what they teach:**

- **The storage panel reported the wrong hog.** It checked a hardcoded list of key names, two of which were wrong (`aerie-packaging-v2`, `plume-products-v1`), so packaging — the largest consumer by far — was hidden in an unlabelled "Other" bucket while Ingredients was blamed. **Heide caught it because the numbers didn't reconcile:** the breakdown summed to ~390KB but the total said 39% of 5MB. Now enumerates actual keys. *Lesson: when a user's reported numbers don't add up, that is data, not confusion.*
- **`stockG` shipped broken.** When extracting core, the cost function was carefully diffed across all four module copies; `stockG` was written from assumption instead, reading a `l.unit` field that does not exist. Non-gram lots silently read as grams — an 8 oz lot became 8 g. Gram lots looked fine, which is why it read as "quantities no longer align with reality" rather than obviously broken. *Lesson: **copy, do not rewrite.** Transcribe the original and run it as a test oracle against the shared version before deleting anything.*
- **Two more divergences caught by then applying that lesson properly:** Costing's `esc` escaped single quotes while four modules didn't (core adopted the stricter version, which also fixed `esc(0)` returning `''` because `0` is falsy); and Batchlog's stock function returns `null` for "no quantity data" as distinct from a real zero, which core now preserves as `stockGOrNull`.
- **A design overreach, self-corrected after pushback.** Batch size was made a saved, dirty-marking field, which made the app ask about unsaved changes constantly. Heide said it was annoying. The right fix was removing the prompts entirely rather than tuning them — history already protected the data, so the prompt guarded nothing.

**Where the process worked:** every change was verified with jsdom suites (115+ assertions by session end), and a test was written to prove the Store seam by swapping in an async driver and confirming the app rendered and saved unchanged.

### Session 12 — Finishing the core conversion

Costing, Batchlog and Packaging converted, in that order. Costing went first deliberately: it is the other half of the cost story and the one place a disagreement with Formulations would still have shown.

1. **`plume-costing.html`** — deleted five helpers, the cost function and the palette block; eleven `localStorage` calls routed through `Store`. Fixed two UTC date bugs by deletion.
2. **`plume-batchlog.html`** — same, plus the three save paths that write ingredient and packaging stock. `fmtDate` kept as a presentational wrapper; deep link moved inside `boot`.
3. **`plume-packaging.html`** — same, plus a real bug: `optimisePhotos()` reported bytes reclaimed without checking whether the save succeeded.
4. **Missing-core guard added to Formulations**, which this document had wrongly claimed already had one.

**No change to `plume-core.js`.** Still v1.3 — which meant the upload was three HTML files, not four.

**Verification, ~196 assertions:**
- A **cost oracle**: the deleted `ingCostPerG` transcribed verbatim and run against `Plume.costPerG` across 20 lot shapes. 17 identical; all 3 divergences are the same documented case (active lot with a blank, zero, or junk cost → `null` instead of falling through). No other divergence, which is what made the deletion safe rather than hopeful.
- **Per-module jsdom suites** covering boot, load, the cost cascade, rendering, editors, save success *and* save failure (including that a failure alerts once rather than once per save).
- A **cross-module suite** loading all five pages against one library and asserting the four cost-function names return identical answers.

**What the tests caught that inspection had not:** three fixture bugs on my side from guessing field names (`netWeight` for `netWtG`, `packaging` for `packagingRecipe`), which is the same class of error as session 11's `l.unit` — wrong field names don't throw, they quietly return wrong numbers. Also that `migrateListOrder()` rewrites product array order on first load, so index-based lookups in tests are unstable.

---

## Spec: ingredient cheat sheet (designed session 13, not yet built)

### The problem in her words
"I have a lot of ingredients and some (most) I have purchased with something in
mind. Now I can't remember what the ingredient even does, or what my primary
purpose was." She then googles it, forgets again, and repeats.

Two distinct moments, both **at the screen while building a formulation**, not
at the cupboard:
1. *"What is THIS again?"* — a name is vaguely familiar, she needs a fast answer.
2. *"What do I have that thickens / emulsifies / solubilises?"* — she knows the
   job, not the ingredient.

### The two axes
This is the crux, and the reason the current app feels muddy.

- **Function** — what an ingredient *does*: emulsifier, thickener, active,
  solubiliser, humectant, preservative.
- **Product type** — what she is *making*: serum, toner, cream, balm.

Searching `emulsifier` is a question on the first axis. Searching `serum` is a
question on the second. Both must work against the same data.

Her own framing: *"I usually have the base in mind — the oils are less of a
mystery — but then the actives and agents that make the product a product get a
little muddy."* The base is solved; the middle is not.

### Why multipurpose ingredients break today
`functionCategory` is a single-value dropdown. Sepinov EMT 10 is genuinely a
thickener AND an emulsifier AND a stabiliser. Forced to pick one, it vanishes
from whichever list wasn't picked. **`functionCategory` must become an array.**
Once it is, "multipurpose" stops being something to manage and becomes a fact
the data holds.

### Data model changes
1. **`functionCategory: string` → `functionCategory: string[]`.**
   Backward-compatible read: a bare string is treated as a one-element list.
   Touches the ingredient editor, the filter dropdown, the table cell, and the
   formulations search. Do the migration properly — do not bolt on a second
   field.
2. **New `purpose` field on the ingredient.** One short free-text line. NOT the
   existing `notes` field, which is a junk drawer.
   - Label it with a question, not a noun: *"What do you reach for this for?"*
   - Example: `Serums — lightweight, cold process, plays well with actives`
   - **Free text, deliberately, not tags.** Substring search means "serum" and
     "serums" both hit, with no controlled vocabulary and no backfill. Tags
     retrieve more reliably and are a fair upgrade *later*, designed against
     real usage. The backfill is what kills reference systems; do not open with
     one.
   - One line, not two fields ("bought for" + "how it behaves"). Her call. The
     version she'll actually fill in beats the better-organised version.
3. **Product-type vocabulary moves to `plume-core.js`** as `Plume.PRODUCT_TYPES`.
   Currently hardcoded as `<option>` tags in TWO places in
   `plume-formulations.html` (~line 438 and ~line 617). One list, one file —
   this is the same class of bug as the phase mismatch that hid her ingredients.

### Load-bearing constraints on the type vocabulary
- **Type values are stored on the formulation as the display string** (`f.type`
  = `"Facial serum"`). **Adding options is safe. Renaming or removing one
  orphans existing formulations.** If a rename is ever wanted it needs a data
  migration, not an edit to the option list.
- **`isSoap()` matches the exact strings** `'Cold Process Soap'` and
  `'Hot Process Soap'` (~line 799, and again ~line 1122). Those two strings are
  load-bearing — the entire soap UI branches on them. Never touch them.
- Current list (19): Facial serum, Face cream, Face oil, Eye cream, Toner /
  mist, Cleanser, Exfoliant / scrub, Mask, Body lotion, Body butter, Body oil,
  Lip balm, Hair serum, Hair mask, Shampoo bar, Deodorant, Other, Cold Process
  Soap, Hot Process Soap.
- **Confirmed gap: there is no general `Balm`** — only `Lip balm`. Heide flagged
  this directly. More additions expected; ask before assuming the set.

### Three doors, one dataset
| Search | Returns |
|---|---|
| a function (`emulsifier`) | the comparison chart for that group |
| a product type (`serum`) | the *shape* of that product, her options under each role |
| a name (`sepinov`) | the single ingredient record |

The `purpose` line surfaces in all three, because it is matched as plain
substring text.

### The comparison chart
Grouped by function. **Columns differ per group** — this is the key design
finding. Thickeners compare on use %, pH range, electrolyte tolerance; oils
compare on absorption, melting point, oxidation stability. One shared column
set leaves most cells blank.

Groups wanted: all of them — preservatives, emulsifiers, actives, humectants,
thickeners, oils and butters, solubilisers, exfoliants, clays.

Every group ends with the `purpose` column. **An empty cell next to a filled one
is the best prompt for backfill there is** — Sepimax Zen blank beside a
filled-in Sepinov row asks the question better than any "add a note" button.
This is the only backfill strategy to trust: capture at the moment the question
naturally arises, never a dedicated tidying session.

Printable, one page per group. That covers the bench case without building a
separate artifact for it.

### The product-type view — "the brain"
A serum is not a function, it is a *shape*: water base → humectant → thickener
or emulsifier → active → preservative. Naming the shape converts the muddy
middle into "which of my thickeners goes here", which is a ten-second question.

**Derive the shape from her own formulations, not from a textbook.** Her logged
formulations already carry lines, phases and percentages, so which roles a serum
needs and in what bands is computable from what she has actually made. This
means the sheet reflects her practice, improves every time she formulates, and
needs no maintenance. A starter template covers types she hasn't made yet; her
own recipes override it once there are two.

**"Used in N formulations" costs nothing to maintain** — it is derived from
formulation lines. Possibly the single highest-value cell on the sheet, and it
requires zero data entry. It also answers the inverse: an ingredient used in
nothing is telling her something.

### Open questions
- **Type granularity.** The 19 types are specific (`Facial serum`, `Hair serum`).
  Deriving a product shape may need a coarser family (`serum`) so there are
  enough formulations per group to learn from. Substring search handles the
  lookup; the *derivation* grouping is unresolved.
- **Which columns per group.** Thickeners on pH + electrolyte tolerance is a
  guess from the Sepimax remark. Confirm against how she actually compares.
- **Where it lives.** Ingredients (natural home, it is ingredient data) versus
  standalone (so it can sit open in a second tab while formulating — the
  tab-per-module nav already supports this). Not a sixth module for its own
  sake: a tab she has to remember to visit is the failure mode of every
  reference system.

### Build order
1. `Plume.PRODUCT_TYPES` in core; both selects read from it; add `Balm` and
   whatever else she names.
2. `functionCategory` → array, with the compatibility read.
3. `purpose` field + editor input.
4. Extend the Formulations ingredient search to match function and purpose —
   **it currently matches name and INCI only** (`searchIngs`, ~line 1769), which
   is why typing "thickener" returns nothing today. Cheapest single win here.
5. Comparison chart, grouped by function, per-group columns, printable.
6. Product-type view, derived from her formulations.

Steps 1 and 4 are small and independently useful. Do not start at step 6.

---

## Sellable-version strategy (session 9 — substantially revised)

This section replaces earlier vaguer notes. It reflects a long strategy conversation and includes a significant correction Heide made to a bad assumption.

### The market is real and already pays

**The competition is NOT free spreadsheets.** Paid formulation spreadsheets are an established, functioning market — they sell on Etsy at a range of prices, and **Humblebee & Me sells one for $150**, whose main value-add is emulsion "bumpers" (guardrails). Willingness to pay is therefore *already validated* — buyers aren't choosing between Plume and free Excel, they're choosing between Plume and a $150 single-purpose spreadsheet.

**None of the incumbents combine formulation + costing + packaging + ingredient/lot tracking.** None ship with common ingredients and INCI names preloaded — every buyer starts with an empty file and hand-enters their whole library before the thing is usable. Plume already has that library imported (Formula Botanica Ingredients Directory, 169 ingredients as structured JSON).

**Pricing implication:** an integrated multi-module app with a preloaded ingredient library can credibly ask **at or above** the spreadsheet incumbents, as a **one-time purchase**. That also happens to be the low-maintenance model Heide wants — no subscription to service.

### Heide is the frustrated buyer — this is the positioning

She **paid for four different formulator spreadsheets**. Several had an ingredients page (empty), a formulation page, and a cost page — all unintuitive, requiring effort just to work out which cell talked to which. She **did not buy Humblebee's $150 sheet because there was no preview** — no way to see what it actually did before paying.

That origin story is the core of how the product should be talked about, because it's true and every buyer who's been burned will recognize it: *"I bought four of these. They were unintuitive, the cells didn't obviously connect, and I still needed separate files for costing. I couldn't even preview the expensive one. So I built what I actually wanted."*

**Design requirement that falls straight out of it: let people preview/demo before buying.** The absence of a preview cost Humblebee a sale to a motivated, ready-to-pay buyer. Build the thing that would have converted Heide.

### Effort budget: modest — this rules things out

Heide wants **nice side income at modest effort**, not a business to invest in. That rules out the SaaS shape originally sketched (accounts, database, API, Vercel). Every paying customer of a hosted service can email about password resets, failed payments, browser problems; servers go down at 2am. **The current architecture — self-contained HTML, localStorage, no backend — is a *feature* for a low-effort business, not a limitation.** Sell the tool, not the service.

**Vercel / backend is relevant only if** the product later needs accounts, cross-device sync, and an API layer. Not applicable to the static architecture.

### Copy protection: settled — don't chase it

**Technical prevention is not achievable and not worth pursuing.** Browser-delivered HTML/CSS/JS is by physical necessity fully present on the buyer's computer. Obfuscation and license-key checks in JS can be undone, and they make the product worse for honest customers (more fragile, harder to support).

What actually protects the business:
- **Heide herself** — name, credibility as an NP and pharmacology educator, trust built over time
- **Updates** — a pirated copy is frozen; the real thing keeps improving
- **Support** — only real customers get help
- **The living ingredient library** — ongoing INCI data expansion that a static copy loses
- **Convenience and legitimacy** — most buyers would rather pay a fair one-time price than fiddle with a sketchy copy

Optional light speed bumps (a license note, embedding the buyer's name in their copy so a shared file traces back, selling through a real purchase platform) have psychological rather than technical value. Minor finishing touches, not strategy.

**The deciding argument:** for a modest-effort side income, a little piracy is not the threat — failing to reach enough honest buyers is. Also note the tension: preview and lockdown pull in opposite directions, and *Heide's own wallet already voted for openness* by refusing the unpreviewable $150 product.

### Honest competitive caveats (don't lose these)

- **Spreadsheets have a transparency advantage.** Buyers can see inside them, tweak them, and own a file that opens in ten years. An HTML app with localStorage is more capable but more of a black box, and carries the browser-bound-data fragility. Countering this means making export/backup extremely prominent and "you own your data" credible.
- **"Does more" only sells to people who feel the missing pieces.** Someone who just wants a formula calculator may see five modules as complexity they didn't ask for and buy the simpler $80 sheet. The integration sells specifically to the *outgrowing-my-spreadsheet* segment.
- **Part of Humblebee's $150 is her name.** Years of trust, a large audience, an SEO empire of tutorials. Plume competes on trust not yet built in this market — which is what makes Heide's dual credibility (NP, pharmacology educator, Formula Botanica student) worth putting forward.

### Phase 1: purposeful listening (current step, no code)

Communities available: **Facebook groups** and the **Formula Botanica community/forums**. Heide is **willing but rusty — lurks more than posts**, which suits this phase since it requires no visibility.

Because the paid-spreadsheet market already answers "will anyone pay," the listening question is sharper than generic validation:

**What do people complain about in the spreadsheets they already bought?** Where do single-purpose tools frustrate them? How often does someone say "I wish this also tracked X" or "I keep a separate spreadsheet for costing"? Those complaints are the exact seam an integrated product slides into — and they supply the *language* to describe why Plume is different.

Also worth noting: how often the core pain appears at all (regularly = green light), and what people currently use.

### Phase 2 (later): one gentle post

When the evidence is in, a single non-salesy post asking about the shared struggle — not pitching. It validates interest and surfaces first customers simultaneously. Suits the reluctant-poster temperament because it's a question, not an ad.

### Phase 3 (later): decide what to build, name it, price it

All of it is much easier to decide once phases 1-2 have shown who bites and why. The clean fork should carry forward what proved useful in real use and drop what didn't — which is exactly why living with the personal edition first was the right sequence.

---

## Pending work / known follow-ups

### Immediate — before the market
- **Print one physical sticker and scan it.** Screen-scanning is confirmed working; thermal print contrast and speed are separate variables and untested.
- **Avery alignment test** if label sheets are used — plain paper held against a sheet against a light; Chrome at 100% scale, margins None, headers/footers off.
- **Enable offline payments on the Handheld** and set a transaction limit. Must be done before losing signal.
- **Square item setup** — codes into the SKU field, items not services, done on desktop in Square Dashboard.

### Immediate — other
- ~~Decide on version stamp~~ — **settled session 17**: footers show `Plume.VERSION`; see the session 17 notes.
- **Name the sellable fork** — gates domain, positioning, copy

### Higher-value next features
1. **Pricing target-margin reverse calc** — "what price hits 60% margin?" (~50 lines)
2. **"What did I make today/this week" overview** — aggregates production runs across products by date range; this is one of the views that would finally make the batch/run recording pay off (~100-150 lines)
3. **Cross-product margin ranking** — sort by margin or profit-per-unit
4. **Three-tier wholesale analysis** — wholesale + shop's resale + profit gap (~150 lines)

### Medium-value follow-ups
5. **Stock decrement (FIFO across unit conversions)** — non-trivial
6. **Batch detail view + delete-with-reversal**
7. **Yield reconciliation on batches** — "250g made, 200g packaged, 50g unaccounted"
8. **Cost-trend awareness** — flag products whose margins shifted when ingredient costs change; needs cost history infrastructure
9. **Barcode rendering** — JsBarcode (~30KB) for visual render + PNG download; deferred twice
10. **Full-system backup** — single export wrapping all modules (currently per-module)
11. **Nav dropdown for category cross-linking** on the Little Bird Studio site — intentionally deferred

### Session 13 — Phase bug, bench sheet, variant reordering

**A real bug, found from a screenshot.** Three ingredients added to a new
formulation showed "No ingredients yet" while the count said 3 and the INCI
panel listed them. Cause: the Ingredients module offers phases water / oil /
cool-down / **add-in**; Formulations rendered water / oil / cool-down /
**active** / **other**. `effPhase` returned the ingredient's phase verbatim and
`renderLines` looped a fixed list, so an `add-in` line was filed under a key
nothing read and vanished. All 17 clays and exfoliants in the FB import carry
that phase. **The print sheet had the identical bug** — a printed recipe would
have been missing the clay.

Fixed with `normPhase()`: one normalisation point, unrecognised values fall to
`other`, and all three "default phase" sites now agree with `effPhase` so the
phase menu marks the right item. Plus a catch-all in the grouping loop, because
the failure mode was a *silent drop*. `add-in` maps to `other`, not `cool-down`
— those ingredients are clays and pumice, not heat-sensitive actives.

**Bench sheet moved to core (v1.4).** `buildSheet` takes plain data, reads no
DOM and no globals. Formulations passes live editor values (which may be
unsaved — the sheet should match the screen); Batchlog passes the stored
formula and the popup's yield. Batchlog computes the active variant's label
itself rather than relying on a mirrored field.

**Product types centralised (core v1.5).** `fillTypeSelect` deliberately keeps
an unrecognised stored type as an extra option instead of snapping the field to
blank. Because `f.type` is stored as the display string, a select that silently
rebuilt itself would drop the type off any formulation carrying an older value
— quiet data loss on open. Tested with a `Beard tonic` fixture.

**Test-design fix:** seven tests hardcoded `'1.3'`, so bumping core to 1.4 turned
nine assertions red for no reason. The harness now reads the version out of
`plume-core.js`. A version bump is a normal event and should not need a test edit.

### Session 14 — Cheat sheet build steps 2-4 (the "quick win")

After a long break. Confirmed at the start that the project files and the live
site were already current (core v1.5), so nothing was half-uploaded.

1. **`functionCategory` is now an array.** Every reader goes through
   `Plume.funcCats(ing)`, which accepts the old bare string, an array, or
   nothing. Existing records are **not** migrated in bulk — each converts the
   first time it is saved from the editor. The FB import still writes strings;
   that is fine. The editor's single dropdown became toggle chips
   ("pick every one that applies"). A word not in the list (an older value, an
   import) gets its own chip and survives the save rather than being dropped.
2. **New `purpose` field** — one line, labelled *"What do you reach for this
   for?"*, placed directly under Common name. Shown under the name in the
   ingredient table, in the detail header, in the Formulations dropdown and in
   the ingredient popup. Deliberately **not** in `REFERENCE_FIELDS`: it is her
   own knowledge, and the reference import must never touch it.
3. **Search.** `Plume.ingMatchRank(ing, q)`: 0 no match, 1 name/INCI, 2
   function / function notes / secondary functions / purpose. Formulations
   sorts band 1 before band 2, alphabetical within each, and shows functions +
   purpose right in the dropdown row. Ingredients' search uses the same
   matcher plus supplier. "thickener", "serum" and "solubil" all return things
   now; before, all three returned nothing.
4. **`Plume.FUNCTION_CATEGORIES`** in core (v1.6) — the list was hardcoded twice
   in Ingredients (editor and filter bar). Same drift lesson as phases and
   product types.

**Caught during the build:** the unsaved-changes guard in Ingredients watched
the old dropdown by ID. Chips are checkboxes, so it now reads them separately —
otherwise toggling a function would not count as an edit and a backdrop click
would discard it silently.

**Not added, her call:** `Stabilizer` / `Gellant` are not in the function list,
though that is how she describes Sepinov and Sepimax. Adding a word is one line
in core and free; renaming one strands data.

### Session 14 (cont.) — The comparison chart (cheat sheet step 5)

**The design shifted during the conversation, and the shift matters.** Heide's
framing: *"an at-a-glance comparison to help me choose between similar
products… what helps determine why I would formulate with this over that."*
So the chart is built to show DIFFERENCES, not to display every field.

- **New file `plume-cheatsheet.js`**, loaded by Ingredients after core. Kept out
  of `plume-ingredients.html` (already ~3,600 lines) on purpose. Shown as a
  **List / Cheat sheet** toggle in the Ingredients header; the choice is
  remembered (`plume_ing_view` in Store).
- **Grouped by function**; a multipurpose ingredient appears in every group it
  belongs to. Ingredients with no function get a "No function set" group, last.
- **Fixed columns:** Ingredient · *Choose it when…* (the main column) · Your
  purpose · On hand · Used in (count of non-archived formulations, active AND
  inactive variants, names on hover).
- **Offered columns per group** (`GROUP_COLS`): Use % leads every group, then
  e.g. Phase/pH/Heat stability for thickeners, emulsifiers, solubilizers,
  surfactants and actives; Phase/pH/Restrictions for preservatives;
  Absorption/Shelf life/Melting point for emollients; Dermal limit/Scent for
  essential oils and fragrance.
- **Auto-hide:** an offered column is hidden only when EVERY row has a value
  and they all agree (noted under the table: "Not shown — the same for every
  one: Phase (Cool-down)"). A column with no data at all is omitted silently.
  If some rows are blank, the column shows — the tests caught an earlier
  version that hid it and falsely claimed everyone agreed.
- **Highlight:** a value that differs from a clear majority (≥2 rows agreeing)
  is marked. Comparison is case- and whitespace-insensitive.
- **Search** at the top: a function name ("thick", "preserv") shows those whole
  groups; anything else ("serum", "niacinamide") cross-lists matching rows,
  kept in their groups, via `Plume.ingMatchRank`. Plus group chips to narrow.
- **Rows click through** to the ingredient record; Back returns to the chart.
- **Print** prints what is on screen, one group per page.

**New field `chooseWhen`** ("Choose it when… — what sets it apart from similar
ingredients"), in the editor under the function chips. Searchable (core v1.7),
shown in the detail header, the Formulations popup, and the Formulations
dropdown when there is no purpose line (purpose wins when both exist).

**The distinction that made this click, from Sepimax Zen:** "why I bought it"
(purpose — hers, unknowable to anyone else, left blank until she fills it) and
"what it does better than its neighbours" (chooseWhen — objective, and so the
one field that CAN be researched and pre-filled). Her Geogard ECT experience
("choose it when you don't care how terrible something smells" — a failed
hydrating mist) is the example of why her line stays hers: research would have
recommended exactly what failed.

**Electrolyte tolerance** — the Sepinov/Sepimax difference — deliberately has no
column; the chooseWhen line carries it.

### Session 14 (cont.) — Ingredient editor reordered, restricted fields merged

Her requested order, top of the editor: Common name | INCI name (side by side,
name no longer full width) → **My purpose** (relabelled from "What do you reach
for this for?", which she found odd; the chart column now also says "My
purpose") → Choose it when… → **Substitutes** (moved up out of Properties, id
still `f-substitution`) → Phase | Min % | Max % on one row (`.form-row3`) →
function chips → Function notes | Secondary functions.

**Restricted use: two fields were one fact.** `flag` (yes/no dropdown, drives
the orange ● in Formulations and the "Restricted use" badge) and `restrictions`
(free text in Properties) are now a single checkbox (`#f-restricted`) at the
top of Properties that reveals the Restrictions box. Data shapes unchanged —
`flag` is still `'yes'`/`'no'`. The box also shows whenever it already holds
text, so an imported caution on an unflagged ingredient (Brazil nut oil's nut
allergy note, the one FB entry with restrictions text) is never hidden, and
unchecking never deletes text. A flagged ingredient auto-expands Properties so
the flag cannot hide in a collapsed section. Dirty tracking reads the checkbox
separately (its `.value` is always "on").

**"Other" function kept** — she wondered why it exists; it is the catch-all for
things like lye that no real function fits.

### Session 14 (cont.) — Editor order, round two; preview links

**Her refinement of the purpose field:** the general "what it is" should lead,
and the personal line is *"more like a note pad or reminder for when I am
looking at all of my actual ingredients wondering what in the world I was
thinking about when I bought it."* So:
- Editor order is now: Common name | INCI → function chips → Function notes |
  Secondary functions → Choose it when… → Substitutes → Phase | Min | Max →
  **What I had in mind** (field still `purpose`; now a 2-row textarea, max 300
  chars, hint "a note to future you: why you bought it").
- Clipped to one line in the list (120 chars) and the Formulations dropdown
  (90 chars), full text on hover; the cheat sheet cell wraps and shows it all.
- Her Sepimax example of the split: Functions = Thickener; Function notes =
  gelling agent; What I had in mind = slightly thicken serums; Choose it when
  = electrolytes.

**Cheat sheet:** Substitutes column added beside Choose it when, shown only in
groups where at least one ingredient lists a substitute. Purpose column
renamed "What I had in mind".

**Preview links (new working pattern).** Since core, a module can't be previewed
on its own (the preview can't load `plume-core.js`, so it shows the red banner).
`make_preview.py` builds a self-contained copy — core and the cheat sheet
inlined, sample data seeded on first open, yellow "Preview" banner with a Reset
button — published as an Artifact link and republished at the same URL for each
tweak. She iterates on the preview and only gets real files once it's settled.
Its storage is private to the preview; never suggest a test folder on the
GitHub site, which would share her real browser storage.

### Session 14 (cont.) — Three levels: quick look, full details, edit

**The problem, in her words:** the "Edit ingredient" button had a dual purpose —
she opened it every time she only wanted to LOOK, because the details page hid
empty fields and folded things away. Her "magic world": select an ingredient in
the list, more info drops down, then click through to full details and/or edit.

1. **Quick look** (`toggleQuickLook`, `quickLookHtml`): clicking a list row opens
   an in-place row beneath it (`tr.ql-row`), one at a time; click again to fold.
   Shows function pills + function notes, Choose it when, Substitutes (if any),
   What I had in mind, Use %, Phase, On hand, Used in, Restricted. Links: "Full
   details →" and "Edit". Survives searches/filters that keep the row
   (`qlOpenId`).
2. **Full details** (`viewIngredient`): the banner now says what it IS — name,
   brand, INCI, **function notes**, with phase/function/restricted badges. The
   working notes moved into the fields: Choose it when | Substitutes, then What
   I had in mind (full width). **Every field is shown, empty ones as a dash** —
   all Properties, Secondary functions, My formulating notes, Expanded details —
   so Edit is never needed just to look. Properties shows "Restricted use:
   Yes — <limit>" / "Not flagged — <note>" / "No".
3. **Edit**: the form, unchanged. Opened from the quick look (`editFromList`), it
   returns to the list after saving; opened from the details page, it returns
   there, as before.

**Click-to-type notes** (`noteEditHtml`, `startNoteEdit`, `commitNote`,
`refreshNoteViews`): `purpose` and `chooseWhen` are editable in place in the
quick look, the details page AND the cheat sheet (she chose to keep the cheat
sheet editable). Click, type, click away or Enter to save; Shift+Enter new line;
Escape cancels; clearing deletes the field. A brief "Saved" appears. Updates
every visible copy in place without re-rendering (an open quick look stays
open) and patches the list row's one-line reminder. In the cheat sheet blank
notes render as a quiet dash (`compact`) rather than the full prompt; clicking a
note cell edits, clicking elsewhere in the row opens the ingredient. One record
underneath — she asked, and was told, edits anywhere show everywhere.

**Cross-module:** Formulations' "View in library →" and Batchlog's two
ingredient links (`#ing=<id>`) still land on full details — verified, no
changes needed there. `PlumeCheat.usageMap` is now exported so the quick look
can show "Used in".

**Preview:** sample data now reseeds automatically whenever the preview is
republished (`plume_preview_seed` stamp), so new samples appear without Reset;
preview edits last until the next update.

**Follow-up tweaks (same session):** the line under each name in the list now
shows **function notes** (what it is), not the reminder note — she flagged the
reminder there as "not the best choice". Quick-look side panel is a two-column
label | value grid. The reminder note (`purpose`) accepts line breaks — Enter
is a new line, clicking away saves — so it can be a short list; Choose it when
stays single-line (Enter saves). Formulations' dropdown joins multi-line notes
with " · "; its popup preserves the line breaks.

**"Choose it when" → "The lowdown" (decided).** She was uneasy with the old
label: her Geogard example — the smell — is a reason NOT to choose it, which
the positive framing couldn't hold. Her call: keep ONE field covering pros and
cons; she offered "Hot tips", "Lowdown" or "Words to the wise" and "The
lowdown" was used. **Label only — the stored field is still `chooseWhen`**
(renaming it would need a data migration for no benefit). Hint: "strengths and
catches, compared with similar ingredients"; max 200 chars. Changed in the
editor, quick look, details page, cheat sheet header and Formulations popup.

**Used in — names, not a count.** Her point: a number "doesn't actually speak
to the formulations that it is a part of." `PlumeCheat.usageMap()` now returns
`{id, name}` pairs and `PlumeCheat.usedInHtml(list, max, forPrint)` renders the
first few names as links (`plume-formulations.html#f=<id>`, new tab) plus "+N
more", full list on hover. Quick look shows 4, details page 8 (new "Used in"
field), cheat sheet 2; print shows plain names. **Formulations now honours a
`#f=<id>` deep link** on boot and opens that formula — the first link INTO
Formulations from another module.

**Manage lots, one level out.** It only existed inside the Edit form, so
managing lots meant opening Edit. Now also a button beside the "Supplier lots"
heading on the details page (`openLotsFromDetails`): the form is loaded behind
the scenes, the drawer opens, and closing the drawer saves and refreshes the
page (`lotsFromDetails`); it sits right beside the heading text, not pushed to the far side. The lowdown column in the cheat sheet is capped at ~260px and wraps, so long notes don't stretch the table. Cheat sheet headers may wrap to two lines (they were colliding on a narrow screen — "What I had in mind" into "On hand"); the reminder column wraps at ~220px; On hand has a minimum width and extra left padding. **Visual checks are now possible — use them.** Headless Chromium (Playwright,
Python) is available in the workspace: `shoot.py` / `shoot2.py` load the
preview file and screenshot the cheat sheet (720px and 1280px), the quick look
and the details page. Several layout bugs this session passed every jsdom test
and were only visible on screen. Screenshot any visible change before handing
it over.

**Second gotcha:** Ingredients also sets `table { table-layout: fixed }` on every
table, so columns share width evenly regardless of content. In the cheat sheet
that crushed the comparison columns and made names overlap "Use %". `.cs-table`
now sets `table-layout: auto`; the name column prefers 150px; short values
(≤14 chars) don't wrap. **Third:** the details banner is dark (`--bark-dark`), so
the function-notes line there needs light text (`.detail-card-header
.detail-purpose`) — it was near-invisible. Function notes under names in the list
now end with "…" instead of being chopped.

**Gotcha found:** Ingredients' page-wide `td` rule (one line, `overflow:hidden`, `text-overflow:ellipsis`) — meant for the list — was inherited by the cheat sheet, truncating names to "Se…", and by the quick-look row. Both now override it explicitly; anything new rendered inside a table on that page needs the same override. Cheat-sheet rows now carry `has-stock` and use the list's blush tint (`--clay-light`, `--clay-hover` on hover). **Print** is landscape with fixed column widths (name 13%, lowdown 21%, substitutes 10%, reminder 17%, on hand 6%, used in 11%; the per-group comparison columns share the rest), every cell wraps, and multi-line reminder notes keep their line breaks. The button in the Edit form stays — a brand-new
ingredient needs it before it has a details page.

**Open question, not raised with her yet:** there are now two personal note
fields — the short "What I had in mind" and the older free-form "My formulating
notes". Worth asking whether both earn their place.

### START HERE — dev tools are in the project

**`plume-devtools.py`** (in the project files) holds the session-14 tooling in
one file: the jsdom harness, `check.py`, `make_preview.py`, the Playwright
screenshot scripts and the four test suites (188 checks). Unpack before any
build work:

    mkdir -p /home/claude/plume && cd /home/claude/plume
    cp /mnt/project/*.html /mnt/project/*.js /mnt/project/*.json .
    python3 /mnt/project/plume-devtools.py .
    npm install jsdom   # if not already present

**Preview a change:** `python3 make_preview.py formulations` (or ingredients,
batchlog, costing, packaging) writes `/mnt/user-data/outputs/preview-<module>.html`;
publish it with the Artifact tool and give her the link.
**Look at it yourself:** `python3 shoot.py /mnt/user-data/outputs/preview-formulations.html
/tmp/f.png --width 1280 --run "openFormula('f1')" --full`, then `view /tmp/f.png`.
Do a narrow (~720px) and a desktop (~1280px) shot. More recipes in shoot.py.

Working pattern Heide wants: for visible changes, build and publish a preview
link first (republish to the same URL per tweak), screenshot it yourself, and
hand over real files only when she says it's ready. When tooling changes,
regenerate `plume-devtools.py` for her to replace in the project.

**Next up (her words at the end of session 14):** she noticed some
improvements in Formulations as a result of this session's changes and wants
to pick those up in a fresh chat. Ask her for the list.

### Immediate — session 15 carry-over
- ~~Pre-fill `chooseWhen` drafts~~ — **built session 17**; see "Drafted lowdowns" in the session 17 notes.
- **Column tuning.** She expects "a few passes" to nail down the per-group
  columns. `GROUP_COLS` in `plume-cheatsheet.js` is the one place to change.
- **Cheat sheet step 6** — the product-type view derived from her own
  formulations. Spec below.
- ~~Add `Balm` to the product-type list~~ — **done session 13.** `Face balm`
  added; it was the only gap she wanted. Build step 1 of the cheat-sheet spec
  came with it: `Plume.PRODUCT_TYPES`, `Plume.isSoapType` and
  `Plume.fillTypeSelect` now live in core (v1.5), replacing two duplicated
  `<option>` blocks in Formulations and a third copy of the soap test in
  Batchlog. **Heide has one existing formulation filed under `Face oil` that
  she intends to move to `Face balm`** — a manual dropdown change, no migration.

### Carried from session 12
- **Two open decisions from the conversion, both cosmetic, both hers to make.**
  1. ~~Palette default drift~~ **Settled session 17: keep per-module palettes and the `sage-green` default.** Her call, recommended: different colours help tell tabs apart, and any module not in the colours she wants is fixed by picking once in its Settings. An app-wide palette was the alternative; dark mode will need a global key anyway (backlog). Original note: **Palette default drift.** Costing, Batchlog and Packaging each defaulted to `coastal`; core defaults to `sage-green`. Saved choices are unaffected — this only shows on a module where a palette was never explicitly picked. Either accept it, or change `DEFAULT_PALETTE` in core (which would then also move Ingredients and Formulations, converted since session 11).
  2. ~~Version stamps~~ **Settled session 17** (see the session 17 notes). Original note: **Version stamps are inconsistent across footers**: Costing says v0.6, Batchlog v0.5, Packaging and Ingredients v0.4. Worth a single sweep to one number rather than a per-file decision.
- **Watch for newly-missing costs.** Costing and Batchlog no longer fall through to another lot when the active lot has a blank cost/g. Any ingredient in that state will start reading as a missing cost. That is data becoming visible; the fix is filling in the lot's cost/g in Ingredients.
- ~~Print sheet from the "Make batch" popup~~ — **built session 13.** `Plume.buildSheet(opts)` / `Plume.openSheet(opts)` in core (v1.4); both modules call it, and a test asserts the two produce byte-identical output. Tick box column added after Grams in all three tables. Original spec, kept for reference: (agreed spec, not built). Identical to the Formulations sheet, scaled to the batch size in the popup, printing the variant actually in use. Recipe and instructions only. **A checkbox column added after the Grams column** in all three tables (skincare, soap, soap add-ins), sized for a dry-erase marker — Heide keeps sheets behind a plastic protector and marks off ingredients as she adds them, because oils and computers don't mix. **Build it as a shared function in core** so Formulations and Batchlog print the same sheet; `newFormula` in Batchlog already holds the whole formula object, so no data plumbing is needed.
- ~~Manual reordering of variant tabs~~ — **built session 13.** Drag a tab; order saves immediately via `saveAll()` rather than waiting on the dirty flag, since tab order belongs to the formulation, not the variant being edited. `v.num` and `activeVariantId` untouched. Tabs are only draggable when there is more than one. Original spec: so the most-used variant can sit first. Display order only — version numbers unaffected. Drag-to-reorder matches the existing pattern in formulation lines and the costing product list. **In-use marker stays manual; tabs do not auto-sort.**

### Larger architectural work
12. **Sellable-product clean fork** — different name, defaults wiped, onboarding, **preview/demo capability as a first-class design requirement**
13. **Inventory of finished products** — actual stock counts, requires thinking about sales/depletion. This is the never-built **Phase 5** from the original roadmap (batch log → products/pricing → labels → costing rework → inventory & sales). Production runs record what was made; nothing records what is left. A sixth module is also the case where `plume-core.js` pays off most — it would start by including one file rather than copy-pasting several hundred lines.
14. **IndexedDB or a real backend.** `Store.useDriver()` is the seam; see "`Plume.Store`" above. IndexedDB raises the 5MB ceiling but does **not** solve Safari/iOS eviction or cross-device sync — only a backend does, and that is already required for the sellable fork. **No longer blocked** — the conversion finished in session 12, so nothing bypasses the seam.

### Known limitations
- **Import is additive merge by id/name only** — no "replace existing" option
- ~~Each module has its own `PALETTES` object~~ — **resolved session 12.** One copy in `plume-core.js`; a palette edit is one file.
- **Modules do not see each other's writes until reloaded.** `Store` hydrates an in-memory cache at boot, and the nav opens each module in its own tab. Editing an ingredient in one tab and committing a batch in another can have the second overwrite the first. This is unchanged by the core conversion — every module only ever read once at load — but it is now written down. Reload before committing if another tab has been editing.
- **Soap vs. lotion formulations** use different line shapes in the same structure (`gramsFixed` vs `pct`) — any reader must handle both
- **`localStorage` is browser-bound and origin-scoped.** GitHub Pages hosting gives a stable origin, but data doesn't sync across devices or browsers. Chrome-on-laptop and Safari-on-phone are two separate datasets. **This is also the main place where "modest effort" and "customers are happy" are in tension for the sellable version.**
- **No lot tracking on batches** — Heide mixes lots in practice; false precision is worse than acknowledged imprecision
- **No FIFO cost blending** — see "Cost estimation philosophy" above; this is a deliberate choice, not an oversight
- **Barcode format resets to Code 39** each time the modal opens. Heide declined persisting it to localStorage when offered. Deliberate, not a bug.
- **Code 128 Set C not implemented** — no practical gain for Heide's SKU shapes

---

## Helpful context for the next session

### Heide's workflow (confirmed sessions 9 and 11)
- **Works on desktop.** New computer as of session 9.
- **Heide uploads through the github.com website** — drag/upload files in the browser. **She has no GitHub Desktop, no command line and no local clone**, so suggestions involving `git clone` or terminal commands on HER machine still do not fit. (I made that mistake in session 9.) **Since session 16 this is no longer the only route:** Claude pushes branches and opens PRs directly, so a code change reaches her as a diff to review rather than a file to download. Her manual upload remains available and is still how anything outside a PR gets there.
- The editing loop is: Claude edits files here → Heide downloads → uploads via github.com → GitHub Pages rebuilds. Nothing lives on her machine, so the loop is machine-independent.
- **Computer migration** therefore requires installing nothing. Only: sign in to github.com and Claude on the new machine, then export the five per-module JSON backups on the old machine and import them on the new one. localStorage is origin-scoped to the GitHub Pages URL and does not transfer automatically. All five modules have Export/Import.
- Tests incrementally between builds; uploads between sessions to keep files current.
- **Browser: Chrome.** Relevant because Safari's 7-day ITP storage eviction does not apply.
- **Upload `plume-core.js` BEFORE the HTML files** that depend on it, and hard-refresh (Ctrl+Shift+R) after a core change — browsers cache `.js` stubbornly. `Plume.VERSION` shows in Settings → Storage so the loaded version is verifiable by looking.
- **A shared core makes her workflow easier, not harder** — one file uploaded fixes five modules, which is less clicking through the github.com interface, not more. This was the deciding argument.
- **The GitHub connector in Claude** syncs repo files into a project as context. **As of session 16 Claude also has WRITE access** via the GitHub app: it creates branches, commits, pushes and opens pull requests, and Heide reviews the diff on github.com and merges. The read-only description above this line was true until 16 October 2026 and is kept only so an older note does not read as current. See the sessions 15-16 section for the rules that come with it (no stacked PRs, a merged PR is frozen, say when a PR is good-to-go).

### Design priorities and mental model
- **Heide is a real formulator** with genuine soap domain knowledge (lye calculations, fatty acid profiles, SAP, INCI norms for small US producers) and a pharmacology background.
- **She designs UX carefully before committing to builds** — prefers walking through workflow scenarios and answering clarifying questions first.
- **Strong complexity-budget awareness** — will decline features that don't earn their UI cost (declined the consignment tier, the estimated-vs-actual cost split, the batch actual-cost readout).
- **Features unobtrusive by default** — toggles off, blur-to-save, low-stock alerts off.
- **Prefers plain prose over heavy formatting**, and decisions framed as clear tradeoffs rather than open-ended option lists. Give a recommendation.
- **Appreciates direct feedback and pushback**, including being told when something doesn't exist rather than sent on a fruitless search.
- **Does not review raw JSON directly** — trusts the import process and catches errors in the UI.
- **Prefers maintenance utilities separated from daily-use controls.**
- **Plume is not a point of sale** — she sells via Etsy/Square/website/local retailers. Plume prepares products for sale elsewhere (labels, SKUs, pricing decisions).
- **Labels are text output, not designed graphics** — design happens in Canva. Soap labels use raw ingredient names (not saponified) per US small-producer practice.

### Design decisions worth remembering
- **Per-unit cost is not per-batch profit.** Products cost per unit; batches track bulk. Runs optionally link the two; nothing auto-links.
- **Batch packaging runs and product production runs record different events.** Don't merge them — explicitly declined.
- **Costed batch records are historical financial records** — never mutate retroactively.
- **Wipe over migrate** when a data model changes radically; normalize at read time for minor shape changes (`runComponents()`, absent `productKind`).
- **Filename stability beats naming purity** — `plume-costing.html` kept its name when the module became "Products & Costing."
- **Reorder/override as two affordances, not one gesture** — drag is a visual preference, phase change is a formulation decision; both should be visible.
- **Manual ordering beats a wrong automatic sort** — alphabetical sorted sizes wrong, so manual won even though it costs a drag for each new product.
- **Accounting integrity:** `activeLotId` honored in cost calcs; reference-only lots excluded from stock and cost; fall back to cheapest purchased lot only when no active lot is designated.

### Recurring pitfalls
- **`node --check` after ANY JavaScript edit**, not just when errors are suspected. Pattern: extract the script block, write to a temp `.js`, run the check.
- **Quote escaping in JS-built HTML is the most dangerous recurring hazard.** `oninput`/`onclick` strings inside HTML attribute strings must use double-quoted outer strings with plain single quotes inside — backslash-escaped patterns break silently.
- **Python scripts are more reliable than `str_replace` for substantial rewrites** of long files with complex JS escaping. When `str_replace` fails, print `repr()` of surrounding lines rather than guessing.
- **Line-based replacement** (split → modify by index → rejoin) beats string replacement for targeted edits.
- **Date strings `YYYY-MM-DD` parse as UTC by default** — must parse as local for display (negative-offset bug).
- **Field names are not generic across modules** — formulation lines use `pct`/`ingId`; packaging unit cost reads `totalCost + shipping`. Check the source module before reading.
- **Buttons inside white modals can't use `.btn-ghost`** (invisible).
- **COPY, DO NOT REWRITE, when extracting shared code.** Transcribe the original implementation, run it as a test oracle against the shared version across realistic inputs, *then* delete the original. Session 11 shipped a broken `stockG` by writing it from assumption; a wrong field name doesn't throw, it silently returns wrong numbers.
- **Lot fields:** quantity is `qtyPurchased` (legacy `stock`), unit is `qtyUnit` (legacy `stockUnit`). **There is no `l.unit`.**
- **Palette blocks are now in `plume-core.js` for every module.** They had already diverged before extraction (`family` attribute present in three, missing in two), which is the whole argument for the extraction in miniature.
- **When a module's helper differs only in presentation, wrap rather than delete.** Batchlog's `fmtDate` renders `'--'` for a missing date; core renders `''`. A three-line local wrapper that delegates the actual date maths keeps one implementation without losing the dash. Deleting outright would have been a silent visual regression across the batch list.
- **A save function that returns nothing cannot be checked.** Every converted `save*` now returns a boolean, and callers that report success to the user must check it — `optimisePhotos()` was announcing reclaimed bytes whether or not the write landed.
- **Stock write-backs are rounded in the lot's native unit**, five decimal places, deliberately, to stop float dust accumulating. Taking 70g from a lot stored in pounds lands about 0.002g off. Any test asserting on post-commit stock needs a ~0.01g tolerance, not float epsilon. Not a bug; don't "fix" it.
- **Moving boot into a callback moves everything that depended on boot's timing.** Batchlog's `handleDeepLink()` ran after a synchronous `loadData()`; with `Plume.boot` it had to move inside the callback or it would silently check an empty `forms` array. Grep for anything sequenced after the old boot line before converting a module.
- **`esc(0)` must return `'0'`.** The old `String(s || '')` idiom blanks zero because it is falsy. Core uses `String(s == null ? '' : s)`.
- **A literal closing `</script>` inside a `.js` file breaks the page if that file is ever inlined** into HTML. Session 11 had one in a usage comment in `plume-core.js`. Harmless while loaded via `src`, removed anyway.
- **When slicing a file by two markers, assert the start index is before the end index.** Session 11 duplicated ~1,600 lines because a replacement block's boundaries were in the wrong order and the slice silently produced garbage that still passed `node --check` (duplicate function definitions simply overwrite each other).
- **Cutting a function block by "start marker → next function" must include the closing brace.** Two stray-brace syntax errors in one session came from `inclusive_end=False` boundaries.
- **`/mnt/project/` is a read-only copy.** Edits there do not sync back to the repo. Always copy to `/home/claude/` and stage finished files to `/mnt/user-data/outputs/`.
- **jsdom smoke tests are worth it for substantial UI changes** — sessions 9 and 10 used them to verify editors opened, rendered, priced, and toggled without throwing. Faster than a round-trip to Heide for a broken build.
- **Verify generated artifacts by decoding them back**, not just by checking the generator's inputs. Session 10's barcode work decoded rendered SVG geometry to text; it proved the renderer rather than the table, and the same style of arithmetic check caught a wrong Avery margin that would have wasted label stock.
- **For hardware capabilities, read the device spec sheet, not the support article.** Session 10 got Code 128 support wrong by relying on a single help page. Prefer the manufacturer's specs page, and when a user says the docs disagree with you, check before defending.
- **When replacing a large function block, splice by line index** (find start and end markers, rebuild the file) rather than one giant `str_replace`. Session 10 used this for the ~490-line barcode wiring block.

### Tools & resources
- **Plume app:** GitHub Pages at `https://littlebirdstudio.github.io/plume/`, files managed via the github.com web interface
- **Little Bird Studio website:** Squarespace at little-bird-studio.com; plumebylittlebird.com forwards to the Plume section with paths maintained (301). **Website and labels/product descriptions were completed and published in a separate chat.**
- **Design tools:** Canva (product shots, label design — PDF Print export at exact dimensions; the Label Sheets app does not support PDF export); Affinity Designer (clean SVG exports — Canva-flattened SVGs with embedded rasters break logo rendering)
- **Labels:** 3.5" × 1.25" custom size, front + back; blank OnlineLabels sheets with a paper cutter for local launch
- **Outer packaging:** blank kraft cartons with custom stickers for small bottles
- **Ingredient reference:** Formula Botanica Ingredients Directory, parsed to structured JSON (169 ingredients), imported into the Plume library
- **Shipping (Squarespace):** carrier-calculated USPS with flat-rate carrier containers plus one 14×14×14 custom catch-all box; overshoot-and-refund philosophy
- **SKU system (pottery):** prefix-year-sequence (`LBS-26-001`), single running counter across all forms, written physically on each piece. For market scanning, pottery uses short *price-tier* codes (`MUG32`) rather than per-piece codes — the physical SKU stays for Heide's own records.
- **Point of sale:** Square Handheld ($399, built-in scanner, Wi-Fi only, IP54). Square-native for in-person; Squarespace remains the online store. The two do not sync.
- **Thermal sticker printer** — used for barcode sticker rolls. Sheet mode with cut guides covers plain sticker paper + paper cutter.

### What to read first in a future session
1. This handoff
2. The relevant module's HTML — comment headers identify section boundaries
3. The shape definitions in "Data structure reference" before reading any cross-module code
4. The cost cascade under Module 1 before touching anything cost-related — it's mirrored in two modules and they must stay in agreement
5. The barcode generator section under Module 5 before touching label output — the two symbologies share one renderer, and the density thresholds are load-bearing

---

## Sessions 15-16 (15-16 October 2026) — GitHub workflow, SAP data, density, archiving

**The biggest change is not a feature.** Claude now has write access to the
repository and work goes through pull requests. Several claims elsewhere in
this document predate that and are wrong; they are corrected below.

### The workflow changed — read this before anything else

**The GitHub connector is no longer read-only.** Claude can create branches,
commit, push and open pull requests. Heide reviews the diff on github.com and
merges. The download-and-upload loop is gone for code changes.

What this means in practice:

- Work happens on a branch, never on `main`. `main` is protected by a
  **ruleset** (not classic branch protection) requiring the `test` status check
  to pass. The ruleset targets `~DEFAULT_BRANCH`, so feature branches are
  unprotected and can be force-pushed. It was briefly set to `~ALL`, which
  blocked branch creation entirely; do not set it back.
- **Do not stack a PR on another PR's branch.** Heide squash-merges, which
  replaces a branch's commits with one new commit, so the stacked base never
  becomes part of `main`'s history and the stacked PR merges into a dead
  branch. This happened in session 16: PR #8's content had to be re-landed as
  PR #9. Branch from `main` every time and deal with any conflict.
- **A merged PR is frozen.** Pushing a follow-up commit to its branch does
  nothing and runs no CI. This happened four times in one session because
  Heide reviews quickly. Finish the work before opening the PR.
- **Say explicitly when a PR is good-to-go.** Her words: *"I don't need to
  merge until you let me know it is good-to-go, rather than wishing I hadn't."*
- **Do not sit in a CI polling loop.** Push, tell her, check once. A ten-minute
  blocking poll reads as the session having stalled, and she said so.
- **Branch deletion is blocked by the proxy.** Claude can create branches but
  not delete them; Heide deletes merged branches in the GitHub UI.
- Her own upload workflow via github.com still exists and still works. It is
  just no longer the only route.

### Tests live in the repo now, and CI runs them

`package.json`, `.gitignore`, `package-lock.json` and a `test/` directory are
committed. `npm test` runs thirteen suites, ~556 checks (`test-search.js`, `test-ph.js`, `test-version.js`, `test-starter.js`, `test-lowdown.js` and `test-dialogs.js` added session 17).
`.github/workflows/tests.yml` runs the same on every pull request and on push
to `main`.

| Suite | What it covers |
|---|---|
| `test-lock.js` | Approved-version lock (jsdom) |
| `test-guards.js` | Delete confirmation wording |
| `test-archive.js` | Formulation archiving, retired versions |
| `test-inci.js` | Blend INCI splitting and dedup |
| `test-sap.js` | SAP reference data and the review that applies it |
| `test-ing-archive.js` | Ingredient archiving, delete guard, missing-ingredient row |
| `test-density.js` | Density resolution and the stock arithmetic on it |
| `test-search.js` | Ingredient search ordering (best match first) |
| `test-ph.js` | pH: version target, usage-log steps, batch final pH, bench sheet |
| `test-version.js` | Every footer shows core's version; none types its own |
| `test-starter.js` | Quick add: merged starter list, SAP from SoapCalc at add time, in-library marking |
| `test-lowdown.js` | Drafted lowdowns: the review, the draft tag and its keep tick, editing as confirmation |
| `test-dialogs.js` | The in-page dialog driven by real clicks and keys, plus a scan that fails if any `alert`/`confirm`/`prompt` call returns to an app file |

**Playwright is pinned to an exact version (1.56.0), deliberately.** Each
release expects one specific Chromium build; a mismatch fails with "Executable
doesn't exist", which reads like a broken suite but is a version mismatch.
`package-lock.json` is committed. See `test/README.md`.

`test/helpers.js` inlines local `<script src>` files into a self-contained
preview under `test/tmp/`, because a `file://` page will not reliably fetch
them. **Adding a new local script file means adding it to `INLINE` there**, or
every browser suite throws.

This supersedes the `plume-devtools.py` arrangement described under session 14.
That file is still in the project but the repo copy is now authoritative.

### LICENSE added

"All rights reserved" with explicit permission to use the hosted app, and no
permission to copy, fork or resell. Chosen over MIT because of the planned
sellable fork. It also carries a disclaimer that Plume does arithmetic and does
not verify that a formulation is safe.

Related finding: **GitHub Pages serves readable source regardless of repo
visibility**, because Plume is vanilla JS with no build step, and a free
account cannot publish Pages from a private repo at all. Code secrecy is not
available on this hosting by any configuration. Plan the sellable fork
accordingly.

### Phase colours in the formula editor

Each phase group is a box in its own colour: the pale badge tint as a header
band, the badge ink as text, the saturated dot tone as the rule beneath, and a
wash a few shades lighter as the box fill.

**`--ph-oil-edge` (#9A7B3C) exists because `--dot-oil` (#BA7517) is within a
few degrees of `--warning` (#B07020)**, which is the low-stock row border, so a
whole box drawn in it read as an alert. Heide predicted this before it was
built. Two fixes were needed: the bronze tone AND widening the row inset from
6px to 12px, because even in bronze two parallel warm lines 6px apart read as
one smudged edge.

The add-in button now reads **As add-in** / **As additive** rather than
"Add-in", because it sits on the same line as the ingredient search and read as
a second add button rather than a mode switch.

### SAP data: most of it was never real

**The headline finding of session 16.** Of the 44 oils in the seeder carrying
soap data, **22 shared one of just two value pairs** — thirteen at exactly
`0.136/0.190`, nine more at `0.135/0.189` — across oils whose real values
spread from 0.129 to 0.148. A generic figure stamped across unrelated oils.

Nine read **high**, which is the dangerous direction: a SAP value above the
truth makes the calculator ask for more lye than the oils can consume and eats
the superfat. Coconut, at 25-30% of most bar recipes, was among them at
0.190 against a true 0.183.

The fatty acid profiles were the opposite: 34 of 44 predict their own SAP
within 4%, so they were kept.

**`plume-sapdata.js` (new file, v1.0, 82 oils).** SAP from the SoapCalc chart
Heide supplied. Two validation laws, both independent of what any source
claims:

1. **KOH SAP must be 1.4027 x NaOH SAP**, fixed by the molar masses (56.105 and
   39.997). Every row is checked, so the column order is confirmed by chemistry
   rather than by trusting a header. Her chart lists KOH first.
2. **A fatty acid profile predicts a SAP value.** A triglyceride of an acid with
   molar mass M weighs 3M + 38.04 and takes 3 KOH to saponify. Predictions run
   about 1% high because real oils carry unsaponifiable matter, which is itself
   a check that the method works.

Three profiles are **withheld rather than guessed**: murumuru and ucuuba
disagree with the chart by over 10% with nothing about the oil to explain it,
and jojoba is a wax ester the triglyceride model does not describe. **`fa:
null` means "not reliably known", never zero**, and the review never writes a
profile over one already in the library.

One SAP value carries `estimated:true`: **chia seed oil**, which is not on the
chart and kept its old placeholder. Heide found this by asking "if a SAP value
is not known, it is now no longer guessed, is that correct?" Anything not from
the chart must carry that flag.

**SAP is keyed on NAME, not INCI.** INCI names the botanical source; grade is
what moves the value. Safflower and high-oleic safflower share one INCI and
saponify at 0.137 and 0.135. Aliases never shadow another oil's primary name,
and a test enforces it.

**Fractionated coconut oil was wrong in the seeder** — recorded as
`Cocos Nucifera (Coconut) Oil` with a profile accounting for 25% of the oil.
Heide caught it. Fractionating strips the long-chain acids out, so it is
`Caprylic/Capric Triglyceride` and its composition is the C8/C10 pair. She also
pointed out that **FCO and CCT are related grades, not one product** (FCO is
from coconut; CCT may come from palm kernel, and the C8:C10 ratio varies), so
CCT-style names resolve to the same row via aliases, with a comment saying to
split them if a real difference between two stocked products is ever known.

**The review tool.** The existing reference importer never overwrites, by
design, so it could not correct a wrong value. "Check SAP values against
reference" in Settings is the explicit alternative: it groups oils by what the
stored value does (overstated / understated / none yet / profile only), sorted
by how far off, shows both lye types, and applies nothing until confirmed.
Built as an in-app modal, which is the first piece of the dialog-conversion
backlog item.

**Bucket naming bug worth remembering:** the buckets were first named for which
way the number moves when corrected, while the headings described whether the
stored value read high. Those are opposites, so every oil sat under a heading
saying the reverse of the truth. Name a bucket after the thing, not the fix.

### Density: stop assuming oil is water

Density converts a lot bought by **volume** into grams. Where none was
recorded, every module used 1.0, so stock on hand ran ~7% high and cost per
gram ~7% low on every oil bought by the litre.

The tables that knew better existed but lived in the Ingredients edit form and
read from DOM fields, so they could only suggest a value to a human and nothing
else could see them. They are in `plume-core.js` now (v1.9), and
**`Plume.densityFor(ing)`** resolves from a plain object, returning the value
AND its source: `set` (she typed it, never overridden), `inci`, `category`, or
`default` (1.0, an admitted guess). `stockG`, `stockGOrNull`, Ingredients'
`calcTotalStockG`, `isLowStock` and Batchlog's deduction all use it.

**Heide looked up 31 densities herself, and the striking result is that 26 land
within 1.5% of the existing 0.92 carrier-oil default**, with her liquid-oil
median at exactly 0.9200. Her data validated the category default rather than
replacing it, which is why the remaining ~46 oils are left on it: under 1% of
error against the 7% the water fallback was costing. The outliers earn their
own entries, jojoba most of all at 0.860 — a wax ester, the same reason its
fatty acid profile was withheld.

**Propanediol corrected from 1.02 to 1.053.** Her lookup caught it;
1,3-propanediol is about 1.06 at 20 C. Glycerin at 1.260 matched.

**Unlike SAP, density has no validating law.** There is no ratio to check and
no profile to predict from, so a recorded source is the only provenance. Five
of her 31 carry one.

### Ingredient archiving, and the bug underneath it

Heide asked for un-archive in Ingredients, which Formulations had and
Ingredients never did. Investigating found something worse.

**Deleting an ingredient silently corrupted formulations.** A line holds an
ingredient id, so deleting the ingredient left the line pointing at nothing,
and every render path did `if (!ing) return`. The row vanished while the line
kept counting toward the percentage total: a two-line formula rendered **one
row under a header reading 100.00%**. A bench sheet printed from that is simply
wrong. `deleteCurrent()` confirmed with "This cannot be undone" and checked
nothing.

**This is the second time a line has vanished while still counting** — the
first was a stray phase key in session 13, and the comment recording that
lesson sits a few lines above the code that had the same bug. Lines now resolve
through `resolveIng()`, which returns a marked stub rather than `undefined`, so
a missing ingredient renders a dashed warning row saying the formula is short.
That also surfaces any dangling reference already in the data.

**The delete guard** mirrors the formulation one and **scans every variant**,
not just the active one. A line lives on a variant; top-level `f.lines` is only
a mirror of whichever is active, so checking that alone would call an
ingredient unused while three versions depended on it.

**The archive UI:** a Show archived toggle, dimmed rows with a tag, an
Unarchive button and banner, and Unarchive in the quick look. The old confirm
told her to restore by importing a backup, which was never true.

**A search always reaches the archive** (her requirement, and she is right):
browsing hides it because a short list is the point, but a text query names a
specific thing, and answering "no results" for something in the archive is how
a duplicate gets made — one ingredient, two records, lots split between them.
Category and phase filters do not reach it, because those are browsing.

### Two UI bugs worth recording as patterns

1. **Markup in a data field gets escaped.** The density note was written as a
   styled `<span>` inside a `propsFields` value, and every value there is
   escaped on the way out, so it rendered as literal angle brackets. The note
   is a separate `note` property now and the renderer supplies the markup.
2. **A banner must follow its state.** The archive bar said "N archived
   ingredients hidden from this list" *while showing them*, because one
   sentence served both states. Heide's ingredient list appeared to grow, she
   checked her data, found nothing added since May, and concluded she was
   imagining it. She was not: the one element that existed to explain the extra
   rows was contradicting them.

That second one also exposed the real history: **archiving existed before
today but there was no way to see or restore archived items**, so things she
archived months ago went into a hole with no door and she never knew they were
there. Making the archive visible is what exposed how badly it behaved.

### Session 16 process notes

- **Claude's diagnoses were wrong twice in one stretch**, once asserting a
  cause confidently and once over-correcting away from a cause that was
  right. When a user reports something odd, gather the facts before offering
  an explanation; a plausible story invites agreement and then has to be
  retracted.
- **Check `.merged` before concluding a PR is broken.** Twice a PR looked
  stuck when Heide had simply merged it; a merged PR freezes and cannot be
  reopened.
- **Assert that two numbers agree, not that each is plausible.** The density
  tests verified `stockG` in isolation and passed while the screen showed a
  different number from the same quantity. Only the disagreement revealed it.

---

## Session 17 (16 October 2026) — Search ordering

**Her report:** typing "n" in the ingredient search did not put names starting
with N first; "na" opened on Activated charcoal, "nat" on Bakuchiol.

**Cause, two halves.** The Ingredients list matched anywhere (name, INCI,
function notes, her notes, supplier) and then sorted every match
alphabetically, so an A-name matched through a word in its notes led the
list. Formulations already put name/INCI matches ahead of notes matches, but
"contains" ranked the same as "starts with", so "na" inside Niacinamide or an
INCI tied with a name beginning with Na.

**Fix (core v1.10).** `Plume.ingMatchRank` now returns five bands, lower is
better, 0 still meaning no match so every caller that tests it as true/false
is unchanged: 1 name starts with the query; 2 a later word of the name does;
3 a word of the INCI does (a parenthesis counts as a word break, so "(Shea)"
is reachable); 4 mid-word in name or INCI; 5 functions, function notes,
purpose, lowdown. The Ingredients list sorts by this when searching (supplier
only matches rank 6, last) and stays plain alphabetical when browsing.
Formulations needed no logic change. The cheat sheet only filters by the
rank, so it is unaffected.

New suite `test-search.js` (18 checks), confirmed to fail 12 of 18 against
the old code.

### Session 17 (cont.) — pH records (core v1.11)

**Her ask:** capture pH for aqueous products, at least the final pH and
whether it needed adjusting. Designed together in conversation, then built.

**The split, in her words:** the batch record is where she goes back to find
the pH of a specific batch, and she does not need to document how she got
there there; the usage log shows the steps and pH along the way. They record
different events (sometimes the same one), so each has its own fields and
nothing is entered twice by design.

1. **Target range per version** (`v.phMin`, `v.phMax`, strings), a "this
   version" field under Status. Optional; blank is fine. Diffed into change
   history ("Target pH set to 4.8-5.5", "... -> ..."), copied into a new
   version, locked with the other per-version fields on an approved version,
   and mirrored to `f.phMin` / `f.phMax` by `syncActive` (Batchlog reads the
   top level). Reverting to a snapshot from before pH existed does NOT wipe
   the current target: it restores the field only when the snapshot has the
   key.
2. **Usage-log steps** (`entry.ph = [{v, m, add}]`): a reading, its method
   (`strip` | `meter`), then optionally what was added before the next
   reading. Rendered as a chain of pills; only the LAST reading is judged
   against the target, since an out-of-range start is the point of
   adjusting. Adjusters are **free text** (her call: a few drops never move
   stock or cost) with suggestions from every adjuster she has typed before,
   most-used first. An entry with no readings stores no `ph` key.
3. **Batch final pH** (`b.finalPh`, `b.finalPhMethod`) in batch detail,
   editable after save, shown under the yield in the batch list. **A batch
   snapshots `phMin`/`phMax` at creation**, because a batch is a historical
   record and a later change to the formula's target must not change how an
   old batch reads. Batches made before this have no key and fall back to
   the formula's current target (`batchPhTarget`).
4. **Bench sheet** gets a pH block (target or a blank, final, a line for
   readings) for any water-phase formula. Both modules pass the target.

**Readings are stored as the string typed** (after `Plume.parsePh`
validates 0-14, up to two decimals), so a meter's "5.20" keeps its second
decimal. She uses strips for a ballpark and a meter to fine-tune, which is
also why every reading carries its method. Compare with `Plume.phNum`.

**When pH appears at all:** `Plume.isAqueous(lines, ings)`, any non-add-in
line whose phase (per-line override first) is `water`, or a target/reading
already present. Never for the two soap types. A balm or oil blend shows no
pH fields anywhere.

**A bad value never saves silently.** The target field and step readings
turn red and say why; the usage-log entry and batch edit refuse to save
until fixed.

**Also fixed:** the usage log defaulted its date with `toISOString()` (UTC),
so an entry logged after 4pm Alaska time defaulted to tomorrow. Now
`Plume.todayISO()`.

**Gotcha:** Plume's labels are uppercased by CSS, which turned "pH" into
"PH". `.ph-word` (core CSS) keeps the case; use it on any new pH label. The
bench sheet's section title has the same fix inline.

**Possible next step (not built, not promised):** warn when a version's
target sits outside its preservative's working pH range, using the pH data
already on ingredient records. Usage-log entries still cannot be edited
after saving, only deleted; worth asking if pH steps make that more pressing.

### Session 17 (cont.) — SAP questions settled (plume-sapdata.js v1.1)

Heide closed the four open SAP questions from the backlog:

- **Murumuru, ucuuba, sea buckthorn: SAP unknown on purpose.** Her reason:
  obscure or expensive oils she is unlikely to soap with, and the sources
  disagreed. Rows now carry `naoh:null, koh:null, unknown:true`; profiles are
  kept where the reference had one (sea buckthorn). The rows stay so the SAP
  review can find these oils: a new **"No reliable value"** group offers to
  CLEAR a stored value (SAP only, the profile stays), after which the lye
  calculator marks the oil as missing SAP rather than calculating from a
  figure nobody can stand behind. The seeder lost murumuru's soap data
  (including the profile the reference had withheld) and sea buckthorn's SAP.
  **Do not fill these back in without a source she accepts.**
- **Canola = rapeseed.** One row answers to both names (`Rapeseed oil` alias
  added). It stays at 0.133: canola is rapeseed bred low in erucic acid, the
  chart's lower 0.125 "rapeseed, unrefined" figure fits old high-erucic
  rapeseed, and the stored profile predicts 0.133. Her old library value
  (0.124, from the seeder) will show as understated in the review, the
  harmless direction.
- **Pumpkin seed butter** now carries `estimated:true` (it had no chart row
  and took the oil's value), which the provenance rule already required.

`test-sap.js` pins the unknown set to exactly those three, so a silently
blanked row cannot hide among them (78 checks, was 65).

### Session 17 (cont.) — One app version (core v1.12)

**Decided with her:** one automatic number. `Plume.VERSION` in
`plume-core.js` IS the app version. Every footer has a
`<span class="plume-version">` that core fills (`Plume.stampVersion()`,
called from `boot`; the landing page loads core only to call it), and
Settings → Storage shows the same number. The old footers carried
hand-typed v0.4 / v0.5 / v0.6 (two with "May 2026"), and Formulations had no
footer at all; it has one now.

**Rule that comes with it: bump `VERSION` in every pull request, core change
or not.** That is what lets her confirm, by looking at any footer, that the
update she just merged is the one loaded. Tests read the number from core,
so a bump never needs a test edit.

**Gotcha found by the test:** Ingredients and Packaging place their footer
AFTER their scripts, so it does not exist yet when `boot` runs.
`stampVersion` waits for `DOMContentLoaded` when the page is still loading.

**Palette: no change, by decision.** Per-module palettes stay, default
`sage-green`. Recorded under "Carried from session 12".

### Session 17 (cont.) — Quick add rebuilt as a comprehensive starter list (core v1.13, plume-sapdata.js v1.2)

**Her ask, and why:** clean up Settings and prepare for the sellable
version by making Quick add a comprehensive starting list. Removed "Patch
soap data" (it copied the stale seeder SAP values back in) and "Import
ingredient reference data" (folded into Quick add). Reorganized by type and
stripped the borrowed text in the same change, her call: the Formula
Botanica prose has little use after first setup.

**`plume-starter.js` v2.0 (new file):** 261 ingredients, each with a
`type`, in 18 types (Carrier oils, Butters and fats, Waxes, Esters and light
emollients, Infused oils and CO2 extracts, Emulsifiers and solubilizers,
Thickeners and gums, Humectants, Waters and hydrosols, Surfactants, Actives
vitamins and acids, Botanical extracts and glycerites, Preservatives
antioxidants and chelators, Essential oils, Clays and charcoal, Exfoliants,
Powders and starches, Soap making). Built from Plume's curated list plus the
Formula Botanica directory, then:

- **One entry per ingredient.** "(organic)" and "(soap grade)" purchasing
  variants and cross-tab repeats folded; real grades kept apart (virgin vs
  76-degree coconut, regular vs high-oleic sunflower, LMW vs HMW hyaluronic
  acid). Her "Your Ingredients" tab, which was her purchase history, is gone
  as a category.
- **Camellia stays two entries:** her "Camellia oil (tea seed)" is *Camellia
  sinensis* and has a SoapCalc row; the directory's "Camellia seed oil" is
  *japonica/oleifera* and has none. Folding them would have handed one
  species the other's SAP.
- **Merge safety:** an INCI-only match also needed the names to share a real
  word (Red clay's INCI is listed as kaolin); grade-specific facts
  (oxidation stability, melting point, absorption, heat stability) only
  filled an exact-name or sole match (high-oleic sunflower must not inherit
  "unstable").
- **No borrowed prose.** `generalInfo` stripped; short factual fields kept.
  Her library's existing records keep their text; only what Quick add
  offers changed.
- **No SAP numbers.** `starterToIngredient()` takes SAP from
  `plume-sapdata.js` by name as an oil is added; nothing if SoapCalc lacks it
  or it is unknown on purpose. Seven aliases added there (Rosehip oil,
  Meadowfoam oil, Tamanu seed oil, Borage seed oil, Flaxseed oil, the long
  fractionated-coconut name, Camellia oil (tea seed)), which also help the
  SAP review recognise those names in her library.
- **`aka` (former names)** on 35 items: folded and renamed names plus the
  directory names that merged under a different name ("Glycerine"). Search
  and the in-library check use them, so a library holding "Rosehip oil" from
  the old import shows Rosehip seed oil as already there. Three directory
  names are deliberately NOT mapped because each covers two grades (Coconut
  oil, Sodium hyaluronate, Aloe vera). `type` and `aka` are never stored on
  the ingredient.
- Directory brand names properly cased (Sucragel AOF Bio, Spectrastat G2
  Natural (MB), SCS...). Tapioca starch's INCI corrected from an extract's to
  "Tapioca Starch".

**Quick add UI:** a search box (the same `Plume.ingMatchRank`, best match
first, plus former names) and a **Type dropdown**, over one list grouped by
type. A dropdown, not chips: nineteen chips took four or five rows and
squeezed the list. Ingredients already in the library are greyed and tagged.
Ticks are kept by item index, so they survive searching and changing type;
the old tabs rebuilt the list and silently dropped ticks made elsewhere, a
bug older than today. "Select / clear all shown" acts on what is visible.
Adding saves once (it used to save after every ingredient with a pause) and
reports a failed save.

**For the sellable fork:** this file is the starting library a buyer gets.
Adding an ingredient means adding an item with a listed type; a test fails on
an unknown type. The build was one-off; edit the file directly.

New suite `test-starter.js` (77 checks).

### Session 17 (cont.) — Drafted lowdowns (core v1.14, plume-starter.js v2.1)

**Her choices:** drafts live in the starter list AND fill her library (no
file uploading); a draft becomes hers by editing it or clicking its tick.

- **Every starter ingredient (262) has a `chooseWhen`** ("The lowdown"):
  strengths and catches vs similar ingredients, 100 to 183 characters. Drafted
  by six parallel research agents by type, from established formulation
  knowledge, with trade-name products (emulsifiers, preservatives, gels)
  checked against manufacturer or supplier pages; then read in full and
  tidied to one style. Six are low confidence and named in the file header
  (Mafura butter, Gum tragacanth, Lemon peel hydrosol, Yucca liquid extract,
  Lady's mantle, Mullein). No therapeutic claims; vitamin E, EDTA and
  ethylhexylglycerin say plainly they are not preservatives; Preservative Eco
  is identified as the Geogard ECT blend (her failed mist).
- **`chooseWhenDraft: true`** marks a drafted line on an ingredient. Shown as
  a quiet dashed "draft" tag with a ✓ wherever the lowdown is
  click-to-type (quick look, details, cheat sheet); "(draft)" in cheat sheet
  print and the Formulations popup; a tag beside the label in the edit
  form. **The tick keeps the line as is. Changing the text (click-to-type or
  the form) makes it hers. Clearing removes both. An unrelated form save keeps
  it a draft** (the form merges into the record, so the flag survives unless
  the text changed).
- **Settings → "Fill in lowdowns"** review: lists her non-archived
  ingredients with a blank lowdown that match a starter item by name or
  former name (`aka`), each with its proposed line and a tick (all on);
  applies only ticked rows, re-checks blank at apply time, never touches
  `purpose`. **Quick add** also brings the lowdown, as a draft.
- **Corrections found while drafting:** Quick add's carrier "Carrot seed oil"
  had been folded into "Carrot seed essential oil" in the earlier merge
  (same INCI, different products); split back into two. Three trade-name
  INCIs that had been cut off at "(and)" completed from supplier pages
  (Sapogel Q, Sucragel AOF Bio, Symbiosolv Clear Plus MB); Horsetail and
  Orris INCIs completed; Kelp's "INCI" (a sentence) now says it varies by
  species. Function lines cleaned for Vegetal, Rosemary essential oil (no
  longer "antioxidant"; that is the extract) and Actifcol (marketing claims
  removed; note Lotioncrafter says the Actifcol NAME needs a Lipotec
  trademark agreement before use in marketing).
- **Filing:** new type **pH adjusters** (citric acid, arginine); SurfPro CF
  to emulsifiers (it is an oil gel, not a cleanser); rosemary CO2 to
  antioxidants; cetyl esters and myristyl myristate to waxes; aloe powder
  beside the other aloes ("Waters, aloe and hydrosols"); "Botanicals,
  extracts and glycerites"; "Powders, starches and salts"; "Infused oils".
- **Cheat sheet:** melting point column removed (her call; it did not help
  choose between emollients).

### Session 18 (17 October 2026) — In-page dialogs replace browser pop-ups (core v1.15)

**Why (her call, from the backlog):** `alert`/`confirm`/`prompt` are blocked
silently in a sandboxed frame, so in an artifact preview, and in any demo of
the sellable version embedded in a web page, every delete, warning and
import did nothing. They also cannot hold more than a line of plain text.

**Core:** `Plume.tell(message, opts)`, `Plume.ask(message, onYes, opts)`,
`Plume.askValue(message, value, onOk, opts)`. Escaped plain text (blank line
= paragraph), one dialog at a time with a queue, Escape cancels, focus kept
inside and returned after, a backdrop click cancels a question but never
dismisses a notice. `danger: true` makes the button red AND puts focus on
Cancel so a stray Enter cannot delete. Styles are injected by core above
every module's own modals (z-index 5000).

**THE RULE for any future code: these do not block.** Everything that used
to run after `if (!confirm()) return;` lives in the `onYes` callback; a
function that returned a confirm's answer takes a callback instead (see
Batchlog's `decommitBatch(silent, done)` and `reverseBatchCommit`). Capture
ids before asking and re-check them in the callback (`if (editingBatchId !==
id) return`). Never call `alert`/`confirm`/`prompt` again: `test-dialogs.js`
scans every app file and fails if one appears.

**Testing:** core calls `window.PLUME_TEST_DIALOGS(kind, message, opts,
value)` if a test defines it, answering synchronously. `trackDialogs(page,
into)` in `test/helpers.js` installs it (AWAIT it before `goto`; the
Packaging conversion found the race when it was not awaited), answers yes or
the default value, and records "title + message" in the same array the suites
used to fill from `page.on('dialog')`. Answer no with
`window.PLUME_TEST_ANSWER = false`.

**How it was done:** five agents, one per module, each in its own git
worktree under `/home/claude/wt/` on its own branch, working from a written
guide; their commits were reviewed and cherry-picked. 96 calls converted
(Formulations 19, Costing 20, Batchlog 17, Ingredients + cheat sheet 16,
Packaging 9; core 2). Restructured flows: Costing `goList` / new
`leaveEditor`, `duplicateProduct` / new `makeDuplicate` (save question, then
open question, strictly in order); Formulations `onStatusChange` (no puts
the status select back) / new `applyStatus`, `revertTo` / new `doRevert`,
`makeBatchFromFormula` / new `openBatchlogFor`; Batchlog `decommitBatch`
(callback) / new `reverseBatchCommit`, `deleteBatch`; Ingredients
`duplicateLotRow` (either answer adds the row; only "Make it active" sets the
flag) and the backdrop unsaved-changes guard; Packaging `optimisePhotos` /
new `runOptimisePhotos`. Imports: each callback has its own try/catch, since
the outer one no longer covers code that runs after the answer.

**Verified beyond the suites:** a real-click script (no test hook) answered
"no" in every module: retire puts the status back, delete keeps the formula,
duplicate "Stay here" stays, batch delete leaves batch and stock untouched
(and "yes" returns lot and bottle stock), discarding a changed ingredient
form keeps the typing, leaving an edited product stays.

**Older bug fixed on the way:** the delete-batch warning listed packaging as
"NaN x undefined" because it read pre-session-8 top-level run fields; it now
goes through `runComponents()`.

### Session 18 (cont.) — Base / solvent, "inexpensive", cheat sheet fit

- **New function category `Base / solvent`** (core `FUNCTION_CATEGORIES`,
  after Humectant). Water, hydrosols and aloe juice/gel had no function that
  fit and landed in "No function set" on the cheat sheet. Starter list
  (v2.2) tags the 14 waters with it; hydrosols are co-tagged `Fragrance` (her
  call). Cheat sheet columns for the group: Use %, Phase, Scent. Her own
  library's waters are untouched; she ticks the chip in the editor.
- **"cheap" reworded in the starter lowdowns** (41 lines): inexpensive /
  less expensive / least expensive; marula rewritten. She had already
  changed her own copies. Use "inexpensive" in anything written for her.
- **Cheat sheet fits without side-scrolling** at 1024 to 1440 px with all
  ten columns (substitutes included): 12px table text, tighter padding,
  narrower lowdown/substitutes/reminder columns, and the page widens to
  1440px while the cheat sheet shows (`body.cs-wide`, removed on the
  details page). Tested at 1280px.
- **Odd-one-out marking explained.** A value that differs from the group's
  majority was drawn in the amber warning colour with no explanation, so it
  read as a problem. Now bold and underlined in the bark colour, with a
  tooltip and a line under the table: "Underlined values differ from most
  others in this group, which is often the reason to choose one over
  another."


### Session 18 (cont.) — Installable app and offline copy (core v1.16)

Heide asked for a more app-like feel; we landed on a PWA, and offline use is
what a sellable package will be. Her own Plume logo is the icon for now; a
generic name and icon will be needed before it is sold.

**New files:** `manifest.webmanifest` (name, `start_url ./index.html`,
`scope ./`, standalone, cream background, olive `#404834` theme), `sw.js`
(the service worker), `icons/` (192, 512, maskable 512 with the badge inside
the safe zone, 32px favicon, 180px apple-touch-icon). Every page's head links
the manifest, theme colour, favicon and apple-touch-icon.

**The service worker is network first, on purpose.** Online, every app file
comes fresh from the site and refreshes the saved copy; the saved copy is
used only when the network fails or takes over 4 seconds (`FRESH_TIMEOUT`).
That is what solved the backlog's blocker: the "push to GitHub, reload, see
the change" loop is unchanged, with no "new version available" notice to
build. Cache-first would open a fraction faster and make every update one
load late. Fonts are kept in their own cache, cache-first. The worker never
touches localStorage; her data lives where it always did, same origin, so
installing moved nothing.

**Rule: every file the app loads must be in `APP_FILES` in sw.js.**
test-pwa.js fails if a page references a local file missing from the list,
or if a listed file does not exist. The cache name only changes if the
caching scheme itself changes.

**Core (v1.16):** `registerAppWorker()` on window load, http(s) only (file://
previews and sandboxed artifacts carry on without it); `Plume.isInstalled()`
(display-mode standalone or window-controls-overlay, iOS `navigator.standalone`,
test hook `window.PLUME_TEST_STANDALONE`); `Plume.install()` uses the saved
`beforeinstallprompt` and shows any `.plume-install` button (landing page has
one, hidden until Chrome offers; otherwise a dialog explains Chrome's own
install icon); `Plume.openPage(url)` (same window when installed, new tab in a
browser), used by Formulations `openBatchlogFor`; `Plume.resetAppCache()`
(asks, unregisters the worker, deletes `plume-` caches only, reloads). The
start-up hooks are guarded so the sandbox suites that run core without a DOM
still load it.

**One window when installed.** In the installed app, module links (which carry
named targets like `target="plume-formulations"`) are turned into same-window
navigation by a capture-phase click handler, so the app does not sprout a
window per module. In a browser tab, links behave exactly as before. Side
benefit: each module loads fresh from storage on arrival. Print sheets still
open their own window, which is right for printing.

**Settings -> Storage** gains a status line: "Running as an installed app" or
"in a browser tab", "Offline copy: ready / being saved / not available here",
a "Clear the saved app copy" link, and an install link when Chrome offers.

**To install:** in Chrome on the published site, the install icon at the
right of the address bar, or the landing page's "Install Plume as an app"
button when it shows. Uninstalling from Chrome may offer to clear site data:
leave that unticked, or the library goes with it (export first regardless).
None of this can be seen in an artifact preview, since previews are
sandboxed and cannot register a service worker.

**Regenerating the icons** (for the sellable logo): render the source SVG in
Playwright on a white square and screenshot at 512, 192, 180 and 32 px; for
the maskable icon draw the logo at 400 px centred on a 512 px white square so
nothing important falls outside the circle Android crops to.

**Tests:** new `test-pwa.js` (41 checks) serves the real repo from a Node http
server, proves every file is saved, a changed file shows on the next load, a
slow file falls back after about 4 seconds, every page opens with the server
stopped, installed-mode links stay in the window, and clearing the saved copy
leaves localStorage and other caches alone. 14 suites, 597 checks.

### Session 18 (cont.) — Dark mode; cheat sheet marking removed (core v1.17)

**Cheat sheet.** The odd-one-out marking (bold underline plus a legend) came
out: Heide found it added nothing. `planGroup` no longer computes `odd`. The
page width while the cheat sheet shows went from 1440px to 1260px (the list
is 1100px); her words: the expansion "looks clunky", so somewhere in the
middle. Ten columns with substitutes still fit at 1280px (test-lowdown).

**Dark mode: one setting, every palette.** Settings in every module now
starts with Light / Dark / Match my computer (default: Match my computer).
The choice is global, kept on the device in localStorage as `plume-theme`
(not in Store, so every page, the landing page included, applies it as core
loads, before data). Palettes stay per module, as she decided earlier; dark
mode gives each one a dark version.

**No hand-drawn dark palettes.** `Plume.darkValue(name, value)` turns each
colour variable dark by the ROLE its name implies, keeping its hue:
`--cream` page background (near-black), `--white` surfaces, `--cream-dark`
quiet fills, `--cream-border`, `--ink*` light text, `--bark-light` a mid
accent; then by suffix: `-dark`/`-fg` light text, `-light`/`-bg` deep tints,
`-wash`, `-hover`, `-edge`, `-border`; everything else is an accent kept
bright enough to read; `--warning`/`--danger` brighter still, since they
sit on their own tints. Non-colours and rgba values are left alone.
`applyTheme()` reads the page's own `:root` variables from its stylesheet
(`rootVars()`), overlays the module palette, and sets the dark values as
inline properties on `<html>`, plus `data-theme="dark"` and
`color-scheme: dark`. So the categorical colours each module defines (phase
colours and washes, packaging types, quality bars, dots) get dark versions
without being listed. A new colour variable just needs a name that says its
role. Back to light removes everything dark mode set and reapplies the
palette.

**Inverse areas get their own variables.** The header, nav and the
ingredient detail card header are dark-on-light inverted (bark-dark
background, cream text), which a role rule cannot serve. They now use
`var(--hdr-bg, var(--bark-dark))`, `--hdr-fg`, `--hdr-sub`, `--hdr-line`;
these are set only in dark mode (a deep tint of the palette's main colour),
so light mode is unchanged. Ghost buttons (header only) use `--hdr-fg`.

**Also:** the installed app's title bar follows (`meta theme-color`);
printing switches to light for the print (beforeprint/afterprint); other
open windows follow a change (storage event); Match my computer follows the
computer live; the landing page logo is inverted and screened onto the dark
page; the storage banners use the warning/danger variables. Print windows
(bench sheet, cheat sheet print, barcodes) keep their own light styles.

**Tests:** new `test-theme.js` (37): role rules; every palette meets
contrast in dark (text 7:1 on surfaces, quiet text 4.5:1, button text,
tints, warnings); the setting, Match my computer, other windows, printing,
the landing page; and a sweep that fails if any visible text in the main
views of every module is under 3.5:1 against what is behind it. 15 suites,
635 checks. Light mode's own contrast was not changed and has more low
spots than dark (small uppercase labels in `--ink-lighter`); not asked for.

### Session 19 (18 October 2026) — App-style redesign, Ingredients first; one palette (core v1.18)

**Why.** Heide felt the app looked "homemade" and pointed to Notion as the
feel she wanted. A preview artifact (Proposed vs Today, with a palette
switcher) went through several rounds before anything was built. Her calls:
keep the in-stock row tint (more useful than a dot) but keep the amber
"running low" dot; heavier lines between rows; a livelier palette; ONE
palette for the whole app (she had split them per module so she could tell
which screen was open, but the sidebar now does that); no peach or sand
tints across everything; a more colourful, distinct hover in the sidebar.
Ingredients is the pilot. The other modules follow one at a time, each
checked with her.

**One palette.** The twelve old palettes are gone. New set: `finch`
(default; terracotta accent `#B9492F`, sage in-stock tint `#EDF2EA`),
`garden`, `lagoon`, `plum`, and `sage-green` kept as "Sage (classic)".
Pages are near-neutral (no warm sand). The palette key is now
`plume-palette` for every module (`paletteKey()`); the old per-module keys
are simply ignored. Variable roles are unchanged, so dark mode and the
modules not yet converted keep working: `--white` main surface, `--cream`
sidebar and page, `--cream-dark` hover, `--cream-border` lines, `--bark`
accent, `--bark-dark` headings, `--clay-light`/`--clay-hover` the in-stock
tint. Modules not yet converted show the new colours under their old
headers until their turn.

**The shell (core).** `Plume.shell({module})` injects a fixed sidebar
(`aside#ps-side`): workspace name linking to the landing page, a collapse
button (remembered in `plume-side-collapsed`), the five modules with live
counts (archived left out) and the current one marked (`.on`,
`aria-current`), a Library section with Suppliers (calls `openSuppliers()`
when the page has it, else links to `plume-ingredients.html#suppliers`),
and Settings (`openSettings()`). Module links keep `target="plume-<key>"`
so each module still opens in its own window, which she wants for side by
side work. `Plume.refreshShell()` updates counts. Below 760px the sidebar
becomes a bar along the top. `Plume.icon(name)` returns inline SVG (module
icons match the landing page drawings). `Plume.peek.open(html, {label,
actions, onClose})` / `.close()` / `.isOpen()` is a 480px slide-in panel
with a scrim; Escape closes it unless a dialog is open. Overflow menus:
a `[data-ps-menu]` button followed by a `.ps-menu`, one delegated handler.
Shared CSS classes, all `ps-`: page head (`ps-page-head`, `ps-title`,
`ps-summary`), toolbar (`ps-toolbar`, `ps-tab`, `ps-tools`, `ps-search`,
`ps-btn-primary`, `ps-icon-btn`), chips (`ps-chips`, `ps-chip`, `.on`),
table (`ps-table`, `has-stock`, `sel`, `ps-num`, `ps-sub`), tags
(`ps-tag`, with phase variants). `BRAND` holds the name shown in the
sidebar, ready for the Formula Finch rename.

**Ingredients.** The dark header is gone. Page head with icon, title and a
one-line summary (replaces the stat cards); List / Cheat sheet tabs, search,
New, and a ⋯ menu (quick add from the starter list, export, import). Filters
are chips: phase, function (a select styled as a chip), In stock, Running
low, Restricted; the old selects stay hidden so the filter code is
unchanged. Rows: name over INCI, phase tag, function tags, use range,
price per gram, stock last. Quick look moved from in place under the row to
the slide-in panel (same toggle rules: the same id closes, another id
switches). The details page got a light header in the page-title type in
place of the dark banner. IDs the tests depend on were kept (`#search`,
`#tbody`, `tr[data-ing]`, `.td-name`, `.ql-actions a`, `#in-stock-btn`,
`#low-stock-btn`, the stock cell last).

**Tests.** New `test-shell.js` (36): core exports and palette set, no sand
pages, the sidebar (modules, counts, current, own windows, Settings,
collapse remembered), summary, chips, menu, the panel (open, switch,
Escape, scrim, open full page), phone width. test-lowdown now checks the
cheat sheet's 1260px cap rather than its rendered width (a 1280px screen
minus the sidebar has less room; the ten columns still fit). test-theme:
Finch is the default, the palette reaches other modules. 16 suites.

**Next:** Formulations (the most complex), then Packaging, Products &
Costing, Batches, one per PR, each previewed with Heide. The landing page
could take the palette later.

### Session 19 (cont.) — Header colour block, Ingredients tweaks, Formulations in the shell (core v1.19)

**Her calls on Ingredients (after the pilot shipped):** the page head sits in a
colour block; Show archived moves to the toolbar; the search moves to where
the archive bar was (between the chips and the table); the archive bar's
explanation goes, just the button. The button's own state carries the
meaning now (Show / Hide wording, dark when on, `aria-pressed`). One piece of
the old bar was kept on purpose: when a search finds nothing, the empty
message says "archived ingredients included", which is the duplicate guard.

**Core v1.19.** `.ps-page-head` is a colour block: a wash of `--bark` mixed
into `--white`, so it follows the palette and dark mode. The title icon sits
on a white tile. New icons: `archive`, `check`, `copy`, `trash`, `note`.
`.ps-menu-danger` for a red menu item.

**Formulations, converted. The first preview went too far and she said so:**
she likes how the module works and looks, and wanted it spruced up, not
replaced. Round 2 is what she approved and what was built:
- **List:** cards stay (smaller), plus a search box above them (reaches the
  archive, like Ingredients), status chips, a type chip, Show archived in the
  toolbar, Export / Import in the ⋯ menu.
- **Editor:** breadcrumb, Saved / Save, Print and a ⋯ menu (Duplicate,
  Archive, Delete) along the top. The colour block holds the name, the
  purpose line, and product type / status / target pH in ONE row of small
  labelled fields. No icons on those fields (she found the property-table
  layout awkward: too much space, "a weird table without lines").
- **Phase boxes are unchanged in colour and structure** (the session 15-16
  work). She was explicit that this must stay. Only the radius and the band's
  type (sentence case) changed.
- **Notes slide in from the right** via `Plume.peek` (`selectNotes`). The
  panel writes into the hidden `#f-formnotes`, which `saveFormula` reads;
  closing the panel saves. The version underneath keeps its lock.
- Method, Usage log and Change history are tabs under the recipe
  (`setEdTab`); the counts on the tabs come from `setTabCount`. The right
  column keeps batch size (with the formula total and the add-ins toggle
  inside it), cost, INCI, and lye / soap quality for soap.
- `renderSaveState()` shows "Saved" or a Save button; `markDirty` and
  `saveFormula` drive it.

**Tests:** `test-shell.js` gains a Formulations section (22 checks): shell,
colour block, summary, chips, search, phase boxes keep their colours,
Saved / Save, the tabs, Notes panel, Archive in the menu. `test-lock.js`
section 7 now checks that Notes opens beside a locked version without
unlocking it, and that closing saves. `test-archive.js` and
`test-ing-archive.js` follow the moved buttons.

**Next:** Packaging, Products & Costing, Batches, one per PR, each previewed
first. Lesson from this round: for a module she already likes, preview a
restyle of what is there before proposing structural change.

### Session 19 (cont.) — Cards and the bench sheet (core v1.20)

- **Formulation cards:** a dark 2px edge (`--ink-light`, `--bark` on hover)
  and the name on a medium-tone bar (`--bark` 20% into `--white`). Phase dots
  removed from the cards, her call.
- **Bench sheet, % vs grams.** Her report: she loves the prints, but % and
  grams side by side were easy to mix up at the scale. Now `% ` sits right
  after the name in small grey (`td.pc`), INCI between, and Grams is the one
  bold number beside the tick box (`td.gr`). Applies to all three tables
  (skincare, soap oils with lye and water, soap additives) and to both
  modules, since they share `Plume.buildSheet`. Offered and not taken: drop %
  from the sheet entirely. `test-ph.js` checks the column order.
- The "$0.00 / 100 g on soap cards" note from earlier was a mistake in the
  preview's sample data (grams in place of `pct` on soap lines), not an app
  bug. Removed from the backlog.

**Follow-up, same evening (core v1.21):** she asked for the grams first. Each
bench-sheet row now reads Grams | tick box | Ingredient | INCI | (SAP) | %,
in all three tables, with lye, water and the batch total following the same
order. Drops for a skincare add-in sit under its grams. `test-ph.js` pins
the order.

### Session 19 (cont.) — Packaging kinds, drawings and the shared picker (core v1.22)

Her problem: packaging was the module getting out of control. Every size and
color lived in the free-text name, so relatives only sorted together if she
phrased them identically, and the Batches dropdown made them hard to tell
apart. Agreed through five rounds of the "Packaging Redesign" preview; the
spec is in the backlog history and summarized here.

- **Kinds, in core** (`Plume.PK_KINDS`, 22 of them in five sections, one
  Other). An item stores `kind`, `capacity` (the size), `color`, `material`,
  `forProduct`, `part` and, for Other only, `other` (its typed name).
  Bottles and boxes take color and material; labels and stickers take a
  product (blank = any) and part; bands and wraps take both.
- **One display everywhere**: `Plume.pkDisplay(item)`, e.g. "Dropper bottle ·
  1 oz · Blue glass". The product name is read live from Products, so a
  renamed product follows. `item.name` is still written on every save, as
  the display string, and `item.type` from the kind, so any reader that only
  knows those keeps working. Items saved before kinds display their old name.
- **Drawings replace photos.** `Plume.pkIcon(kind, color)`: 32×32 SVG, body in
  the item's color, caps dark, colors as literal hex so dark mode cannot
  shift them, tiles fixed light (#F6F3EE). No upload any more. Old photos stay
  until removed: "Remove the photo" per item, "Remove every photo" in
  Settings (the old Shrink stored photos is gone with the upload code).
- **Packaging module** in the shell: colour-block head, chips per section,
  search above the list, list grouped by kind (sizes small to large, then
  color; labels by product), in-stock tint and Buy link kept. The edit modal
  keeps its IDs but slides in from the right; "What is it?" replaces Name.
  Opening an old item fills in Plume's reading of its name to check and save.
  Duplicate warning when kind, size, color, material, product and part all
  match another item. Used in comes from products' packaging recipes.
- **Tidy up names**: a one-time screen (tab and ⋯ menu) listing items without
  a kind, each pre-filled by `Plume.pkGuess`. Only ticked rows change; stock,
  purchases and costs are not part of a row. The tab hides once nothing is
  left to sort.
- **Shared picker**: `Plume.pkPickers(root, items)` turns every
  `select[data-pk-pick]` into a button plus a searchable list grouped by
  kind, with drawing, size, color or product and stock. The select stays
  (hidden) and picking fires its change event, so Batches' run builder and
  Costing's packaging recipe run their own handlers unchanged. Costing's
  cost breakdown and Batches' run names use the display name.
- `test-packaging.js` (85 checks) is the 17th suite.
