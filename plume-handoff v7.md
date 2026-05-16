# Plume by Little Bird Studio — Project Handoff

**Last updated:** May 2026 (session 5)
**Previously known as:** Aerie by Little Bird Studio (renamed to Plume in session 1)

**Business context:** Skincare and soap formulation management system. Currently scoped for personal use by Heide, with active plans to host and sell Plume as a package to other small formulators. The market gap is real — Heide has personally paid for expensive professional tools and clunky Excel spreadsheets, and there's nothing well-designed in between. Little Bird Studio also has pottery and sewing arms; Plume is its cosmetic/skincare branch.

---

## What exists — four standalone HTML files sharing localStorage

All files are standalone HTML with vanilla JS (ES5), no frameworks, no build step. They must live in the **same folder** for nav links to work. Data lives in browser localStorage — the user must use the same browser and file path consistently. Moving files to a different path means localStorage won't carry over; always export backup first.

**Version stamp:** All files show `Plume by Little Bird Studio · v0.4 · May 2026` in a footer.

| File | Purpose | localStorage keys |
|------|---------|-------------------|
| `plume-ingredients.html` | Ingredients library | `aerie-ingredients-v2`, `aerie-suppliers-v1`, `aerie-brands-v1`, `plume-palette-ingredients` |
| `plume-formulations.html` | Formula editor | `aerie-formulations-v1`, `plume-palette-formulations` |
| `plume-costing.html` | Batch costing + pricing | `aerie-costing-v1`, `plume-palette-costing` |
| `plume-packaging.html` | Packaging item library | `aerie-packaging-v2`, `plume-palette-packaging` |

Data-storage localStorage keys retain the `aerie-` prefix intentionally — changing them would break existing data. New keys (palette preferences) use `plume-*`.

---

## File 1: `plume-ingredients.html` — Ingredients Library

### Header actions
`Formulations` | `Packaging` | `Costing` | `Suppliers` | `Export backup` | `Import` | `⚙ Settings` | `+ New ingredient`

Nav links use `target="_blank" rel="noopener"` — they open each module in a new tab so the current module's state is preserved.

