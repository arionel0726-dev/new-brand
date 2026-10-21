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

## Verification (this sprint)

- `bunx tsc --noEmit`: clean.
- `bunx drizzle-kit check`: no drift (this sprint writes into Sprint
  12B.1's schema, no new migration).
- Full suite sequential (`bun test --parallel=1`), isolated `beauty_store_test`:
  **474 passed / 0 failed / 15 skipped** (16 new tests, 0 regressions from
  the 458/0/15 Sprint 12B.1 baseline).
