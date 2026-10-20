# VIZAJE-NICA V2 — Legacy Catalog Migration Report (Sprint 12, Phase A)

**Scope:** Real-data audit and dry-run only. No PostgreSQL writes, no Drizzle
migrations, no R2 uploads, no frontend changes. Phase B (controlled import)
is **not** executed by this sprint — see §11.

**Source file:** `docs/legacy-reference/vizaje_catalog_only.sql` (mysqldump
data-only export, 31 MB, 39 624 lines, UTF-8, no `CREATE TABLE` statements).
Column definitions were taken from `docs/legacy-reference/vizaje_nica_local.sql`
(schema-only reference dump), exactly as instructed. Every number below is
computed by actually parsing the real file — nothing here is estimated or
extrapolated. No full row, no customer data, and no secret ever appears in
this document; findings are counts, id lists, and short non-sensitive
excerpts only.

All code backing this report lives under `apps/api/src/import/`:
`parsers/mysql-dump.ts` (the tokenizer), `parsers/mysql-catalog.ts` (typed
table extraction), `audit/legacy-catalog-audit.ts` (Task 1 statistics),
`dry-run-catalog.ts` (Task 7 preview), `cli/catalog-dry-run.ts` (CLI
entrypoint: `bun run import:legacy:catalog-dry-run -- --file=<path>`).

---

## 1. Actual table counts

| Table | Rows (real, parsed) |
|---|---:|
| `products` | 6 999 |
| `products_variable` | 8 545 |
| `brands` | 94 |
| `categories` | 127 |
| `product_categories` | 7 696 |
| `products_img` | 7 290 |
| `products_variable_img` | 8 017 |
| `stores` | 15 |
| `stores_img` | 6 |
| `products_more` | 1 |
| `products_related` | not present in this dump (no `INSERT` for it) |
| `collections` | **0** — table exists in the schema reference but carries no rows in this export |
| `products_features` | **0** — same |

## 2. Data quality findings

### Products

| Finding | Count |
|---|---:|
| Published (`isShown=1`) | 6 884 |
| Hidden (`isShown=0`) | 115 |
| With ≥1 row in `products_variable` | 1 500 |
| Without any variant row (standalone) | 5 499 |
| With a non-null `titleRU` | 6 999 (100%) |
| With a non-null `titleRO` | 6 974 |
| With both RU and RO titles | 6 974 |
| With neither RU nor RO title | 0 |
| Assigned to more than one category (`product_categories`) | 718 |
| Without a brand (`brand_id` is `NULL` or `0`, the legacy default) | 1 |
| Without any category (no `product_categories` row and `category_id` is `NULL`/`0`) | 16 |
| Without any image (neither `products_img` nor `products_variable_img`) | 1 218 |
| With a missing/negative/non-numeric `price` | 0 |
| With a literal zero `price` | 159 |
| Referencing a `brand_id` not present among the 94 `brands` rows | 0 |
| Referencing a `category_id` or `product_categories.category_id` not present among the 127 `categories` rows | **33**, naming exactly two missing ids: `category_id=1` (17 references) and `category_id=56` (16 references) |

**Duplicate identifiers (products):**
- Duplicate `GUID` values: **14 groups**, covering 30 product rows (largest groups: `GUID=32491` shared by ids `10432,10433,10434`; `GUID=33584` shared by ids `10435,10436,10437`; the rest are 2-way duplicates).
- Duplicate `SKU` values: **128 groups**. The largest is SKU `1502artdeco` shared by 34 product rows — this is not noise; it is almost certainly a shared "line" article code reused across many individual legacy products, and is exactly the kind of case Task 3 forbids treating as a merge signal.
- Duplicate `uriRU` slugs: **1 group** — `gel-dlya-dusha-adidas-pure-game` shared by product ids `680` and `751`.
- Duplicate `uriRO` slugs: **0**.

### Variants (`products_variable`)

| Finding | Count |
|---|---:|
| Orphan variants (`product_id` matches no row in `products`) | **721**, across 68 distinct missing `product_id` values |
| — of which point at `product_id=1` specifically | 463 (see note below) |
| Duplicate `SKU` values (variant-level) | 1 group (`SKU="30"`, variant ids `1122,6691`) |
| Missing/negative/non-numeric `price` | 1 |

**Important artifact:** `product_id=1` does not exist anywhere in the
`products` table of this export, yet 463 of the 721 orphan variants, and
one broken category parent reference (`category_id=4` → `parent_id=1`),
and 17 of the 33 invalid category references all point at id `1`. This is
consistent with id `1` having been a real row (a placeholder/"uncategorized"
entry, by legacy convention) that was excluded from this particular
catalog-only export rather than genuine data corruption — but that is an
inference, not a confirmed fact, and Phase B must treat it as an open
question (see §9), not assume either explanation.

### Categories