Quick add was moved into Settings → Data import (it's a one-time seeding operation, not daily use).

### Settings modal sections
- **Appearance** — palette switcher (12 presets, see Design system below)
- **Data import**
  - Quick add starter ingredients (the original seeder)
  - Import ingredient reference data (JSON merge by INCI)
- **Maintenance**
  - Patch soap data

Buttons inside the settings modal must use `.btn` (not `.btn-ghost`) — ghost styling is for the dark header and is invisible on white modal backgrounds.

Import button uses button + hidden input pattern (NOT label-wrapped input) for cross-browser reliability.

### Stats row
Two cards: **Total ingredients** and **Suppliers** (unique suppliers actually assigned to ingredient lots, not total in database). Supplier count updates live when suppliers are added, edited, deleted, or assigned to a lot.

### List view features
- Search by name, INCI, or supplier
- **Function filter** — fixed dropdown of 14 primary functions
- **Phase filter** — Water, Oil, Cool-down, Add-in
- **Restricted-only filter**
- **In stock toggle button** — sage-themed, off by default. When on, filters to ingredients with positive stock. `hasStock(ing)` uses `calcTotalStockG > 0`.
- **Low stock toggle button** — warning-themed, off by default. Low stock items show ▼ indicator in name column. Independent of In stock toggle (they can stack).
- **In-stock row tinting** — always on, regardless of toggle state. Rows with stock get a blush row tint (`--clay-light`), with a slightly deeper hover shade (`--clay-hover`).
- **Recently viewed strip** — up to 5 pill buttons above the table, session-only
- **Alphabetical sort** — list is sorted by common name using `localeCompare` (case-insensitive). Underlying array order is untouched; only the rendered list reorders.
- **Search/filter state preserved on Back** — `showList()` no longer resets the search input or filter dropdowns when you return from the detail view. Filters must be cleared manually.

### Library grid columns
| Column | Width |
|--------|-------|
| Common name | 24% |
| INCI name | 24% |
| Phase | 9% |
| Primary function | 18% |
| Price/g | 9% |
| Stock | 9% |

Notes:
- "Status" column (restricted-use dot) was removed — pill still appears on the detail card, and the "Restricted only" filter handles bulk surfacing
- "Lots" column was removed — lot count is meta-info; reference-only lot info is on the detail card where it's actionable
- "Best price/g" was renamed to "Price/g" — the value now reflects the active lot for costing (see below); the simpler name doesn't expose internals

### Ingredient record fields
- Common name *, INCI name *
- Phase — Water / Oil / Cool-down / Add-in
- Restricted use flag (yes/no), min/max usage %
- **Primary function** — fixed dropdown (`functionCategory` field, 14 options): Emollient, Humectant, Emulsifier, Preservative, Active, pH Adjuster, Thickener, Solubilizer, Surfactant, Exfoliant, Essential oil, Fragrance, Colorant, Other
- **Function notes** — free text descriptive depth (`function` field — kept for backward compatibility, but the meaning shifted from "category" to "notes")
- **Secondary functions** — free text (`function2`)
- **Properties & characteristics (collapsible section):**
  - Absorption rate, Heat stability, Melting point, Oxidation stability
  - Colour, Scent, Optimal pH, Dermal limits (intended for essential oils)
  - Substitution, Restrictions (free text — distinct from the boolean flag)
  - **Expanded ingredient details** — long-form reference content (textarea, supports paragraph structure)
- **Resource links** — three fixed labeled rows (SDS, IFRA, COA) plus "+ Add link" for custom labeled extras. Saved as `links: [{label, url}]` array. Backward compatible via `migrateLinks()`.
- Density (g/mL) — for liquid/fl oz purchase conversion, defaults to 1.0
- Low stock alert — value + unit dropdown (g/mL/fl oz/oz/lb)
- **My formulating notes** — personal observations
- Soap / saponification data (collapsible)

### Editor modal — backdrop click protection
The edit modal has two protections against accidental data loss:

1. **Mousedown guard:** the click-outside-to-close handler only fires if both `mousedown` AND the click event target are the backdrop. Previously, drag-selecting text inside a field could release on the backdrop, the browser fired `click` on the common ancestor (the backdrop), and the modal closed mid-edit. Now, if the drag starts inside a field, the close is suppressed.

2. **Dirty-form check:** when the modal opens, `snapshotEditFormState()` captures a serialized snapshot of all editable fields (including lot rows). On a legitimate backdrop click, `isEditFormDirty()` compares the current state — if anything changed, confirm before discarding.

Helpers: `snapshotEditFormState()`, `isEditFormDirty()`, `serializeEditForm()`. The `EDIT_FIELD_IDS` constant lists all top-level form fields tracked.

### Save / Save & close buttons
The editor has two save buttons in the footer:
- **Save** — `saveIngredient(true)` — saves and keeps the modal open. After save, lot rows are refreshed (in case new lot ids were assigned), the dirty snapshot is reset, and the detail view re-renders if currently viewing this ingredient.
- **Save & close** — `saveIngredient(false)` — original behavior, saves and closes the modal.

Critical: when saving a brand-new ingredient with `keepOpen=true`, `editingId` is now set to the new record's id so a subsequent Save updates the same row instead of creating duplicates.

### Supplier lots — slide-out drawer
The lot section lives in a slide-out drawer (680px wide, slides from right edge). Triggered by "Manage lots ›" button in the modal. The modal shows a one-line summary of current lots (e.g. "2 lots · Amazon, Lotioncrafter"). The drawer has full breathing room for lot rows.

**Each lot row has a header bar** with a "Reference only" checkbox followed by three layout lines:
- Row 1: Supplier | Brand + Organic checkbox | Purchase size+unit | Purchase price | Cost/g
- Row 2: Qty purchased+unit | Lot # | Received | Best by
- Row 3: Order # | Purchase link | Receipt/invoice link
- Actions: Copy lot · Remove (right-aligned)

**Lot field reference:**
- Supplier (dropdown from database + inline "New supplier" form)
- Brand — per-purchase (same brand may differ across purchases from same supplier)
- Organic checkbox — per-purchase, displays as sage-coloured tag in detail view
- Purchase size + unit (g / mL / fl oz / oz wt / lb)
- Purchase price ($) → cost/g auto-calculates
- Cost/g — auto or manual, shows note ("auto-calculated", "calc. from density", "est. — add density")
- Qty purchased + unit
- Lot #, Received date, Best-by date, Order #
- Purchase link, Receipt/invoice link

### Lot detail-card display
- Per-lot "Qty purchased" field reads from `qtyPurchased` (current model), falling back to `l.stock` for any legacy data. The previous "Stock" label was misleading — it read a vestigial field that wasn't being written by the editor.
- Lots sort oldest-to-newest by `received` date within each group (purchased first, reference-only after). Lots with no received date sort after dated ones in their group so the timeline reads cleanly.

### Reference-only lots
A lot can be flagged as **reference only** — a price-comparison watchlist entry rather than an actual purchase. Use case: when reordering, log alternative supplier links and prices alongside the real purchase so cheaper options are visible at a glance.

**Data model addition:**
```js
referenceOnly: true | false   // omitted/false = regular purchase
```

**UI in lot editor:**
- "Reference only" checkbox at the top of each lot row, with hint "(price comparison, not a purchase)"
- When checked: row gets dashed border + cream background; lines 2 and 3 (qty, lot #, dates, order #, receipt link) fade to ~45% opacity and become non-interactive (`pointer-events: none` and `disabled`)
- Header shows "Reference only · REFERENCE"
- Unchecking re-enables fields — original data is preserved (nothing gets cleared)

**UI in detail card:**
- Reference lots sort *after* purchased lots
- Reference cards show "Reference only · price comparison" tag at top
- Dashed border + slightly muted text colour

**Behaviour:**
- Reference lots are excluded from: `activeCost()`, `primarySupplier()`, `isExpiring()`, `calcTotalStockG()`, `hasStock()`, `isLowStock()`
- Reference lots can't be set active for costing (Set as active button doesn't appear)
- `getLots()` empty-row filter recognizes `referenceOnly: true` as substantive content

**Helpers:** `onReferenceOnlyToggle()`, `applyReferenceOnlyState()`.

### Active-lot picker for costing
The library's Price/g column shows the active lot's price. With multiple lots and reference-only entries, a manually-designated active lot drives cost calculations.

**Data model:**
```js
// Ingredient object adds:
activeLotId: "L2"   // points to a lot's id; null = use fallback

// Lot object adds:
id: "L1"            // stable id, generated on save; format: L + counter
```

**Lot id scheme:**
- Lots get stable ids on save: `L1`, `L2`, ... per-ingredient counter
- `migrateLots(i)` assigns ids on read for in-memory consistency; persisted on next save
- Pre-v6 data: lots get ids on first edit-and-save
- Ids stored on lot row DOM as `data-lot-id`; preserved by `getLots()` through the editor cycle

**Active-lot resolution (`getActiveLot(ing)`):**
1. If `activeLotId` is set AND points to an existing purchased lot → return it
2. Otherwise → return the cheapest purchased lot with valid cost/g (preserves pre-v6 behavior)
3. If no purchased lots → return null

**Auto-active logic (in `saveIngredient`):**
- If no `activeLotId` set AND exactly one purchased lot → mark it active automatically
- Saves a click for the common single-supplier case
- Does NOT override existing manual choices
- If `activeLotId` points to a deleted lot, cleared on save

**UI:**
- Active lot detail card: sage-coloured 2px border + "ACTIVE FOR COSTING · received [date]" banner at top
- Fallback active (no explicit choice): banner reads "...(default)"
- Non-active purchased lots with a valid cost/g show a "Set as active" button at the bottom of the card

**Set-active-on-copy:**
- `duplicateLotRow()` asks via `confirm()` whether to make the copied lot the new active
- Only asks if existing purchased rows ≥ 1
- Default is Cancel (keep current active)

**Helpers:** `getActiveLot()`, `activeCost()`, `setActiveLot()`, `formatDateShort()`.

### Total stock calculation
Auto-tallied from `qtyPurchased` across all purchased lots, converted to grams using density and unit. Reference-only lots excluded. Native unit total shown as secondary line when all purchased lots share the same non-gram unit.

### Inline supplier form (inside drawer)
"+ New supplier" button opens a 3-column form (name/website/notes). **Blur-to-save** — saves automatically when you tab away from any field, as long as name is filled. Uses `_isfSavedId` to track current session supplier and prevent duplicates on repeated blur. Updates all supplier dropdowns immediately.

### Detail view
Top-to-bottom:
1. **Header** — name, INCI, brand pills, phase pill, function category pill (sage), restricted-use pill
2. **Top grid** — Usage rate, Function notes, Total stock (with low-stock indicator), Resource links
3. **Properties & characteristics** — populated fields render inline; section hidden if all blank. Density lives here.
4. **My formulating notes**
5. **Expanded ingredient details** — collapsible (defaults closed)
6. **Soap data** — if `soap` data present
7. **Supplier lots** — purchased lots first (active card has sage banner), reference lots after

### Reference data import
Settings → Data import → Import ingredient reference data. Reads a JSON array file and merges:
- **Match by normalised INCI** — `normaliseInci()` lowercases and strips `(common name)` parentheticals so "Butyrospermum Parkii (Shea) Butter" matches "Butyrospermum Parkii Butter"
- **Enrich existing ingredients** — only fills blank fields; never overwrites user data
- **Add new ingredients** — full record with `lots: []`, generated `id` and `created` timestamp
- **Preview confirmation** — alert shows "Enrich N, Add M, Skip K" before applying

Fields enriched by import (`REFERENCE_FIELDS`): `functionCategory`, `function`, `function2`, `min`, `max`, `phase`, `absorptionRate`, `heatStability`, `meltingPoint`, `oxidationStability`, `colour`, `scent`, `optimalPh`, `dermalLimits`, `substitution`, `restrictions`, `generalInfo`, plus `soap` object if present and existing ingredient has none.

`fb_ingredients.json` in the project contains 169 ingredients parsed from the Formula Botanica Ingredients Directory PDF (June 2024). Fatty acid profiles parsed correctly; SAP values intentionally not populated. Celsius temperatures converted inline to °C + °F format at parse time.

### Key functions (JS)
- `migrateLinks(i)` — converts old `i.link` string to `[{label, url}]` array
- `migrateLots(i)` — converts old direct supplier/cost on ingredient to lots array; copies legacy `i.brand` onto first lot; assigns stable lot ids
- `getActiveLot(ing)` / `activeCost(ing)` — active-lot resolution and cost lookup
- `primarySupplier(ing)` — prefers active lot's supplier, falls back to first purchased, then any
- `addExtraLink(link)` — adds custom link row to form
- `getLinks()` / `loadLinks(links)` — serialize/deserialize links section
- `calcLotCostPerG(lotId)` — auto-calculates cost/g from purchase size/price/unit/density
- `lotQtyToGrams(qty, unit, density)` — unit conversion for stock tally
- `calcTotalStockG(ing)` / `hasStock(ing)` — stock totals (excludes reference-only lots)
- `openLotsDrawer()` / `closeLotsDrawer()` — drawer management
- `updateLotsSummary()` — updates the summary line in the modal
- `lotInp(attrs)` — builds styled lot input element string
- `getLots()` / `duplicateLotRow()` — handle checkbox inputs; preserve persisted lot ids; pass through set-active intent
- `applyReferenceOnlyState(row, isRef)` — toggle dashed-border + disabled state
- `setActiveLot(ingredientId, lotId)` — manual active-lot designation
- `togglePropsSection()` / `toggleGeneralInfo()` — collapse/expand sections
- `openSettings()` — opens settings modal; renders palette swatches
- `applyPalette(name)` / `loadPaletteChoice()` / `savePaletteChoice(name)` / `selectPalette(name)` / `renderPaletteSwatches()` — palette switcher
- `saveIngredient(keepOpen)` — main save handler; `keepOpen=true` stays in editor
- `snapshotEditFormState()` / `isEditFormDirty()` / `serializeEditForm()` — backdrop close protection
- `importReferenceData(e)` — merges JSON reference file by INCI
- `normaliseInci(s)` — INCI matching helper

---

## File 2: `plume-formulations.html` — Formulations Module

Reads ingredients from `aerie-ingredients-v2`. Stores at `aerie-formulations-v1`.

### Header actions
`Ingredients` | `Packaging` | `Costing` | `Export backup` | `Import` | `⚙ Settings`

Nav links use `target="_blank" rel="noopener"`.

### Coverage
Skincare and soap formulation editor, lye calculator, quality bars, print page, version history, usage log, INCI list.

Soap-specific features include CP and HP support, oil weight model, lye calculator, soap quality bar, soap-specific print page.

The in-formulation ingredient detail popup (`showIngDetail`) currently shows Phase / Restricted / Usage / Best cost/g / Function / Notes / Suppliers — could be enriched with functionCategory pill, dermal limits, "View in library →" link, and Properties block.

### Per-formula "Add-ins in total %" toggle
**Background:** standard cosmetic practice includes fragrance, essential oils, and preservatives in the 100% batch total. Soap, by contrast, uses the PPO convention (per pound of oils) where additives are calculated relative to the oils, not the total bar. Earlier versions of Plume defaulted to "add-ins outside total" globally — that was a soap-style convention applied universally, which is wrong for skincare.

**Solution:** a per-formula `addinsInTotal` boolean stored on the formula object.

- **New skincare formulas** → defaults to `true` (counted in 100%, standard practice)
- **New soap formulas** → setting hidden, soap-addins are *always* outside the oil 100% (PPO is non-negotiable in soap)
- **Legacy formulas without the field** → defaults to `false` so existing totals don't visibly shift when reopened

**UI:** a checkbox row in the editor meta-card labeled "Count add-ins toward total %", with an explanatory note. For soap, the row appears but the checkbox is disabled and the note clarifies the PPO convention.

**Helpers:** `getAddinsInTotal()`, `onAddinsInTotalChange()`, `updateAddinTotalRow()`. The setting feeds `recalc()` to conditionally include add-ins in total %, batch cost, and INCI list.

### Soap print bug (fixed)
Earlier versions had an unterminated string literal in the soap print code (line ~1675) — a script-tag escape string was broken across multiple lines with a raw newline. This was a JavaScript syntax error that crashed the entire script on load, which meant `newFormula` was never defined and the "+ New formulation" button silently did nothing. Fixed by collapsing the broken string onto one line.

### Settings modal
Just the Appearance section (palette switcher) for now. Designed to grow as module-specific settings are added.

---

## File 3: `plume-costing.html` — Costing Module

### Concept: One batch → multiple packaging runs
The batch ingredient cost is fixed; costing shows how it splits across different packaging configurations from the same batch.

### Header actions
`Ingredients` | `Formulations` | `Packaging` | `⚙ Settings`

### Left sidebar
- Formula picker with search — lists all formulations, shows missing cost count
- Batch size input with quick buttons (100g / 250g / 500g / 1kg / 2kg)
- Batch allocation bar — shows % of batch accounted for across runs, turns red if over

### Main panel
**Ingredient cost card:** Summary stats + full breakdown table with add-ins separated.

**Packaging runs** — each run has:
- Name (editable inline)
- Grams from batch, fill weight (g), units (auto or manual override)
- Soap note: leave fill weight blank and enter bar count in units override — formal bar count mode is planned
- Packaging items from library or typed one-off
- Stats: units, ingredient/unit, packaging/unit, total cost/unit
- Pricing calculator: margin % or markup × toggle

### Wholesale scenario panel
Each run's pricing section now includes a three-tier wholesale breakdown below the main pricing readout:

**Three side-by-side tiles:**
- **Direct** (sage-tinted) — your retail price, what you keep per unit, your margin
- **Wholesale** — what you'd charge a shop, what you keep, your margin (warning-red if it doesn't cover cost)
- **Shop retail** — what the shop sells at, what the shop keeps, the shop's margin

