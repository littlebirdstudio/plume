# Plume by Little Bird Studio — Project Handoff

**Last updated:** May 2026 (sessions 6-8)
**Previously known as:** Aerie by Little Bird Studio (renamed to Plume in session 1)

**Business context:** Skincare and soap formulation management system. Currently scoped for personal use by Heide, with active plans to host and sell Plume as a package to other small formulators. The market gap is real — Heide has personally paid for expensive professional tools and clunky Excel spreadsheets, and there's nothing well-designed in between. Little Bird Studio also has pottery and sewing arms; Plume is its cosmetic/skincare branch.

**Brand architecture:** Little Bird Studio is the parent maker identity (pottery, skincare, sewing — unified by Heide's taste, not category). Plume is specifically the skincare/formulation line under Little Bird Studio. The formulation tool currently sharing the Plume name will eventually need its own name when packaged for sale to other formulators. Current plan: keep "Plume" for the personal-edition tool; build a separately-named "clean fork" later as the sellable product.

---

## What exists — six files sharing localStorage

All files are standalone HTML with **vanilla ES5 JavaScript** (`var`, no arrow functions, no template literals), no frameworks, no build step. They live in the same folder; data lives in browser localStorage. **Hosted on GitHub Pages** at `https://littlebirdstudio.github.io/plume/`, which gives a stable origin so data persists across machines that use the same browser profile. Repository: `https://github.com/littlebirdstudio/plume`.

**Version stamp:** Footers show `v0.6` (bumped in session 7 with the Products & Costing rebuild).

| File | Purpose | localStorage keys |
|---|---|---|
| `index.html` | Landing page with logo + module cards | (none) |
| `plume-ingredients.html` | Ingredients library | `aerie-ingredients-v2`, `aerie-suppliers-v1`, `aerie-brands-v1`, `plume-palette-ingredients` |
| `plume-formulations.html` | Formula editor | `aerie-formulations-v1`, `plume-palette-formulations` |
| `plume-packaging.html` | Packaging item library | `aerie-packaging-v2`, `plume-palette-packaging` |
| `plume-batchlog.html` | Production batch log | `aerie-batches-v1`, `plume-palette-batchlog` |
| `plume-costing.html` | **Products & Costing** (rebuilt in session 7) | `plume-products-v1`, `plume-palette-products`, `plume-pricing-custom-mult` |

The filename `plume-costing.html` is kept for GitHub continuity; the module display name is "Products & Costing." Data-storage keys retain the `aerie-` prefix where they predate the rename; new keys use `plume-`. **Do not change existing keys** — it would break user data.

In session 7 the old `aerie-costing-v1` key was wiped via `removeItem` on first load of the rebuilt module, since the old per-batch-pricing data didn't map cleanly to the new product-centric model.

---

## Module 1: `plume-ingredients.html` — Ingredients library

### Header
Nav: `Formulations` · `Packaging` · `Products & Costing` · `Batches` · `Export` · `Import` · `⚙ Settings`
Section header: `Ingredients` title with `+ New ingredient` button next to it (moved out of nav strip in session 8 for consistency).

### Settings modal sections
- **Appearance** — palette switcher (12 presets)
- **Data import** — quick-add starter ingredients (one-time seeder), reference-data JSON merge by INCI
- **Maintenance** — patch soap data

Buttons inside settings modal use `.btn` (not `.btn-ghost`) — ghost styling is for the dark header and is invisible on white modal backgrounds.

### Stats row
Total ingredients · Suppliers count (unique suppliers actually assigned to ingredient lots, not total in database).

### List view
- Search by name, INCI, or supplier
- Function filter dropdown of 14 primary functions
- Recently viewed pills (last 6 ingredients opened)
- Low-stock filter toggle (off by default — unobtrusive)
- Library grid: Name · INCI · Function · Active supplier · Cost/g · Stock

### Ingredient record fields
- Identity: name, INCI, function, sub-function, notes, resources (URLs)
- Soap data: SAP NaOH, SAP KOH, fatty acid profile, soap properties (oils + butters only)
- Lots: array of purchase lots with supplier, brand, qty, unit, cost/g, lot#, best-by, received date

### Lot system
Each ingredient has one or more **lots**. A lot represents a specific purchase:
- `costPerG` is the cost per gram, auto-computed from purchase price + size when both filled
- `referenceOnly: true` is the "watchlist" flag — ingredients you're considering but haven't bought. These don't contribute to cost calcs and don't count toward stock.
- `activeLotId` on the ingredient marks one lot as the "current" lot — used as the cost source when multiple lots have valid `costPerG` values.

### Total stock calculation
Sums non-reference-only lots' quantities, converted to grams using each lot's `qtyUnit` and the ingredient's density.

### Resurrection / reversal banners (added Block 4)
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
  soapAddin:   false
}
```

Anyone reading formulations from another module must use `ingId`, `pct`, `gramsFixed`. Getting the field names wrong silently produces zero costs and missing label data (caught in session 7 — original Products & Costing build read wrong fields).

### Version snapshots
- "Save as version" → modal with optional label; snapshots the saved-on-disk state, bumps working version
- "Restore" → auto-parachute (snapshots current as "auto-archived vN before restore"), then replaces working copy. Version number reverts to the restored version.
- Each snapshot has a unique `snapId` so duplicate version numbers can coexist; delete/restore operate by snapId not version number
- Usage log groups by version (current expanded, older collapsed)
- "Duplicate" button: creates a copy with "(copy)" suffix, status:draft, empty version history, empty usage log

### "Make batch" (renamed from "Make it!" in session 6)
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
`(totalCost + shipping) / qty` from the most recent purchase with valid data. **CRITICAL:** the field is `totalCost` plus `shipping`, NOT a single `price` field. The Products module had this wrong initially and read $0 for all packaging costs — fixed in session 7.

### Image storage
Inline base64 data URLs in localStorage. Compression on upload keeps long-term storage under control.

---

## Module 4: `plume-batchlog.html` — Batch log

### Header
Nav: `Ingredients` · `Formulations` · `Packaging` · `Products & Costing` · `Export` · `Import` · `⚙ Settings`
Section header: `Batches` title with `+ Add batch` button next to it.

### Concept
Tracks actual production runs. When you "Make it!" from a formulation, a batch is created. The batch holds the ingredient snapshot at make-time, tracks curing status for soaps, and records packaging runs.

### Auto-commit model (current — set in session 6)
Ingredients commit on batch save; packaging commits per-run on add. There is no manual commit/decommit step in the UI anymore. The legacy `commitBatch()` is kept as a safety belt but its UI button is hidden.

**Atomic blocking:** If `Make it!` finds insufficient ingredient stock, the batch is NOT created. The popup stays open with all form values preserved, and a blocked-message panel shows per-shortage with deep-links to the affected ingredients (`plume-ingredients.html#ing=<id>`).

