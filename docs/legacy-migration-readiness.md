# Legacy Migration Readiness

Sprint 9, Task 6. This document inspects the Drizzle/PostgreSQL schema that
exists today (through Sprint 9, migration `0011`) and asks: what would it
take to import catalog, pricing, stock, and media from the existing
CodeIgniter/MySQL/1C-based retailer into it?

**This is an assessment, not an implementation.** No migration code is
written here, no schema is changed, and no field-by-field MySQL/1C mapping
table is produced — none of this project's sessions have ever seen the real
legacy schema (a MySQL dump, a 1C export sample, or the CodeIgniter model
definitions). Every finding below is grounded in the Postgres schema actually
in this repository (`apps/api/src/db/schema/*.ts`), not assumptions about
what the legacy system contains. Where the legacy shape matters and is
unknown, that is called out explicitly as an open question rather than
guessed at.

## 1. What already maps cleanly

| This schema | Likely legacy equivalent | Notes |
|---|---|---|
| `products.nameRu` / `nameRo`, `descriptionRu` / `descriptionRo` | MySQL bilingual name/description columns | Already a RU/RO pair on every customer-facing text field (products, variants, brands, categories, product images' alt text) - a good structural match *if* the legacy store is genuinely bilingual RU/RO. Needs confirming against the real schema; if the legacy site carries a third locale or a single locale with on-the-fly translation, this pairing doesn't hold. |
| `product_variants.sku` | MySQL/1C SKU/article code | `unique, not null` - the single most reliable natural key available today for matching an imported variant back to its source row on re-import. |
| `product_variants.barcode` | 1C barcode (EAN/UPC) | `unique when present` - a second natural key, useful when SKU formats differ between systems or a product has multiple barcodes 1C tracks separately (not representable here - see §2). |
| `brands.slug`, `categories.slug` | MySQL category/brand slug or generated from name | Already unique text slugs; safe to reuse directly if the legacy slugs are already URL-safe and non-colliding, otherwise need regenerating and old→new redirects (§2). |
| `product_prices.price` (integer, bani) | MySQL/1C retail price | Already integer minor-unit money, matching this project's "all monetary calculations use integers" rule throughout checkout/orders - no float-to-integer conversion bugs waiting to happen on import, just a unit conversion (legacy MDL leu amount × 100) if the source stores major units. |
| `inventory.quantityOnHand` | MySQL/1C stock count | A plain integer per variant - trivial to populate from a single-location legacy stock figure. Falls short once multiple physical stores are involved (§2). |
| `product_images.url` + R2 `objectKey` | Legacy image file paths/CDN URLs | The *shape* (one row per image, optional `variantId` pin, `sortOrder`) maps fine; the *storage* does not - legacy image bytes live on different infrastructure and must be re-uploaded through this project's own R2 pipeline, never referenced in place (§5). |

## 2. Missing fields / structural gaps

These are real gaps in what this schema can currently represent - not
flagged as bugs, since nothing before Sprint 9 needed them, but each is a
schema decision an import will force:

- **No external/legacy identifier anywhere.** Every primary key in this
  project (`products.id`, `product_variants.id`, `brands.id`,
  `categories.id`, `orders.id`, ...) is a server-generated UUID
  (`gen_random_uuid()`). There is no `external_id`, `legacy_id`, or
  `source_system` column on any table. This is the single biggest
  readiness gap for Task 6's own "idempotent import and reconciliation"
  requirement: without a durable foreign key back to the legacy row's own
  id, a second import run has nothing reliable to match against except
  `sku` (variants only) or `slug`/`barcode` - none of which is guaranteed
  stable across every legacy record (a renamed slug, a corrected barcode,
  a product with no barcode at all).
- **No store-level inventory.** `inventory` is one row per variant,
  globally - no warehouse/location dimension. If 1C tracks stock per
  physical store (plausible for a multi-location cosmetics retailer),
  that detail has nowhere to go today. Importing would mean either (a)
  adding an `inventory_locations` concept and a location-keyed
  `inventory` table, or (b) deliberately summing every 1C location's
  stock into this single global count and accepting the loss of
  per-store detail. That is a business decision, not a schema change to
  make silently - **open question**, needs the real 1C stock export
  schema and a decision from the people operating the stores.
- **Single current price only, no price history or price types.**
  `product_prices` is a strict 1:1 with a variant: one `price`, one
  optional `compare_at_price`, one currency (hardcoded `'MDL'` by check
  constraint). 1C commonly exposes multiple price types (retail,
  wholesale, promotional, loyalty) and sometimes effective date ranges.
  This schema can hold exactly one of those per variant at a time - which
  1C price type becomes `price`, whether a second one becomes
  `compare_at_price` (it is documented as *reference-only*, never an
  automatic discount - see Sprint 8), and whether historical prices need
  to be preserved at all, are open questions this document deliberately
  does not answer without the real 1C price feed shape.
- **No SEO metadata fields.** No `meta_title`, `meta_description`,
  canonical URL, or structured-data fields on `products`, `brands`, or
  `categories`. If the existing CodeIgniter storefront has search-indexed
  pages with hand-written SEO copy, none of it has anywhere to land today.
- **No redirect table.** Nothing maps an old CodeIgniter URL (e.g.
  `/catalog/product.php?id=1234` or a legacy slug) to this system's new
  `/products/:slug`. Cutover without one means losing indexed search
  traffic and breaking every external link/bookmark pointing at the old
  site. A `redirects` table (`fromPath`, `toPath`/`toProductId`,
  `createdAt`) plus a thin catch-all route in the public API (or at the
  CDN/reverse-proxy layer) would close this, but does not exist yet.
- **No multi-barcode / multi-SKU per variant.** One `sku` and one
  `barcode` column, both scalar. If 1C associates more than one barcode
  with a single sellable unit (repackaging, multiple suppliers), this
  schema has no second slot for it.
- **Brand/category are flat name+slug+description, not equipped for an
  arbitrary external taxonomy.** `categories` does support a parent/child
  tree (`parentId`, cycle-checked by the admin API), which is a close
  structural match for most e-commerce category trees including a typical
  1C/MySQL one - but nothing here knows how to *resolve* a legacy
  category/brand id into this system's UUID without an explicit mapping
  step (see §6).

## 3. Stable external identifiers (what to add before importing)

Given the gap in §2, before any import runs, at minimum the following
columns should be added (as new, additive migrations - never altering
existing Sprint 1-9 history):

- `products.external_id text unique` (nullable) - the legacy product id.
- `product_variants.external_id text unique` (nullable) - the legacy
  variant/SKU-row id, if distinct from `sku` itself.
- `brands.external_id text unique` (nullable) and
  `categories.external_id text unique` (nullable) - legacy brand/category
  ids, needed to resolve a product's legacy brand/category reference
  into this system's UUID on import.

Each nullable and unique-when-present (mirroring the existing
`product_variants.barcode` pattern), so a product created natively in this
system (no legacy counterpart) is unaffected, and a second import run can
`UPDATE ... WHERE external_id = $1` or `INSERT ... ON CONFLICT (external_id)
DO UPDATE` safely. In the absence of a legacy product/variant id (some
feeds expose only a SKU), `product_variants.sku` remains the fallback
match key - it is already unique and required.

## 4. RU/RO content

Every customer-facing text field in this schema already has an RU/RO pair
(`nameRu`/`nameRo`, `descriptionRu`/`descriptionRo`, `altRu`/`altRo` on
images). This is a good structural match for a bilingual import **if** the
legacy system is itself bilingual in the same two locales. Two open
questions that can only be answered against the real legacy schema:

- Does every legacy record actually carry both RU and RO content, or is
  one locale authoritative with the other machine-translated/missing? If
  the latter, an import needs an explicit fallback policy (e.g. RO
  defaults to RU when absent) - this project's existing `localize()`
  helper already has a "fall back to the other locale" behavior at read
  time, so a partially-bilingual import is survivable, but should be a
  conscious choice, not a silent side effect of missing data.
- Are there legacy records in a third locale (Romanian Cyrillic variants,
  Russian transliterations, or English product copy) this two-column
  shape cannot hold at all?

## 5. Image path and R2 migration strategy

Legacy product images live on the existing CodeIgniter app's own storage
(filesystem or whatever CDN it currently uses) with their own URL scheme.
This project's `product_images.url` is populated today exclusively by the
R2 upload pipeline (`src/media/r2.ts`, `src/routes/v1/admin/media.ts`): a
presigned PUT, then server-side verification (real content-type sniffing,
real size check against the object actually in R2) before a `product_images`
row is ever created.

**Recommendation:** a legacy image import must reuse that same pipeline,
not bypass it by writing legacy URLs straight into `product_images.url`.
Concretely: for each legacy image, fetch the bytes from the legacy
source, run the same magic-byte content validation this project already
applies to admin uploads (`src/media/sniff.ts`), upload to R2 under this
project's own key scheme (`products/<productId>/<uuid>.<ext>`, matching
`src/routes/v1/admin/media.ts`), and only then insert the `product_images`
row with the new R2-backed `url`/`objectKey`. This is slower than a
one-line `UPDATE ... SET url = legacy_url` migration, but it is what keeps
the promise already made elsewhere in this codebase: "design the backend
to remain independent of the original CodeIgniter application." Pointing
`url` at the legacy host would make this system permanently dependent on
infrastructure it doesn't control and that may be decommissioned once the
old site is retired.