**Two tunable inputs:** Wholesale at X% of retail (default 50), Shop retail multiplier (default 2×). Different shops want different deals; these persist per run.

**Gut-check line:** how much per-unit profit you give up going wholesale, and how many wholesale units you'd need to sell to match the profit of a single direct unit.

**Automatic warning** if the shop's retail (wholesale × multiplier) would undercut your direct price.

Settings (`wholesalePct`, `shopRetailMult`) save to the run via the existing generic `updateRun(idx, field, val)` handler.

**Why no consignment tier (yet):** considered and explicitly skipped. Consignment math is straightforward enough (sell at retail, shop keeps a %, you keep the rest) that it doesn't warrant its own UI. The decision was a deliberate complexity-budget call. Worth revisiting if Plume goes multi-user.

Runs persist per formula in `aerie-costing-v1`.

### Settings modal
Just the Appearance section (palette switcher).

---

## File 4: `plume-packaging.html` — Packaging Library

### Header actions
`Ingredients` | `Formulations` | `Costing` | `Export` | `Import` | `⚙ Settings` | `+ New item`

### Each packaging item has
- Name *, type (container / label / box / closure / other)
- Supplier, minimum order qty, fill volume/capacity, purchase link, notes
- **Photo** — uploaded, auto-compressed to 800px JPEG 75%, stored as base64. Thumbnail in list view.
- **Purchase history** — one row per purchase: date, qty purchased, total cost ($), shipping attributed ($, optional). Cost/unit auto-calculates: (total cost + shipping) ÷ qty.
- **Stock on hand** — auto-tallied from purchase rows + adjustments
- **Stock adjustments** — manual add/subtract with note and date. Shown as a log newest-first.
- **Cost/unit = most recent purchase's calculated cost/unit** — feeds into costing module via `item.cost` field, auto-derived on save