For packaging, the same atomic rule applies — if any component is short, the whole run is rejected with a per-item shortage message.

### Multi-component packaging runs (NEW in session 8)
A packaging run is now a **single event grouping multiple components together**, not one row per component. The run has:
```js
{
  id:          "...",
  date:        "2026-05-18",
  notes:       "First batch of 1oz tins",
  components:  [
    { packagingId: "tin1oz",    packagingName: "1oz tin",      quantity: 6 },
    { packagingId: "labelTop",  packagingName: "Top label",    quantity: 6 },
    { packagingId: "labelBot",  packagingName: "Bottom label", quantity: 6 }
  ],
  committed:   true,
  committedAt: "..."
}
```

UI:
- **Builder** at the bottom of the packaging section: date + notes at top, stack of component rows below, "+ Add component" / "Reset" / "+ Add run" actions
- **Existing runs** above the builder, rendered as cards: each card shows the date, notes, and a bulleted list of components inside. The "×" deletes the whole run, returning all components to stock atomically.
- **Legacy single-component runs** (created before session 8) still render correctly — `runComponents(r)` normalizes both shapes. No data migration needed; new runs are always multi-component shape.

### Date timezone fix (session 8)
`fmtDate` parses `YYYY-MM-DD` strings as local time rather than UTC. Previously, negative-offset zones (Alaska, US Pacific) displayed dates one day earlier than entered. The fix:
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
- "Mark ready now" button visible only for currently-curing batches

### Cost rollup in detail view
Shows total ingredient cost from the snapshot + per-yield grams. Per-gram and per-oz costs were dropped per Heide feedback — total only.

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

## Module 5: `plume-costing.html` — Products & Costing (rebuilt in session 7)

### Header
Nav: `Ingredients` · `Formulations` · `Packaging` · `Batches` · `Export` · `Import` · `⚙ Settings`
Section header: `Products` title with `+ Add product` button next to it.

