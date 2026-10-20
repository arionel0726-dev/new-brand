# VIZAJE-NICA V2 — SQL ↔ 1C Reconciliation Tool (Sprint 12A.3)

Status: tool built and smoke-tested against sample data only. **No real
reconciliation has been performed** — see §4.

## 1. What this tool does

`apps/api/src/import/reconcile/sql-1c-reconciliation.ts` (`reconcileSqlWith1c`)
compares the already-parsed legacy MySQL catalog (Sprint 12 Phase A's
`loadLegacyCatalogDump`) against an already-parsed 1C products feed (Sprint
10A's `parseProductsFeed`) and produces, per MySQL product, one of four
outcomes:

- **`confirmed`** — exactly one 1C record matches, on an unambiguous key.
- **`ambiguous`** — multiple 1C candidates were found, or two keys point at
  different 1C records (conflicting signals). Never auto-resolved.
- **`unmatched`** — no candidate was found on any available key.
- **`quarantine`** — the product was already quarantined by the Sprint
  12A.2 catalog dry-run (`runLegacyCatalogDryRun`, e.g. duplicate GUID, broken
  category reference, duplicate SKU). Reconciliation evidence against 1C is
  still computed and attached (it may help a human resolve the quarantine
  later), but **a 1C match never clears a quarantine on its own** — that is
  an explicit design decision, not an oversight.

The same analysis runs in the other direction too: every 1C record whose
`ID_nom` matched no MySQL product is listed under `unmatchedOneCRecords`, so
gaps on the 1C side are visible as well, not just gaps on the MySQL side.

Every result carries its **basis** — which key(s) matched, the matched
value(s) on both sides, and a human-readable `reasoning` string — so a
reviewer never has to take a verdict on faith. This is read-only analysis:
it performs no database writes, creates or mutates no
`external_entity_mappings` row, and never resolves a Sprint 12A.2 quarantine
item by itself.

CLI entrypoint: `bun run import:legacy:reconcile-1c -- --sql=<path> --feed=<path>`
(`apps/api/src/import/cli/reconcile-1c.ts`).

## 2. Matching key priority, and why

1. **GUID (MySQL `products.GUID`) ↔ `ID_nom` (1C)** — the *primary* identity
   link, not a coincidence. `docs/legacy-reference/workapp-1c-observed-contract.md`
   §3 confirms Legacy's own GUID "в Legacy при создании берётся из ID_nom"
   (taken from `ID_nom` at creation time). An exact hit here is the system's
   own original identity relationship, re-derived rather than assumed.
2. **Barcode** — a real-world physical/supplier identifier present on both
   sides. Strong, but secondary to GUID/`ID_nom`: a barcode can legitimately
   be shared across resellers or repackaged goods in ways a system-assigned
   id cannot.
3. **`VariativeNomenclature` (1C) ↔ a detected MySQL group-code pattern in
   `products.SKU`** — Sprint 12A.2 §13.3 found this exact pattern in the real
   MySQL data (e.g. `"A10.XXX"`, `"A8.XXX.XX"`, `"1502artdeco"`), including
   the literal `"A10.XXX"` group code already confirmed real via the Sprint
   10A.1 ANNY fixture. This is a **grouping**-level signal, not a
   single-record identity match on its own: the tool only promotes it to a
   match when the MySQL-side group resolves to exactly one product *and* the
   1C-side group resolves to exactly one record (a genuine 1:1 pairing). A
   group with multiple members on either side stays unmatched/ambiguous
   rather than guessing which member pairs with which.
4. **SKU — explicitly NOT used as a cross-system key.** Per
   `workapp-1c-observed-contract.md` §3, MySQL's `SKU` is "локальный SKU,
   формируемый при импорте из входной номенклатуры" (a *local* SKU generated
   by Legacy at import time) — it does not exist in the 1C products feed
   shape at all (`ProductsFeedRecord` in `../parsers/products-feed.ts` has no
   `SKU` field). This is recorded here deliberately, so the absence of SKU
   matching is a documented decision, not a gap someone has to rediscover.

## 3. Integration with the Sprint 12/12A.2 quarantine model

`quarantineMapFromCatalogDryRun(dryRun.products)` converts the Sprint 12A.2
`CatalogDryRunResult.products` list into the `priorQuarantine` map this
tool's `reconcileSqlWith1c` accepts. Any product already quarantined there
is forced to outcome `'quarantine'` here regardless of 1C match quality —
see §1. The CLI wires this automatically by running
`runLegacyCatalogDryRun` internally before reconciling.