### List view
- Search by name or supplier
- Filter by type
- **Sorted by Type, then by Name** within each type (alphabetical). Sort applied to a `slice()`; underlying data order untouched.
- Thumbnail column, Stock column (green pill or —)
- **Inventory value stat card** — sum of (stock × cost/unit) across all items

### Stats: Total items, Containers, Labels, Inventory value

### Duplicate item feature
Edit modal has a Duplicate button (visible only in edit mode). Copies "style" fields — name with " (copy)" suffix, type, supplier, MOQ, capacity, link, notes, image — but **not** purchase history, adjustments, or derived cost. Those are specific to a real purchase.

After Duplicate:
- Modal switches into new-item mode (`editingId = null`)
- Name suggested with " (copy)" suffix unless it already contains "(copy)"
- Purchase rows cleared, adjustments cleared, name field focused
- Unsaved edits on the original are *preserved* and become part of the new item rather than the original. (Trade-off: save the original first if you want those edits to apply to the original.)

`duplicateItem()` is the handler.

### Settings modal
Just the Appearance section (palette switcher).

### Import button
Uses button + hidden input pattern (same fix as ingredients).

---

## Design system

**Fonts:** Cormorant Garamond (serif display) + DM Sans (body)

### Palette tokenization
All four files share an **identical `:root` block** organized into clearly-labeled sections:

- **PALETTE** — the warm/natural studio feel. Edit these variables to retheme a module. Sections within: Surfaces, Bark, Sage, Clay, Ink, Status (warnings + errors).
- **CATEGORICAL** — functional color codes (phase badges, phase dots, soap quality bars, packaging type badges). These signal "what kind of thing" and stay visually distinct across all palettes for recognition purposes.

**Palette-level variables:**
- `--cream`, `--cream-dark`, `--cream-border`, `--white` — surfaces
- `--bark`, `--bark-light`, `--bark-dark` — primary brand tone
- `--sage`, `--sage-light`, `--sage-dark`, `--sage-border` — positive/success tone
- `--clay`, `--clay-light`, `--clay-dark`, `--clay-hover` — warm accent
- `--ink`, `--ink-light`, `--ink-lighter` — text
- `--warning`, `--warning-bg`, `--warning-border` — warnings
- `--danger`, `--danger-bg`, `--danger-border`, `--success` — errors and success

**Categorical variables (NOT theme-switched):**
- Phase badges: `--ph-water-bg`, `--ph-water-fg`, etc. (water, oil, cool-down, active)
- Phase dots (formulations): `--dot-water`, `--dot-oil`, etc. + `--ph-other`
- Soap quality bars: `--q-hardness`, `--q-cleansing`, `--q-conditioning`, `--q-lather`, `--q-ins`
- Packaging type badges: `--pk-container-bg/fg`, `--pk-label-bg/fg`, `--pk-box-bg/fg`