### What it is
The salable thing. A "product" defines what you sell — name, SKU, what formulation it's made from, packaging recipe, net weight per unit, retail and wholesale prices. The costing math from the old Costing module lives here, attached to products rather than free-floating runs.

### Product object shape
```js
{
  id, name, sku, barcode, status,           // status: 'active' | 'draft' | 'discontinued', defaults 'active'
  formulaId, netWtG, netWtDisplay, notes,
  packagingRecipe: [{ packagingId, quantity }],
  retail, wholesale,
  labelMode:         'inci' | 'common',
  labelOverrideOn:   false,
  labelOverrideText: '',
  productionRuns:    [{ id, date, units, batchId, notes, addedAt }],
  createdAt, updatedAt
}
```

### List view
- Group-by-formulation as default sort (Hawaiian Sunset 1oz and Hawaiian Sunset 2oz appear together)
- Columns: Name+SKU · Formula · **Units made** (total across runs) · Unit cost · Retail · Margin · Wholesale · Status pill
- Search across name, SKU, formula name
- Status filter pills: All / Active / Draft / Discontinued
- Margin colors: green ≥30%, amber <30%, red negative

### Editor
- **Identity**: name, SKU, barcode (text field — image generation deferred), status, notes
- **What it is**: linked formulation, net weight in grams, net weight display string
- **Packaging recipe**: multi-row picker with quantity per unit and live unit cost display
- **Pricing**: retail, wholesale
- **Cost rollup panel**: live calculation with per-ingredient diagnostics if cost data is missing
- **Pricing helper** (NEW in session 8): see below
- **Label preview** with INCI/common toggle and override textarea, plus copy-to-clipboard
- **Production runs** sub-list with date / units / batch / notes, batch dropdown filtered to batches with matching `formulaId`

### Cost rollup math
- Ingredients cost: `formulationCostPerG(f) × netWtG`
- Per-packaging cost: `pkgUnitCost(p) × quantity` for each recipe line
- Total unit cost = ingredients + packaging
- Retail/wholesale margins computed against total cost
- Diagnostic: if some ingredients are missing cost/g, the panel surfaces their names with a link back to Ingredients

### Pricing helper (NEW in session 8)
A panel below the cost rollup, designed as a thinking tool for pricing decisions. Restores the "exploration" function the old costing module had.

- **Custom multiplier row** — type any multiplier (e.g. 3.5×) and see the resulting price live. Stored across sessions in `plume-pricing-custom-mult` (defaults to 4).
- **Quick-reference grid** of common multipliers: 2×, 3×, 4×, 5× of unit cost, each as a cell showing the implied price
- Each cell has **"→ Wholesale"** and **"→ Retail"** buttons that promote that price into the corresponding input and re-run the cost rollup
- Rule-of-thumb note: 2× cost for wholesale, 4-5× cost for retail (cottage-industry convention)

Only renders when total cost > 0; otherwise shows a hint to fill in net weight and packaging first.

### Label output
Text-only — no PDF/image rendering. Generates ingredient list sorted by descending weight (using `pct` for non-soap, `gramsFixed` for soap). INCI/common toggle picks which field to read. Override textarea lets the user replace the auto-generated list entirely. Copy-to-clipboard exports the label as plain text suitable for Etsy/Canva/Square.

