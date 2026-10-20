# VIZAJE-NICA V2 Migration Architecture

Sprint 10A, verified and corrected in **Sprint 10A.1** against the real
legacy sources. This document describes the legacy-migration foundation:
external identity mapping, import-run tracking, record-level diagnostics,
feed parsers, product/variant normalization, a field-ownership policy, and
a dry-run CLI. **No real catalog data has been imported.** Task 9 of
Sprint 10A (a controlled, real import path) was explicitly not implemented
- see "Blockers" below, now updated for Sprint 10A.1.

Every claim in this document is labeled as either a **confirmed fact**
(directly observed in the real legacy sources, listed below, or in this
repository's own code) or an **assumption** (inferred, recommended, or a
placeholder pending further data). Nothing here is invented from a legacy
schema this project hasn't seen. Section 15 ("Sprint 10A.1 — Verification
Against Real Legacy Sources") is the authoritative, corrected account;
earlier sections are kept for history but should be read through that
section's corrections where the two disagree.

## 1. Source inventory

Three source documents were named in the Sprint 10A prompt:

1. `vizaje_nica_local.sql`
2. `legacy-feed-samples.json`
3. `workapp-1c-observed-contract.md`

**Sprint 10A: none of the three were present.** This session searched the
repository working directory, the home directory, and the upload/
attachment directories (`/mnt/user-data/uploads`, `/mnt/attach`) and found
nothing matching. Every parser, schema shape, and field name in Sections
2-14 below that relates to the legacy system was built **only** from the
"Confirmed legacy findings" given verbatim in the Sprint 10A prompt text -
never from inspecting the actual files.

**Sprint 10A.1: all three were supplied**, plus a fourth document,
`vizaje-legacy-discovery.md` (a prior code-level audit of the legacy
CodeIgniter 3 application). Sanitized copies of all four are preserved at
`docs/legacy-reference/` (schema-only SQL export, no production data; the
other three already redact secrets/PII at the source). See Section 15 for
what each one actually confirms or corrects.

### Confirmed legacy findings (as given, not independently verified)

- `products.id`: local MySQL integer ID
- `products.GUID`: identifier populated from 1C `ID_nom`
- `products.SKU`: legacy product SKU
- `products_variable.id`: legacy variant ID
- `products_variable.product_id`: parent product
- `products_variable.SKU`: variant matching key
- `product_categories`: many-to-many category association
- `products_img` / `products_variable_img`: product/variant images
- 1C feed fields: `ID_nom`, `VariativeNomenclature`, `VariativeName`,
  `Barcode`, `ColorVar`, `VolumeVar`, `Price`, `PriceWH`, `DiscountPrice`
  (said to appear in `pricevn.json`), `QuantityBalance`, `WarehouseName`
  (explicitly: do not interpret as a physical location without
  confirmation)
- An observed group: `VariativeNomenclature = A10.XXX` with members
  `ID_nom` 10568, 10516, 10559 - used directly as this sprint's synthetic
  test fixture (see `tests/import-normalize.test.ts`,
  `tests/import-dry-run.test.ts`)
- Explicit warning: legacy GUID, SKU, and phone indexes are **not**
  guaranteed unique by the local SQL schema
- Explicit warning: the local SQL is a schema export, not a verified full
  production dataset

Nothing else about the legacy schema or feeds is confirmed. In particular:
no SEO feed field names, no category/brand table structure, no stock-feed
shape, and no RU/RO translation field names were ever given or inspected.

## 2. Mapping design (Task 2)

`external_entity_mappings` (migration `0012`) is the only place a legacy or
1C identifier is ever recorded. V2's own catalog tables
(`products`, `product_variants`, `brands`, `categories`, ...) gain **no**
inline `external_id` column - this supersedes the inline-column suggestion
in Sprint 9's `docs/legacy-migration-readiness.md`, which predates this
sprint's explicit mapping-table design.

Columns: `id`, `source_system` (enum: `legacy_mysql`, `1c`), `entity_type`
(enum: `product`, `product_variant`, `brand`, `category`, `nomenclature`,
`nomenclature_group`), `external_id` (text, trimmed, non-empty, enforced by
a check constraint), `internal_id` (uuid, **not** a typed foreign key -
`entity_type` decides which table it belongs to; referential integrity for
it is enforced in application code, not the database, since one column
cannot point at six different tables).

**Unique constraint:** `(source_system, entity_type, external_id)` - the
one hard guarantee the database itself enforces.

**Why `nomenclature` and `nomenclature_group` are separate entity types
from `product`/`product_variant`:** per the confirmed findings, an
individual 1C `ID_nom` record is expected to become a V2 `product_variant`
(when grouped) or a standalone product (when not), while a 1C
`VariativeNomenclature` group value becomes the V2 parent `product`. These
are conceptually distinct identity spaces from a legacy MySQL
`products.id`/`products_variable.id`, even where the numeric values might
coincide - `legacy_mysql/product/4582` and `1c/nomenclature/10568` are
never merged just because digits match, exactly as the sprint's
architectural principles require. This is enforced structurally (distinct
enum values go into the unique key) and is covered by
`tests/import-mappings.test.ts`'s "independent namespaces" test.

**Conflict protection:** `resolveOrCreateMapping` (src/import/mappings.ts)
is the only function that ever creates a mapping row. It is idempotent
(the exact same external id → internal id pair resolves to `'existing'` on
a repeat call) and distinguishes two kinds of conflict without silently
resolving either:

- `external_id_points_elsewhere` - the same `(source_system, entity_type,
  external_id)` already maps to a *different* internal entity. Per the
  sprint's explicit warning that legacy GUID/SKU uniqueness is not
  guaranteed, this is expected to happen in real data and is surfaced, not
  thrown away.
- `internal_id_has_other_external_id` - this internal entity already has a
  *different* external id under the same source/entity type. Not
  necessarily wrong (a legitimate SKU change is plausible) but never
  silently creates a second identity without the caller deciding.

A concurrent-creation race (two processes resolving the same external id
at once) is closed by a `SELECT ... FOR UPDATE` plus a catch-and-re-resolve
around the database's own unique-constraint violation - see
`tests/import-mappings.test.ts`'s "concurrent mapping creation" test, which
exercises this with two real, concurrently-committing Postgres
transactions (not a mock).

## 3. ID strategy

- PostgreSQL UUIDs remain the only primary internal identifier (confirmed
  principle, unchanged from Sprints 1-9).
- Every legacy/1C identifier is text in `external_entity_mappings`,
  trimmed and validated non-empty, never reinterpreted as a different type
  (an id is never treated as a number for arithmetic purposes anywhere in
  this subsystem).
- `src/import/parsers/shared.ts`'s `externalIdSchema` accepts a JSON string
  or number but requires it to look like a plain non-negative whole number
  (no decimal point, no scientific notation) - a float-shaped id (e.g.
  `10568.0`) is rejected rather than silently truncated, since silently
  truncating an identifier is more dangerous than refusing it outright.

## 4. Variant grouping (Task 6)

`src/import/normalize/products.ts` groups parsed products-feed records by
`VariativeNomenclature`, namespaced as `${sourceSystem}:${value}` (e.g.
`1c:A10.XXX`) purely as an in-memory collision guard across batches/sources
during normalization - the database-level namespacing is already provided
by `external_entity_mappings`'s compound unique key, which uses the *raw*
group value plus a separate `source_system` column.

A record with no `VariativeNomenclature` becomes a standalone candidate
with exactly one variant.

**Grouping is never heuristic.** There is no name-similarity matching, no
SKU-prefix guessing - only the explicit group identifier decides
membership, which is what "avoid accidental merging of unrelated products"
(Task 6) requires structurally rather than by convention.

**Inconsistent group membership is detected, not resolved:** if two
records share a `VariativeNomenclature` but disagree on `VariativeName`,
the candidate is still produced (for reporting) but marked
`publishable: false` with an `ambiguous_variant_parent` issue.

**A significant, honestly-reported limitation:** per the confirmed legacy
findings, the products feed carries `VariativeName` (a *group* name) but no
field that names an individual product or variant. This means:

- A standalone (ungrouped) record has **no name source at all** in this
  feed.
- Even a grouped candidate's *parent product* gets a name (from
  `VariativeName`), but no per-variant name/description is available from
  this feed either.

Rather than fabricating one, every candidate this sprint's normalization
layer cannot name is returned with `publishable: false` and a
`missing_required_field` issue. In the current confirmed data, that means
**every standalone candidate is blocked**, unconditionally, until a real
name source is identified (most likely the legacy MySQL `products` table,
not yet inspected). This is intentional, not a bug - see Section 6, "RU/RO
titles."

## 5. Field ownership (Task 7)

`src/import/policy/field-ownership.ts` holds one declarative table
(`PRODUCT_FIELD_OWNERSHIP_POLICY`) and one function
(`resolveFieldValue`) that every future importer must call before writing
any field sourced from a feed. Changing a field's classification is a
one-line edit to the table; nothing about *how* ownership is enforced
should ever need to change alongside it.

| Field | Owner | Confidence |
|---|---|---|
| External nomenclature identity | feed | Recommended - the feed is definitionally authoritative for its own ids. |
| Base product/variant price | feed | Recommended, but **out of scope for any writes this sprint** regardless (Task 9 restrictions forbid importing production prices). |
| Stock snapshot | feed | Recommended, also out of scope for writes this sprint. |
| Barcode | feed | Recommended. |
| 1C-derived nomenclature metadata (color/volume) | feed | Recommended. |
| Product images | website | Recommended - curated through the existing admin media/R2 pipeline, never overwritten by an import. |
| Curated descriptions | website | Recommended. |
| Custom SEO metadata | website | Recommended, but see the open JobVN-feed question below. |
| Merchandising (collections, sort order) | website | Recommended - no legacy equivalent exists. |
| Manual product visibility (publish/draft/archived) | website | Recommended - an import must never flip this. |
| RU/RO titles | **unresolved** | No confirmed source field exists for an individual product/variant name (see Section 4). |
| Ingredients/instructions | **unresolved** | No confirmed source field. |
| Category mapping | **unresolved** | No legacy category feed/table was inspected this sprint. |
| Promotional reference price (`compare_at_price`) | **unresolved** | Unclear which observed price (`PriceWH`? `DiscountPrice`?), if any, should populate it. |
| Variant group naming | **unresolved** | Whether `VariativeName` should ever become a V2 product's own title, vs. staying an internal label, is undecided. |

**Default behavior for every unresolved field:** preserve the existing V2
value and emit a conflict - never overwritten by a guess. **Default
behavior for every feed-owned field:** apply the incoming value, *unless*
it is blank while the existing V2 value is non-blank, in which case the
existing value is preserved and a `blank_value_would_overwrite_curated_value`
issue is recorded instead. This two-rule shape is Task 7's own requirement
("avoid importing blank values over nonblank curated values by default"
applied as a general rule, not only to unresolved fields).