- Hierarchy depth: **2 levels** below root (root → child → grandchild is the deepest chain found).
- Root categories (`parent_id=0`): **6**.
- Broken parent references (`parent_id` points at a `categories.id` that doesn't exist): **7** — `category_id 4→1`, `27→26`, `32→26`, `55→54`, `71→54`, `101→54`, `102→54`. Two distinct missing parents: `1` (see above) and `54`.
- Duplicate `GUID` values: **0**.
- Duplicate `uriRU`/`uriRO`: **0** for both.

### Media

- Orphan `products_img` rows (`product_id` matches no product): **551**, across 447 distinct missing product ids.
- Orphan `products_variable_img` rows (`variable_id` matches no variant, or `product_id` matches no product): **404**.
- No image filename in `products_img` is reused across more than one product (0 shared filenames found) — filenames appear to be per-product-unique, which is a mild positive signal for the planned manifest (see §7).

### Brands / Stores

- Brands: 94 rows, all with a non-empty `uri`; **0** duplicate `uri` values.
- Stores: 15 rows; 2 missing a `phone`; 0 missing `coords`; all 15 are shown (`isShown=1`).

### GUID / SKU identity shape (real evidence for §3)

- `products.GUID` is **always a plain numeric string** for all 6 999 rows (never alphanumeric, never null).
- `products.GUID` is **never equal to `products.id`** (the MySQL auto-increment primary key) for any of the 6 999 rows — confirming the existing Sprint 10A.1 field-ownership note ("`products.GUID` stores `ID_nom`") is consistent with the real data: `GUID` behaves like an externally-meaningful nomenclature identifier, not an internal row number.
- For a product with variants, its `GUID` matches the `SKU` of what is evidently its "primary" variant, and the sibling variants' own `SKU` values are adjacent numeric ids in the same family (e.g. product id 40: `GUID=7643`, variant SKUs `7643, 7644, 7645`). This is strong, real evidence that the legacy `GUID`/variant-`SKU` numeric values are the same identifier space the existing 1C importer calls `ID_nom` — but it is **not proof the two systems share literal id values** for the same physical item; that can only be confirmed once a real 1C export is cross-referenced against this MySQL export, which has not happened this sprint.
- `products.GUID === products.SKU` for 5 236 of 6 999 products (the rest have a human-readable SKU, e.g. `MISSXXX`, distinct from their numeric GUID).

### SEO slugs (`uriRU`)

- 6 580 of 6 999 products (94%) have a `uriRU` that is purely numeric (equal to the product's own `GUID`/id-shaped value) — i.e. **no real SEO-friendly slug was ever set**, only the legacy default. Only **419 products (6%)** carry a genuine word-based slug.
- Among those 419 real slugs, exactly 1 collision pair exists (noted above).

## 3. Legacy → V2 identity mapping strategy (Task 3)

Implemented in `apps/api/src/import/dry-run-catalog.ts`, reusing the
Sprint 10A `external_entity_mappings` table and `legacy_mysql` source-system
namespace (already part of the schema's allowlist — no schema change
needed):

- **Legacy MySQL `products.id` → never used as the external key.** It is the
  database's own auto-increment row number, not guaranteed stable across a
  re-export. The external key is `products.GUID` instead, confirmed above to
  be non-null and numeric for all 6 999 rows.
- **Legacy MySQL product → V2 product UUID:** `external_entity_mappings`
  row with `source_system='legacy_mysql'`, `entity_type='product'`,
  `external_id=<GUID>`.
- **Legacy MySQL variant (`products_variable.id`) → V2 variant UUID:**
  `source_system='legacy_mysql'`, `entity_type='product_variant'`,
  `external_id=<products_variable.id>`. A standalone product (no
  `products_variable` row) still needs exactly one V2 variant to carry
  price/inventory (V2's existing model requires this) — Phase B must mint
  that implicit variant's identity from the **product's own** GUID under
  `entity_type='product_variant'`, which is safe only because
  `entity_type` is part of the mapping's unique key, so it can never
  collide with a real `product_variant` mapping keyed by a
  `products_variable.id`.
- **Legacy GUID / 1C `ID_nom` → `nomenclature`/`nomenclature_group`:**
  untouched by this sprint — that mapping is owned by the existing 1C
  importer (`apps/api/src/import/normalize/products.ts`) and stays fully
  independent of the `legacy_mysql` namespace introduced here. The two
  namespaces are **never merged automatically**, even where their numeric
  values look related (see the GUID/SKU note in §2) — only an explicit,
  human-reviewed decision could link a `legacy_mysql/product` mapping and a
  `1c/nomenclature_group` mapping to the same internal UUID.
- **Legacy brand (`brands.id`) → V2 brand UUID:** `entity_type='brand'`,
  `external_id=<brands.GUID>` (not `brands.id`, for the same stability
  reason as products).
- **Legacy category (`categories.id`) → V2 category UUID:**
  `entity_type='category'`, `external_id=<categories.GUID>`.
- **Uniqueness was verified empirically, not assumed:** GUID is *not*
  globally unique (14 duplicate groups, §2) and SKU is *far* less unique
  (128 duplicate groups). The dry-run (`dry-run-catalog.ts`) treats every
  product whose GUID is shared with another product as a **conflict**,
  never silently importing the first one and dropping the rest — Phase B
  must resolve these 30 products by hand (or by finding a different,
  genuinely-unique legacy field) before they can be imported at all.
- **Never matched by title** anywhere in this pipeline — confirmed: no
  title/name comparison exists in `dry-run-catalog.ts`'s classification
  logic.

## 4. Variant migration rules (Task 4)

| Legacy shape | V2 target |
|---|---|
| Product with 0 `products_variable` rows | One V2 product + exactly one implicit V2 variant (see §3) |
| Product with ≥1 `products_variable` rows | One V2 product (parent) + one V2 variant per `products_variable` row |
| `products.isShown` / `products_variable.isShown` | Maps to V2 `products.status`/`product_variants.isActive` — **manual-visibility, website-owned** per the existing field-ownership policy (`policy/field-ownership.ts`'s `manualVisibility` entry); Phase B must not flip V2 visibility purely from this MySQL snapshot without an explicit decision, same as the existing 1C-feed policy. |
| `titleRU`/`titleRO` | Candidate V2 `name_ru`/`name_ro` — classified `titleRuRo: 'unresolved'` in the existing policy for the 1C feed; this sprint finds no reason to reclassify it for MySQL either, since the legacy importer's own documented behavior (unconditional overwrite on every run) is exactly the risk that policy entry exists to prevent. |
| `descRU`/`descRO`/`textRU`/`textRO` | Candidate V2 `description_ru`/`description_ro` — `curatedDescription: 'website'` per existing policy; preserved, never auto-overwritten. |
| `instructionRU`/`instructionRO`, `componentsRU`/`componentsRO` | Confirmed present in this real export (unlike the three JobVN/1C samples, where only the destination columns were confirmed) — still `ingredientsInstructions: 'unresolved'` per existing policy pending a store-owner decision. |
| SEO (`seoTitleRU/RO`, `seoDescRU/RO`) | Present for both RU and RO at the MySQL level (unlike the 1C JobVN feed, which the existing policy notes never carries an RO SEO field) — candidate source for V2 SEO metadata, still gated by the existing blank-value guard (`resolveFieldValue`) so a blank legacy value never erases a curated one. |
| `brand_id` (incl. the `0`-means-none convention) | Resolved via `external_entity_mappings` `legacy_mysql/brand`, never created implicitly from a bare id. |
| `category_id` **and** `product_categories` rows | V2 primary category = `products.category_id` (when valid); all `product_categories` rows become V2 `product_categories` many-to-many rows, which already match the legacy junction table structurally 1:1. The 33 invalid category references (§2) must be resolved or dropped explicitly before Phase B, never silently imported as a dangling reference. |
| `SKU` | Candidate V2 `product_variants.sku` (variant-level) or informational product-level field — **not** globally unique (128 duplicate groups), so it cannot be the primary identity (§3 already uses GUID for that); Phase B needs an explicit per-row disambiguation rule for the 128 duplicate-SKU groups before any variant-level SKU can be written as V2's own `sku` column (which **is** unique in V2's schema — see §9, blocker 2). |
| `barcode` | Direct candidate for V2 `product_variants.barcode` — confirmed nullable, no uniqueness constraint in legacy (matches the existing policy note), so Phase B must deduplicate before relying on V2's own unique barcode index. |
| `GUID` | The external identity key (§3), never written into any V2 display field. |
| `price` / `discount_price` / `priceWH` | **Historical snapshot only**, per Sprint 12's explicit instruction — this report parses and validates them (0 missing/invalid at product level, 159 legitimate zero prices, 1 invalid variant price) purely for data-quality purposes. They are **not** treated as live, authoritative stock/price data; ongoing synchronization is a future 1C-feed concern (already partially designed in Sprint 10A/10A.1), explicitly out of scope here. |
| `stock` / `on_stock` / `qty` / `qtyWH` | Same snapshot-only treatment as price. |

## 5. Field ownership

No change to `apps/api/src/import/policy/field-ownership.ts` was made this
sprint — every classification already there (`feed`/`website`/`unresolved`)
is reused as-is for the `legacy_mysql` source too, since the underlying
policy question (who should win: the import, or a human curator?) is the
same regardless of which system supplied the import. §4 above cross-checks
each legacy MySQL field against that existing table rather than inventing a
parallel one.

## 6. Media manifest statistics (Task 5)

No file was uploaded to R2, and no claim is made that any image file
physically exists on disk (the `public` media directory is explicitly
still being downloaded, per the sprint brief). The manifest this dry-run
can produce today is purely referential:

- 7 290 `products_img` rows describe product-level images; **551 of them
  (7.6%) reference a `product_id` with no matching product row** and must
  be either resolved or dropped, not migrated blindly.
- 8 017 `products_variable_img` rows describe variant-level images; **404
  of them (5.0%) reference a `variable_id` with no matching variant** (or a
  `product_id` that doesn't resolve).
- Both tables carry `img` (filename), `sorder` (display order), and
  `isShown` (visibility) — all three map directly onto V2's existing
  `product_images.sortOrder`/implicit primary-image-by-order convention and
  a visibility flag; no legacy field is lost in that mapping.
- Legacy has **no explicit "primary image" boolean** — primariness is
  implied by `sorder=0` (lowest sort order) exactly like V2's own
  `product_images.sortOrder` convention, so no new V2 field is needed for
  this.
- No product image filename is reused across more than one product (0
  collisions found), which means a future download step can safely use
  `filename` as a weak secondary check, though it must never be the only
  identity signal (filenames are legacy-local paths, not content hashes).
- **1 218 products (17%) have no image at all** (product-level or
  variant-level) — these would publish with no photo if visibility were
  ever flipped on without human review.

## 7. SEO URL preservation (Task 6)

No live URL was changed and no redirect was created, per the sprint
restriction. This dry-run only *previews* the mapping:

- Confirmed legacy pattern (per `docs/vizaje-migration-architecture.md`):
  `/{lang}/{catalog-uri}/{category-uri}/{product-uri}` for products,
  `/{lang}/{catalog-uri}/{brand.uri}` for brands (brand URI shared across
  languages; product/category URIs are language-specific).
- Of 6 999 products, only **419 (6%) carry a real, non-numeric `uriRU`**;
  the remaining 94% never had a curated slug and show the legacy numeric-id
  fallback instead. Phase B's canonical-URL strategy must therefore default
  to **generating** a V2 slug for the overwhelming majority of products
  (from `titleRU`, following V2's existing slug-generation convention),
  while the 419 products with a genuine legacy slug should **preserve**
  that exact string rather than regenerate it, to avoid breaking any
  existing inbound links/SEO equity those specific pages may already have.
- Exactly **1 real slug collision** exists today (`gel-dlya-dusha-adidas-pure-game`,
  products 680 and 751) — Phase B must disambiguate this pair (e.g.
  appending a GUID-based suffix to one) before both can get a V2 slug.
- Category and brand `uri` values have **zero** duplicates, so no
  collision handling is needed for those two entity types.
- This report deliberately does **not** fabricate or claim a canonical
  production URL for any mock or legacy record — the above is a strategy
  and statistics only, not a committed URL list.

## 8. Dry-run results (Task 7)

Run against the real file via
`bun run import:legacy:catalog-dry-run -- --file=docs/legacy-reference/vizaje_catalog_only.sql`
(no database connection — every product is therefore evaluated as if no
`legacy_mysql` mapping exists yet, which is true today):

| Outcome | Count |
|---|---:|
| Total legacy products evaluated | 6 999 |
| Would create (no existing mapping, no blocking conflict) | 6 936 |
| Would update (existing `legacy_mysql/product` mapping found) | 0 (none exist yet — expected, since no MySQL import has ever run) |
| Conflicts | **63** — exactly the union of the 30 products in duplicate-GUID groups and the 33 products with an invalid brand/category reference (no double-counting; both conditions never co-occur in this data) |
| External ID (GUID) collisions | 14 groups / 30 products (§2) |
| Missing media (no image at all) | 1 218 products (§6) |
| SEO slug collisions | 1 pair (§7) |

Re-running the dry-run against an unchanged file and an unchanged (empty)
mapping table reproduces identical create/update/conflict counts — verified
both by direct re-run and by the automated idempotency test (§10).

**Zero-write guarantee:** verified both by code inspection (the only
database call in `dry-run-catalog.ts` is the existing read-only
`findMapping` helper from Sprint 10A) and by an automated test
(`tests/import-dry-run-catalog.test.ts`) that runs the dry-run twice —
once with a live database connection, once without — and then asserts
`products`, `product_variants`, and `external_entity_mappings` are all
still empty afterward.

## 9. Unresolved records

- **63 products cannot be auto-classified as a plain "create"** today: 30
  are entangled in duplicate-GUID groups (identity ambiguous — §2/§3), 33
  reference a brand/category id absent from this export (§2). Both sets
  need a human decision before Phase B can touch them.
- **721 orphan `products_variable` rows** (68 distinct missing
  `product_id` values, 463 of them pointing at the single id `1`) have no
  parent to attach to in this export.
- **7 broken category parent references**, resolving to two missing
  parent ids (`1` and `54`).
- **955 orphan media rows** (551 product-level + 404 variant-level) have
  no valid owner in this export.
- **128 duplicate product SKU groups** and **1 duplicate variant SKU
  group** need an explicit disambiguation rule before any legacy SKU can
  populate V2's own unique `product_variants.sku` column.
- Whether the "missing id `1`" pattern (§2) reflects a genuinely deleted
  legacy row, or an artifact of how this particular catalog-only export
  was produced (e.g. a system/placeholder row deliberately excluded), is
  **not determined by this sprint** — Phase B needs either a second,
  complete MySQL export to cross-check against, or an explicit answer from
  whoever produced `vizaje_catalog_only.sql`.

## 10. Required V2 schema changes (Task 2)

**None required to proceed with Phase B as scoped.** The existing schema
already accommodates every field this report classifies as migratable:
`products`/`product_variants`/`product_prices`/`inventory`/`product_images`/
`product_categories`/`brands`/`categories`/`external_entity_mappings`
already carry RU/RO name & description pairs, a unique `sku`, a nullable
unique `barcode`, `sortOrder` on images, and the exact
`(source_system, entity_type, external_id)` mapping shape this report's
identity strategy needs — no new column and no new table were added this
sprint, and `drizzle-kit generate` against the current schema confirms
"No schema changes, nothing to migrate."

Two **non-blocking but real** gaps to flag for Phase B's design (not
implemented here, per the Phase A restriction on new migrations):

1. V2's `product_variants.sku` is `NOT NULL UNIQUE` — legacy's 128
   duplicate-SKU groups (§2) cannot be imported as-is into that column
   without a disambiguation rule (e.g. suffixing with the legacy row id).
   This is a Phase B **data transformation** concern, not a schema gap.
2. V2 has no field dedicated to "this slug came from the legacy export and
   must be preserved verbatim" vs. "this slug was generated fresh" — Phase
   B may want such a flag (even just informally, in the import run's own
   audit trail via `import_record_issues`) to make the distinction
   auditable later, per §7's mixed preserve/generate strategy. This is a
   process note, not a required schema migration.

## 11. Phase B execution plan (planning only — not started)

Unchanged from the sprint brief's own ordering, now informed by real
numbers:

1. Isolated PostgreSQL database (never production).
2. Apply existing migrations (none new needed per §10).
3. Import 94 brands, then 127 categories (resolving the 7 broken parent
   references and the 2 missing-parent ids first).
4. Import parent products: 6 936 as plain creates, with the 63 conflicted
   products explicitly deferred for manual review rather than silently
   skipped or silently forced through.
5. Import 8 545 variants for the 1 500 variant-bearing products, plus one
   implicit variant for each of the 5 499 standalone products, applying
   the SKU-uniqueness transformation from §10.
6. Import 7 696 `product_categories` associations, excluding the 33 rows
   that reference a missing category until that's resolved.
7. Import SEO/description fields per the field-ownership policy (§5),
   applying the preserve-vs-generate slug strategy from §7.
8. Record historical media references for all valid `products_img`/
   `products_variable_img` rows (7 290 + 8 017 minus the 955 orphans) —
   still no file upload, since the actual image files are not available
   yet.
9. Create `external_entity_mappings` rows for every successfully-imported
   product/variant/brand/category under `source_system='legacy_mysql'`,
   transactionally with the entity write (Sprint 10A's existing
   `resolveOrCreateMapping` pattern).
10. Validate counts: expect 6 936 products minus however many of the 63
    conflicts get resolved by then, cross-checked against
    `external_entity_mappings` row counts per entity type.
11. Idempotency test: re-run the same import against the same isolated
    database and confirm zero new rows are created the second time.
12. Produce a reconciliation report (planned vs. actual counts) and a
    rollback plan (see §12) before touching any shared/staging database.

**Phase B requires explicit approval and is not started by this report.**

## 12. Rollback strategy

- Phase A touches no catalog table, so there is nothing to roll back from
  this sprint's own work.
- For Phase B (when approved): run entirely inside a disposable, isolated
  PostgreSQL instance first (per §11 step 1). Every entity Phase B creates
  gets a corresponding `external_entity_mappings` row in the same
  transaction as the entity write (the existing Sprint 10A pattern already
  guarantees this), so a rollback can delete exactly the rows whose
  `legacy_mysql` mapping was created by a specific `import_runs` id — never
  a blanket `DELETE FROM products`, which could remove unrelated,
  non-legacy-sourced catalog data.
- Because every Phase B write is wrapped in the existing transactional
  mapping-resolution pattern, a mid-import failure on a single product
  never leaves a partially-written product/variant/price/inventory row set
  without its mapping (or vice versa) — the existing `createImportRun`/
  `completeImportRun`/`failImportRun` audit trail (Sprint 10A) already
  gives Phase B a per-run undo boundary for free, reused rather than
  rebuilt.
- No rollback plan in this report assumes production PostgreSQL is ever
  touched before a separate, explicit approval for that specific step.

---

## Tests (Task 9)

Synthetic fixtures only — no row from `vizaje_catalog_only.sql` is copied
into any test file.

- `apps/api/tests/import-mysql-dump-parser.test.ts` — 13 tests: multi-row
  and multiline `INSERT`s, backslash-escaped quotes, literal commas/
  parens/semicolons inside quoted strings, raw embedded newlines, Cyrillic
  Unicode, numeric/negative literals, multiple statements for one table,
  ignoring other tables, malformed-input error handling, empty-string vs
  `NULL`, escaped backslashes.
- `apps/api/tests/import-legacy-catalog-audit.test.ts` — 14 tests:
  published/hidden, with/without variants, orphan variants, duplicate
  GUIDs/SKUs, invalid brand references, the `brand_id=0` convention,
  category hierarchy depth, broken parent references, RU/RO field
  counting, invalid vs. zero price, orphan product/variant images,
  determinism across repeated runs.
- `apps/api/tests/import-dry-run-catalog.test.ts` — 9 tests: zero-write
  guarantee (with and without a live DB connection), no writes to
  `external_entity_mappings`, create-vs-update classification against a
  real mapping row, idempotency across repeated runs, external-ID
  collision reporting, SEO slug collision reporting, numeric-fallback
  slugs correctly excluded from both "real slug" and "collision" counts.

## Verification results

| Check | Result |
|---|---|
| TypeScript typecheck (`bunx tsc --noEmit`, `apps/api`) | **Clean**, 0 errors |
| Migration drift (`bunx drizzle-kit generate`) | **"No schema changes, nothing to migrate"** |
| Full Bun test suite (`bun test`, `apps/api`) | **352 pass, 0 fail, 15 skip** (367 total, 889 assertions) — the 15 skips and the Meilisearch connection-refused log lines are pre-existing and unrelated to this sprint (no local Meilisearch instance running in this environment; the admin write paths already degrade to best-effort per Sprint 2/4A design) |
| Real dry-run (`bun run import:legacy:catalog-dry-run -- --file=docs/legacy-reference/vizaje_catalog_only.sql`) | Ran to completion against the full 6 999-product file; see §8 for results |

No real catalog row was imported into PostgreSQL, no new migration was
applied, no file was uploaded to R2, and `apps/web`'s mock data was not
touched, per the Phase A restrictions.

## 13. Sprint 12A.2 — Migration Conflict Resolution

Forensic follow-up on §2/§9's open findings, run against the real
`vizaje_catalog_only.sql` via `apps/api/src/import/dry-run-catalog.ts`'s new
quarantine model (§13.6). Every number below is computed, not estimated.
Phase B remains unauthorized and unimplemented; nothing here writes to
PostgreSQL, applies a migration, or modifies any legacy source file.

### 13.1 The 14 duplicate-GUID groups — classified

All 14 groups share the same signature: identical `brand_id`/`category_id`,
near-identical `titleRU`, the **same `created_at` down to the second**
across every member, and — the strongest signal — the legacy system's own
`uriRU` collision-handling: the first member keeps the bare GUID as its
slug, every other member gets `<GUID>-<id>` appended. That suffixing
behavior is the legacy application itself detecting and reacting to the
collision at write time, not an artifact of this audit.

**Classification: all 14 groups are duplicate catalog entries (the same
product created more than once), not legitimate separate variants, not
corrupted GUIDs, and not a coincidental collision between unrelated
products.** Within several groups one member carries real
`product_variable` rows (and sometimes `updated_at`) while its duplicate(s)
carry none — e.g. GUID `103065` (ids 10486/10487): 10486 has 4 variants and
an `updated_at`, 10487 has 0 variants and no `updated_at`. That member is
the better candidate for "the real one," but nothing is merged or discarded
here — this is read-only classification, per the task's own restriction.

Two groups (`30369`, `36178`) additionally share a broken `price=1`
placeholder across both members — a second, independent data-quality signal
on the same rows, not evidence against the duplicate classification.

No group in this export showed GUID reuse across genuinely unrelated
products (different brand/category/title) — the "erroneous/malformed GUID"
and "distinct records that happen to collide" hypotheses from the task
brief are not supported by the data actually present.

### 13.2 The 33 invalid-category-reference products — resolved where possible

`products.category_id` is broken for all 33 (pointing at category id `1` or
`56`, neither of which exists in this export — see §13.5 on exactly which
ids are missing where). Checking `product_categories` for each of the 33:

- **30 of 33 have a valid secondary category** via `product_categories` —
  `products.category_id` is simply wrong/stale, but the product is already
  correctly linked to a real category through the join table. These are
  tagged `invalid_category_reference_resolvable_via_secondary` by the new
  dry-run quarantine model; migrating them by preferring the
  `product_categories` link over the broken `category_id` column is a
  mechanical, low-risk fix for Phase B, but is not applied here.
- **3 of 33 (ids `1455`, `6519`, `7698`) have no valid category anywhere** —
  zero `product_categories` rows at all. These are tagged
  `invalid_category_reference_unresolvable` and **genuinely need a human
  decision** (assign a category manually, or import as uncategorized if V2
  permits that). No category was invented to patch this, and none of the 33
  products were dropped from consideration — all 33 are visible in the
  dry-run's quarantine output with their specific sub-reason.

### 13.3 The 128 duplicate-SKU groups — schema check and design

**V2's `product_variants.sku` has a hard database-level `unique()`
constraint** (`apps/api/src/db/schema/product-variants.ts`) — confirmed by
reading the schema file, not assumed. The current schema **cannot** store a
colliding legacy SKU verbatim as the primary `sku` value for more than one
variant.

Inspecting the actual duplicate groups surfaced a more specific, more
useful finding than "128 unrelated SKU collisions": **most of the largest
groups are legacy shade/variant families that were imported as separate
standalone `products` rows instead of `products_variable` rows, all sharing
one literal group-code string as their `SKU` value** — e.g. SKU `"A10.XXX"`
(9 products, all "ANNY Nail Polish" shade variants — the same group-code
syntax as the confirmed-real 1C `VariativeNomenclature` value from Sprint
10A.1's ANNY fixture), `"A8.XXX.XX"` (6 products), `"a.10.150xxan"` (6
products), `"1502artdeco"` (34 products, ARTDECO lipstick/lip-shine
shades), `"417xx"` (22 products, Eugene Perma haircare line), `"KISSLIQUID"`
(8 products, MAC lipstick shades). These are not SKU typos; they are
products that should have been modeled as **one V2 parent product with
multiple real variants**, mirroring exactly the 1C-side variant-grouping
pattern this project already handles for the `1c` source.

**Proposed design (documented only, not implemented — this is schema
analysis, not a migration):**

1. For group-code-shaped duplicate SKUs (matching the observed
   `<letter><digits>.XXX`-style pattern), treat the group as a single V2
   product with N variants during Phase B, exactly as the 1C
   `VariativeNomenclature` grouping already works. This resolves the
   uniqueness problem structurally rather than papering over it.
2. For the remaining, genuinely flat SKU collisions (not group-code
   shaped), V2 needs a **synthetic/internal SKU** generated at import time
   to satisfy `product_variants.sku`'s uniqueness constraint, with the
   **original legacy SKU preserved verbatim** — either as the
   `external_entity_mappings.external_id` for a `product_variant`/`product`
   mapping (if SKU, not GUID, is used as that record's external identity)
   or, if GUID remains the external identity as recommended in §3, in a
   dedicated nullable `legacy_sku` column added to `product_variants` in a
   future migration. No such column exists today and none was added this
   sprint.
3. Whichever path is chosen, the original SKU must never be silently
   dropped — both because it has real operational value (physical labels,
   supplier references) and because Task 3's restriction against losing
   identity-bearing data applies here too.

### 13.4 The 721 orphan variants — cross-referenced, not fabricated

`product_id=1` is referenced by **463 of the 721** orphans — a single,
suspiciously round value, concentrated enough to suggest an application-
level default/fallback rather than 463 independent deletions of the same
row. The remaining **258 orphans spread across 67 other distinct missing
`product_id` values**, each with a small count (2–14), which looks more
consistent with genuinely deleted parent products. **This cannot be proven
either way from a static MySQL export alone — both explanations stay open,
and the `product_id=1` concentration is reported as an unresolved anomaly,
not asserted as fact.**

Cross-referencing orphans against real products by barcode or SKU (the only
two identity-adjacent fields a `products_variable` row carries besides the
broken `product_id`) recovers a possible reattachment target for **137 of
721 (19%)** — 126 by barcode match, 97 by SKU match, with overlap. The new
dry-run's quarantine output surfaces `possibleReattachProductId` for each
such case *only when the match is unambiguous* (exactly one candidate
product); ambiguous or absent matches are left unset rather than guessed.
Checking for a `WarehouseName` group-code prefix (the same `A10.XXX`-style
pattern as §13.3) as an alternative grouping signal recovers only 40/721 —
not a materially better path than barcode/SKU matching.

**The majority — 584 of 721 (81%) — cannot be reattached to any present
product by any signal available in this export.** No orphan data was
deleted, and no placeholder `product_id=1` product was fabricated to
satisfy the foreign key; the anomaly stays flagged in the dry-run's
`quarantinedVariants` output for a human to resolve (most plausibly against
a future 1C cross-reference, per the task's own suggestion, since no 1C
identifier is actually embedded in `products_variable` itself to check
here).

### 13.5 SEO slug origin — re-investigated

Of 6 999 products, **6 580 have `uriRU` set to literally the numeric
product id** (never `NULL`, never empty — `nullUri`/`emptyUri` are both 0);
**419 have a real, non-numeric slug.**

- **All 419 real-slug products are published** (`isShown=1`); none of the
  115 hidden products have a real slug. This alone doesn't fully explain
  the gap, since only 115 of the 6 580 numeric-slug products are hidden —
  the other 6 465 numeric-slug products are published too.
- **No `created_at` boundary explains it** — real-slug and numeric-slug
  products' `created_at` ranges overlap almost entirely.
- **Brand concentration is the real pattern**: real slugs exist for
  products from only **20 of 94 brands**, and the top 5 brands alone
  account for ~81% of all 419 (104 + 99 + 62 + 48 + 27 = 340). Product id
  range also doesn't cleanly separate the two groups (real-slug ids span
  8–10 957; numeric-slug ids span 2–11 179).

**Honest conclusion: there is no clean technical rule (date, publish state,
or id range) behind the 419/6 999 split. The pattern is consistent with a
one-off, brand-by-brand editorial effort to hand-curate SEO slugs for a
handful of priority brands, never extended to the rest of the catalog —**
i.e., legacy data-entry inconsistency, not a bug to "fix" during migration.
This matches §7's existing preserve-vs-generate strategy: the 419 real
slugs should be preserved as-is, and the 6 580 numeric-fallback products
need a slug-generation decision in Phase B, not a search for a hidden rule
that doesn't exist.

### 13.6 Dry-run quarantine model

`apps/api/src/import/dry-run-catalog.ts` was extended to replace the flat
`conflicts` bucket with a structured quarantine model
(`CatalogDryRunAction` is now `'create' | 'update' | 'quarantine'`). Every
quarantined product carries one or more `QuarantineReasonCode` values
(`duplicate_guid`, `invalid_brand_reference`,
`invalid_category_reference_resolvable_via_secondary`,
`invalid_category_reference_unresolvable`, `duplicate_sku`) — a product can
carry more than one at once, and none is ever auto-resolved. Orphan
`products_variable` rows get their own `quarantinedVariants` list
(`orphan_variant`, with an optional unambiguous `possibleReattachProductId`
per §13.4). `CatalogDryRunSummary.quarantine` aggregates counts per reason
code plus up to 3 sanitized, non-sensitive illustrative examples per code
(legacy id and a short note only — never a full row, price, or free-text
field).

Real run against `vizaje_catalog_only.sql` (zero database writes):

| Metric | Count |
|---|---|
| Total legacy products | 6 999 |
| Would create (clean) | **6 596** |
| Would update | 0 (no `--use-db` flag; no prior mappings exist yet regardless) |
| Products quarantined | **403** |
| — `duplicate_guid` | 30 |
| — `invalid_brand_reference` | 0 |
| — `invalid_category_reference_resolvable_via_secondary` | 30 |
| — `invalid_category_reference_unresolvable` | 3 |
| — `duplicate_sku` | 376 |
| Variants quarantined (`orphan_variant`) | 721 |

(403 quarantined products + 6 596 clean = 6 999, confirmed. The per-reason
counts sum to more than 403 because a product can carry multiple reason
codes at once — e.g. several of the 14 GUID-duplicate groups' members also
appear in a SKU-duplicate group.) `duplicate_sku` jumped from the 128 group
count to 376 *products* because a group's size is its member count, not 1 —
the 34-member `"1502artdeco"` group alone contributes 34 to that total.

### 13.7 Is the 6 936→6 596 clean subset safe for a test import?

**Partial — not a plain yes.** The quarantine model above already moved 340
products out of Phase A's original 6 936 "would-create" figure (the 128 SKU-
duplicate groups weren't excluded from that original number; they are now).
What remains — **6 596 products** — is clean with respect to identity
(GUID), reference integrity (brand/category), and the SKU-duplicate
transformation decided in §13.3. It is **not** fully clean end to end:

- **1 176 of the 6 936 pre-quarantine would-create products (≈17%) have
  zero images** — real, not an artifact of quarantine; a test import would
  need to tolerate imageless products (consistent with §6: no physical
  media files are available to upload yet regardless).
- **6 911 of 6 936 have both RU and RO titles; 25 are missing RO** — a
  minor localization gap, not a blocker, but worth flagging rather than
  assuming full bilingual coverage.
- No variant-level SKU collision exists within the clean subset (checked
  directly: 0 groups), and no clean-subset product is itself the target of
  an orphan variant's broken `product_id` (checked directly: 0 — the
  orphans' missing `product_id` values never collide with a real, present
  product id).

**Conclusion: the post-quarantine 6 596-product subset is safe to use as
the basis for a future controlled *test* import (Phase B, once approved) —
its identifiers, localizations, categories, and relationships are
internally consistent — provided the import tooling is built to tolerate
missing images and the occasional missing RO title rather than treating
either as a hard failure.** The 403 quarantined products and 721 orphan
variants remain explicitly out of scope for that first test import until
the decisions in §13.1–§13.4 are made by a human.

### 13.8 Verification (Sprint 12A.2)

| Check | Result |
|---|---|
| TypeScript typecheck (`bunx tsc --noEmit`, `apps/api`) | **Clean**, 0 errors |
| Migration drift (`bunx drizzle-kit generate`) | **"No schema changes, nothing to migrate"** — no Drizzle schema was touched this round |
| Full Bun test suite (`bun test`, `apps/api`) | **364 pass, 0 fail, 15 skip** (379 total) — the 15 skips are the same pre-existing Meilisearch-unavailable skips from Phase A, unrelated to this work |
| Real dry-run (`bun run import:legacy:catalog-dry-run -- --file=../../docs/legacy-reference/vizaje_catalog_only.sql`) | Ran to completion against the full 6 999-product file; quarantine totals match §13.6; zero rows written to any catalog table |
| `apps/api/tests/import-dry-run-catalog.test.ts` | Extended from 9 to 20 tests — new coverage for each `QuarantineReasonCode`, multi-reason products, example-list capping, orphan-variant quarantine (including ambiguous/unmatched reattachment), and the zero-write guarantee with orphan variants present |

No real catalog row was imported into PostgreSQL, no new Drizzle migration
was applied, no file was uploaded to R2, no legacy source file was modified,
and `apps/web`'s mock data was not touched, per Sprint 12A.2's restrictions.
Phase B was not started.
