# VIZAJE-NICA V2 — Controlled Catalog Importer (Sprint 12B.2)

Scope: this sprint authorizes **implementation and synthetic testing only**.
No real catalog row has ever been imported by this tool. Everything below
was built and verified against synthetic fixtures in `apps/api/tests/catalog-importer.test.ts`.

## What it is

`apps/api/src/import/catalog-importer.ts` (`runCatalogImport`) composes the
existing read-only reconciliation modules (Sprint 12A.3–12A.7) into real
Drizzle writes — the first and only module in the Sprint 12 series that
writes to Postgres. It only ever writes a product/variant whose identity
reconciliation outcome is unambiguously `confirmed` (standalone) or
`confirmed_position` within a `confirmed_family` (no `collisionRisk`).
Everything else — `ambiguous`, `unmatched`, `quarantine`, a group-code
collision — is counted and reported, never written.

## Explicitly out of scope this sprint

- **Price and stock**: no `product_prices` or inventory row is ever written.
  There is still no confirmed source-of-truth rule between `products.json`
  and `pricevn.json`, and the `Bal*` per-warehouse aggregation formula is
  still an open question (see `docs/vizaje-identity-architecture.md` §D).
  Writing either would be exactly the "arbitrary selection" this sprint's
  restrictions forbid.
- SEO title/description fields (legacy `seoTitleRu/Ro`, `seoDescRu/Ro`) — not
  mapped onto any V2 column yet.

## Safety mechanism (Task 15)

`assertSafeImportTarget(databaseUrl)` is called before write mode is even
attempted. It parses the database name out of `DATABASE_URL` and refuses to
proceed unless the name contains `"test"` and does **not** contain
`"prod"` — the same convention `tests/helpers.ts` already enforces for the
test suite itself. This is an enforced code path (`UnsafeImportTargetError`),
not just documentation; see `assertSafeImportTarget`'s own tests.

## CLI usage

```bash
cd apps/api
bun run import:legacy:catalog-import -- --sql=<path> --products=<path>        # dry-run (default)
bun run import:legacy:catalog-import -- --sql=<path> --products=<path> --write  # real writes - test DB only
```

Dry-run mode uses only read-only `findMapping` lookups — it never calls
`resolveOrCreateMapping`, which is what makes "zero writes in dry-run"
actually true rather than merely intended (see `resolveIdentity` in
`catalog-importer.ts` and the corresponding test).

## Idempotency (Task 16)

`resolveIdentity` always looks up any existing `external_entity_mappings`
row first and reuses its `internalId`, rather than handing a fresh random
UUID to `resolveOrCreateMapping` on every call — the latter would
misreport a legitimate second run as a mapping conflict (Sprint 10A's
`resolveOrCreateMapping` is idempotent only when called with the *same*
internalId each time). Proven by the "idempotent repeated import" test:
running the same input twice yields the same product/variant UUIDs, no
duplicate rows, no duplicate mappings.

## Rollback (Task 17)

Every write-mode run is expected to be wrapped in one `db.transaction(...)`
call by the caller (the CLI does this; so does every test). A thrown error
anywhere after a successful write rolls back every row that run touched —
proven by the "transaction rollback" test, which lets a run fully succeed
inside an uncommitted transaction, then forces a throw and asserts the
database is left exactly as it was before.

## Readiness criteria for a future real test import

A real `--write` run against real local files is **not yet authorized**.
Before requesting that authorization, these should hold:

1. A fresh `bun run import:legacy:reconcile-1c-local` run (Sprint 12A.4) on
   the current real files shows a stable, reviewed `confirmed`/`confirmed_family`
   set — no unreviewed spike in `ambiguous`/`collision_risk` since the last
   run.
