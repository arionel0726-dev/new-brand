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