## 6. Idempotency guarantees

- **Mappings:** `resolveOrCreateMapping` is fully idempotent per
  `(source_system, entity_type, external_id, internal_id)` - re-running an
  import with the same input never creates a duplicate row (Section 2).
- **Import runs:** every attempt (dry-run or real) gets its own
  `import_runs` row; nothing is ever updated in place to "merge" two
  separate attempts into one history entry. A repeated run is always
  visible as a repeated run, never erased.
- **Checksums are an identification tool, not a skip switch.** See Task
  3's own instruction: "a repeated file should be recognized, but should
  not automatically be skipped when the import policy or mapping logic
  has changed." `computeChecksum` (`src/import/checksum.ts`) hashes a
  deterministically key-sorted canonical form of the payload, so identical
  bytes always produce identical checksums regardless of source key
  ordering. `findRunsByChecksum` surfaces every prior run with a matching
  checksum to the operator (visible in the dry-run summary as
  `priorRunsWithSameChecksum`) - nothing in this codebase currently uses a
  checksum match to silently skip reprocessing. If/when an importer wants
  an explicit "skip if unchanged" fast path, it should require an explicit
  flag **and** a pinned policy/importer version number, so a logic change
  can never be masked by an unchanged checksum.

## 7. Feed contract limitations

- **No real samples were available.** The `products` and `pricevn` feed
  parsers (`src/import/parsers/products-feed.ts`,
  `src/import/parsers/pricevn-feed.ts`) are built strictly from the
  confirmed field list and use `.passthrough()` so any field they don't
  yet recognize is retained rather than silently dropped - useful for
  diffing against a real sample later.
- **The JobVN SEO feed parser is a placeholder, explicitly marked as
  such.** No field name for it was confirmed anywhere this sprint - not
  even one. `src/import/parsers/jobvn-seo-feed.ts` requires only a linking
  id (assumed `ID_nom`, not independently confirmed for this feed) and
  three guessed field names (`MetaTitle`, `MetaDescription`, `Url`) that
  must be verified or replaced once a real sample exists.
- **No envelope format is assumed.** The dry-run CLI and `runDryRun`
  require the top-level JSON value to be a plain array; a wrapper object
  shape (e.g. `{"data": [...]}`) is explicitly rejected with a clear error
  rather than guessed at.
- **`QuantityBalance` and `WarehouseName` are confirmed fields with no
  confirmed feed membership.** They are not included in any parser this
  sprint - partly because their feed isn't confirmed, and partly because
  stock import is out of scope regardless (Sprint 10A restrictions).
- **Legacy MySQL-side matching (SKU, GUID) is not yet implemented.** The
  confirmed findings describe `products_variable.SKU` as a "variant
  matching key," implying the real importer will need to join 1C
  nomenclature records against legacy MySQL rows by SKU - but no MySQL
  dump was available to build or test that join this sprint.

## 8. Error and conflict handling (Task 4)