2. The three still-open questions for the 1C developer
   (`docs/vizaje-identity-architecture.md`'s closing section) are answered,
   or an explicit decision has been made to proceed without an answer to a
   given one.
3. The real test import is run with `--write` against `beauty_store_test`
   (or an equivalently isolated, disposable database) only, and its output
   is reviewed — `productsCreated`, `unitsSkipped`/`bySkipReason`,
   `slugAliasConflicts` — before any further step.
4. The import is run **twice** against the same input and the two runs'
   summaries compared — any difference beyond `action: created → updated`
   is a bug to investigate before trusting the tool further.
5. Price/stock remain out of scope until a source-of-truth rule is
   confirmed — a real test import's products will have no price and no
   stock, by design, and that must be the expected result, not a surprise.

## Verification (Sprint 12B.2)

- `bunx tsc --noEmit`: clean.
- `bunx drizzle-kit check`: no drift (this sprint writes into Sprint
  12B.1's schema, no new migration).
- Full suite sequential (`bun test --parallel=1`), isolated `beauty_store_test`:
  **474 passed / 0 failed / 15 skipped** (16 new tests, 0 regressions from
  the 458/0/15 Sprint 12B.1 baseline).

## Sprint 12B.2.1 — real dry-run audit and fixes

The user ran the CLI in dry-run mode against real local files on their own
Mac and reported: `totalUnits: 6976`, `productsCreated: 5972`,
`unitsSkipped: 1004`, `variantsWritten: 16`, `barcodesWritten: 0`,
`quarantine: 374` (vs. an earlier-reported `403`), zero `slugAliasConflicts`,
zero `unpublishedFor*`. Code-level investigation (no access to the real
files — this was pure code tracing plus synthetic reproduction) found
several real bugs, all now fixed:

1. **Dry-run was not a faithful preview.** Both `importFamily` and
   `importStandalone` returned early, before computing brand/category
   resolution, slug-collision detection, or barcode planning, for EVERY
   unit in dry-run mode. `variantsWritten=16` reflected only
   family-matched units (the minority of real data); standalone units
   never set `variantIds` at all. `barcodesWritten=0` and
   `slugAliasConflicts=0` were unconditional in every dry-run, not
   evidence the real data had none. **Fixed**: dry-run and write mode now
   run the identical code path end to end; every mutating `insert`/
   `update` is gated by a `dryRun` flag deep inside the `write*` helpers,
   not by an early return. A dry-run's `variantsWritten`/`barcodesWritten`/
   `slugAliasConflicts`/`unpublishedFor*` are therefore now a faithful
   preview of what write mode would actually do.
2. **A real write-mode foreign-key bug**, found while fixing (1): moving
   variant/category/alias writes ahead of the product-row write (to check
   the zero-variant invariant below before committing to a product)
   broke every write-mode import outright, since `product_variants`,
   `product_categories`, and `product_variant_barcodes` all have a hard FK
   to `products.id`. Fixed by splitting each write into a **read-only
   identity/mapping resolution phase** (safe before the product row
   exists — `external_entity_mappings` has no FK to catalog tables) and a
   **persistence phase** that only runs after the product row is written.
3. **A real, severe idempotency bug**: variant-identity resolution
   (`product_variants` and the paired `1c`/`nomenclature` mapping) used a
   bare `resolveOrCreateMapping` call with a freshly-generated
   `crypto.randomUUID()` on every call, instead of the `resolveIdentity`
   wrapper products already used. On any SECOND run of the importer over
   the same confirmed family/standalone position, every variant's mapping
   lookup found the real stored mapping from run 1 under a *different*
   (freshly random) candidate id and reported `{outcome:'conflict'}` —
   silently producing a Product with **zero variants** on every re-run.
   Fixed by routing all variant-identity resolution through
   `resolveIdentity`, exactly like product identity already was.
4. **Invariant added**: every planned Product now has at least one
   planned ProductVariant, enforced in code, not just by convention. If
   every confirmed member's variant mapping genuinely conflicts (a real
   external-identity collision, not the bug in (3)), the whole unit is
   aborted — `ZeroVariantProductError` in write mode (rolls back the
   transaction), a skip in dry-run — rather than ever publishing a
   variant-less product.
5. **`unpublishedForMissingCategory` was keyed off the wrong signal**: the
   raw legacy `categoryId` being non-null, not whether a V2 category
   mapping actually resolved. A product whose legacy category id had no
   matching V2 mapping yet (a real, confirmed Sprint 12A.2 scenario) would
   have been silently marked `active` with zero real `product_categories`
   rows. Fixed: `writeCategoryLinksPreview`/`persistCategoryLinks` now
   return the actually-resolved V2 category ids, and `unpublishedForMissingCategory`
   is keyed off `linkedCategoryIds.length === 0`.
6. **Quarantine undercount explained and fixed**: an unresolved family
   (`ambiguous_family`/`unmatched_family`/`collision_risk_family`) used to
   collapse ALL of its members into one lumped skip unit, carrying only
   the family's own outcome — so a member independently quarantined by
   the Sprint 12A.2 catalog dry-run was invisible in `bySkipReason.quarantine`
   whenever its family also happened to be unresolved. This is the
   code-grounded explanation for `374` vs. the earlier `403`: the two were
   never measuring the same population. Fixed: each member of an
   unresolved family now gets its own unit, carrying its own true
   position-level status (quarantine takes priority, exactly as the
   underlying reconciliation already decides it). A new summary field,
   `quarantinedPositionsTotal`, reads the TRUE total directly from
   `reconcileSqlWith1c`'s own per-product summary, independent of this
   importer's unit-bucketing, as a standing cross-check against
   `bySkipReason.quarantine`.
7. **Dry-run cross-unit slug-collision detection gap**: within one
   dry-run pass, no row is ever persisted, so a second unit's slug-collision
   check could never see the first unit's "would-be" slug via a DB read —
   two sibling products sharing a colliding legacy URI reported zero
   conflicts in dry-run even though write mode would correctly flag one.
   Fixed with an in-memory `DryRunSlugLedger` (canonical slugs + aliases,
   keyed by product id) that `ensureUniqueSlug`/`writeSlugAliases` consult
   and update for the duration of one dry-run call, so later units see
   earlier ones' claims exactly as write mode's DB-visible state would.

### Corrected summary shape

`CatalogImportSummary` is unchanged in its field names (so earlier
real-run numbers remain comparable), but every count's semantics are now
precisely documented inline in `catalog-importer.ts` and genuinely dual-mode
(preview in dry-run, actual in write):

- `totalUnits` / `productsCreated` / `productsUpdated` / `unitsSkipped` /
  `bySkipReason` — one unit per confirmed family, one unit per member of an
  *unresolved* family (new in 12B.2.1 — see fix 6), one unit per standalone
  legacy product.
- `variantsWritten` — sum of planned/written variants across **every**
  created/updated unit, family-derived and standalone-default both (fix 1).
- `barcodesWritten` — sum of planned/written `product_variant_barcodes`
  rows, real in both modes now (fix 1).
- `unpublishedForMissingCategory` / `unpublishedForMissingBrand` — keyed
  off actually-resolved V2 mappings, not raw legacy field nullness (fix 5).
- `slugAliasConflicts` — real cross-unit detection in both modes (fix 1, 7).
- `quarantinedPositionsTotal` — new field (fix 6): the true total
  quarantine population, independent of unit-bucketing.

### Updated readiness criteria

In addition to the five criteria above, a future real test import should
also confirm:

6. The post-12B.2.1 dry-run numbers look structurally different from the
   pre-fix run described here — in particular `variantsWritten` and
   `barcodesWritten` should now scale with `productsCreated` rather than
   sitting near zero, and `quarantinedPositionsTotal` should equal (not
   exceed) `bySkipReason.quarantine`. A fresh run that still shows the old
   pattern means the fix did not actually take effect against the real
   data shape and must be investigated before proceeding.

### Verification (Sprint 12B.2.1)

- `bunx tsc --noEmit`: clean.
- `bunx drizzle-kit check`: no drift (counter/logic fixes only, no schema change).
- Full suite sequential (`bun test --parallel=1`), isolated `beauty_store_test`:
  **481 passed / 0 failed / 15 skipped** (7 new regression tests, 0
  regressions from the 474/0/15 Sprint 12B.2 baseline).

## Sprint 12B.3 — Brand & Category Bootstrap

The real dry-run after 12B.2.1's fixes correctly reported `missingBrand:
5972` / `missingCategory: 5972` — not a bug, just the honest consequence of
there being no bootstrap step yet to create the brands/categories a product
could resolve against. This sprint adds that step:
`src/import/brand-category-bootstrap.ts`
(`bootstrapBrands`/`bootstrapCategories`) + its CLI,
`src/import/cli/brand-category-bootstrap.ts`
(`bun run import:legacy:brand-category-bootstrap`).

It reuses the existing legacy SQL parser
(`parsers/mysql-catalog.ts`'s `extractBrands`/`extractCategories`, already
built in Phase A) and the exact identity/mapping pattern
`catalog-importer.ts` already established: `resolveIdentity` (dry-run-safe
mapping preview, never creates a real mapping row in dry-run) ->
create/update or report, one `legacy_mysql` external mapping per
brand/category, never a fabricated placeholder for a missing/invalid
reference. It also reuses `catalog-importer.ts`'s own
`assertSafeImportTarget` directly rather than duplicating the safety check.

### Key decisions

- **RU/RO brand names (Requirement 3).** Legacy's own `brands` table
  (confirmed by reading its real `CREATE TABLE` in
  `docs/legacy-reference/vizaje_nica_local.sql`) has only a single
  `title`/`uri` pair — no RU/RO split, unlike `categories`, which does have
  real `titleRU`/`titleRO` throughout. V2's `brands.nameRu`/`nameRo` are
  both `NOT NULL`. Decision: `nameRu` = the legacy title (canonical, since
  the storefront's primary locale is `ru`), `nameRo` = the **same** value,
  duplicated — not left null (would violate the constraint) and not
  machine-translated (would misrepresent invented text as real brand copy).
  Flagged as needing real RO translation before launch.
- **Category tree order (Requirement 4).** Breadth-first/wave insertion so
  a parent always resolves before its children, regardless of the source
  array's own order. `parent_id = 0` (legacy's own "no parent" sentinel) is
  imported as a real root (`parentId: null`), never promoted to a
  fabricated parent. A nonzero `parent_id` that matches no real legacy
  category row is reported as `invalid_parent`, never silently rooted.
- **Duplicate slugs (Requirement 7 / Important-B).** Both colliding
  brands/categories are imported, under distinct slugs (the second
  suffixed by its own legacy id, mirroring the `-id` pattern the forensic
  audit found in legacy's own `update_url()`), with a conflict report
  naming **both** legacy owning ids — never a generic "conflict detected",
  never an automatic reassignment.
- **SEO metadata on brands/categories (Requirement 5).** Out of scope this
  sprint, same posture as products' own SEO fields in `catalog-importer.ts`
  — `brands`/`categories` have no SEO columns in the current schema and
  none were added; `drizzle-kit check` confirms no drift. Adding them is a
  Phase B schema question, not something this sprint needed in order to
  unblock product brand/category resolution.
- **Draft-to-publishable count (Requirement 14).** `countDraftToPublishableCandidates`
  is a documented formula, not a fabricated real number — there is no real
  5972-product dataset available in this environment. It counts
  created/updated units whose `unpublishedForMissingBrand` and
  `unpublishedForMissingCategory` are both false; run it against a real
  `catalog-importer.ts` result after a real bootstrap to get the real
  answer.
- **Never auto-publishes (Requirement 15).** The bootstrap only creates
  brands/categories and their mappings; it never touches `products.status`.
  That stays `catalog-importer.ts`'s own brand/category-resolution logic,
  unchanged by this sprint.

### Important-A: 403 vs. an earlier "387" quarantine figure

`quarantinedPositionsTotal` and `bySkipReason.quarantine` are, by the
12B.2.1 fix's own design, meant to measure the same population and agree
(see that fix's doc comment on `quarantinedPositionsTotal` in
`catalog-importer.ts`). A new regression test
(`tests/brand-category-bootstrap.test.ts`, "Important-A") pins this
invariant on a synthetic quarantined fixture. A real run showing two
different numbers (403 vs. an earlier 387) is most consistent with
comparing a **post-12B.2.1** number against a **pre-12B.2.1** run, which
used the old lumped-per-family counting that this test would have failed
against — not evidence of a new, separate bug in this sprint's code. A
fresh real run with both before/after 12B.2.1 and 12B.3 code should show
`quarantinedPositionsTotal === bySkipReason.quarantine`; if it does not,
that is itself a regression to investigate, not a number to reconcile by
hand.

### Exact commands for a future read-only real-data dry-run

```bash
bun run import:legacy:brand-category-bootstrap -- --sql=/path/to/legacy_dump.sql
bun run import:legacy:catalog-import -- --sql=/path/to/legacy_dump.sql --products=/path/to/products.json
```

Both default to dry-run and are safe to run read-only against real local
files — neither has ever been run with `--write` against real data. Write
mode (`--write`) is not authorized this sprint and requires both the flag
and `assertSafeImportTarget` passing against an isolated test database.

### Verification (Sprint 12B.3)

- `bunx tsc --noEmit`: clean.
- `bunx drizzle-kit check`: no drift (no schema change this sprint).
- Full suite sequential (`bun test --parallel=1`), isolated `beauty_store_test`:
  **500 passed / 0 failed / 15 skipped** (19 new tests, 0 regressions from
  the 481/0/15 Sprint 12B.2.1 baseline).