### What's NOT in Products & Costing
- Three-tier wholesale analysis (wholesale price + shop's resale + profit gap) — old module had this; session 8 decision was to keep just the multiplier-based price suggestions
- Margin-target reverse calculation ("what price hits 60%?") — could add later
- Cross-product margin ranking — would be useful as catalog grows
- Cost trend awareness ("your ingredient costs rose 12% — revisit pricing")
- Inventory of finished products (only production-run records, not "I have 17 on hand")
- Auto-linking from batch packaging runs to product runs — explicitly declined in session 8; batch packaging and product runs record different things and the user wants them separate
- Parent/child variant hierarchy — flat list with formulation grouping is sufficient for the current catalog scale

---

## Design system

### Palette tokenization
Twelve preset palettes: coastal, indigo, mist, blush, petal, mulberry, lavender, slate, wisteria, forest, sage-green, eucalyptus. Each defines the same set of CSS variables (cream, bark, sage, clay, ink, warning, danger, success). The default palette ("coastal" in Products & Costing; varies elsewhere by historical preference) is applied at boot via `applyPalette(loadPaletteChoice())`.

The `PALETTES` object is duplicated across all modules — there's no shared CSS file because each HTML file is standalone. If editing palettes, edit one and copy the block to all others.

Each module saves its palette choice in a separate localStorage key (`plume-palette-{module}`) so modules can have different palettes.

### Palette swatch picker
Each Settings modal has a grid of 12 swatches; clicking applies and saves. The active swatch has a thicker border.

### Typography
- Cormorant Garamond for display (brand name, section titles)
- DM Sans for body text and UI

### Buttons
- `.btn` — default neutral
- `.btn-primary` — bark background, cream text (primary actions)
- `.btn-ghost` — transparent, for dark headers only
- `.btn-sage` — sage background (positive/save secondary)
- `.btn-danger` — red text on red border (destructive)
- `.btn-sm` — smaller variant

### Nav strip pattern (consistent across all 5 modules)
1. Sibling links (Ingredients, Formulations, Packaging, Products & Costing, Batches — whichever 4 aren't the current module)
2. Export / Import (file actions)
3. Settings cog
4. **No "+ Add" button in the header** — that lives next to the section title

Named targets on each link (`target="plume-ingredients"`, etc.) ensure clicking re-uses the existing tab if open. **Do not add `rel="noopener"`** to nav links — it disables tab-name registration in some browsers. External links (suppliers, deep-links) still use `target="_blank" rel="noopener"`.

---

## Tech notes

### Code style — non-negotiable
- Vanilla ES5: `var` (not `let`/`const`), `function` declarations (not arrow functions), string concatenation (not template literals)
- No frameworks, no build step, no bundler
- localStorage for persistence; no servers, no APIs
- Single-file modules — HTML + CSS + JS in one document per file

### Quote escaping — recurring bug source
String-building JS for HTML output is fragile. Patterns like:
```js
'<button onclick="doThing(\'' + id + '\')">'
```
break easily when ID-like strings are rewritten. After every cleanup pass on JS string-building code, `node --check` verification is **mandatory**. Several silent breakages have come from this — the `\'' + x + '\''` pattern getting mangled to `'' + x + ''` (broken) is the most common.

### Date handling
Date strings stored as `YYYY-MM-DD` (date-only, no time). When displaying in any timezone, parse as **local** date, not UTC:
```js
var parts = iso.split('-');
new Date(+parts[0], +parts[1]-1, +parts[2]);
```
Otherwise users in negative-offset zones see dates one day earlier. `fmtDate` in Batchlog already does this correctly (fixed in session 8). The other modules should follow the same pattern if they format dates — check before adding any date display.

### Import button pattern
Label-wrapped file inputs are unreliable cross-browser. Use:
```html
<button onclick="document.getElementById('imp').click()">Import</button>
<input type="file" id="imp" style="display:none" onchange="...">
```

### Soap field names
- `gramsFixed` for soap oil amounts (NOT `grams`)
- `pct` for percentage (NOT `percent`)
- `ingId` for ingredient reference (NOT `ingredientId`)
- `soapAddin: true` flag for fragrance/EOs (not in % total)

These caused real bugs in session 7's first attempt at Products & Costing — fields look generic, but the formulation module has its own conventions.

### Field name on packaging unit cost
`(totalCost + shipping) / qty` from most recent purchase — NOT a single `price` field. Match `latestCostPerUnit()` in plume-packaging.html.

### Cost data resolution for ingredients
`ingCostPerG(ing)` cascade:
1. If `ing.activeLotId` is set AND that lot has `costPerG > 0` → use it
2. Else: filter to non-reference-only lots with `costPerG > 0`, pick lowest
3. Else: legacy fallback — if `lots[]` is empty but `ing.cost` is set, use that
4. Else: null

### Migration approach
Old data shapes are detected and normalized at read time (e.g. `runComponents(r)` in batchlog). Storage is not rewritten unless the user explicitly saves the record. This means upgrades are non-destructive — older files can still read newer data structures correctly.

---

## Data structure reference

### Ingredient
```js
{
  id, name, inci, function, subFunction, notes, resources: [],
  density,           // g/ml, used for unit conversions
  soapNaOH, soapKOH, fattyAcidProfile, soapProperties,  // soaps only
  activeLotId,       // pointer to "current" lot
  lots: [Lot]
}
```

### Lot
```js
{
  id, supplier, brand, lotNum, bestBy, received,
  qtyPurchased, qtyUnit,        // modern; legacy was stock/stockUnit
  costPerG,                     // auto-computed when price + size present
  referenceOnly: false,         // watchlist flag
  wasResurrected, resurrectedAt,// from batch decommit
  wasReversal                   // ghost lot from delete-after-commit
}
```

### Formulation
```js
{
  id, name, type, notes, status, version,
  lines: [{ ingId, pct, gramsFixed, pinned, soapAddin }],
  versions: [{ snapId, version, label, lines, savedAt, ... }],
  usageLog: [{ batchId, version, date, ... }]
}
```

### Packaging item
```js
{
  id, name, capacity, category, notes, photo,
  purchases: [{ date, qty, totalCost, shipping, supplier, lotNum, notes }],
  adjustments: [{ id, qty, date, reason, batchId, runId }]
}
```

### Batch
```js
{
  id, date, formulaId, formulaName, formulaType,
  batchName, batchType, targetYield, actualYield, cureWeeks, readyDate,
  status, notes,
  ingredientSnapshot: [{ ingredientId, ingredientName, grams }],
  packagingRuns: [{
    id, date, notes,
    components: [{ packagingId, packagingName, quantity }],
    committed, committedAt
  }],
  committed, committedAt,
  lotDraws:        [...],   // receipt
  packagingDraws:  [...],   // flat receipt
  createdAt, updatedAt
}
```

### Product
```js
{
  id, name, sku, barcode, status,
  formulaId, netWtG, netWtDisplay, notes,
  packagingRecipe: [{ packagingId, quantity }],
  retail, wholesale,
  labelMode, labelOverrideOn, labelOverrideText,
  productionRuns: [{ id, date, units, batchId, notes, addedAt }],
  createdAt, updatedAt
}
```

---

## Session 6-8 work summary

### Session 6 — Batchlog Block 3-4 (Phase 4)
- Batch detail view with editable fields, ingredient snapshot, packaging runs, cost rollup
- Initial commit/decommit logic with FIFO across lots, resurrection of depleted lots, ghost reversal lots
- Reworked to auto-commit model: ingredients commit on batch save, packaging per-run
- Formulation versioning rebuild: snapId-based snapshots, restore-as-current with auto-parachute, Duplicate action
- Cross-module Batches nav link (Phase 5)

### Session 7 — Products & Costing rebuild (Phase 6)
- Complete rebuild of `plume-costing.html` from per-batch-pricing to product-centric
- Product schema with formulation link, packaging recipe, pricing, label settings, production runs
- Cost rollup with per-ingredient diagnostics (surfaces which ingredients are missing cost data)
- Label preview with INCI/common toggle, override textarea, copy-to-clipboard
- Production runs with batch-linkage dropdown filtered by matching formulaId
- Cross-module rename: "Costing" → "Products & Costing"
- Old `aerie-costing-v1` data wiped on first load
- Bug fixes during build: wrong field names (`percent`/`ingredientId` instead of `pct`/`ingId`), wrong packaging cost calculation (`price` instead of `totalCost+shipping`), missing soap formulation handling (`gramsFixed` + `soapAddin`)

### Session 8 — Polish + multi-component packaging runs
- "Save and close" button on product editor
- "+ Add" buttons relocated from nav strips to next to section titles (all 4 sibling modules)
- New products default to "active" not "draft"
- Number-field placeholders reworded as obvious examples (`e.g. 30` instead of `30`)
- "Units made" column added to Products list with hover tooltip showing run count + most recent date
- **Multi-component packaging runs** — runs are now single events grouping multiple components, rendered as cards; legacy single-component runs still render correctly via `runComponents()` normalization
- **Date timezone fix** — `fmtDate` parses YYYY-MM-DD as local-time
- **Pricing helper** — multiplier-based price suggestions (2×, 3×, 4×, 5× cost) with custom-multiplier dial and "→ Retail" / "→ Wholesale" promote buttons, restoring the "thinking tool" feel of the old Costing module

---

## Pending work / known follow-ups

### Where to start next
**Most natural next step: live with the current system for real making and see what surfaces.** A lot of recent work (Products & Costing, multi-component runs, pricing helper) is brand new and hasn't been used in real production yet. Two weeks of actual workflow will reveal what's missing better than another scoping session could.

That said, if Heide wants to keep building, here's a prioritized list:

### Higher-value next features
1. **Pricing target-margin reverse calc** — small addition to the pricing helper: "what price hits 60% margin?" Adds another thinking dimension without much complexity (~50 lines).
2. **"What did I make today/this week" overview** — a small dashboard or table that aggregates production runs across all products by date range. Real visibility without leaving the Products module. (~100-150 lines.)
3. **Cross-product margin ranking** — sort products by margin or profit-per-unit. Helps identify underperformers. List-view enhancement.
4. **Three-tier wholesale analysis** (revival of old costing feature) — wholesale price + shop's resale price + profit gap analysis. The old Costing module had it. ~150 lines.

### Medium-value follow-ups
5. **Yield reconciliation on batches** — "this batch was 250g; you've packaged units totaling 200g, 50g unaccounted for." Surfaces leftovers/waste. Needs net-weight-per-unit awareness from Products.
6. **Cost-trend awareness** — when ingredient costs change, flag products whose margins have shifted. Needs cost history tracking, which doesn't exist yet — bigger infrastructure.
7. **Barcode rendering** — currently just a text field. Could add JsBarcode (~30KB) for visual rendering + download-as-PNG. Heide deferred this in session 7; revisit if useful.
8. **Full-system backup** — single export that wraps all modules' data. Currently per-module exports.

### Larger architectural work
9. **Sellable-product version** — the "clean fork" build for distribution to other formulators. Different name, defaults wiped, onboarding flow, etc.
10. **Inventory of finished products** — actual stock count for products, not just production-run history. Would require thinking about sales/depletion mechanisms.

### Known limitations to be aware of
- **Import is additive merge by id only** — there's no "replace existing" option. Users who want a clean reset must manually delete first.
- **Each module has its own `PALETTES` object** — editing palettes requires copying to all 5 files.
- **Soap formulations vs. lotion formulations** use different line shapes within the same data structure (`gramsFixed` vs. `pct`). Anyone reading formulation data must handle both.
- **`localStorage` is browser-bound.** GitHub Pages hosting solved the path-fragility issue but data still doesn't sync across devices/browsers. A user using Chrome on their laptop and Safari on their phone has two separate datasets.

---

## Helpful context for the next session

### User's mental model and design priorities
- **Heide is a real formulator** with genuine domain knowledge in soap (lye calculations, fatty acid profiles, SAP, INCI norms for small US producers).
- **She designs UX carefully before committing to builds** — asks clarifying questions about behavior before implementation. Walking through workflow scenarios produces better designs than guessing.
- **Features should be unobtrusive by default** — low-stock filter off unless needed; status defaults to active not draft; advanced features hide rather than clutter.
- **Plume is not a point of sale** — she sells through Etsy/Square/website/local retailers. Plume's job is to *prepare* products for sale elsewhere (labels, SKUs, pricing decisions).
- **Labels are text output, not designed graphics** — Plume generates copy-pasteable text. Design happens in Canva or wherever.
- **Soap labels use raw ingredient names** (not saponified) per US small-producer practice. No saponified-form field needed in the data model.

### Design decisions worth remembering
- **Per-unit cost is not per-batch profit.** Products are priced and costed per unit. Batches track inventory pulls. The two have a loose relationship — production runs on a product can optionally link to a batch, but the system doesn't auto-link.
- **Batch packaging runs and product production runs record different events** even though they describe the same physical work. Don't try to merge them — user explicitly wants them separate.
- **Multi-component shape is for batch packaging only**, not product production runs. Different jobs, different shapes is fine. Consistency for its own sake isn't a goal.
- **Wipe over migrate** when data model changes radically (session 7 wiped old `aerie-costing-v1`). For minor shape changes, normalize at read time (`runComponents()`).
- **Filename stability matters more than naming purity.** `plume-costing.html` stayed the same when the module became "Products & Costing" because changing filenames breaks GitHub links and nav references.

### Recurring pitfalls to remember
- `node --check` after any JS string-building change — `\'` quotes get mangled silently
- Date strings as YYYY-MM-DD parse as UTC by default in JS — must parse as local for display
- Field names are not generic across modules — formulation lines use `pct`/`ingId`, packaging purchases use `totalCost`+`shipping`. Check the source module before reading.
- Buttons inside white modals can't use `.btn-ghost` (invisible)
- Each module duplicates the palette block, so palette edits must be copied across files

### What to read first (in a future session)
1. This handoff (you're already here)
2. The relevant module's HTML — the comment headers identify section boundaries
3. The shape definitions in "Data structure reference" above when reading any cross-module code

### Test-mode noise vs. real signal
Heide is currently in test-mode for several modules — clicking through every selector to see how it works. Some early reactions ("this feels redundant") may fade once she's using the system for actual production rather than poking at it. Real production use should surface real workflow needs.