**Hardcoded exceptions:** A handful of generic grays (`#333`, `#666`, `#ddd`, etc.) used for printed soap labels in `plume-formulations.html` are intentionally left as literals — they should stay theme-independent.

### Palette switcher (now in all four files)
12 presets defined in a `PALETTES` JS object: Coastal, Indigo, Mist, Blush, Petal, Mulberry, Lavender, Slate, Wisteria, Forest, Sage, Eucalyptus. Across four colour families: blue / pink / purple / green.

Each preset redefines only the **palette-level** variables. Categorical colours are intentionally NOT overridden — they stay consistent across all palettes so phase badges remain recognizable.

- **Per-module storage:** `plume-palette-ingredients`, `plume-palette-formulations`, `plume-palette-packaging`, `plume-palette-costing`. Each module remembers its own palette choice independently.
- **Default palette:** `coastal` for all four files when no choice is saved.
- **Boot order:** `applyPalette(loadPaletteChoice())` runs before `loadData()` so the user never sees a flash of default palette.
- **UI:** Settings → Appearance shows a 4-column swatch grid (5-stripe preview per swatch); clicking applies + persists.

**Known limitation:** changing the palette doesn't propagate to other open tabs of Plume in real time — only on the tab where the change was made. Other tabs need a reload. This is a localStorage event limitation; not worth solving for single-user, but worth a `storage` event listener if/when Plume goes multi-user.

---

## Tech notes

### Code style
- **ES5 throughout** — `var`, `function` keyword, no arrow functions, no template literals, no destructuring
- All files have `esc()` HTML-escaping helper
- Section comments use `// ──` pattern

### Quote escaping — recurring bug source
When building HTML strings in JS that contain inline event handlers (`onclick`, `oninput`, `onchange`), the correct pattern depends on what quotes wrap the attribute in HTML:

**When the HTML attribute uses double quotes** (standard):
```js
// CORRECT — plain single quotes inside double-quoted attribute
'<button onclick="doThing(\'' + id + '\')">click</button>'

// CORRECT — for lotInp oninput (double-quoted by lotInp helper)
oninput: "calcLotCostPerG('" + id + "')"

// WRONG — over-escaped, produces literal \' in HTML, throws SyntaxError on click
oninput: 'calcLotCostPerG(\\\'' + id + '\\\')'
```

Bugs in this family have hit in multiple sessions. Cleanup rewrites of JS string-building code are the most common trigger.

**Node syntax check is mandatory** after any JS string-building changes:
```python
script_start = content.find('<script>') + len('<script>')
script_end   = content.find('</script>')
js_only = content[script_start:script_end]
# Node's strict parser complains about `<\/scr` script-tag escapes in plain strings
# Substitute before checking:
js_only = js_only.replace('<\\/scr', '</scr')
with open('/tmp/test.js', 'w') as f: f.write(js_only)
# then: node --check /tmp/test.js
```

The script-tag escape pattern (`'<scr' + 'ipt>...<\/scr' + 'ipt>'`) is correct in browsers but trips Node's strict mode. The substitution above is just for syntax-check purposes — the original source should keep the escape.

### Multi-line string literal hazard
The soap print bug in session 4 was an unterminated string literal — a script-tag-escape string was broken across multiple lines with a raw newline. This is a SyntaxError that crashes the entire script on load. When refactoring or auto-formatting JS strings, watch for any string literal that wraps across lines without proper concatenation.

### Duplicate HTML IDs across filter/editor contexts
A bug introduced in v4/v5: the filter dropdowns and the editor modal dropdowns shared IDs (`f-phase`, `f-flag`). `getElementById` returns the first match, so setting phase in the editor was actually setting the *filter's* value.

**Fix:** Filter elements are `filter-phase` / `filter-flag`. Editor IDs remain `f-phase` / `f-flag`.

**Lesson:** Be careful when paired contexts (filter ↔ editor, search ↔ form) need similar UI but separate state. A duplicate ID will work *most* of the time and fail silently.

### Empty-lot filter
`getLots()` requires at least one substantive field (supplier, brand, qty, purchase data, lot/order ref, link, dates, or `referenceOnly` flag) before counting a row as a real lot. Without this, accidentally-touched supplier dropdowns on the default empty row could create phantom lots on save.

### Import button pattern
Always use button + hidden input, NOT label-wrapped input:
```html
<button onclick="document.getElementById('import-input').click()">Import</button>
<input type="file" id="import-input" accept=".json" style="display:none" onchange="importData(event)">
```