## 4. Current limitation: no real 1C data exists yet

As of this sprint, the **only** 1C-shaped file in this repository is
`docs/legacy-reference/legacy-feed-samples.json`. Its own `meta.purpose`
field states it is an **"Обезличенный пример структуры Legacy-фидов для
проектирования импорта V2"** — an anonymized sample for designing the V2
import, not a real export. It contains 3 synthetic-looking sample records
(the ANNY fixture shades), not the full products catalog.

The smoke-test run documented in §5 below runs the CLI against this sample
file **purely to demonstrate the tool works end to end** — it is explicitly
labeled in the CLI's own output as **"NOT a real reconciliation"**, and must
never be cited as evidence about the real catalog's actual match rate
against 1C.

### What real 1C file(s) are needed for a genuine reconciliation run

Per `docs/legacy-reference/workapp-1c-observed-contract.md` §3, Legacy's
catalog import draws from three JSON feed files:

| File | Purpose | Fields this tool needs |
|---|---|---|
| **`products.json`** (1C "products" feed) | Main product/variant feed: descriptions, categories, brand, variants, stock, prices | `ID_nom` (required — primary match key), `VariativeNomenclature` (grouping match key), `Barcode` (secondary match key). Already covered by the existing `parseProductsFeed` / `ProductsFeedRecord` schema in `apps/api/src/import/parsers/products-feed.ts` — **no new parser is needed**, this tool consumes that schema's output directly. |
| **`pricevn.json`** | Prices and discounted prices | Not consumed by this reconciliation tool (it has no bearing on *identity* matching), but is the source Sprint 12 Task 4 already flagged for future ongoing price/stock sync — out of scope here. |
| **`JobVN.json`** | SEO/content updates | Not consumed by this tool for the same reason as `pricevn.json`. |

**Minimum needed for a real run: a real, full export of `products.json`**
(not a sample) — ideally covering the same product population as
`vizaje_catalog_only.sql`, so unmatched/ambiguous rates are measured against
a comparable universe rather than a handful of records. `pricevn.json` and
`JobVN.json` are not required for identity reconciliation itself.

## 5. Smoke-test demo (NOT a real reconciliation)

Command actually run during this sprint:

```
bun run import:legacy:reconcile-1c -- \
  --sql=docs/legacy-reference/vizaje_catalog_only.sql \
  --feed=docs/legacy-reference/legacy-feed-samples.json
```

Result (sanitized — counts and a bounded number of non-sensitive examples
only):

- `totalMysqlProducts`: 6999 (the real catalog, per Sprint 12 Phase A)
- `totalOneCRecords`: 3 (the anonymized sample — **not** a real export)
- `confirmed`: 0, `ambiguous`: 0, `unmatched`: 6596, `quarantine`: 403
- `byMatchKey`: `guid_id_nom`: 1, `barcode`: 1, `variative_nomenclature_group`: 0
- 2 of the 3 sample 1C records matched no MySQL product (`unmatchedOneCRecordCount: 2`)

Interpretation: the tool correctly found 1 GUID/`ID_nom` match and 1 barcode
match among the 3 sample records, and correctly kept both at outcome
`quarantine` (not `confirmed`) because the matched MySQL products were
already flagged by the Sprint 12A.2 catalog dry-run — exactly the
"quarantine wins" behavior described in §1, which is the useful thing this
smoke test actually verifies. It says **nothing** about the real catalog's
true match rate against 1C, since 3 sample records out of 6999 real products
is not a meaningful sample size and the sample file was never a real export
to begin with.

## 6. Tests

`apps/api/tests/import-reconcile-1c.test.ts` — synthetic fixtures only (no
field values copied from the real dump or any real 1C data), covering:
confirmed match via GUID/`ID_nom`, confirmed match via barcode, ambiguous
match via duplicate 1C `ID_nom`, ambiguous match via conflicting
GUID/barcode signals, unmatched (no candidate on any key), unmatched with no
keys available at all, a previously-quarantined product staying quarantined
through reconciliation (with match evidence still attached), the
`VariativeNomenclature` group-code match firing only on a genuine 1:1
pairing and *not* firing when the MySQL-side group has multiple siblings,
reverse-direction unmatched-1C-record detection, and summary/example-bucket
consistency across a mixed batch.
