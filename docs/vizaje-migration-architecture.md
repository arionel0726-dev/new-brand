# VIZAJE-NICA V2 Migration Architecture

Sprint 10A. This document describes the legacy-migration foundation built
this sprint: external identity mapping, import-run tracking, record-level
diagnostics, feed parsers, product/variant normalization, a field-ownership
policy, and a dry-run CLI. **No real catalog data has been imported.** Task
9 (a controlled, real import path) was explicitly not implemented this
sprint - see "Blockers" below.

Every claim in this document is labeled as either a **confirmed fact**
(stated directly by the project owner in the Sprint 10A prompt, or observed
directly in this repository's own code) or an **assumption** (inferred,
recommended, or a placeholder pending real data). Nothing here is invented
from a legacy schema this session never saw.

## 1. Source inventory

Three source documents were named in the Sprint 10A prompt:

1. `vizaje_nica_local.sql`
2. `legacy-feed-samples.json`
3. `workapp-1c-observed-contract.md`

**None of the three were present in this environment.** This session
searched the repository working directory, the home directory, and the
upload/attachment directories (`/mnt/user-data/uploads`, `/mnt/attach`) and
found nothing matching. This is reported explicitly per the sprint's own
instruction ("if they are not present, explicitly report that limitation").
Every parser, schema shape, and field name below that relates to the legacy
system is built **only** from the "Confirmed legacy findings" given
verbatim in the Sprint 10A prompt text - never from inspecting the actual
files.

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

## 14. Blockers for Task 9 (controlled import)

Task 9 is explicitly conditional: **"Only if source materials are fully
available and schema mapping is sufficiently verified"** - and, separately,
**"If essential schema assumptions remain unresolved, stop at parsers,
mappings and dry-run."** Given Section 1 above, source materials are not
available at all. Per the sprint's own instruction, no real import path was
implemented. What exists instead - mappings, run tracking, diagnostics,
parsers, normalization, field-ownership policy, and dry-run - is the
complete foundation Task 9 would be built on top of once the real schema is
confirmed.
