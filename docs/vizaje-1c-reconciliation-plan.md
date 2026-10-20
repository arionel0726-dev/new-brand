# VIZAJE-NICA V2 — 1C Reconciliation Plan (Sprint 12A.3 continuation)

Status: planning document, grounded in the real **aggregate** 1C audit
(`docs/legacy-audit/vizaje-1c-audit.md` / `.json`, committed by the user as
`d3466140`). That audit contains **no raw rows or identifiers** — only
field-population counts, duplicate-group counts, and cross-file key
overlaps. Nothing in this document asserts that any specific product in
`products.json` is "the same" as any specific product in
`vizaje_catalog_only.sql`; that requires row-level data no one has handed
over yet (see §5). Phase B remains unauthorized and unimplemented. No
PostgreSQL writes, no Drizzle migrations, no modification of anything
under `docs/legacy-reference/` or `docs/legacy-audit/` were made while
producing this document.

This extends, and must be read alongside:
- `docs/vizaje-sql-1c-reconciliation.md` (Sprint 12A.3, commit `cf18d57d`) —
  the reconciliation tool this plan's §5 builds on.
- `docs/vizaje-catalog-migration-report.md` §13 (Sprint 12A.2) — the
  forensic findings on the real MySQL export this plan cross-references.

## 0. Источник данных этого документа

`docs/legacy-audit/vizaje-1c-audit.md` reports on **four** real JSON files,
not three — in addition to `products.json` (18 057 rows), `pricevn.json`
(17 338 rows), and `JobVN.json` (11 423 rows), a fourth file,
**`old_products.json`** (703 rows), exists and was audited. This is new
information relative to Sprint 12A.3's original assumption (which only
anticipated the three files named in
`workapp-1c-observed-contract.md` §3). `old_products.json` is treated
below as a probable superseded/retired-product snapshot, not yet confirmed
as such — see §1's note on it.

## 1. Матрица соответствия полей: 1C JSON ↔ legacy MySQL ↔ V2

Legend: **1C** = field name as it appears in `products.json` (also present
identically in `JobVN.json`/`old_products.json` unless noted); **MySQL** =
column in `vizaje_nica_local.sql`'s `products`/`products_variable` (the
`CREATE TABLE` reference, since `vizaje_catalog_only.sql` carries no
column headers of its own); **V2** = Drizzle column in
`apps/api/src/db/schema/`. "—" means no corresponding field exists in that
system; this is expected for several rows (1C and MySQL are independent
source systems per the established field-ownership policy, not mirrors of
each other) and is not itself a defect.

| 1C field (`products.json`) | Fill rate (of 18 057) | MySQL column | V2 column | Notes |
|---|---:|---|---|---|
| `ID_nom` | 100% (0 blank) | — (no MySQL column holds a 1C id) | `external_entity_mappings` (`entity_type='nomenclature'`, `external_id`) | Primary 1C identity key. **See §4 — not as clean as assumed.** |
| `Barcode` | 99.9% (21 blank) | `products.barcode` / `products_variable.barcode` | `product_variants.barcode` (nullable, unique when present) | Direct match, both sides nullable. |
| `Brand` | 91.8% (1 477 blank) | `brands` (via `products.brand_id`, resolved, not by name) | `brands.name_ru` / `brands.name_ro` (via mapping) | A brand *name string*, never a reliable match key per existing policy — resolved through `external_entity_mappings`, not string equality. |
| `ColorVar` | 37.8% (11 230 blank) | `products_variable.color` | — (no dedicated column; would feed `product_variants.name_ru`/variant option modeling) | Variant discriminator (shade code), RU-oriented. |
| `ColorVarMD` | 37.8% (11 233 blank) | `products_variable.colorRO` (closest RO-equivalent) | — | RO-locale counterpart of `ColorVar`. "MD" here reads as the Moldovan/Romanian-locale suffix used throughout this feed (`...MD` fields pair with `...RU` fields elsewhere), not a separate warehouse dimension — do not confuse with the `Bal*` warehouse columns below. |
| `FullDescriptionMD` | 49.0% (9 217 blank) | `products.textRO` | `products.description_ro` | |
| `FullDescriptionRus` | 49.2% (9 163 blank) | `products.textRU` | `products.description_ru` | |
| `InstructionMD` | 67.7% (12 232 blank) | `products.instructionRO` | — | No V2 column for usage instructions yet. |
| `InstructionRU` | 67.7% (12 221 blank) | `products.instructionRU` | — | Same gap, RU side. |
| `NomenclatureCategory1/2/3` + `...Parent`/`...Parent2` (9 columns) | 13%–97% populated depending on level | `products.category_id` (single id only) + `product_categories` (junction, multi) | `categories` (self-referencing `parent_id` tree) + `product_categories` | 1C's 9-column flattened hierarchy (3 levels × {self, parent, parent2}) is richer than MySQL's single `category_id` + junction table. A real mapping pass needs to decide how deep the 1C hierarchy maps onto V2's `categories.parent_id` tree — not addressed by this sprint's aggregate audit alone. |
| `Planks` | 99.96%–100% populated (name suggests "shelf/plank" location) | no obviously matching column found in `vizaje_nica_local.sql` | — | Meaning unconfirmed from field name alone; flagged, not guessed at. |
| `Price` | 100% (0 blank) | `products.price` / `products_variable.price` | `product_prices.price` | Per Sprint 12 Task 4: historical only, not live — ongoing 1C price sync is explicitly out of scope. |
| `PriceWH` | 100% (0 blank) | `products.priceWH` / `products_variable.priceWH` | — | Wholesale/warehouse price; no V2 column (V2 has no B2B pricing tier yet). |
| `QuantityBalance` | 100% (0 blank) | `products.stock` / `products_variable.qty` | `inventory.quantity_on_hand` | Snapshot only, same caveat as `Price`. |
| `SeoDescriptionRO`/`RU` | 2.9% populated (17 524 blank each) | `products.seoDescRO`/`seoDescRU` | — **no V2 home** | See below — V2's `products` table has **no SEO columns at all**. |
| `SeoHeaderRO`/`RU` | 2.9% populated (17 531 blank each) | `products.seoTitleRO`/`seoTitleRU` | — **no V2 home** | Same gap. |
| `SeoKeyWordsRO`/`RU` | 0.2% populated (18 018 blank each) | `products.seoKeywordsRO`/`seoKeywordsRU` | — **no V2 home** | Same gap; also the sparsest field in the whole feed. |
| `Sex` | 99.5% (91 blank) | `products.sex` | — | No V2 column; would need a new field or a tag/attribute mechanism. |
| `ShortDescriptionMD`/`Rus` | 39.3%/39.4% blank | `products.descRO`/`descRU` (MySQL's separate short `desc*` columns, distinct from the long `text*` columns) | — (only the long description has a V2 home, via `FullDescription*` above) | V2 collapses MySQL's short/long description split into one `description_ru`/`description_ro`; the short-form text itself has no separate V2 column. |
| `VariativeName`/`MD` | 46.0% blank (9 745/18 057) | — (no MySQL equivalent; MySQL has no group-display-name column) | Would become `products.name_ru`/`name_ro` for a grouped (variant) product | The group's own display title, used only when `VariativeNomenclature` is set. |
| `VariativeNomenclature` | 54.4% blank (9 830/18 057) | — (no MySQL column; recovered only indirectly via the group-code-shaped `SKU`/`WarehouseName` pattern found in §13.3 of the Phase A report) | Drives the choice between one V2 `products` row (grouped) vs. per-record `products` rows (standalone) | The real 1C variant-grouping key. See §3. |
| `VolumeVar` | 38.1% blank (6 888/18 057) | `products_variable.VolumeVar` (MySQL column is literally named this) | — (no dedicated column; feeds variant naming/option modeling like `ColorVar`) | |
| `WarehouseName` | 100% populated | `products.WarehouseName` / `products_variable.WarehouseName` | — | Present on both sides, confirmed **never** a trusted title/name source anywhere in this pipeline (Sprint 10A.1 Task 3 decision, reaffirmed here) — kept for diagnostic visibility only. |
| `componentsMD`/`Ru` | 67.8%/67.8% blank | `products.componentsRO`/`componentsRU` | — | Ingredients list; no V2 column (same family of gap as `Instruction*`). |
| `BalAtrium`, `BalELAT`, `BalG3`, `BalGRHILLS`, `BalMall`, `BalNR1`, `BalSC1`, `BalSC3`, `BalSOIUZ`, `BalUNIC`, `BalUNIC1` (11 columns) | 100% present (fill-rate of the *value*, e.g. zero-vs-populated, not reported by the aggregate audit — only field presence is) | no per-store stock columns in `vizaje_nica_local.sql`'s `products`/`products_variable` (MySQL only has one aggregate `stock`/`qty` column) | — | **New finding this sprint**: 1C carries per-store stock balances for (at least) 11 named locations, which MySQL's schema never modeled at all. V2's `inventory` table is also single-location (`quantity_on_hand`, no store dimension). This is the clearest real gap surfaced by the real audit that Sprint 12/12A.2 could not have seen from the MySQL-only data — flagged for Phase B schema discussion, not resolved here. |

### `pricevn.json` fields

| 1C field | Fill rate (of 17 338) | MySQL column | V2 column |
|---|---:|---|---|
| `ID_nom` | 100% | — | `external_entity_mappings` |
| `Price` | 100% | `products.price` | `product_prices.price` |
| `DiscountPrice` | 100% | `products.discount_price` | `product_prices.compare_at_price` (inverse sense — MySQL/1C's `discount_price` is the *lower* sale price, V2's `compare_at_price` is the *higher* pre-discount reference price; a direct copy would be backwards, already a known mapping-direction detail, reconfirmed here) |
| `VariativeNomenclature` | 54.7% blank | — | same grouping role as in `products.json` |

### `JobVN.json` fields

Same field set as `products.json` (see table above) with one structural
difference per the audit: `SeoDescriptionRO/RU`, `SeoHeaderRO/RU`, and
`SeoKeyWordsRO/RU` are **100% populated** in `JobVN.json` (0 blank each)
versus ~97%+ blank in `products.json` — consistent with `JobVN.json`'s
stated purpose as the SEO/content feed (per
`workapp-1c-observed-contract.md` §3). The field *names* and their MySQL/V2
targets are identical to the `products.json` row above; only population
differs.

### `old_products.json`

Same schema as `products.json`, 703 rows, markedly lower fill rates on
every descriptive field. Its name and shape are consistent with a
retired/superseded-product snapshot, but **this is an inference from the
file name and aggregate stats, not a confirmed fact** — no row-level
comparison against `products.json`'s `ID_nom` values has been done (that
would require row-level data, see §5). Flagged for a one-line
clarification from the data owner rather than guessed at further.