### localStorage origin binding
Data is tied to the file path. Moving files to a different folder = empty database in new location. Always export backup before moving. Hosting on a stable URL solves this permanently.

A moved file that has *never* been opened at its old path has no data to lose — drag and drop is safe. The danger is moving files that already have data at their current path.

### Packaging image storage
Base64 images can fill localStorage at scale. `QuotaExceededError` is caught and surfaced. Recommend keeping images under 2MB before upload; auto-compression handles the rest.

### Nav links
All four files have nav links in the header with `target="_blank" rel="noopener"`. Opening sibling modules in new tabs preserves the current module's state and matches how Heide actually works (multiple tabs open simultaneously).

---

## Data structure reference

### Ingredient object
```js
{
  id: "string",
  name: "Shea butter",
  inci: "Butyrospermum Parkii (Shea) Butter",
  // brand: "optional"  ← legacy field; brand moved to lot level. Migrated by migrateLots()
  phase: "water" | "oil" | "cool-down" | "add-in",
  flag: "yes" | "no",                 // restricted-use boolean (pill in UI)
  min: "2", max: "25",                // usage % range
  functionCategory: "Emollient",      // primary function (fixed 14-option dropdown)
  function: "Emollient, rich moisturizer",  // function notes (free text)
  function2: "also antioxidant",      // secondary functions (free text)

  // ── Properties & characteristics (all optional) ──
  absorptionRate: "Medium to slow",
  heatStability: "Good",
  meltingPoint: "32 – 46 °C (90 – 115 °F)",
  oxidationStability: "Good",
  colour: "Off-white",
  scent: "Nutty, woody",
  optimalPh: "4.0 – 5.5",
  dermalLimits: "1% leave-on / 5% rinse-off",
  substitution: "Mango butter",
  restrictions: "Max 1% in leave-on; avoid in pregnancy",
  generalInfo: "GENERAL INFORMATION\n[long-form reference text]…",

  // ── Resource links ──
  links: [
    { label: "SDS",  url: "https://..." },
    { label: "IFRA", url: "https://..." },
    { label: "COA",  url: "https://..." },
    { label: "Custom label", url: "https://..." }
  ],
  // legacy: link: "https://..." — migrated via migrateLinks()

  density: 0.91,
  lowStock: 2,
  lowStockUnit: "lb",
  notes: "text",                      // "My formulating notes" in UI
  lots: [ /* lot objects */ ],
  activeLotId: "L2" | null,
  soap: { naoh: 0.128, koh: 0.179, fa: { palmitic:6, stearic:37, oleic:44, linoleic:7 } },
  created: "ISO date",
  archived: true | undefined
}
```

### Lot object
```js
{
  id: "L1",                 // stable id, format L + counter, generated on save
  supplier: "Amazon",
  brand: "NOW Foods",
  organic: true,
  referenceOnly: true | false,
  purchaseSize: "5",
  purchaseUnit: "lb",       // g | mL | fl oz | oz | lb
  purchasePrice: "18.99",
  costPerG: "0.0084",
  qtyPurchased: "5",
  qtyUnit: "lb",
  lotNum: "optional",
  bestBy: "2027-09-01",
  received: "2025-09-22",
  orderNum: "optional",
  receiptLink: "https://...",
  buyLink: "https://..."
  // stock, stockUnit  ← legacy fields, replaced by qtyPurchased/qtyUnit
}
```

### Formulation object
```js
{
  id: "string",
  name: "Lotion bar",
  type: "Body butter" | "Cold Process Soap" | ...,
  status: "draft" | "testing" | "approved" | "retired",
  notes: "intention / purpose",
  instructions: "process notes",
  addinsInTotal: true | false,  // skincare default true; soap ignores
  lines: [ /* line objects */ ],
  versions: [ /* archived states */ ],
  usageLog: [ /* dated production entries */ ],
  soapSettings: {
    superfat: 5, lyeConc: 33, waterPct: 38,
    lyeMethod: "concentration" | "water_pct",
    lyeType: "naoh" | "koh", kohPurity: 90
  },
  version: 1,
  createdAt: "ISO date", updatedAt: "ISO date"
}
```

### Packaging item object
```js
{
  id: "string",
  name: "1oz amber glass dropper bottle",
  type: "container",  // container | label | box | closure | other
  supplier: "SKS Bottle",
  cost: "0.0354",     // derived from most recent purchase
  moq: "12",
  capacity: "1oz / 30mL",
  link: "https://...",
  notes: "Matte black lid",
  image: "data:image/jpeg;base64,...",
  purchases: [
    {
      date: "2025-09-15",
      qty: 24,
      totalCost: "18.99",
      shipping: "2.50"
    }
  ],
  adjustments: [
    { qty: -3, note: "damaged in transit", date: "2025-10-01" }
  ]
}
```

