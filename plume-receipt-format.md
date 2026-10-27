# Plume receipt files

How a Claude chat turns a supplier receipt into a file Plume can import.
Heide drops a receipt (PDF, photo, screenshot or pasted email) into a chat
in the "Skin care product line" project and asks for a Plume receipt file.
She opens it in Plume with Ingredients › ⋯ › Import a file. Plume shows
every line and what it matches before anything is added, so the file only
has to be read carefully, not be perfect.

## What to hand back

One `.json` file per order, named `plume-receipt-<supplier>-<order number>.json`,
sent as a file (not pasted into the reply). Then, in a few lines of the
reply: anything left out and why, anything guessed, and any question in
"Ask first" below.

## The shape

```json
{
  "kind": "plume-receipt",
  "supplier": "Lotioncrafter",
  "orderNum": "LC-48213",
  "date": "2026-10-24",
  "shipping": 14.95,
  "tax": 0,
  "receiptLink": "",
  "lines": [
    { "kind": "ingredient", "name": "Beeswax", "inci": "Cera Alba",
      "count": 2, "size": 1, "unit": "lb", "price": 11.50, "priceIs": "each",
      "lotNum": "", "brand": "", "link": "https://..." },
    { "kind": "packaging", "name": "Amber Boston round, 2 oz",
      "count": 12, "price": 0.89, "priceIs": "each", "link": "" }
  ]
}
```

### The order
- `kind`: always `"plume-receipt"`.
- `supplier`: the shop's name as it would be written on a supplier list
  ("Mountain Rose Herbs", not "MRH Inc. Order Confirmation").
- `orderNum`: the order number exactly as printed. Plume uses it to spot a
  receipt imported twice.
- `date`: the order date, `YYYY-MM-DD`.
- `shipping`, `tax`: numbers, the order's totals. Use `0` when the receipt
  shows none. Leave the field out when the receipt does not say. These stay
  with the order and are never added to what an ingredient or a jar costs.
- `receiptLink`: a link to the order page, if the receipt has one, else `""`.

### Each line
- `kind`: `"ingredient"` for anything that goes into a formula (oils,
  butters, waxes, actives, water, fragrance, colorants). `"packaging"` for
  containers, caps, pumps, labels, boxes, bags and shrink bands.
- `name`: the plain name she would call it ("Rosehip seed oil", "Beeswax"),
  not the shop's marketing title. Drop sizes, grades and SKUs from the name
  ("Shea butter, refined" is fine; "Shea Butter Refined 16 oz SKU 4471" is not).
  For packaging, describe it: kind, size, color ("Amber Boston round, 2 oz").
- `inci`: the INCI name when the receipt or the product page shows it.
  Leave it out when unknown; never guess one. Plume fills it from its starter
  list when it can, and otherwise asks her.
- `count`: how many of that size were bought. For packaging, the number of
  single units: 2 packs of 12 jars is `24`.
- `size` and `unit` (ingredients only): the size of ONE, with a unit from
  this list: `g`, `kg`, `oz`, `lb`, `mL`, `L`, `fl oz`, `gal`. Use `oz` for
  ounces by weight and `fl oz` for fluid ounces; when a receipt only says
  "oz", liquids sold by volume (oils in bottles, water) are usually `fl oz`
  and solids are `oz`. Say in the reply which you chose when it is unclear.
- `price` and `priceIs`: the price paid for the line after any line
  discount. `"each"` when it is the price of one, `"total"` when it is the
  line total. When both are printed, give the each price with `"each"`.
- `lotNum`, `brand`, `bestBy` (`YYYY-MM-DD`), `link`: only when the
  receipt shows them.

## Ask first (in the reply, before making the file)
- An order-wide discount or coupon: ask whether to leave it out or take it
  off each line in proportion. Plume does not track discounts on their own.
- A line that is not a product (a gift card, a sample, a fee): leave it out
  and say so.
- A line where the size or the price cannot be read.

## Not in the file
Shipping or tax spread into line prices; payment details or card numbers;
addresses.

## Notes for whoever builds Plume
- The importer is `previewReceipt()` in plume-ingredients.html (2026-10-26,
  v1.61). Ingredient lines become lots with `onOrder: true`, the buy fields
  (`buyCount`, `buySize`, `buyPrice`, `buyPriceIs`), `orderNum` and
  `ordered`. Packaging lines become Packaging purchases with `onOrder: true`.
  Orders (shipping, tax) are stored under `plume-orders-v1`.
- Optional fields a chat with her backup in hand may add: `ingId` or `pkgId`
  on a line, to point at an exact item.