### Summary of V2 schema gaps this matrix surfaces

No code or migration changes were made for any of these — documented only,
confirming the task's "flag fields with no clean home" instruction:

1. **No SEO columns on `products` at all** (`apps/api/src/db/schema/products.ts`
   has only `slug`, `name_ru/ro`, `description_ru/ro` — confirmed by reading
   the file). `SeoHeaderRU/RO`, `SeoDescriptionRU/RO`, `SeoKeyWordsRU/RO`,
   and MySQL's `uriRU`/`uriRO` (used for §13.5's slug analysis) have no V2
   home. `products.slug` is a single column, not localized — RU/RO need
   either two slug columns or a decision that one slug serves both locales.
2. **No per-warehouse/per-store inventory dimension** — 11 `Bal*` columns
   in 1C, one `quantity_on_hand` in V2.
3. **No ingredients/instructions/short-description columns** —
   `componentsMD/Ru`, `InstructionMD/RU`, `ShortDescriptionMD/Rus` all lack
   a V2 home; only the long description (`FullDescription*`) maps cleanly.
4. **No `Sex`/audience column.**
5. **No wholesale/warehouse price (`PriceWH`) column.**
6. **1C's 9-column category hierarchy vs. V2's single-parent tree** needs an
   explicit mapping decision (likely: 1C `NomenclatureCategory3` → deepest
   V2 category, climbing `Parent`/`Parent2` to populate ancestors) — not a
   missing column, but a non-trivial transformation.

None of these block Phase A/12A.2/12A.3 work; they are Phase B schema
discussion items.

## 2. Стратегия разрешения orphan-вариантов (721, с 463 на `product_id=1`)

Per the user's decision on Sprint 12A.2: the 463-orphan `product_id=1`
cluster **stays in quarantine** until reconciled against real 1C exports,
and is **never** auto-attached to another product as a guess. Nothing
below changes that — this section only specifies *how* a future row-level
pass would actually attempt the reconciliation, once real row-level 1C
data exists.

**What this sprint's aggregate audit can and cannot tell us:** the real
`products.json` audit confirms `VariativeNomenclature` is a genuine,
heavily-used grouping mechanism (8 227/18 057 populated, 1 536 distinct
groups) — this is the real-data confirmation of the mechanism Sprint 12A.2
§13.4 could only approximate via a `WarehouseName` group-code *pattern*
match on the MySQL side (which recovered just 40/721 orphans). **It cannot
tell us which specific orphan variant corresponds to which specific 1C
record** — that requires row-level `ID_nom`/`Barcode`/`VariativeNomenclature`
values on both sides, which the aggregate audit deliberately does not
contain.

### Proposed row-level reconciliation pass (not executable yet — needs real row-level `products.json`)

Run the existing `reconcileSqlWith1c` (`cf18d57d`) specifically against the
721 orphan `products_variable` rows (not the full 6 999-product set,
though the tool already covers both), in this key priority:

1. **Barcode** — the orphan's `products_variable.barcode` against 1C
   `Barcode`. Already the strongest signal available on an orphan row
   per §13.4 (126/721 matched products by barcode in the MySQL-only pass);
   row-level 1C barcode presence (99.9% fill rate, confirmed by this
   sprint's audit) makes this the first key to try.
2. **SKU-derived group code** — for orphans whose `SKU`/`WarehouseName`
   carries the `<letter><digits>.XXX`-style group pattern (§13.3), look up
   the same group code against 1C's `VariativeNomenclature` value. This is
   a **grouping**, not a single-record, match — only promote to
   `confirmed` when the 1C-side group resolves to exactly one record, per
   the existing tool's established rule (§2 of
   `docs/vizaje-sql-1c-reconciliation.md`).
3. **`ID_nom`-shaped identifiers embedded elsewhere** — `products_variable`
   itself has no `GUID`/`ID_nom` column (confirmed by reading the
   `CREATE TABLE products_variable` definition), so there is no direct key
   for this step today; this step only becomes viable if the real
   `products.json` export reveals a `WarehouseName`/`SKU` value that
   embeds the originating `ID_nom`, which cannot be determined from
   aggregate stats alone.

**Expected outcome once run for real:** some fraction of the 721 (plausibly
in the same rough range as the MySQL-only barcode/SKU pass's 19%, likely
higher once a real `Barcode`-to-`Barcode` row-level match is possible
instead of the MySQL-internal cross-check used in §13.4) will reach
`confirmed` or `ambiguous`. **The `product_id=1` cluster specifically
stays quarantined even after this pass** per the user's standing decision
— a 1C match is evidence for a human reviewer, never an automatic
quarantine-clearing event, exactly as `docs/vizaje-sql-1c-reconciliation.md`
§1 already specifies for the existing tool.

## 3. Правила группировки товаров и вариантов (уточнено на реальных данных)

- **`VariativeNomenclature` blank → standalone.** 9 830/18 057 (54.4%) of
  `products.json` rows have no `VariativeNomenclature` — these are
  single-SKU products with no sibling variants; each becomes its own V2
  `products` row with exactly one `product_variants` row. This confirms,
  on real population numbers for the first time, what Sprint 10A/10A.1
  assumed from samples alone.
- **`VariativeNomenclature` populated → candidate for one V2 parent
  product with N variants** — 8 227 rows across 1 536 distinct group
  values. The grouping is only safe once row-level data confirms every
  member of a group shares the same `Brand`/category/base title (the same
  consistency check Sprint 10A.1's `normalizeProductsFeed` already applies
  to the 1C feed shape) — this sprint's aggregate audit cannot itself
  verify that per-group consistency, only that the grouping *key* is
  real and heavily used.
- **`ColorVar`/`ColorVarMD` and `VolumeVar` are variant *attributes*, not
  grouping keys.** They describe what distinguishes siblings *within* an
  already-identified `VariativeNomenclature` group (shade, size) — they
  must never be used to *form* a group on their own, since two unrelated
  products could coincidentally share a color code or volume value. This
  matches how the Sprint 10A `normalizeProductsFeed` module already treats
  them.
- **`Barcode`'s near-1:1 distinctness (18 036 populated / 17 472 distinct /
  only 5 duplicate groups covering 569 rows) makes it a safe *secondary*
  identity/matching signal**, but explicitly **not a grouping key** and
  **not a replacement for `ID_nom`/GUID as the primary identity**:
  - Safe role: a tie-breaker / corroborating signal in reconciliation
    (§2 above, and already how `reconcileSqlWith1c` uses it — priority 2,
    after GUID/`ID_nom`, per `docs/vizaje-sql-1c-reconciliation.md` §2).
  - Unsafe role: using `Barcode` to *decide* two 1C records are the same
    sellable unit on its own, since 569 rows (3.2% of the file) sit in a
    duplicate-barcode group — a real, if small, rate of either
    resellable/repackaged goods sharing a barcode or genuine data entry
    duplication, indistinguishable from aggregate stats alone.

## 4. Правила уникальной товарной позиции — и важная поправка к допущению Sprint 10A/10A.1/12A.2

**`ID_nom` itself is not fully unique within `products.json`: 771 duplicate
groups covering 1 594 rows (8.8% of the file).** This is a materially
different and more concerning finding than Sprint 12A.2 §13.1's 14
GUID-duplicate groups on the *MySQL* side — this is the **1C feed itself**,
previously treated across Sprint 10A, 10A.1, and 12A.2 as the clean,
authoritative identity source (`ID_nom` was consistently used as "the
primary identity key", e.g. `docs/vizaje-sql-1c-reconciliation.md` §2's
priority-1 matching rule, and Sprint 10A.1's whole normalization pipeline
keys groups and standalone candidates by `ID_nom`).

**What this does and does not mean, stated carefully (aggregate stats
cannot distinguish these cases — row-level data is required to know
which applies to which group):**

- It does **not** necessarily mean 1C's identity model is broken. A
  duplicate `ID_nom` in an *export* file can equally mean: the same
  nomenclature record was re-exported across two feed "pages"/batches
  (an export-time artifact), a genuine update-in-place that produced two
  rows instead of overwriting one, or — the more concerning possibility —
  `ID_nom` is reused for genuinely different nomenclature records under
  some condition not yet understood.