`import_record_issues` (migration `0012`) never stores a raw source
record - only a `record_identifier` (the record's own claimed natural key,
as plain text) and a `safe_message` drawn from a fixed, pre-written
message table per `issue_code`
(`src/import/issues.ts`'s `ISSUE_MESSAGES`). A legacy/1C feed can carry
fields this project has no visibility into (see the `WarehouseName`
caution above, and the general "local SQL is a schema export, not a
verified full production dataset" warning) - a diagnostics table queryable
by more people than can see the original feed must not become a second
copy of that feed.

Issue codes: `validation_failed`, `unmatched_brand`, `unmatched_category`,
`duplicate_guid`, `duplicate_sku`, `missing_required_field`,
`ambiguous_variant_parent`, `conflicting_external_mapping`,
`invalid_price`, `malformed_stock_quantity`, `unexpected_record_structure`,
`blank_value_would_overwrite_curated_value`.

## 9. Dry-run instructions (Task 8)

```sh
bun run import:legacy:dry-run -- --type=products --file=./path/to/feed.json
bun run import:legacy:dry-run -- --type=pricevn --file=./path/to/pricevn.json
bun run import:legacy:dry-run -- --type=jobvn_seo --file=./path/to/seo.json --persist-report
```

Flags: `--type` (`products` | `pricevn` | `jobvn_seo`, required), `--file`
(path to a JSON file containing a top-level array, required), `--source`
(default `1c`), `--persist-report` (default off).

**By default, a dry-run touches the database not at all** - pure,
synchronous, in-memory parsing, normalization, and read-only mapping
lookups. Only with `--persist-report` does it write an `import_runs` row
plus its `import_record_issues`, both inside a single transaction - and
even then, never to a catalog table, never to Meilisearch, never to R2.
This default-off behavior is Task 8's own requirement ("a dry-run may
store an audit report only if explicitly requested; default should be
read-only") and is directly exercised by
`tests/import-dry-run.test.ts`'s "zero-write guarantee" tests.

A safe default file-size limit (200 MB) guards against unbounded memory
use for a mistakenly huge input; true streaming JSON parsing (so an even
larger file could be processed incrementally) is not implemented this
sprint.

## 10. Planned price and stock integration

Not implemented, not scoped for writes this sprint (explicitly restricted:
"Implement stock sync" and "Implement price sync to production" are both
disallowed). The `pricevn` parser exists so its shape can be validated and
reasoned about now, but `runDryRun`'s pricevn path only parses and reports
- it never resolves a price against a product, never computes a V2
`product_prices` row, and (per Section 5) the question of which observed
price feeds `compare_at_price` is explicitly unresolved.

## 11. Planned R2 media migration

Not implemented this sprint (explicitly restricted: "Upload media to R2").
Sprint 9's `docs/legacy-migration-readiness.md` (Section 5 there) already
recommends re-uploading legacy images through the existing admin
upload/verification pipeline rather than pointing V2's `product_images.url`
at legacy infrastructure directly - that recommendation stands unchanged;
nothing about `products_img`/`products_variable_img` was inspected further
this sprint.

## 12. Planned SEO redirects

Not implemented. Sprint 9's readiness doc already flags the complete
absence of a redirect table and SEO metadata columns as a gap; this
sprint's JobVN SEO feed parser is a first, explicitly-unverified step
toward *reading* SEO data, not toward building the redirect mechanism
itself.

## 13. Dependencies on the 1C programmer (open questions before further work)

1. The real `vizaje_nica_local.sql`, `legacy-feed-samples.json`, and
   `workapp-1c-observed-contract.md` - none were available this sprint.
2. Confirmation of which feed(s) actually carry `QuantityBalance` and
   `WarehouseName`, and whether `WarehouseName` denotes a real physical
   store location (explicitly cautioned against assuming).
3. A real JobVN SEO feed sample - this sprint's parser field names
   (`MetaTitle`, `MetaDescription`, `Url`) are guesses.
4. Confirmation of how (or whether) an individual product/variant gets a
   RU/RO name - the only name field confirmed this sprint
   (`VariativeName`) names a *group*, not an individual sellable item.
5. The legacy MySQL `products`/`products_variable`/`product_categories`
   table definitions in full, to confirm the SKU-matching join between 1C
   and MySQL records, and to assess the real-world uniqueness of
   `GUID`/`SKU` (confirmed to be *not* guaranteed unique, but the actual
   collision rate in production data is unknown).
6. A decision on the data-ownership model (Sprint 9's readiness doc,
   Section 6: one-time import vs. continuous sync) - still open.

## 14. Blockers for Task 9 (controlled import) — Sprint 10A status, superseded by Section 15

Task 9 is explicitly conditional: **"Only if source materials are fully
available and schema mapping is sufficiently verified"** - and, separately,
**"If essential schema assumptions remain unresolved, stop at parsers,
mappings and dry-run."** In Sprint 10A, source materials were not available
at all, so no real import path was implemented. Sprint 10A.1 now has all
four real sources (Section 15) and has corrected the parsers/normalization/
ownership policy against them - but Task 9 remains **not implemented**
this sprint too (Sprint 10A.1's own instructions: "Do not implement
production import... do not write real catalog data"). See Section 15.14
for exactly what is now unblocked vs. still blocked for a future Sprint
10B.

## 15. Sprint 10A.1 — Verification Against Real Legacy Sources

Sprint 10A.1 received, read in full, and preserved (at
`docs/legacy-reference/`) all three sources originally requested plus a
fourth: `vizaje-legacy-discovery.md`, a prior code-level audit of the
legacy CodeIgniter 3 application. This section is a corrective,
evidence-based verification of Sprint 10A's work against them - it is
**not** a new feature sprint, and no production import, stock sync, or
payment integration was implemented.

### 15.1 Discrepancy matrix

| Legacy source | Sprint 10A implementation | Mismatch | Correction made | Risk if uncorrected |
|---|---|---|---|---|
| JobVN feed confirmed fields: `ID_nom`, `WarehouseName`, `Brand`, `ShortDescriptionRus`, `VariativeNomenclature`, `VariativeName`, `SeoHeaderRU`, `SeoDescriptionRU`, `Price`, `PriceWH` (legacy-feed-samples.json) | `jobvn-seo-feed.ts` schema used placeholder, guessed field names: `MetaTitle`, `MetaDescription`, `Url` | Complete field-name mismatch - the Sprint 10A parser would have rejected or mis-validated every real JobVN record | Replaced with the confirmed field list; documented that no RO SEO field was observed in the sample despite MySQL having `seoTitleRO`/`seoDescRO` columns | High - the parser was non-functional against the real feed |
| Legacy MySQL `products.GUID`/`SKU` have plain (non-unique) `KEY` indexes only; `products_variable.SKU` likewise non-unique; `clients.phone` has a plain `KEY`, no unique constraint (vizaje_nica_local.sql) | Sprint 10A's `external_entity_mappings` design already assumed non-uniqueness and never used name/phone as a key | None - Sprint 10A's design was already correct here | Confirmed and documented with real evidence (Section 15.5) | Low - already correctly conservative |
| Products feed real sample additionally carries `Brand`, `Sex`, `QuantityBalance`, `Price`, `PriceWH` (legacy-feed-samples.json) | `products-feed.ts` schema only validated `ID_nom`/`VariativeNomenclature`/`VariativeName`/`Barcode`/`ColorVar`/`VolumeVar`; other fields fell through `.passthrough()` untyped | Real fields existed but weren't validated/reported on | Added typed, optional fields for `Brand`/`Sex`/`QuantityBalance`/`Price`/`PriceWH` (parsed and reported, never acted on - still no price/stock writes) | Medium - dry-run reporting was incomplete, not incorrect |
| Products feed and JobVN feed carry no individual product/variant name field at all - only `VariativeName` (a group name) and `ShortDescriptionRus` (a short description) (legacy-feed-samples.json) | Sprint 10A unconditionally blocked every standalone (ungrouped) candidate as unpublishable | Over-broad: Task 3 explicitly says "do not reject a legitimate standalone product merely because it has no VariativeName" | Added source-aware title resolution (MySQL enrichment > VariativeName > ShortDescriptionRus fallback > unresolved) in `normalize/products.ts` | High - would have blocked every legitimate standalone product indefinitely, even with a real title available from MySQL |
| `vizaje-legacy-discovery.md` confirms `Import::import()` updates `seoTitleRU`/`seoDescRU` from the JobVN feed on every run | Sprint 10A classified `seoMetadata` as `website`-owned | Backwards - the feed genuinely is a real SEO source | Reclassified `seoMetadata` as `feed`-owned in `field-ownership.ts`, still protected by the existing blank-value guard | Medium - a future importer following the old policy would never import real SEO content the store owner expects from the feed |
| `product_categories` is a real MySQL many-to-many table with `UNIQUE(product_id, category_id)` (vizaje_nica_local.sql) | Sprint 10A's `categoryMapping` ownership note said "no confirmed legacy category feed/table was inspected" | Partially outdated - the *table* is now confirmed, even though no category-bearing *feed* field is confirmed in any of the three samples | Updated the note to distinguish "table structure confirmed" from "feed matching strategy still unresolved" | Low - no behavior changed, only documentation precision |
| `vizaje-legacy-discovery.md` confirms legacy's own importer **unconditionally overwrites** titles/descriptions/instructions/components/SEO on every run, with `product_import_changes` only logging the fact (not preventing it) | N/A (Sprint 10A's `titleRuRo` was already `unresolved`) | None - but the *reason* to keep it unresolved is now much stronger and explicit | Documented explicitly in `field-ownership.ts`'s `titleRuRo` note: V2 must not blindly copy legacy's risky overwrite-everything behavior | High if ever copied - would silently destroy manually-curated V2 content on every re-import |
| `pricevn.json` real sample has no `PriceWH` field (unlike the products/JobVN samples) | Sprint 10A's `pricevn-feed.ts` schema included `PriceWH` as if equally confirmed everywhere | Minor overstatement of confidence | Added a doc comment distinguishing "optional, forward-compatible" from "confirmed present in this specific feed" | Low |

### 15.2 Confirmed vs. inferred vs. unknown (Task 1)

**Confirmed fields** (observed directly in `legacy-feed-samples.json` or
`vizaje_nica_local.sql`): `ID_nom`, `VariativeNomenclature`, `VariativeName`,
`Barcode`, `ColorVar`, `VolumeVar`, `Brand` (string), `Sex`,
`QuantityBalance`, `Price`, `PriceWH`, `DiscountPrice`, `WarehouseName`,
`ShortDescriptionRus`, `SeoHeaderRU`, `SeoDescriptionRU`; every MySQL table/
column named in Section 15.5.

**Inferred semantics** (a column/field exists and its *name* is confirmed,
but its exact business meaning is not): what `DiscountPrice: 0` means
(no active discount vs. a genuine zero price); whether `VariativeName`
should ever become a permanent V2 title or stay an internal grouping
label; whether `Brand` (a name string) can ever safely resolve to a V2
brand without a dedicated legacy brand GUID feed.

**Unknown 1C behavior** (nothing in any supplied source answers this):
import schedule/frequency; what happens to a product that disappears from
the feed (hidden/archived/deleted/kept); whether `ID_nom` is permanently
stable; the exact meaning of every `Bal*` field and whether `WarehouseName`
denotes a real physical store (`vizaje-legacy-discovery.md` explicitly
warns against assuming so); the 1C-side bonus ledger, order-status, and
webhook-retry contracts (see `workapp-1c-observed-contract.md` Section 6
"Статус готовности контракта" for the full list - unchanged by this
sprint, since this sprint is catalog-only).

### 15.3 Corrected variant grouping logic (Task 2)

Re-verified against the real ANNY group from `legacy-feed-samples.json`:
parent group `A10.XXX`, individual `ID_nom` 10568 (shade 396), 10516
(shade 253), 10559 (shade 369.50). `normalizeProductsFeed` produces
**exactly one parent candidate with three distinct variants**, confirmed
by `tests/import-normalize.test.ts`'s "real ANNY fixture" tests. The group
identifier (`VariativeNomenclature`, e.g. `"A10.XXX"`) is never written or
treated as a variant's own SKU/identity anywhere in the pipeline - each
variant keeps only its own `ID_nom` - also directly tested.

Collision detection across groups and sources was already present
(`findCrossBatchGroupCollisions`) and is unchanged; group keys remain
namespaced by source system (`1c:A10.XXX` vs. a hypothetical
`legacy_mysql:A10.XXX`), per Task 6's explicit instruction never to merge
two source systems' identifiers just because their raw values match.

### 15.4 Source-aware standalone product naming (Task 3)

`normalizeProductsFeed` now accepts an optional `ProductNameEnrichment`
parameter (`mysqlTitles`, `shortDescriptions`, both keyed by `ID_nom`) and
resolves a candidate's title in this order, never fabricating one:

1. A verified MySQL title (`mysqlTitles`), when supplied - this is the
   preferred, authoritative source once a real cross-reference exists.
2. For a grouped candidate: the group's own `VariativeName`, when every
   member agrees on it.
3. The JobVN feed's `ShortDescriptionRus` (`shortDescriptions`), if
   supplied - a real, confirmed field, but a *description*, not a title;
   using it always produces a `warning`-severity issue so it stays
   visible in every dry-run report, and is clearly distinguished
   (`titleSource: 'short_description_fallback'`) from a verified title.
   It never blocks `publishable` on its own.
4. Otherwise: `unresolved`, blocked, with a `missing_required_field`
   error - returned as an explicit candidate ready for a later MySQL
   enrichment pass, exactly as Task 3 asks ("return an explicit unresolved
   candidate that can be enriched through MySQL").

`WarehouseName` is never consulted at any step, under any circumstance -
directly tested (`tests/import-normalize.test.ts`: "never fabricates a
title and never uses WarehouseName as one, even when present").

### 15.5 Legacy MySQL mapping verification (Task 5)

All findings below are read directly from `vizaje_nica_local.sql` (a real
MariaDB 10.4.27 schema-only export, no data rows).

| Table | Confirmed PK/relevant columns | Confirmed indexes | Uniqueness reality | FK constraints |
|---|---|---|---|---|
| `products` | `id` int PK; `GUID` varchar(128); `SKU` varchar(128); `price`/`priceWH` float; `discount_price` float; `brand_id`/`category_id` int | `KEY GUID`, `KEY SKU` (both **non-unique**), plus many single-column performance indexes | **GUID and SKU are not unique** - a plain `KEY`, not `UNIQUE KEY`. Confirms the prompt's explicit warning. | None to `brands`/`categories` (no FK constraint on `brand_id`/`category_id` at all) |
| `products_variable` | `id` int PK; `product_id` int; `SKU` varchar(32); `price` double; `discount_price` **varchar(32)** (!); `qty`/`qtyWH` int | `KEY product_id`, `KEY SKU` (non-unique), `KEY qty`, `KEY isShown` | **SKU is not unique.** `discount_price` is stored as a free-text string, not a number - a real legacy data-quality risk, not a V2 assumption. | None |
| `brands` | `id` int PK; `GUID` varchar(128) | **No index on `GUID` at all** (only `PRIMARY` and a redundant duplicate `KEY id (id)`) | GUID has no index, let alone a unique one. | None |
| `categories` | `id` int PK; `GUID` varchar(128); `parent_id` int (self-referencing hierarchy, default `0`) | **No index on `GUID` at all** (only `PRIMARY`) | GUID has no index, let alone a unique one. | None (not even on `parent_id`, despite it being a logical self-reference) |
| `product_categories` | `id` int PK; `product_id`, `category_id` int | `UNIQUE KEY (product_id, category_id)`, plus single-column indexes on each | **This junction table IS uniquely constrained** - a real, confirmed match for V2's own `product_categories` design. | `FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE`, `FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE` - one of only 3 FK constraints in the entire schema |
| `products_img` | `id` int PK; `product_id` int; `img` varchar(64); `sorder` int | `KEY product_id`, `KEY sorder`, composite `(product_id, sorder, id)` | No FK to `products` at all (confirmed no constraint) - an orphaned row is possible at the DB level. |
| `products_variable_img` | `id` int PK; `product_id`, `variable_id` int; `img` varchar(64) | `KEY product_id`, `KEY variable_id` | Same as above - no FK, orphan-possible. |
| `stores` | `id` int PK; localized title/desc/text; `phone`; `delivery` int | Only `PRIMARY` | No GUID/feed-key column of any kind - confirms `vizaje-legacy-discovery.md`'s finding that no store-to-feed mapping exists yet. |
| `clients` | `id` int PK; `id_fb`, `active`, `Discount` varchar(16), `Bonus` varchar(16), `phone` varchar(256), `email` text, `code` int | `KEY id_fb`, `KEY active`, `KEY phone`, `KEY code` - **all non-unique** | **No unique constraint on phone, email, or anything else.** `Discount`/`Bonus` are stored as free-text strings, confirming they are a snapshot, not numeric ledger state. `code` is a plain int reused for both an SMS one-time code and (per the discovery doc) an active/filter marker - never the 1C customer `Code` from WORKAPP, which is not persisted anywhere in this schema at all. | None - not imported this sprint regardless (restricted) |
| `orders` | `id` int PK; `order_id` int (public number, random 10000-99999 per the discovery doc); `` `1c` `` int; `ExternalID` varchar(64); `total`/`orders_products.price`/`.total` **varchar** (money as strings) | `KEY idx_orders_promo_id`, `KEY idx_orders_promo_code` - **no index on `order_id` at all** | `order_id` (the public-facing order number) has no uniqueness guarantee whatsoever at the DB level - a real collision risk in production data. | None - not imported this sprint regardless (restricted) |
| `orders_products` | `id` int PK; `order_id`, `product_id` int; `qty`; `price`/`total` varchar | Only `PRIMARY` | No FK to `orders` or `products` at all. No immutable snapshot of product title/SKU at order time is stored here - confirms the discovery doc's warning that a later catalog change would alter the apparent contents of a historical order unless V2 snapshots order-line display data itself (already true of V2's own `order_items`, unaffected by this sprint). | None - not imported this sprint regardless (restricted) |

**Only 3 foreign-key constraints exist in the entire 2,139-line schema**
(`product_categories` → `categories`/`products`,
`home_brand_section_products` → `home_brand_sections`,
`site_feedback_images` → `site_feedback`). Every other relationship in this
schema (including `products.brand_id`/`category_id`,
`products_variable.product_id`, every `_img` table, `orders`/
`orders_products`) is enforced only in application code, if at all. This
sprint changes nothing about customer/order records (explicitly
restricted) - the table is included only because Task 5 asked for
non-uniqueness/nullability/relationship findings across all 10 named
tables, including `clients`/`orders`/`orders_products`, for future
reference.

### 15.6 External identity correctness (Task 6)

Re-confirmed against the real evidence above: `legacy_mysql` and `1c`
remain fully independent namespaces in `external_entity_mappings` (no
code change was needed - the Sprint 10A design already matched what the
real schema now confirms). `resolveOrCreateMapping` and `findMapping`
take only `(sourceSystem, entityType, externalId)` - there is no code
path anywhere in `src/import/mappings.ts` that resolves identity by name,
phone, or email, and `clients.phone`'s confirmed non-unique index
(Section 15.5) is exactly the kind of weak attribute Task 6 says must
never be used for automatic collision resolution (customers are not
imported this sprint regardless). No UUID primary key was altered
anywhere in this sprint - the three new migration-0012 tables
(`external_entity_mappings`, `import_runs`, `import_record_issues`) are
untouched, and no further migration was added this sprint (Sprint 10A.1
made no schema changes at all - see Section 15.14).

### 15.7 Field ownership, corrected (Task 7)

See the full updated table and reasoning in
`src/import/policy/field-ownership.ts`'s `PRODUCT_FIELD_OWNERSHIP_POLICY` -
every entry's `note` cites the specific real evidence behind it. Summary
of what changed from Sprint 10A:

| Field | Sprint 10A owner | Sprint 10A.1 owner | Why it changed |
|---|---|---|---|
| `seoMetadata` | `website` | **`feed`** | JobVN feed confirmed to carry `SeoHeaderRU`/`SeoDescriptionRU`, and `Import::update_seo()` confirmed to write them from this exact feed. Still protected by the blank-value guard (Task 4: a blank feed SEO value never erases curated content). |
| `basePrice`/`stockSnapshot`/`barcode`/`nomenclatureMetadata` | `feed` (recommended) | `feed` (now evidence-backed) | Field names and legacy destination column types now confirmed; ownership direction unchanged. |
| `titleRuRo` | `unresolved` | `unresolved` (much stronger justification) | Now explicitly documents that legacy's own importer unconditionally overwrites titles on every run - a risk V2 deliberately does not copy without an explicit decision. |
| `categoryMapping` | `unresolved` | `unresolved` (partially confirmed) | `product_categories` table structure confirmed; feed-side category matching still unconfirmed. |
| `ingredientsInstructions` | `unresolved` | `unresolved` (destination confirmed) | MySQL `instructionRU/RO`, `componentsRU/RO` columns confirmed to exist; no source feed field confirmed in any supplied sample. |
| `promotionalReferencePrice` | `unresolved` | `unresolved` (ambiguity now explicit) | `DiscountPrice: 0` in every sample row is ambiguous (no discount vs. zero price) - documented, not resolved. |
| `variantGroupNaming` | `unresolved` | `unresolved` (confidence raised) | Real ANNY evidence shows `VariativeName` works well as a *working* parent title; whether it should become the *permanent curated* title is still the store owner's call. |

### 15.8 Mapping table: source field → V2 destination → transformation → ownership → confidence

| Source field | V2 destination | Transformation | Ownership | Confidence |
|---|---|---|---|---|
| `ID_nom` | `external_entity_mappings` (`entity_type='nomenclature'`, `source_system='1c'`) → `product_variants.id` (once Task 9 is unblocked) | Normalized to trimmed text via `externalIdSchema`; never reinterpreted as a number | feed | Confirmed |
| `VariativeNomenclature` | `external_entity_mappings` (`entity_type='nomenclature_group'`) → `products.id` | Namespaced in-memory as `${source}:${value}`; raw value used as the DB-side external id | feed | Confirmed |
| `VariativeName` | Candidate parent product title (fallback chain step 2) | Used verbatim when every group member agrees; flagged `ambiguous_variant_parent` otherwise | feed (tentative - see `variantGroupNaming`) | Confirmed field, unresolved as permanent title source |
| `Barcode` | `product_variants.barcode` (once Task 9 is unblocked) | Trimmed text only, leading zeros preserved (`normalizeBarcode`) - never parsed as a number | feed | Confirmed |
| `ColorVar`/`VolumeVar` | Variant attribute metadata | Passed through as trimmed text | feed | Confirmed |
| `Brand` (string) | Unresolved - reported as `unresolvedBrandNames` in the dry-run only | Never used as a mapping key (a name is not a stable identifier) | feed-sourced, resolution unresolved | Confirmed field, unconfirmed matching strategy |
| `Price`/`PriceWH` (products.json) | Unresolved - parsed and reported only | Decimal-safe MDL→bani (`parseMajorUnitToBani`) | feed (tentative), out of scope for writes | Confirmed field, price-sync out of scope |
| `Price`/`DiscountPrice` (pricevn.json) | Unresolved - parsed and reported only | Decimal-safe MDL→bani | feed (tentative), out of scope for writes | Confirmed field; `DiscountPrice` semantics ambiguous |
| `SeoHeaderRU`/`SeoDescriptionRU` (JobVN) | Unresolved - parsed and reported only (`seoBlankFieldCount` in dry-run) | Blank → `null`, never fabricated | feed (corrected, Section 15.7) | Confirmed field; write path not implemented |
| `ShortDescriptionRus` (JobVN) | Candidate title fallback (chain step 3) | Used only when MySQL enrichment and `VariativeName` are both absent; always flagged `warning` | feed, explicitly interim | Confirmed field, explicitly non-authoritative use |
| `WarehouseName` | Never - retained via `.passthrough()` only, never typed as a title/name field | N/A | N/A | Confirmed present, confirmed NOT a title (explicit rule) |
| `QuantityBalance` | Unresolved - parsed and reported only | N/A, out of scope for writes | feed (tentative), out of scope | Confirmed field; stock-sync out of scope |

### 15.9 Known schema limitations (Sprint 10A.1)

- V2's `products` table has no product-level SKU column (only
  `product_variants.sku`) - legacy `products.SKU` has nowhere to map to
  directly. Unchanged from Sprint 9's readiness doc; not addressed this
  sprint (no schema changes made).
- No RO SEO field was observed in the JobVN sample, despite the legacy
  MySQL schema having `seoTitleRO`/`seoDescRO` on `products`, `brands`,
  and `categories` - RO SEO source is entirely unconfirmed.
- No category-bearing field exists in any of the three supplied feed
  samples - `categoryMapping` cannot move beyond `unresolved` without a
  fourth, category-specific feed/table sample.
- `products_variable.discount_price` is stored as `varchar(32)` in real
  legacy MySQL - any eventual MySQL-side ingestion must treat it as
  unparsed text first, never assume it's already numeric.

### 15.10 Unresolved 1C questions (unchanged by this sprint - catalog-only scope)

All 18 open questions in `vizaje-legacy-discovery.md` Section 13 remain
open; this sprint did not contact WORKAPP or 1C (explicitly restricted)
and did not attempt to resolve bonus/order/payment semantics (out of
scope - catalog import preparation only). The single most relevant
addition from this sprint's own parser work: **confirm whether `ID_nom`
is stable across re-exports** - `external_entity_mappings` already
assumes it might not be perfectly stable (hence conflict detection,
Section 2/6), but a real answer would remove that caution.

### 15.11 Dry-run improvements actually shipped (Task 8)

`runDryRun`'s summary now reports: `candidatesMissingEnrichment` (distinct
from `candidatesBlocked`), `unresolvedBrandNames` (distinct legacy brand
name strings, never used as a matching key), `unresolvedCategoryCount`
(always `0` this sprint - no category field confirmed in any sample),
`priceParsingErrorCount` (a derived subset of `recordsRejected`), and
`seoBlankFieldCount` (jobvn_seo feed only - both `SeoHeaderRU` and
`SeoDescriptionRU` blank). The CLI (`src/import/cli/dry-run.ts`) gained an
optional `--enrichment=<path>` flag accepting a JSON file of
`{"mysqlTitles": {...}, "shortDescriptions": {...}}`, both keyed by
`ID_nom` - entirely optional, and omitting it reproduces Sprint 10A's more
conservative behavior exactly. All existing guarantees are unchanged:
read-only by default, writes only `import_runs`/`import_record_issues`
with `--persist-report`, never a catalog table, never Meilisearch, never
R2.

### 15.12 Test results

All corrections are covered by new or updated tests - see
`tests/import-normalize.test.ts` (real ANNY fixture, source-aware naming,
WarehouseName-never-a-title), `tests/import-parsers.test.ts` (corrected
JobVN fields), `tests/import-dry-run.test.ts` (new summary fields). Full
results are in the Sprint 10A.1 final report (chat), not duplicated here.

### 15.13 Preserved sources

`docs/legacy-reference/` now contains: `vizaje_nica_local.sql` (schema
only, verified no `INSERT` statements / production data),
`legacy-feed-samples.json`, `workapp-1c-observed-contract.md`, and
`vizaje-legacy-discovery.md`. No credentials, production personal data, or
other secrets are present in any of them (each source already redacts
these at origin; the SQL dump is schema-only).

### 15.14 Exact prerequisites for Sprint 10B

Now unblocked by this sprint's verification:

- Products-feed, pricevn-feed, and JobVN-feed parsers are verified against
  real samples and ready for a real (still-not-yet-built) import path.
- Variant grouping is verified correct against the real ANNY example.
- A concrete, source-aware title-resolution strategy exists and is tested.

Still blocking a real Task 9 import, in priority order:

1. **A real MySQL data export** (not schema-only) to build actual
   `mysqlTitles`/category/brand enrichment maps - the current samples are
   schema and feed samples only, never production rows.
2. **A decision on `titleRuRo` ownership** for existing products once
   imported (the store owner must decide whether re-imports may ever
   touch a curated title - Section 15.7).
3. **A confirmed category-bearing feed field or table export** - no
   sample seen this sprint carries one.
4. **A confirmed answer on `DiscountPrice`/`compare_at_price` semantics**
   before any promotional-price mapping is attempted.
5. **A brand-matching strategy** beyond name strings (a legacy brand GUID
   feed, or an explicit manual mapping table) before brand resolution can
   move past "reported as unresolved."
6. Everything already listed in Sprint 9's `legacy-migration-readiness.md`
   that this sprint didn't touch: external-id columns are intentionally
   *not* added to catalog tables (superseded by `external_entity_mappings`
   - see Section 2), SEO redirects, R2 media migration, and the
   data-ownership model decision.