### Costing run object
```js
{
  name: "1oz retail",
  grams: 250,           // grams from batch
  fillWeight: 30,       // g per unit
  unitsOverride: null,  // override auto-calc
  items: [              // packaging items
    { name: "1oz bottle", cost: 0.50, qty: 1 }
  ],
  pricingMode: "margin" | "markup",
  marginPct: 60,
  markupMult: 4,
  wholesalePct: 50,     // % of retail (NEW in v5)
  shopRetailMult: 2     // × wholesale (NEW in v5)
}
```

---

## Pending work / known follow-ups

1. **Cost snapshots in costing module** — when a batch is costed, snapshot which lot's price was used per ingredient. Foundation laid (stable lot ids). User's principle: a costed batch is a historical financial record; changing it later corrupts it. No batches exist yet, so no migration needed — implement when first formulations are added.
2. **Formulations: surface ingredient fields** in `showIngDetail` popup — functionCategory pill, dermal limits, "View in library →" link, Properties block
3. **Batch log module** (`plume-batchlog.html`) — production-level record separate from per-formula usage log. Select formula + version, batch size, date made, actual yield. Multiple packaging runs per batch. Auto-decrement ingredient stock from total. Auto-decrement packaging stock per run. Deviations / notes field. Confirmed entries view-only.
4. **Soap packaging UX** in costing — auto-detect CP/HP soap, show "Avg bar weight" + "Number of bars" labels
5. **Products / SKUs module** — ties formulations to sellable products
6. **Low stock reorder view** — dedicated view or export with supplier, last price, purchase link
7. **Quick add seeder** could be regenerated to include all current ingredients
8. **Export backup filename** still says `aerie-backup-...` — should be `plume-backup-...`
9. **Hosting / permanent URL** — GitHub Pages / Netlify / Cloudflare Pages. Solves localStorage path problem. This is the next major step as Heide moves toward selling Plume.
10. **Cross-tab palette propagation** — `window.addEventListener('storage', ...)` to apply palette changes across open tabs. Trivial fix; only worth doing if Plume goes multi-user.
11. **Orphaned formulation lines** — when an ingredient referenced by a formulation is deleted, the line stays in `fLines` but invisibly (filtered out by `ings.find` checks). Could surface a "missing ingredient" indicator on those orphan lines.
12. **EU / international** — saponified INCI names for soap, print toggle (raw vs saponified)
13. **Packaging Plume for sale** — landing page, pricing, payment, account separation, demo data, onboarding, documentation. The palette switcher, per-module memory, and tokenized design system are already friendly to this.

---

## Helpful context for the next session

### User's mental model and design priorities
- Heide thinks carefully about UX *before* committing to builds — expects clarifying questions
- Communication style: relaxed and collaborative, comfortable with light humor
- Strongly prefers **unobtrusive defaults** (e.g. toggles off until needed)
- **Blur-to-save** preferred over explicit save buttons where contextually appropriate
- Values **incremental builds with verification** over large speculative changes
- Comfortable with one-file trials before propagating (palette switcher was a perfect example)
- **Complexity budget awareness** — willing to skip features when they don't earn their UI cost (consignment tier in wholesale panel was an explicit decline)

### Design decisions worth remembering
- The active-lot + reference-only system is a meaningful improvement over "cheapest price wins." Plume's middle ground fits a single-formulator workflow well.
- Categorical colors stay fixed across palettes — explicitly chosen consistency over per-palette tuning.
- A costed batch is a historical financial record. **Never** mutate it retroactively.
- Add-ins inside vs outside the 100% is a real practice difference between cosmetics and soap. Per-formula setting is the right shape.
- Wholesale at indie price points is structurally hard — the wholesale calculator makes that visible rather than letting users learn the hard way.

### Recurring pitfalls
1. **Quote escaping in JS-built HTML attributes** — `node --check` after any JS string changes
2. **Multi-line string literals** — script-tag escape strings broken across lines have crashed scripts in past sessions
3. **Duplicate HTML IDs across filter/editor contexts** — fail silently in surprising ways
4. **localStorage path binding** — static hosting solves it permanently
5. **Working from stale project files** — if the user has been editing locally, the project copies can drift. Audit prior fixes are present before patching: grep for distinctive strings (`mouseDownOnBackdrop`, `addinsInTotal`, `duplicateItem`, etc.) before applying changes that depend on them.

### Session 5 specific learnings
- The palette switcher port was mostly mechanical because the `:root` blocks across files were already identical. Worth keeping that invariant — if the design system grows, propagate to all four files together.
- The wholesale calculator is a worked example of "calculator as conversation aid" — its real value isn't the numbers, it's that it makes the trade-off vivid before a real wholesale conversation happens.
- Settings modal pattern is now consistent across all four files (button in header → modal with Appearance section). Future module-specific settings should live in the same modal.

### What to read first
- Current HTML files in `/mnt/project/` are the canonical state, modulo any local edits the user has made between sessions.
- This handoff is self-contained; previous versions (v3, v4) are archived and not needed for context.
- When in doubt, grep for the feature in question to verify it's actually present in the file you're patching.