A bulk-import variant of the existing upload-complete verification (same
checks, batch-oriented, no presigned-URL round trip since the import
process itself has the bytes) would need to be written as new code - not
proposed here in detail, since that crosses into "implement the
migration," which this task explicitly defers.

## 6. Data ownership between MySQL, 1C, and PostgreSQL

This is the most consequential open decision, and this document
deliberately stops short of making it unilaterally:

**Option A - one-time (or periodically re-run) import, then PostgreSQL
is sole source of truth.** MySQL/1C are read once (or on a schedule) to
populate/refresh this system; after that, every checkout/order/inventory
read and write in this codebase already assumes Postgres is authoritative
- nothing in the Sprint 1-9 architecture defers a live price/stock check
to an external system mid-request (by design: checkout always recomputes
from `product_prices`/`inventory` directly, never trusts a cached or
externally-sourced figure - see Sprint 6-8's checkout/order work).
This option fits the existing architecture with zero changes to the
request-time code path; only the import job itself is new.

**Option B - MySQL/1C remain continuously authoritative**, with this
system treated as a read replica that is live-synced (webhook, polling,
or queue-based) indefinitely. This would require new infrastructure this
project has deliberately not built (no queue, no outbox, no webhook
receiver) and would mean every checkout either trusts a potentially-stale
replica or adds a live round-trip to the legacy system inside the
checkout path - directly undermining the "never trust a client-provided
total, always recompute from Postgres" guarantee this codebase enforces
everywhere else.

**Recommendation: Option A.** It requires no new runtime dependencies,
matches every architectural decision already made in this project, and
keeps the new storefront operable even if the legacy systems go away.
This is a recommendation, not a decision made on the user's behalf - it
needs explicit sign-off before any import tooling is built, per this
sprint's "do not start the legacy migration... without approval."

## 7. Idempotent import and reconciliation strategy (shape, not code)

Once §3's external-id columns exist and §6's ownership model is decided,
an importer should follow the same patterns already established
throughout this codebase rather than inventing new ones:

- **Upsert by external id**, falling back to `sku` for variants where no
  legacy variant id is available - never upsert by this system's own
  UUID, since UUIDs are generated here and cannot be known in advance by
  an external feed.
- **Batched, transactional, safely re-runnable.** The same input run
  twice should produce the same end state (no duplicate rows, no
  duplicate price history) - the existing `onConflictDoNothing`/
  conditional-UPDATE idioms used throughout `src/db/queries/*.ts` are the
  right building blocks, not raw `INSERT`.
- **A structured per-run report**, not a silent sweep - this project's
  existing CLI scripts (`src/search/reindex.ts`, `src/media/cleanup.ts`)
  already log a `{created, updated, skipped, failed}`-shaped summary
  rather than running silently; an importer should do the same so a
  partial or failed run is visible and re-runnable, not quietly wrong.
- **Import order matters**: brands and categories first (so their
  `external_id` → UUID mapping exists), then products (resolving
  `brandId`/`categoryId` via that mapping), then variants, prices, and
  inventory, then images last (since image import is the slowest step and
  should never block the rest of the catalog from being queryable).
- **Never silently overwrite data edited natively in this system** after
  go-live. Once a product has been edited through this project's own
  admin API, a later re-import from the legacy source re-running against
  the same `external_id` would clobber that edit. If periodic re-import
  is needed post-cutover (e.g. stock/price only, not full catalog
  content), the importer should update a narrow, explicit field set
  (price, stock) and leave everything else untouched - this needs
  deciding explicitly once the real feed and its update frequency are
  known, not assumed here.

## 8. Summary of concrete next steps (none implemented in this sprint)

1. Obtain the real MySQL schema/dump and a sample 1C products/prices/stock
   JSON export - nothing above can become a concrete field mapping without
   them.
2. Decide the data-ownership model (§6) - recommend Option A.
3. Add `external_id` columns (§3) as new, additive migrations.
4. Decide the store-level inventory question (§2) with the people who run
   the physical stores.
5. Decide which 1C price type(s) map to `price`/`compare_at_price` (§2).
6. Design the redirect table and SEO metadata columns (§2) before
   cutover, not after - once old URLs stop resolving, that traffic is
   gone.
7. Build the image re-upload pipeline (§5) reusing the existing R2
   upload/verification code paths.
8. Only then write the importer itself (§7), as its own reviewable,
   testable body of work - explicitly out of scope for this sprint.