- It **does** mean the deterministic-mapping assumption stated in Sprint
  12 Phase A §3 ("Legacy MySQL product ID → V2 product UUID... Legacy GUID
  / 1C `ID_nom` → external nomenclature mapping") needs a **duplicate-
  handling rule for `ID_nom` itself**, which did not previously exist,
  before any 1C-sourced mapping can be trusted as 1:1 reliable at import
  time.

**Proposed rule (to validate once row-level data exists, not applied
anywhere yet):** a sellable unit's unique identity is **`ID_nom`, AND
only when `ID_nom` is unique within the feed it came from**. A duplicated
`ID_nom` must route to the same kind of `ambiguous`/quarantine outcome the
existing `reconcileSqlWith1c` tool already applies to duplicate 1C
`ID_nom` values in its own synthetic test coverage (see
`docs/vizaje-sql-1c-reconciliation.md` §6: "ambiguous match via duplicate
1C `ID_nom`" is already an explicitly tested scenario) — this finding
confirms that test scenario is not hypothetical, it is the real shape of
the real data, at a non-trivial 8.8% rate. **No code change was made here**
— the tool already handles this case correctly by design; this section
documents that the real data now proves the design decision was
necessary, not defensive-programming overreach.

`pricevn.json` (84 duplicate `ID_nom` groups / 169 rows, 1.0%) and
`JobVN.json` (410 groups / 837 rows, 7.6%) show the same phenomenon at
different rates — consistent with it being a structural property of how
these feeds are exported, not isolated to one file.

## 5. План фактической сверки (real row-level reconciliation)

### Нужно от владельца данных

A **row-level** export of at least **`products.json`**, ideally the real
full file the aggregate audit was computed from (18 057 rows) or a
representative subset — not another aggregate summary. `pricevn.json` and
`JobVN.json` row-level data are not required for *identity* reconciliation
(per `docs/vizaje-sql-1c-reconciliation.md` §4's existing table — unchanged
by this sprint's findings) but would be needed if/when price or SEO-content
reconciliation is scoped separately in a later sprint.

### Как это будет прогнано

1. `bun run import:legacy:reconcile-1c -- --sql=docs/legacy-reference/vizaje_catalog_only.sql --feed=<path to real row-level products.json>`
   — the exact existing CLI from `cf18d57d`, unchanged. No new tool is
   needed for the base run; `reconcileSqlWith1c` already consumes
   `parseProductsFeed`'s output, and `parseProductsFeed`'s Zod schema
   (`.passthrough()`) already accepts every field name this sprint's audit
   observed, including ones not explicitly typed (e.g. the `Bal*` columns,
   `NomenclatureCategory*`, `Planks`) — they pass through without
   validation failure, just untyped. **No code change was required or made
   this sprint to make ingestion possible.**
2. Expected real output once run: `confirmed`/`ambiguous`/`unmatched`
   counts at real scale (6 999 MySQL products × up to 18 057 1C records),
   replacing §5 of `docs/vizaje-sql-1c-reconciliation.md`'s 3-record smoke
   test with a genuine measurement. The `quarantine` bucket (403 products
   + 721 orphan variants, per §13.6 of the Phase A/12A.2 report) stays
   quarantined regardless of 1C match quality, unchanged behavior.
3. **New edge cases this sprint's real field audit suggests preparing
   for, before (not during) that run:**
   - §4's duplicate-`ID_nom`-within-1C finding means the real run will
     very likely surface `ambiguous` results at a non-trivial rate purely
     from 1C-side duplication, not MySQL-side issues — this should be
     expected and reported as such, not mistaken for a tool defect.
   - The `Bal*` per-warehouse columns and the 9-column category hierarchy
     (§1) are not yet consumed by any identity-matching logic (they are
     out of scope for *identity* reconciliation specifically) — if a
     future sprint extends `reconcileSqlWith1c` to use category/warehouse
     data as an additional disambiguation signal for `ambiguous` results,
     these are the fields to type explicitly in `productsFeedRecordSchema`
     first.
   - `old_products.json`'s role (§0) should be clarified with the data
     owner before deciding whether it participates in reconciliation at
     all, or is excluded as a retired-record archive.

No code changes were made to the reconciliation tool this sprint — the
existing `.passthrough()`-based schema and `reconcileSqlWith1c` were judged
already sufficient for the base run in item 1 above; speculative typing of
fields with no current consumer (per the task's own "don't over-build"
instruction) was deliberately not added.

## 6. Verification

| Check | Result |
|---|---|
| TypeScript typecheck (`bunx tsc --noEmit`, `apps/api`) | Clean (no code changed this sprint; re-verified for safety) |
| Migration drift (`bunx drizzle-kit generate`) | No schema changes, nothing to migrate (no Drizzle schema touched) |
| Full Bun test suite (`bun test --parallel=1`, `apps/api`, run only after confirming no concurrent `bun test` process held the shared test DB) | **377 pass, 0 fail, 15 skip** (392 total) — the 15 skips are the same pre-existing Meilisearch-unavailable skips from Phase A/12A.2, unrelated to this work |

No PostgreSQL writes. No `external_entity_mappings` mutations. No Phase B
work started or implied.

## 7. Sprint 12A.4 — running this locally on your Mac

Sprint 12A.4 added a new entrypoint,
`apps/api/src/import/cli/reconcile-1c-local.ts`, that accepts **explicit
local file paths** instead of hardcoded repo paths, so it can be run
directly against the real files on your machine - none of which exist in
this repository or in the cloud sandbox this project is normally developed
in. Nothing in this sprint was run against your real files; every test and
the one smoke run described above used synthetic fixtures shaped like the
real field layout recorded in `docs/legacy-audit/vizaje-1c-audit.{md,json}`
(Sprint 12A.3's aggregate-only audit).

**New in this sprint:**

- `apps/api/src/import/cli/reconcile-1c-local.ts` - the local CLI described below.
- `apps/api/src/import/parsers/json-array-stream.ts` - a bounded-memory
  streaming parser for a top-level JSON array file, used to read the (large)
  real `products.json`/`old_products.json`/`pricevn.json`/`JobVN.json` one
  element at a time during the parse step, rather than holding the whole
  raw file text and the whole parse tree in memory simultaneously. See that
  file's own doc comment for the precise, honest scope of what is and
  isn't actually streamed - the final matching step still needs the full
  record set in memory, which is inherent to how `reconcileSqlWith1c`'s
  indexes work, not something this parser can avoid.
- `apps/api/src/import/reconcile/duplicate-id-nom.ts` - classifies every
  duplicate-`ID_nom` group found in a real 1C file into one of four
  categories (`identical`, `conflicting`, `mutable_only`,
  `variant_or_warehouse`) - see §4 above for the reasoning. Never reports
  raw field values, only field *names* that differ.
- `apps/api/src/import/reconcile/secondary-source-rescue.ts` -
  `old_products.json` wiring: a product the primary `products.json` pass
  left `unmatched` can be evidenced (not resolved) by a match in
  `old_products.json`. This is reported as a separate, clearly-labeled
  section - never merged into the primary counts, and never able to clear
  a Sprint 12A.2 quarantine.
- `reconcileSqlWith1c` itself (Sprint 12A.3) was **not modified** - barcode
  remains supporting evidence only (an independent signal checked
  regardless of GUID/ID_nom, never short-circuiting or overriding a GUID
  match on its own; see that file's own `matchProduct()` for the
  unmodified logic), and `VariativeNomenclature`-based grouping only ever
  promotes to a record-level match when both sides resolve to exactly one
  candidate - unchanged from Sprint 12A.3.

### Setup (once)

```bash
# From anywhere - clone if you haven't already:
git clone https://github.com/arionel0726-dev/new-brand.git
cd new-brand
git checkout claude/trusting-ride-faubis
git pull

# Bun (if not already installed):
curl -fsSL https://bun.sh/install | bash

# Install dependencies:
cd apps/api
bun install

# A local Postgres is required only for the catalog dry-run's quarantine
# lookup (read-only SELECT against external_entity_mappings) and for
# running the test suite - it is never written to by the reconciliation
# CLI itself. If you don't already have one:
#   brew install postgresql@16
#   brew services start postgresql@16
#   createdb beauty_store_test
# Then point apps/api/.env's DATABASE_URL at it, e.g.:
#   DATABASE_URL=postgres://localhost:5432/beauty_store_test
# and apply migrations once:
bun run db:migrate
```

### Running the reconciliation

Replace the paths below with wherever your real files actually live
(the user's own paths, by way of example):

```bash
cd new-brand/apps/api

bun run import:legacy:reconcile-1c-local -- \
  --sql="$HOME/path/to/your/legacy_dump.sql" \
  --products="$HOME/Downloads/b2b-patch/public/import/products.json" \
  --old-products="$HOME/Downloads/b2b-patch/public/import/old_products.json" \
  --pricevn="$HOME/Downloads/b2b-patch/public/import/pricevn.json" \
  --jobvn="$HOME/Downloads/b2b-patch/public/import/JobVN.json"
```

`--sql` and `--products` are required; `--old-products`, `--pricevn`, and
`--jobvn` are each optional and only add their own report section when
supplied. To save the full output to a file for later review:

```bash
bun run import:legacy:reconcile-1c-local -- \
  --sql="$HOME/path/to/your/legacy_dump.sql" \
  --products="$HOME/Downloads/b2b-patch/public/import/products.json" \
  --old-products="$HOME/Downloads/b2b-patch/public/import/old_products.json" \
  --pricevn="$HOME/Downloads/b2b-patch/public/import/pricevn.json" \
  --jobvn="$HOME/Downloads/b2b-patch/public/import/JobVN.json" \
  2>&1 | tee ~/vizaje-reconciliation-run-$(date +%Y%m%d-%H%M%S).log
```

### What the report contains

Printed to stdout, in this order:

1. **Primary reconciliation summary** (products.json) - `confirmed` /
   `ambiguous` / `unmatched` / `quarantine` counts, a breakdown by which
   key matched (`guid_id_nom` / `barcode` / `variative_nomenclature_group`),
   and a bounded number of sanitized examples per outcome.
2. **Unmatched 1C records** - a sample (up to 10) of `products.json`
   records with no MySQL match on any key.
3. **Duplicate `ID_nom` classification: products.json** - counts by
   `identical` / `conflicting` / `mutable_only` / `variant_or_warehouse`,
   plus a bounded number of examples (ids, record counts, and differing
   field *names* only).
4. *(if `--old-products` given)* **Secondary reconciliation via
   old_products.json** - how many primary-unmatched products this
   stale-snapshot source offers additional (non-authoritative) evidence
   for, plus its own duplicate-`ID_nom` classification.
5. *(if `--pricevn` given)* **pricevn.json** duplicate-`ID_nom`
   classification and ID_nom coverage of the SQL-matched set.
6. *(if `--jobvn` given)* **JobVN.json** duplicate-`ID_nom` classification
   and ID_nom coverage of the SQL-matched set.
7. **Quarantined variants** - the Sprint 12A.2 orphan-variant totals by
   reason code, unchanged by this run.
8. **Remaining Phase B blockers** - a short reminder of what still needs a
   human decision (the 3 uncategorizable products, the `product_id=1`
   orphan cluster, the SKU-duplicate variant-restructuring approach, and
   whatever this specific run's duplicate-`ID_nom` classification turned
   up).

Nothing is written to PostgreSQL, nothing mutates
`external_entity_mappings`, and no file under `docs/legacy-reference/` or
`docs/legacy-audit/` is ever touched by this tool.

## 8. Sprint 12A.5 — findings from the real reconciliation run

The user ran the Sprint 12A.4 CLI against the real legacy SQL dump and
the four real 1C JSON exports on their own Mac and reported the
aggregate numbers back. Nobody on this side of the sandbox has seen the
underlying rows - every finding below either traces to a code-level
review of `reconcile-1c-local.ts`/`sql-1c-reconciliation.ts`/
`duplicate-id-nom.ts` that explains *why* a reported number came out the
way it did, or is explicitly flagged as needing a further local run to
confirm. Numbered to match the user's own 8 tasks.

### 1. Barcode-only `ID_nom` duplicates (real run: 768/771 `conflicting`, 0 `variant_or_warehouse`)

**Root cause found and fixed.** `duplicate-id-nom.ts`'s Sprint 12A.4
classifier put `Barcode` in the same bucket as any unrecognized field
(`Brand`, a title, a category column, ...) - so any pair of rows sharing
one `ID_nom` but differing in `Barcode` landed in `conflicting`,
indistinguishable from a real brand/category conflict. Given the real
audit's own finding that `Barcode` is 99.9% distinct in `products.json`,
a `Barcode` difference between two rows sharing one `ID_nom` is the
overwhelmingly common shape of a "duplicate" - which fully explains both
the 768-conflicting / 0-variant_or_warehouse split and why the category
built for exactly this case never fired.

**Fixed**: `Barcode`-only differences now classify as their own
`barcode_only_conflict` category, distinct from a general `conflicting`
field (e.g. `Brand`) and distinct from `variant_or_warehouse`. This is a
classification change only - nothing is merged, split, or resolved
automatically; a human still decides whether a given group is a
multi-pack, a corrected barcode, or something else. **Needs a new local
run** to see the real `barcode_only_conflict` vs. true `conflicting`
split - re-run `import:legacy:reconcile-1c-local` and read the updated
`byClassification` breakdown for `products.json`.

### 2. `byMatchKey` semantics (real run: 7365 guid/ID_nom + 56684 barcode, vs. 6999 products)

**Root cause found and the API clarified.** `sql-1c-reconciliation.ts`'s
counter incremented once per `basis` entry - i.e. once per *candidate
signal*, not once per product. A MySQL product whose barcode hits several
1C records sharing that barcode (a duplicate on the 1C side) contributes
one entry *per 1C record it hit*, not one. That is the entire explanation
for 56684 "barcode matches" against 6999 products: it is overwhelmingly
counting 1C-side barcode duplicates being discovered as candidates, not
6999-ish real matches.

**Fixed**: the single `byMatchKey` field is now two explicit fields:
- `byMatchKeyCandidates` - the old meaning, renamed for clarity (every
  candidate signal, can vastly exceed `totalMysqlProducts`).
- `byMatchKeyConfirmedEntities` - one count per key, per product whose
  *final* match was `confirmed` and where that key contributed to the
  single agreed-upon `ID_nom`. This is the number to read for "how many
  real products were confirmed via key K" - it can never exceed
  `confirmed × 3`.

Each `MysqlReconciliationResult` also now carries `confirmedKeys` (which
key(s) agreed, only set for a confirmed raw match). **Needs a new local
run** to see the real `byMatchKeyConfirmedEntities` numbers - these are
the trustworthy per-entity counts the old single field could not provide.

### 3. `variative_nomenclature_group` matching 0 real matches despite 1536 distinct values

**Root cause found and fixed - a real implementation bug, not just data
sparsity.** `detectGroupCode`'s regex test runs case-insensitively (the
`/i` flag), but the `Map` lookups that join the MySQL-side group-code
index against the 1C-side `VariativeNomenclature` index used the raw,
un-normalized string as the key - and JS `Map` keys are case-sensitive.
A MySQL `SKU` of `"a10.xxx"` and a 1C `VariativeNomenclature` of
`"A10.XXX"` represent the same group (Sprint 12A.2 §13.3) but would
never collide as `Map` keys, silently preventing every such match.

Sprint 12A.2's finding that this group-code pattern is genuinely rare on
the MySQL side (only a minority of the 128 SKU-duplicate groups follow
it) is **also still true** and likely explains why the real count would
stay low even after this fix - but a hard 0 despite 1536 distinct 1C
values pointed at a code bug on top of that rarity, and the bug is now
confirmed and fixed.

**Fixed**: a `normalizeGroupCodeKey()` helper (`trim().toUpperCase()`)
is now applied consistently to every group-code `Map` key (never to the
`basis.mysqlValue`/`oneCValue` shown to a human, which stay as the
original values). **Needs a new local run** to see the real non-zero
`variative_nomenclature_group` count this unlocks.

### 4. The 495 ambiguous products - classification taxonomy

**Taxonomy enumerated and basis exposure extended**, per Sprint 12A.3's
own promise that "every match result must carry its basis." Reading
`matchProduct`, there are exactly two distinct code paths that produce
`'ambiguous'`:

- `conflicting_candidates` - two or more *different* ID_nom values were
  found across the available keys (e.g. GUID points at one 1C record,
  Barcode points at a different one). A genuine cross-key disagreement.
- `duplicate_1c_records_on_single_key` - exactly one candidate ID_nom was
  found, but a single key hit more than one 1C record sharing that value
  (the 1C input itself has a duplicate on that key - consistent with the
  real ID_nom-duplicate-within-1C finding).

Both are now a typed `ambiguityReasonCode` on every `'ambiguous'` result,
plus `summary.ambiguousByReasonCode` giving the aggregate split. **Needs
a new local run** to see how the real 495 actually split between the two
causes - that split was never previously surfaced at all.

### 5. The 128 unmatched products - discontinued vs. "needs investigation"

**Implemented exactly as the user specified: evidence-gated, not
assumed.** The only real, independently-recorded MySQL-side signal
available today is `products.is_shown` (the Phase A published/hidden
flag - 6884/115 in the real audit). A new `possiblyDiscontinued: boolean`
field is `true` **only** when a product's raw match attempt was
`unmatched` *and* `isShown === false`; every other unmatched product gets
`false` and stays in the neutral "needs investigation" bucket, exactly as
instructed - unmatched is never assumed to mean discontinued on its own.
`summary.possiblyDiscontinuedCount` gives the aggregate. **Needs a new
local run** to see how many of the real 128 actually carry this
evidence.

### 6. Duplicate `ID_nom` in pricevn.json - price-selection determinism

**Finding: no price-selection code exists anywhere in this project
today** - `pricevn.json` is currently used only for its own
duplicate-`ID_nom` classification and an ID_nom-coverage check against
the SQL-matched set (`reconcile-1c-local.ts`); nothing reads a `Price` or
`DiscountPrice` value out of a pricevn record and assigns it to anything.
There is therefore no first-wins/last-wins bug to fix in this sprint,
because there is no selection logic at all yet - that is a Phase B /
future price-sync concern, explicitly out of scope.

What *was* a real gap, and is fixed: `duplicate-id-nom.ts`'s classifier
previously lumped a genuine `Price`/`DiscountPrice` disagreement into the
same soft `mutable_only` bucket as `QuantityBalance`/`PriceWH` - treating
a real pricing conflict as casually as a stock-count snapshot difference.
`Price`/`DiscountPrice` differences are now their own `price_conflict`
category, ranked more severe than `mutable_only` (but less severe than an
unrecognized-field `conflicting`), so a future price-sync feature has a
distinct, un-missable signal to check before it is ever allowed to pick
either value automatically. **Needs a new local run** to see the real
`price_conflict` count within pricevn.json's 84 duplicate groups (the
previously-unaccounted-for remainder of the 84 − 46 = 38 groups the user
flagged splits across `price_conflict`/`mutable_only`/`identical` -
`reconcile-1c-local.ts` already printed the full `byClassification`
object, including these, before this sprint; the user's chat summary
just didn't quote every field).

### 7. CLI output sanitization

Reviewed `reconcile-1c-local.ts`'s print paths against every new field
added this sprint: `confirmedKeys`/`ambiguityReasonCode` are closed
enums, `possiblyDiscontinued`/`byClassification` counts are
booleans/numbers, `barcode_only_conflict`/`price_conflict` are
classification labels. None of this sprint's additions introduce a path
that prints a raw field value - the existing "ids, reason codes, and
field *names* only" discipline from Sprint 12A.2-12A.4 holds. No code
change was needed here; the regression test
`'the new Sprint 12A.5 diagnostic fields are enums/booleans/ids only'`
pins this.

### 8. Is the ~5973-confirmed-match subset ready for a safe test import?

**Honest answer: closer than before this sprint, but still not a clean
yes.** Layering this sprint's findings on top of Sprint 12A.2's standing
data-quality findings:

- **Identifier stability**: stronger than previously known.
  `byMatchKeyConfirmedEntities` (once re-run) will show real per-key
  reliance; the `variative_nomenclature_group` fix may move some
  currently-`ambiguous`/`unmatched` products into `confirmed` on a
  *more* trustworthy signal than before, since it closes a real bug
  rather than relying on luck.
- **Pricing**: this sprint found no live pricing *use* to audit (none
  exists yet), but it does mean no confirmed-matched product's price has
  ever been silently resolved incorrectly - there was simply nothing
  reading pricevn data into anything yet. This is a readiness
  *prerequisite* now properly flagged (`price_conflict`) rather than a
  risk that was already live.
- **Variants/localization/brand-category**: unchanged from Sprint
  12A.2's findings - the 3 uncategorizable products (1455/6519/7698, to
  import unpublished/uncategorized per the user's decision), the
  SKU-duplicate groups (now understood to often be mis-modeled variant
  families per 12A.2 §13.3, to be reconstructed as real V2 variants per
  the user's decision, not synthetic SKUs), and the 6%-real-SEO-slug
  coverage all still apply to whichever confirmed-matched products they
  intersect with - this sprint did not re-touch any of that.
- **Orphan variants**: the 463-`product_id=1` cluster and the remaining
  258 orphans are explicitly *not* resolved by anything in this sprint -
  per the user's standing decision, they stay quarantined until checked
  against real row-level 1C data, which is still not available in this
  sandbox.

**Still not safe to call "ready" without a new local run**: every fix in
this sprint (barcode-only distinction, byMatchKey split, group-code
case-normalization, ambiguity taxonomy, discontinued-evidence flag,
price-conflict category) changes *how the tool reports*, not what the
real catalog actually contains - the real `confirmed`/`ambiguous`/
`unmatched` counts will almost certainly shift once re-run with these
fixes (most likely: some currently-`unmatched`/`ambiguous` products move
into `confirmed` via the group-code fix; some currently-`conflicting`
duplicate-ID_nom groups move into `barcode_only_conflict`/
`price_conflict`). **Phase B readiness should be re-assessed only after**
a fresh `import:legacy:reconcile-1c-local` run against the real files
with this sprint's code, not against the numbers quoted in the Sprint
12A.5 request.

## 9. Sprint 12A.6 — identity model update from domain-expert confirmation

A VIZAJE-NICA employee who works with the live 1C system directly gave
four confirmations that resolve open questions from §1–§8. This section
is **analysis and architecture recommendation only** — no code change
beyond two clarifying doc-string/note updates
(`apps/api/src/import/reconcile/duplicate-id-nom.ts`), no migration, no
PostgreSQL write, no auto-merge of anything. Phase B remains unstarted.

### 12A.6-A. Updated identity rules

| Concept | Identity | Confirmed by |
|---|---|---|
| `ID_nom` | **The identity of one sellable variant/nomenclature position.** Not a barcode, not a group. | Employee confirmation #2 ("Каждая позиция имеет собственный ID_nom") |
| `Barcode` | **A non-unique-per-se attribute of an `ID_nom`.** One `ID_nom` can legitimately own *more than one* barcode. Still useful as supporting matching evidence (per §12A.3's original design — see `docs/vizaje-sql-1c-reconciliation.md` §matching-key-priority), but a barcode-level difference between two rows sharing one `ID_nom` must no longer be read as "these might be different products" — see §12A.6-B. | Employee confirmation #1 ("наблюдались вручную") |
| `VariativeNomenclature` | **The parent-group identity** — a folder/group code in 1C that has "вариативность" (variant-configuration) switched on. When set, every `ID_nom` sharing that code is a child variant of one logical product, differing by volume, colour, or other attributes. This is exactly what Sprint 10A's `external_entity_mappings.entity_type` enum already encodes (`'nomenclature_group'` → V2 product, `'nomenclature'` → V2 product_variant — `apps/api/src/db/schema/external-entity-mappings.ts` lines 26–34) — the **data model was already correctly designed** for this before the employee's confirmation; what had gaps was the *matching code*, not the schema (see §12A.6-C). | Employee confirmation #2 |
| `VariativeNomenclature` global uniqueness | **Unconfirmed — an open empirical question, not a fact.** Do not assume a group code is globally unique across brands/categories. The matching/import logic must tolerate (and flag, never silently trust) an accidental collision between two unrelated groups that happen to share a code string. | Employee confirmation #3, explicit |
| `price_conflict` (Price/DiscountPrice differing within one `ID_nom` duplicate group) | **Cause unknown.** A discount-related hypothesis exists but is explicitly unconfirmed. Kept as its own classification tier (unchanged this sprint), never silently resolved. See §12A.6-D for what static analysis can and cannot say about it. | Employee confirmation #4, explicit |

**Practical consequence for the reconciliation tool**: `barcode_only_conflict`
(from `duplicate-id-nom.ts`) is **not** a conflict about product identity —
its note text now says so explicitly (Sprint 12A.6 update). It remains its
own classification tier (not merged into `identical`) because the
underlying barcode *values* still need to be captured and preserved, not
because the records are in doubt as to being "the same `ID_nom`".

### 12A.6-B. Product ↔ ProductVariant ↔ Barcode design recommendation

**Current V2 schema** (`apps/api/src/db/schema/product-variants.ts`):

```ts
barcode: text('barcode'),                    // single nullable column
// ...
uniqueIndex('product_variants_barcode_unique_idx')
  .on(table.barcode)
  .where(sql`${table.barcode} is not null`)  // globally unique when present
```

This assumes **one barcode per variant, globally unique**. Both halves of
that assumption are now known to conflict with at least some real legacy
records (confirmation #1): a single `ID_nom` → V2 `product_variant` can
have *multiple* legitimate barcodes.

Three options, with tradeoffs — **none implemented, none migrated, this
sprint**:

1. **New `product_variant_barcodes` table** (recommended direction for
   Phase B design, not built now): `(id, product_variant_id, barcode,
   is_primary, source_system, external_id, created_at)`, with the unique
   constraint moved there (`barcode` globally unique across the new
   table, nullable `is_primary` boolean or a partial unique index
   ensuring at most one primary per variant). Cleanest fit for "many
   barcodes, one variant" without touching `products`/`product_variants`'
   own shape. The existing `product_variants.barcode` column would
   either become a denormalized "primary barcode" cache (kept in sync
   from the new table) or be dropped in favor of always joining — a
   decision to make when this is actually scoped for Phase B, not here.
2. **Keep a single `product_variants.barcode` as "canonical/primary"
   only**, and preserve every *other* legacy barcode for that `ID_nom`
   in `external_entity_mappings` or a dedicated audit/import-trail
   table, never exposed as a second "real" barcode on the public API.
   Lower schema-churn, but loses the ability to usefully search/scan by
   a non-primary barcode later (e.g. a customer scanning a secondary
   pack barcode at a kiosk would not resolve to the product).
3. **Do nothing to the schema; dedupe at import time** by always picking
   one barcode per `ID_nom` via a documented, deterministic rule (e.g.
   "shortest", "first seen", "matches `Barcode` on the earliest-dated
   feed row") and silently drop the rest. **Not recommended** — this
   contradicts the Sprint 12 "never silently discard information"
   principle that has held throughout every prior round, and the
   confirmed employee information is precisely what should prevent
   choosing this option without an explicit decision from the user.

No migration file was created; no table was added. This is a documented
recommendation for Phase B scoping, consistent with "Пока только анализ и
рекомендации по архитектуре."

### 12A.6-C. Re-examination of the Sprint 12A.5 zero-match fix — is there a second-order group-vs-individual gap?

**Direct answer: yes, a real, additional gap exists beyond the
case-sensitivity bug Sprint 12A.5 fixed — found by reading
`matchProduct()` in `sql-1c-reconciliation.ts` (lines 293–309) against
the employee's confirmation #2.**

The relevant code:

```ts
const groupCode = detectGroupCode(product.sku)
if (groupCode !== null) {
  const normalizedGroupCode = normalizeGroupCodeKey(groupCode)
  const mysqlSiblings = groupCodeOwners.get(normalizedGroupCode) ?? []
  const oneCGroup = variativeIndex.get(normalizedGroupCode) ?? []
  if (mysqlSiblings.length === 1 && oneCGroup.length === 1) {
    // ... promote to a record-level match
  }
}
```

This only promotes a group-code hit to an individual match when **both
sides resolve to exactly one record** (`mysqlSiblings.length === 1 &&
oneCGroup.length === 1`). But per the employee's confirmation #2, a real
`VariativeNomenclature` group is, by design, meant to have **multiple**
`ID_nom` children (that is the entire point of "вариативность" being
switched on for that group). Sprint 12A.2 §13.3 independently found the
same shape on the MySQL side: `products.SKU` is the field being
opportunistically read here as a "group code" (via `detectGroupCode`'s
regex heuristic), and MySQL has no dedicated "parent group" column — the
128 real duplicate-`SKU` groups found in Sprint 12A.2 **are** multiple
MySQL products sharing one `SKU` value, i.e. `mysqlSiblings.length > 1`
for every real family.

**Consequence**: the `mysqlSiblings.length === 1 && oneCGroup.length ===
1` condition is satisfied almost *never* for a genuine multi-member
family — it can only fire for the degenerate case of a single-variant
"family" on both sides, which is close to a contradiction in terms (a
group with exactly one member isn't meaningfully a "group"). This means
that even with Sprint 12A.5's case-normalization fix applied, the
`variative_nomenclature_group` key will continue to under-fire on real
multi-variant families, independent of case sensitivity — the case fix
was necessary (it was blocking even the degenerate single-member case
from ever matching) but not sufficient.

This is precisely the risk the employee's framing named
("возможно, алгоритм ошибочно сопоставляет групповой SKU с
идентификатором отдельной номенклатуры") — though more precisely stated:
the algorithm does not *confuse* a group code with an individual id in
the sense of silently treating them as interchangeable; rather, its
current design structurally **declines to use the group-code signal at
all** for any real (multi-member) group, by requiring a 1:1 shape that
only a non-group ever has. The net effect for a human reading Sprint
12A.5's real run is similar either way: the key under-performs on exactly
the data shape (`VariativeNomenclature` groups) it was built for.

**Recommendation (not implemented this sprint, per "анализ и
рекомендации" scope)**: separate *group-level candidate detection* from
*individual-record matching* into two distinct outputs:

- A **family-candidate signal**: "MySQL group-code X (N members) and 1C
  `VariativeNomenclature` X (M members) appear to be the same family" —
  reported as its own diagnostic category, not promoted to any individual
  `product_id ↔ ID_nom` pairing.
- A **within-family attribute-matching pass** (a materially new, more
  complex piece of logic, out of scope to design in full here): once a
  family candidate is identified, pairing *which* MySQL product
  corresponds to *which* `ID_nom` within that family would need a second
  signal — barcode (per §12A.6-A/B, itself now known to be many-to-one,
  which complicates this further), `ColorVar`/`VolumeVar` attribute
  matching, or simply leaving every within-family pairing for human
  review rather than guessing. This is real, nontrivial design work
  recommended for Phase B planning, not attempted here.

No code change was made to `matchProduct()`'s group-matching condition
this sprint — the finding is reported for the user's decision on how
(and whether) to scope the family-vs-individual redesign described
above.

### 12A.6-D. Price/DiscountPrice vs. `pricevn.json` — structural analysis

**What static code/schema analysis can say:**

- `products.json`'s confirmed fields (per `products-feed.ts` and
  `docs/legacy-audit/vizaje-1c-audit.md`) include `Price` and `PriceWH`,
  but **no `DiscountPrice`**.
- `pricevn.json`'s confirmed fields (per `pricevn-feed.ts`) include
  `Price` and `DiscountPrice`, but **no confirmed `PriceWH`** (the
  parser's own doc comment: "`PriceWH` was **not** present in the real
  pricevn sample ... kept here as optional for forward compatibility").
- `docs/vizaje-migration-architecture.md` already documented this same
  split independently (lines 530, 543–544) and flagged
  `promotionalReferencePrice`/`compare_at_price` as **unresolved** for
  exactly this reason — this sprint's finding is consistent with, not a
  contradiction of, that earlier open question.

This field split is **structurally suggestive** that `pricevn.json` is
the system's dedicated pricing feed (its only confirmed job is price +
discount), while `products.json`'s `Price`/`PriceWH` may be a secondary,
possibly-cached catalog-display pair (`PriceWH` reads naturally as a
warehouse/wholesale reference price, not a discount). **This is a
plausible structural reading, not a confirmed fact** — nothing in the
code or any committed doc proves which feed, if either, is authoritative
for a live price.

**What this does *not* explain**: the Sprint 12A.5 `price_conflict`
finding is about **two rows *within the same feed* sharing one `ID_nom`**
disagreeing on `Price`/`DiscountPrice` — not a cross-feed discrepancy
between `products.json` and `pricevn.json`. Nothing in the code, the
Zod schemas, or any committed document explains *why* a single feed
export would contain two differently-priced rows for the same `ID_nom`.
The employee's discount hypothesis is a plausible explanation (e.g. one
row captured mid-sale, one row post-sale) but is explicitly unconfirmed
per confirmation #4, and this sprint found no code-level or data-shape
evidence that would confirm or rule it out.

**Recommended verification the user/employee would need to do** (not
performable from code alone):

1. Check whether a real `pricevn.json` duplicate-`ID_nom` group's two
   `Price`/`DiscountPrice` values are ever consistent with a before/after
   discount-window pair (e.g. do the differing rows carry any timestamp
   or export-batch metadata not currently modeled in
   `pricevn-feed.ts`'s schema that could order them?).
2. Ask the 1C/warehouse team directly whether a single pricevn export can
   legitimately contain the same `ID_nom` twice by design (e.g. once per
   warehouse, once per currency, or similar to the confirmed
   multi-barcode pattern from confirmation #1) — this would be a
   structurally different explanation than "stale snapshot" or
   "discount".
3. Re-run `reconcile-1c-local` and inspect the new `price_conflict`
   category's sanitized examples (`idNom`, `recordCount`,
   `differingFields` only — never raw values) for any pattern in *which*
   `ID_nom`s are affected (e.g. concentrated in one brand/category,
   correlated with `Sex`/`NomenclatureCategory*`, or evenly spread) that
   might narrow the hypothesis.

`price_conflict` remains its own classification tier, unchanged this
sprint — no silent resolution was added or proposed.

### 12A.6 — open questions for the user/employee

1. Is `VariativeNomenclature` scoped per-brand, or intended to be
   globally unique across the whole catalog? (Confirmation #3 says this
   is not yet verified — this is the concrete next question.)
2. Does a `pricevn.json` export ever legitimately carry the same `ID_nom`
   more than once by design (e.g. per-warehouse), the way `Barcode` does?
3. Is there any export metadata (timestamp, batch id) available outside
   the four JSON files already reviewed that could help order duplicate
   `pricevn.json` rows chronologically?

These three questions, plus the §12A.6-B schema-design decision (which of
the three barcode-modeling options to pursue) and the §12A.6-C
family-vs-individual matching redesign, are the concrete items this
sprint identifies as needing the user's/employee's further input before
any of them becomes implementation work.
