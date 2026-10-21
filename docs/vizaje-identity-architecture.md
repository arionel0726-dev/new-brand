# VIZAJE-NICA V2 — Identity Architecture & Migration Rules (Sprint 12B.0)

Status: **analysis and architecture only**. No PostgreSQL writes, no Drizzle
migrations created or applied, no Phase B execution. This document
consolidates the identity model, migration rules, proposed (not applied)
schema changes, unresolved pricing/inventory contracts, and the Phase B
readiness plan, following the forensic audit of the real legacy
CodeIgniter 3 importer (`legacy-1c-import-forensic-audit.md`, supplied
2026-10-21, not committed to this repo — see "Source of this document"
below).

This document does not replace `docs/vizaje-1c-reconciliation-plan.md`,
`docs/vizaje-sql-1c-reconciliation.md`, or `docs/vizaje-catalog-migration-report.md`.
It is the architecture layer sitting above them: those documents describe
what the reconciliation *tooling* does and what it *found*; this document
specifies what V2's *schema and migration rules* must be as a result.

## Source of this document and its evidence discipline

The forensic audit is a **static code audit** of the real legacy importer
(`application/controllers/Import.php` and related files), grounded in
exact `file:line` citations, performed without running any PHP/MySQL
code or making external requests. It tags every finding:

- **CONFIRMED** — directly follows from the source code or a measured
  local file. Treated here as reliable evidence of *actual legacy code
  behavior*.
- **INFERRED** — a plausible mechanism explanation for an observed
  pattern, not proof of the historical cause for any specific record.
- **UNKNOWN** — the code does not resolve the question; needs the 1C
  developer or further evidence.

Per the explicit instruction accompanying the audit: **CONFIRMED findings
are evidence of legacy implementation *behavior*, not instructions to
preserve legacy *bugs*.** Where the audit's own §11 names something a
legacy bug (non-unique parent lookup, `product_id` placeholder fallback,
scalar Barcode, last-write-wins), this document designs V2 away from it,
informed by now understanding the mechanism — never replicates it.

**Snapshot discrepancy — not reconciled, cited separately.** The audit's
own §0 measured its local `products.json`/`pricevn.json` and got
different counts than two other snapshots already in this Sprint 12
series:

| Metric | Sprint 12/12A.3 audit snapshot (`docs/legacy-audit/vizaje-1c-audit.json`) | Forensic audit local snapshot (§0) | Real local CLI run (Sprint 12A.5/12A.7, user's Mac) |
|---|---:|---:|---:|
| `products.json` rows | 18 057 | 17 941 | — (JSON side not itemized in the chat report) |
| Duplicate `ID_nom` groups | 771 | 761 | — |
| `pricevn.json` rows | 17 338 | 16 978 | — |
| Duplicate `ID_nom` groups (pricevn) | 84 | 84 | — |
| MySQL `products` total | — | — | 6 999 |

These are **three different snapshots in time**, not one dataset counted
three ways. Per the audit's own explicit caution ("Do not combine their
statistics as if they came from the same snapshot") and the user's own
finding #10, this document never merges, averages, or silently picks one
as authoritative. Every number cited below names its snapshot.

---

## A. Identity architecture

### A.1 The model

| Concept | V2 identity | Confirmed by |
|---|---|---|
| One confirmed product family (a 1C `VariativeNomenclature` group whose members have been independently corroborated, not just string-matched — see B.2) | One V2 `products` row | Audit §4.2 (legacy conflates this with `products.SKU`); employee confirmation (Sprint 12A.6, pt. 2); `external_entity_mappings.entity_type = 'nomenclature_group'` already modeled this in Sprint 10A, before this sprint — see A.4. |
| One nomenclature position (`ID_nom`) | One V2 `product_variants` row | Audit §4.1–4.2 confirms each `ID_nom` is one sellable position; `external_entity_mappings.entity_type = 'nomenclature'` already modeled this in Sprint 10A. |
| One nomenclature position's barcodes | A **set**, not a scalar | Audit §6.1 (CONFIRMED: legacy's own JSON contains multiple Barcode rows per `ID_nom`; `products.barcode`/`products_variable.barcode` are scalar fields that structurally cannot hold more than one); independently confirmed by the VIZAJE-NICA employee (Sprint 12A.6, pt. 1, "manually observed"). Two independent confirmations — treated as settled, not merely plausible. |
| A standalone nomenclature position (no `VariativeNomenclature`, or a `VariativeNomenclature` that resolves to a family of exactly one member) | A `products` row with exactly one, default, `product_variants` row | **V2 design judgment call**, not dictated by legacy. Legacy's own empty-`VariativeNomenclature` path (audit §2.4: `SKU = ID_nom`) shows legacy treats a standalone item as its own "group of one" — V2 keeps this shape (one parent + one child variant) rather than inventing a parentless-variant case, so every sellable item uniformly has exactly one owning `products` row, keeping the public API's product→variant traversal uniform regardless of family size. |
| `legacy_mysql` and `1c` external identities | Independent namespaces in `external_entity_mappings`, never merged just because their `external_id` strings look alike | Standing rule since Sprint 10A Task 2, reaffirmed by every subsequent sprint, consistent with audit §13 Q1's unresolved `ID_nom` reuse question (an independent-namespace design is robust to that answer either way). |

### A.2 Barcode: many-to-one, not 1:1

Two independent sources now confirm one nomenclature position can
legitimately carry multiple barcodes:

1. Audit §6.1 (CONFIRMED): legacy JSON itself contains repeat `ID_nom`
   rows differing only by `Barcode` — 752/761 duplicate-`ID_nom` groups
   in the forensic audit's own snapshot have more than one non-empty
   `Barcode` value.
2. The VIZAJE-NICA employee (Sprint 12A.6): "одна номенклатурная позиция
   действительно может иметь несколько штрихкодов. Такие случаи
   наблюдались вручную."

This **upgrades** Sprint 12A.5/12A.6's `barcode_only_conflict`
classification from "a plausible benign explanation to consider" to "the
confirmed correct interpretation for this specific shape of duplicate" —
see B.5.

### A.3 Group-code global uniqueness — still unverified, must not be assumed

The audit independently reaches the same open question Sprint 12A.6 already
flagged:

- Audit §4.3 (CONFIRMED): legacy's parent lookup (`products.SKU = VariativeNomenclature`)
  has no `order_by`, no uniqueness check, and no corroborating signal
  (brand/category/`VariativeNomenclature` cross-check) — `row()` returns
  an arbitrary one of potentially several matches.
- Audit §12.2 pt. 2 and §13 Q4 (UNKNOWN): explicitly asks whether one
  `VariativeNomenclature` always means one parent card, or whether the
  code can repeat across brands/categories.

V2's matching logic (Sprint 12A.7's `family-reconciliation.ts`) was
already built to never trust code-string equality alone — a
`confirmed_family` outcome requires independent GUID/barcode
corroboration between at least one member pair, and any corroborating
evidence that *contradicts* the pairing (a member whose GUID/barcode
points outside the family) sets `collisionRisk: true` and forces
`ambiguous_family`. This document confirms that design decision is
correct and should remain the standing rule, not be relaxed once
the 1C developer answers — relaxing it would only be safe if the answer
is "yes, globally unique, verified," and even then corroboration costs
nothing.

### A.4 `external_entity_mappings` already modeled this correctly

Reviewing `apps/api/src/db/schema/external-entity-mappings.ts`: its
`entity_type` enum already distinguishes `'nomenclature'` (→ V2
`product_variant`) from `'nomenclature_group'` (→ V2 `product`), with the
enum's own code comments stating this intent since Sprint 10A — *before*
this sprint's work and *before* the forensic audit existed. The gap the
audit and Sprint 12A.6/12A.7 found was never in this table's design; it
was in the **matching code** that decides which legacy/1C records
populate it (Sprint 12A.7's family-level redesign). No change to
`external-entity-mappings.ts` is proposed.

---

## B. Migration rules (deterministic, documentation-only — no code executes these yet)

Each rule below states: what the audit found legacy does (so the
mechanism is understood), and what V2 does instead.

### B.1 Family creation

- **Legacy (audit §4.1–4.2, CONFIRMED):** creates one `products` row per
  `ID_nom`, even within one `VariativeNomenclature` group (e.g. all 131
  `A10.XXX` rows in the audit's snapshot became 131 *candidate* parent
  rows). No group-by.
- **V2 rule:** a family becomes one `products` row only after
  `reconcileFamilies()` (Sprint 12A.7) returns `'confirmed_family'` for
  that group — i.e. at least one member pair corroborated by an
  independent key (GUID/barcode), no unresolved contradiction. A family
  with outcome `'ambiguous_family'`, `'unmatched_mysql_family'`, or
  `'unmatched_1c_family'` creates **no** `products` row during Phase B's
  first pass; it is queued for human review.

### B.2 Member attachment

- **Legacy (audit §4.2–4.3, CONFIRMED):** attaches a variant to whichever
  parent `row()` happens to return for a shared, non-unique SKU.
- **V2 rule:** a member attaches to a family's `products` row only as part
  of a `'confirmed_family'` resolution; within that family, individual
  position resolution uses the member's own `ID_nom`/GUID (primary) with
  barcode as supporting evidence only (Sprint 12A.3's standing rule,
  unchanged by the family redesign). A member whose own identifiers
  contradict the family assignment is never force-attached — it reports
  as `ConflictingMembership` (Sprint 12A.7) and goes to human review, not
  to either family.

### B.3 Duplicate GUID

- Preserve Sprint 12A.2's classification (14 groups in that round's
  snapshot) and Sprint 12A.5's finer `duplicate-id-nom.ts` tiers. Never
  auto-merge; a duplicate GUID blocks that `ID_nom`'s row from Phase B's
  first pass until classified.

### B.4 Duplicate `ID_nom`

- **Legacy (audit §2.3, CONFIRMED):** last-write-wins by JSON row order,
  no timestamp/source/quality comparison.
- **V2 rule:** never adopted. `duplicate-id-nom.ts`'s five-tier
  classification (`identical` / `conflicting` / `price_conflict` /
  `barcode_only_conflict` / `mutable_only` / `variant_or_warehouse`)
  stays the only path; `price_conflict` and `conflicting` groups are
  excluded from the first Phase B pass entirely (see B.9, D).

### B.5 Multiple Barcode

- **Legacy (audit §6.2, CONFIRMED):** scalar field, last value wins,
  earlier barcodes are lost with no audit trail.
- **V2 rule:** a nomenclature position's barcode set is the union of every
  `Barcode` value observed for its `ID_nom` across all source rows
  (MySQL + every 1C feed), deduplicated, with each value's first-seen
  source recorded. None is discarded. See C.1 for the proposed storage
  shape (`product_variant_barcodes`, not applied this sprint). A
  `barcode_only_conflict` classification (Sprint 12A.5/12A.6) is now
  treated as the **confirmed correct case** per A.2 — not folded into
  `conflicting`.

### B.6 Ambiguous groups

- Any family with `collisionRisk: true` (A.3) or more than one plausible
  `'confirmed_family'` candidate on either side goes to human review, not
  Phase B's first pass. No tie-breaking heuristic (title similarity,
  "more complete record wins," etc.) is applied automatically — legacy's
  own `row()`-returns-arbitrary-match is exactly the failure mode this
  rule exists to avoid.

### B.7 Orphan variants

- **Legacy (audit §4.4, CONFIRMED):** the *only* place `product_id=0`
  (new-variant-insert, no parent found) or `product_id=1`
  (existing-variant-update, no parent found) appears. The 463-variant
  `product_id=1` cluster and the remainder of the known 721 orphans from
  Sprint 12A.2/12A.5 are very plausibly (INFERRED, not proven for any
  specific row) a direct consequence of this exact code path.
- **V2 rule, stated explicitly per the user's restriction: V2 NEVER
  constructs a numeric placeholder parent FK (no `product_id = 0`, no
  `product_id = 1`, no equivalent).** An orphan position with no resolved
  parent has no `products.id` to attach to at all — it stays in
  `quarantine` (an explicit status, not a row pointing at an arbitrary
  real product) until a human resolves it. This is already how Sprint
  12A.3–12A.7's reconciliation code behaves — verified in code (see
  "Verification" below) and now pinned by a regression test.

### B.8 Missing categories

- Preserve Sprint 12A.2's decision: a product with no valid category
  reference is importable as unpublished/uncategorized if V2's schema
  supports that state (it already does — `product_categories` is a pure
  join table with no `NOT NULL`/`CHECK` forcing at least one row; a
  product can exist with zero category rows and `status = 'draft'`). No
  fabricated category is ever created to patch a broken reference.

### B.9 Conflicting prices

- Never auto-selected (first/last/any). A price-conflicting group (either
  the `price_conflict` tier of `duplicate-id-nom.ts`, or a cross-feed
  disagreement per D below) excludes that position's `product_prices` row
  from Phase B's first pass; the position itself may still be created
  (family/identity resolution and pricing resolution are independent),
  but it carries no price and is therefore unsellable until priced
  (consistent with the existing `product_prices` schema, which requires
  a price row at all — see C).

### B.10 Publication status

- **Legacy (audit §2.5, CONFIRMED):** new items get `isShown = 1`
  unconditionally; existing items never get `isShown` touched by
  `import()`; `import_variable()` sets `isShown = 1` on both insert *and*
  update, meaning a previously-hidden existing variant can be silently
  re-shown by the next import run.
- **V2 rule:** publication status is never auto-set to "published" by a
  reconciliation/import pass. A newly created `products`/`product_variants`
  row defaults to `status = 'draft'`/`isActive = false` respectively
  (matching the existing schema defaults — `products.status` defaults to
  `'draft'`, not `'active'`); publishing is a separate, explicit, human or
  policy-driven action. This avoids legacy's silent-re-show bug by
  construction.

---

## C. Schema design — proposed, **not applied**

All changes below are additive: new nullable columns or new tables with
foreign keys to existing tables. None rewrites or drops an existing
column, migration, or row. No migration file is created this sprint —
these are `CREATE TABLE`/`ALTER TABLE` shapes in prose only, per the
explicit restriction. (Current latest migration on disk:
`apps/api/drizzle/0012_clever_squirrel_girl.sql` — any future migration
implementing this proposal would be `0013_...` or later, not written now.)

### C.1 `product_variant_barcodes` (new table)

Today, `product_variants.barcode` is a single nullable `text` column with
a partial unique index (`product_variants_barcode_unique_idx`, unique
where non-null). This is the exact 1:1 assumption A.2 just confirmed is
false.

Proposed shape:

```text
product_variant_barcodes
  id            uuid primary key default gen_random_uuid()
  variant_id    uuid not null references product_variants(id) on delete cascade
  barcode       text not null
  is_primary    boolean not null default false
  source        text   -- e.g. 'legacy_mysql', '1c_products_json', '1c_jobvn_json' - free-text audit trail, not a new external_source_system enum value (that enum names *systems*, this names *which feed row* within a system contributed the value)
  created_at    timestamptz not null default now()

  unique (variant_id, barcode)                 -- one row per distinct barcode per variant
  unique (barcode) where is_primary             -- at most one primary barcode globally, mirroring today's global uniqueness constraint for whichever barcode is "the" canonical one
  -- at most one is_primary=true per variant_id enforced at the application layer (a partial unique index on (variant_id) where is_primary is also viable; left as an implementation choice for Phase B, not decided here)
```

Migration path (described, not applied): add the new table; backfill
every existing non-null `product_variants.barcode` value as that
variant's `is_primary = true` row; **do not drop** `product_variants.barcode`
in the same migration — keep it as a denormalized "current primary
barcode" cache column for read-path compatibility (every existing query
reading `product_variants.barcode` keeps working unmodified), updated by
application logic whenever the primary barcode changes. Dropping the
scalar column, if ever desired, is a separate, later, backwards-compatible-breaking
decision explicitly out of scope here.

### C.2 Localized SEO and slug aliases (new table)

Today, `products.slug` is a single unique `text` column; there is no
alias/redirect history table anywhere in the schema.

Audit §8.3 (CONFIRMED): legacy has **zero** redirect-history mechanism —
`update_url()`/`url_chech()` mutate `uri*` directly with no record of the
prior value, and an old numeric or title-SKU URL that no longer matches
`products.uri$lang` 404s with no fallback. This is exactly the failure
mode V2 must design away from (consistent with the existing, still-open
SEO migration strategy noted since Sprint 11's spec and
`docs/vizaje-migration-architecture.md`).

Proposed shape:

```text
product_slug_aliases
  id            uuid primary key default gen_random_uuid()
  product_id    uuid not null references products(id) on delete cascade
  locale        text not null  -- 'ru' | 'ro', matching the existing locale convention
  slug          text not null
  is_canonical  boolean not null default false  -- exactly one canonical row per (product_id, locale)
  source        text   -- 'legacy_numeric_uri' | 'legacy_title_sku_uri' | 'v2_generated' | ... - audit trail only
  created_at    timestamptz not null default now()

  unique (locale, slug)                                  -- a slug resolves to exactly one product within a locale, globally, forever (this is what makes a redirect a redirect and not a collision)
  -- exactly one is_canonical=true per (product_id, locale) enforced at the application layer
```

A category-level equivalent (`category_slug_aliases`) is a natural
parallel but not required for the first Phase B pass unless a legacy
category URI collision is actually found during reconciliation; not
proposed in detail here to avoid over-building speculative schema per
the Sprint 11/every-prior-sprint "don't add unused structure" convention.
`products.slug` itself stays as the single source for "the current
canonical slug," read-path-compatible exactly as in C.1; the alias table
is additive, consulted only on a 404 to attempt a redirect lookup before
actually 404ing.

### C.3 Short descriptions, ingredients, instructions

Today's `products` table has only `description_ru`/`description_ro` —
no short-description, ingredients, or instructions columns. The 1C field
audit (Sprint 12A.3,`docs/legacy-audit/vizaje-1c-audit.md`) and this
sprint's forensic audit both observe `ShortDescriptionRus`/`ShortDescriptionMD`,
`InstructionRU`/`InstructionMD`, `componentsRu`/`componentsMD` as real,
populated fields in the 1C feed; the legacy MySQL schema (per
`docs/vizaje-migration-architecture.md`'s own prior finding) separately
confirms `instructionRU/RO`, `componentsRU/RO` columns exist there too.

Proposed additive columns on `products`:

```text
short_description_ru   text   (nullable)
short_description_ro   text   (nullable)
ingredients_ru         text   (nullable)
ingredients_ro         text   (nullable)
instructions_ru        text   (nullable)
instructions_ro        text   (nullable)
```

All nullable, all additive — no existing row is affected, no existing
query that doesn't reference these columns changes behavior.

### C.4 Per-store inventory locations

Today's `inventory` table is one row per variant
(`variant_id unique references product_variants`), a single
`quantity_on_hand`/`quantity_reserved` pair — no warehouse dimension at
all. The 1C feed has (per the Sprint 12A.3 field audit) 11 `Bal*`
per-warehouse columns (`BalAtrium`, `BalELAT`, `BalG3`, `BalGRHILLS`,
`BalMall`, `BalNR1`, `BalSC1`, `BalSC3`, `BalSOIUZ`, `BalUNIC`,
`BalUNIC1`), plus a separate `QuantityBalance`. Section D below documents
why this sprint does **not** decide how these map onto a single
`quantity_on_hand` number — that mapping is itself an unresolved business
rule.

Proposed shape, for Phase B to populate **only once D's open questions
are answered** (schema proposed now so the modeling work isn't blocked
later, population rules intentionally deferred):

```text
inventory_locations
  id        uuid primary key default gen_random_uuid()
  code      text not null unique   -- e.g. 'atrium', 'elat', 'g3', 'mall', ... mirroring the Bal* suffixes 1:1 so the mapping is traceable, not re-invented
  name_ru   text
  name_ro   text
  is_active boolean not null default true

variant_inventory_by_location
  id            uuid primary key default gen_random_uuid()
  variant_id    uuid not null references product_variants(id) on delete cascade
  location_id   uuid not null references inventory_locations(id) on delete restrict
  quantity      integer not null default 0 check (quantity >= 0)
  updated_at    timestamptz not null default now()

  unique (variant_id, location_id)
```

Today's single `inventory` row stays as-is and becomes (once this table
exists and is populated) a computed/cached aggregate — the exact
aggregation rule (sum? a specific subset of locations?) is explicitly one
of D's open questions, not decided here.

### C.5 External identity tracking

Reviewed `external-entity-mappings.ts` in full (A.4): its existing
`source_system` (`legacy_mysql` | `1c`) × `entity_type` (`product` |
`product_variant` | `brand` | `category` | `nomenclature` |
`nomenclature_group`) model already covers every identity this sprint's
analysis needs. **No change proposed.** The one addition this document's
other proposals imply — tracking *which barcode came from which feed*
(C.1's `source` column) — is deliberately kept inside
`product_variant_barcodes` itself rather than growing a new
`external_entity_type`, because a barcode is an *attribute value*, not an
*entity* with its own lifecycle; routing it through
`external_entity_mappings` would conflate "the ID_nom 10568 maps to V2
variant X" (a real entity mapping) with "this specific barcode string
came from feed Y" (provenance on a value), which are different kinds of
fact.

### C.6 Sprint 12B.1 implementation status

C.1-C.4 above are now **implemented and applied to the isolated
`beauty_store_test` database only** (migration
`apps/api/drizzle/0013_strong_johnny_storm.sql`) - not production, no
other shared environment. Every change is additive (new nullable columns
on `products`, four new tables with foreign keys onto existing tables);
nothing existing was renamed, dropped, or made non-nullable. The full
Bun test suite (458 passed / 0 failed / 15 skipped, up from the Sprint
12B.0 baseline of 438/0/15 - the +20 are this sprint's own new tests) ran
sequentially against this migrated test database with no regression in
Cart, Checkout, Orders, or Catalog, confirming compatibility. Order
creation/reservation logic (Sprint 6/7) was not touched in any way this
sprint, per the standing restriction that it is manual-operator-driven
today and changing it needs separate sign-off.

One confirmed business rule narrowed C.1's design slightly from how it
first read: the VIZAJE-NICA 1C developer confirmed multiple barcodes per
position occur "including due to repackaging" - a real provenance fact,
not just a hypothetical - which is exactly what C.1's existing `source`
column already captures; no schema change was needed beyond what was
already proposed, only this confirmation that the column earns its place.

### C.7 Content inheritance (Task 8): no schema change needed

Business-rule confirmation from the 1C developer: a variant group has one
"main" position carrying the title/description; other positions inherit
that content and differ only by volume/color/etc. Reviewing the **already
existing** schema against this rule found it already matches exactly:
`products.name_ru`/`name_ro` are `NOT NULL` (the canonical, always-present
content, matching "the main position's" title), while
`product_variants.name_ru`/`name_ro` are nullable (an optional override,
not a required field) - there is nothing to migrate. The decision this
sprint makes **explicit** (previously implicit) is the read-path
contract: a consumer reading a variant's display name must fall back to
the parent `products` row's name when the variant's own `name_ru`/`name_ro`
is null, never render a blank name. The two admin serialization routes
that currently read `variant.nameRu`/`variant.nameRo` directly
(`src/routes/v1/admin/products.ts`, `src/routes/v1/admin/variants.ts`)
were reviewed; they pass the raw nullable value through to the admin UI
as-is today, which is fine for an admin context (an editor needs to see
"this variant has no override" distinctly from "this variant's override
text is empty") - the fallback-to-parent contract applies to
customer-facing read paths, not admin ones, and is noted here as a
contract for Phase B's catalog-serving code to implement, not a change
made to the admin routes this sprint.

### C.8 Identity constraints (Task 9): what got a DB unique constraint and what deliberately didn't

Reviewed every identity-bearing column against the two now-confirmed
collision risks (1C developer: `ID_nom` intended-but-historically-buggy
uniqueness; `VariativeNomenclature` intended-but-unvalidated uniqueness):

- **Got a DB-level unique constraint (unchanged, and correctly so):**
  `product_variants.sku` (`NOT NULL UNIQUE`) and
  `product_variants.barcode` (partial unique index, non-null values only).
  Both are **V2's own internal identifiers**, not raw unverified legacy
  values written straight through from a feed - the existing
  reconciliation/quarantine layer (Sprint 12A.1-12A.7) is what decides
  which legacy records are clean enough to ever reach a `product_variants`
  insert in the first place. A historical `ID_nom` duplicate or an
  unverified `VariativeNomenclature` collision is caught and quarantined
  *before* this table, never written to it, so the DB constraint here is
  protecting V2's own invariant, not re-litigating legacy's.
  `external_entity_mappings`' existing unique constraint on
  `(source_system, entity_type, external_id)` is the same situation: each
  individual `ID_nom` or group code is only ever mapped once it has been
  confirmed (not auto-merged) by reconciliation.
- **Deliberately did NOT get a raw-legacy-value unique constraint:**
  there is no column anywhere in this schema that stores a raw
  `VariativeNomenclature` group-code string as a trusted/unique key - it
  only ever appears as `external_entity_mappings.external_id`
  (`entity_type = 'nomenclature_group'`), which is unique *per source
  system*, not globally validated against the 1C side's own (unverified)
  uniqueness assumption. A collision between two unrelated 1C group codes
  normalizing to the same string is a reconciliation-layer concern
  (`family-reconciliation.ts`'s `collisionRisk` flag, Sprint 12A.7),
  never something the schema itself resolves or could resolve - the
  schema has no opinion on whether two *different* `external_id` rows
  "really" describe the same family; it only guarantees one `external_id`
  never silently maps to two different internal UUIDs.
- **New tables inherit the same discipline:** `product_variant_barcodes`
  has no unique constraint on `barcode` alone (only `(variant_id, barcode)`
  and the partial "one global primary" index) precisely because a raw
  barcode value is confirmed non-unique across variants (repackaging,
  multi-pack). `inventory_locations.code` IS uniquely constrained because
  it is V2's own enumeration of the 11 observed `Bal*` warehouses, chosen
  and named by this schema, not an untrusted pass-through value.

---

## D. Price and inventory contracts — unresolved, not decided here

For each item: what legacy does (confirmed, treated as bug not
spec), what's unknown, what V2's safe default is until answered.

### D.1 Authoritative retail `Price`

- **Legacy (audit §7.2, CONFIRMED):** no formal priority. `products.json`
  writes an initial value via `import()`; `pricevn.json`'s
  `update_price()` can overwrite it later via a *separate* HTTP endpoint
  with no verified call order. The actual winner is "whichever endpoint
  ran most recently" — not a real source-of-truth rule.
- **Unknown:** which feed the 1C developer intends as authoritative, and
  whether that intent is even stable across the two feeds existing at
  all (why would 1C export price twice, in two different shapes, if one
  were simply derivative of the other?).
- **V2 default until answered:** never auto-select. A position with Price
  candidates from more than one source that disagree is excluded from
  Phase B's first pass (consistent with B.9); both candidate values, their
  source, and the disagreement are surfaced for human pricing decision.

### D.2 `DiscountPrice` and sale rules

- **Legacy (audit §7.1, §7.4, CONFIRMED):** only `pricevn.json` carries
  `DiscountPrice`; `DiscountPrice = 0` is written as `discount_price = 0`,
  which legacy's own "скидки" page query (`discount_price > 0`) then
  correctly treats as "no discount," but this is incidental to how the
  write path works, not a documented zero-means-no-discount contract.
  V2's `product_prices.compare_at_price` (the existing schema's
  equivalent slot) has a `CHECK` requiring it to be strictly greater than
  `price` when present — i.e. V2 already models "no discount" as `NULL`,
  not `0`, which is the *safer* of the two conventions and should not be
  changed to match legacy's `0`-based convention.
- **Unknown:** whether `DiscountPrice` represents a scheduled/time-boxed
  sale, a permanent price reduction, or something else; no start/end date
  field was found anywhere in the audited feeds.
- **V2 default:** `DiscountPrice` populates `product_prices.compare_at_price`
  only when a positive value is present and exceeds `price`, consistent
  with the existing `CHECK` constraint; `0` or absent → `NULL`
  (no discount), not `0`.

### D.3 `PriceWH`

- **Legacy (audit §7.1, CONFIRMED):** only `products.json` carries
  `PriceWH`; `pricevn.json` does not carry it at all, so it structurally
  can never be refreshed by that endpoint.
- **Unknown:** what "WH" denotes (wholesale? warehouse-specific cost?)
  and whether V2 needs to model it at all for a B2C storefront, or only
  for a future B2B/admin-cost-visibility feature.
- **V2 default:** not mapped onto any customer-facing field in this
  sprint's proposal; if needed later, it is additive (a nullable
  `wholesale_price` column), not decided here.

### D.4 Price duplicates (within one feed)

- **Legacy (audit §7.3, CONFIRMED):** last-value-in-file wins, both in
  `import()` and `update_price()`. **Per the user's explicit restriction,
  this must not be copied into V2** — and it already isn't: Sprint
  12A.5's fix to `duplicate-id-nom.ts` introduced the `price_conflict`
  tier specifically so a price-disagreeing duplicate group is flagged,
  never silently resolved. This document reaffirms that fix as correct
  and permanent, not a temporary stopgap.
- **Unknown (audit §7.3, §13 Q6):** *why* 1C emits multiple prices for one
  `ID_nom` at all — different warehouses/price lists, historical dupes,
  multiple-barcode artifacts, pricing-zone differences, or export error.
- **V2 default:** quarantine the position's pricing (B.9), never guess.

### D.5 `QuantityBalance` and `BalMall`

- **Legacy (audit §4.2, CONFIRMED):** `import_variable()` computes variant
  quantity as `QuantityBalance + BalMall` (`Import.php:489-501`) —
  addition, not a choice between the two.
- **Unknown (audit §13 Q10/Q11, explicitly flagged by the audit itself as
  possibly double-counting):** whether `QuantityBalance` is already a
  sum that includes `BalMall`, in which case legacy's addition
  double-counts Mall stock, or whether they are genuinely independent
  figures that must be added.
- **V2 default:** do not reproduce the addition. Store each observed
  `Bal*` value (including `BalMall`) as its own
  `variant_inventory_by_location` row (C.4) once that table exists, and
  leave the aggregate `inventory.quantity_on_hand` computation rule
  explicitly undecided/unimplemented until the 1C developer confirms
  whether summing all locations is correct or double-counts.

### D.6 `Bal*` stock mapping (the other 9 warehouse columns)

- Same unresolved status as D.5, generalized: 11 `Bal*` columns were
  observed; their individual real-world meaning (one row per physical
  store? per fulfillment channel? some overlapping?) is unconfirmed.
  C.4's `inventory_locations.code` values are proposed to mirror the
  `Bal*` suffixes 1:1 precisely so this mapping stays traceable and
  reversible once answered, rather than collapsed into a guessed
  aggregate now.

### D.7 Feed timestamps, batch IDs, snapshots vs. deltas

- **Legacy (audit §1.2, CONFIRMED):** no scheduler, queue, or cron
  definition was found anywhere in the audited repository that would
  guarantee the order `import()` → `import_variable()` → `update_price()`
  → `update_qty()` actually runs in, or how often. This is a
  significant, previously-undocumented finding — prior sprints assumed
  "every ~30 minutes" (from the Sprint 12 kickoff context) as a
  *business* cadence, but the forensic audit found **no code-level
  evidence this ordering/cadence is actually enforced**, only that the
  separate endpoints exist.
- **Unknown:** whether each of `products.json`/`pricevn.json`/`JobVN.json`
  is a full snapshot or a delta on every export; whether any timestamp,
  batch ID, or export-generation marker exists anywhere in the feed or
  an accompanying header/filename that a V2 importer could use to order
  conflicting records deterministically.
- **V2 default:** V2's 1C-sync design (a future, still-unbuilt feature —
  explicitly out of scope for Phase B's first catalog-structure import)
  must not assume feed ordering is reliable. Until confirmed, any
  value-level conflict between two reads of the same feed, or between
  two different feeds, is surfaced for human/quarantine resolution, never
  resolved by "whichever arrived more recently through the sync job,"
  mirroring D.1's rule.

---

## E. Phase B readiness — a plan, not an execution

Still **not authorized to run**. Each step below states what it does,
what existing Sprint 12A.1–12A.7 tooling it reuses, and a concrete,
checkable acceptance criterion.

### E.1 Migrations and rollback

- **What:** apply the schema changes proposed in C (as real, reviewed
  Drizzle migrations — written and reviewed in a future sprint, not this
  one) to an **isolated** PostgreSQL instance only, never the shared
  `beauty_store_test` DB used by the existing test suite and never
  production.
- **Reuses:** the existing `drizzle-kit generate`/`db:migrate` tooling,
  unchanged.
- **Acceptance criteria:** (1) `drizzle-kit check` reports zero drift
  immediately after migration; (2) every new table/column is nullable or
  has a safe default — the full existing Sprint 1–12A.7 test suite
  (435 tests as of `e6a405a2`) passes unmodified against the migrated
  schema with zero code changes to existing queries; (3) a documented,
  tested `down` migration (or an explicit "additive, not reversed, drop
  manually if ever needed" note per column/table) exists for every
  change.

### E.2 Product-family normalization

- **What:** run `reconcileFamilies()` (Sprint 12A.7) against the real
  parsed MySQL catalog and real 1C feed records, producing the
  confirmed/ambiguous/unmatched family set.
- **Reuses:** `apps/api/src/import/reconcile/family-reconciliation.ts`,
  `apps/api/src/import/parsers/mysql-dump.ts`, `mysql-catalog.ts`,
  `products-feed.ts`, unchanged.
- **Acceptance criteria:** (1) every family in the `'confirmed_family'`
  bucket has at least one corroborating independent-key match (never zero
  — this is already a code invariant, re-verified by test before Phase B
  starts); (2) zero families with `collisionRisk: true` are included in
  the first import pass.

### E.3 Brands and categories

- **What:** import brands/categories from MySQL (already a clean,
  low-risk dataset per Sprint 12A.2 — only 3 products have no resolvable
  category at all, per that sprint's forensic finding).
- **Reuses:** existing admin Brands/Categories CRUD (Sprint 4A), the
  external-entity-mapping module (Sprint 10A).
- **Acceptance criteria:** (1) every imported brand/category has exactly
  one `external_entity_mappings` row per source system; (2) the 3
  known no-valid-category products (ids 1455/6519/7698, per the user's
  Sprint 12A.2 decision) are imported with **zero** `product_categories`
  rows, `status = 'draft'`, not a fabricated category.

### E.4 Products and variants

- **What:** materialize `'confirmed_family'` families as `products` rows
  and their within-family-resolved positions as `product_variants` rows.
- **Reuses:** E.2's output directly; B.1–B.2's rules.
- **Acceptance criteria:** (1) **zero** rows created with a placeholder
  parent reference of any kind — no row exists whose parent resolution
  mechanism was anything other than a `'confirmed_family'` outcome (this
  is the direct, measurable form of B.7's "never `product_id=0`/`1`"
  rule); (2) 100% of created `product_variants` rows trace back to either
  a confirmed family member or an explicit standalone-product decision —
  no variant exists without a documented reason for its parent
  assignment; (3) every ambiguous/unmatched/quarantined record from E.2
  is **excluded**, re-verified by a final pre-import count match (import
  candidate count + quarantined count + ambiguous count = total
  reconciliation input count, exactly, zero unaccounted records).

### E.5 Multiple barcodes

- **What:** populate `product_variant_barcodes` (C.1) with the full
  deduplicated barcode set per position, one `is_primary` row per
  variant.
- **Acceptance criteria:** (1) the `product_variant_barcodes` row count
  for a given variant equals the count of distinct non-empty `Barcode`
  values observed for that `ID_nom` across every source row fed into the
  import, exactly (no value dropped, no value duplicated); (2) legacy's
  `products_variants.barcode` cache column (C.1) matches the `is_primary`
  row's value for every variant, 100%.

### E.6 SEO metadata and URL aliases

- **What:** populate `product_slug_aliases` (C.2) with every known legacy
  URI variant (numeric `ID_nom`-based, title-SKU-based, and any
  `-id`-suffixed collision variant per audit §8.2) as non-canonical alias
  rows, and the current/intended V2 slug as the canonical row.
- **Acceptance criteria:** (1) every row of `products.slug` has exactly
  one corresponding `is_canonical = true` alias row per locale — no
  product with zero or multiple canonical aliases; (2) every distinct
  legacy numeric/title-SKU URI observed in the source data resolves,
  post-import, to a `product_slug_aliases` row (so a legacy bookmark or
  search-engine-indexed URL can redirect rather than 404 — directly
  closing the audit §8.3 gap).

### E.7 Media references

- **What:** import `product_images`/variant-image rows as *references*
  only — per the original Sprint 12 Task 5 restriction, still in force:
  no R2 upload, no claim that physical files exist, a manifest of
  expected assets only.
- **Acceptance criteria:** (1) zero R2 API calls made during this step,
  verified by the R2 client module's own call-count instrumentation (or
  absence of any R2 client import in the import code path at all); (2)
  every created `product_images` row has a non-null `url`/legacy source
  path recorded, even though the file itself is not yet confirmed to
  exist in R2.

### E.8 Validation and reconciliation

- **What:** a final full-dataset pass comparing import results against
  the pre-import reconciliation summary (E.2/E.4's counts).
- **Acceptance criteria:** the six-way family/position statistics from
  Sprint 12A.7's `FamilyReconciliationSummary` match the actual created
  row counts exactly, with a documented explanation for every
  discrepancy (there should be none, by construction, if E.1–E.7 ran
  correctly).

### E.9 Repeat-run idempotency

- **What:** run the entire Phase B import twice against the same isolated
  database.
- **Acceptance criteria:** (1) the second run creates **zero** new
  `products`/`product_variants`/`product_variant_barcodes`/
  `product_slug_aliases`/`external_entity_mappings` rows — every record
  the second run considers is recognized via `external_entity_mappings`
  as already-imported and updates (or no-ops) rather than duplicates;
  (2) row counts across every affected table are byte-for-byte identical
  after run 1 and after run 2; (3) zero duplicate
  `(source_system, entity_type, external_id)` tuples exist in
  `external_entity_mappings` after either run (the table's own existing
  `unique` constraint should make a true duplicate impossible at the DB
  level — this criterion verifies the import logic never even attempts
  one, rather than relying on the constraint to silently reject it).

### E.10 Quarantine and failure recovery

- **What:** every record quarantined by reconciliation (orphans,
  ambiguous families, price conflicts, no-valid-category products with no
  human decision yet, etc.) is tracked in a durable, queryable form (the
  existing `import_record_issues`/`import_runs` tables from Sprint 10A,
  extended if needed) so a human can resolve and re-run without
  re-deriving the quarantine list from scratch.
- **Acceptance criteria:** (1) every quarantined record from the
  pre-import reconciliation appears in `import_record_issues` with a
  specific, non-generic reason code (not a bare "quarantined" with no
  context); (2) a partial-failure mid-import (e.g. the process is killed
  after creating 3 000 of 6 596 products) leaves the database in a state
  where re-running the import is safe and idempotent per E.9 — no manual
  cleanup required before a retry.

### Overall acceptance for approving the first real test import

All of E.1–E.10's individual criteria, plus: the 1C developer has
answered at minimum D.1 (price source of truth) and A.3 (group-code
uniqueness) — these two are the only items whose answer actually changes
import *behavior* (not just documentation) for the first pass, since
Phase B's first pass is structured to simply exclude/quarantine anything
touched by an unanswered question (D.2–D.7, A.3's collision handling)
rather than guess. Every other open question in the consolidated list
below can be answered after the first structural (non-pricing,
non-barcode-primary-selection) import, since the architecture already
defers those decisions safely.

---

## Consolidated open questions for the 1C developer / user

Merged with the forensic audit's own §13 (not duplicated — items already
listed there are cited by number, not re-stated in full; only genuinely
new questions from this sprint's analysis are spelled out).

**From the forensic audit §13 (still open, highest priority first):**
Q4 (group-code global uniqueness — A.3; **Sprint 12B.1 narrowed, not
resolved**: the 1C developer confirmed the code is *intended* to be
unique but *not validated* by 1C - scope, i.e. per-brand or global,
remains the open part, see new question 1 below), Q6/Q7 (which feed is
authoritative for price; **partially resolved** - `DiscountPrice = 0`
confirmed to mean "no discount," see C.6/the `duplicate-id-nom.ts` fix,
but the broader "which feed wins, Price vs pricevn.json, when both are
genuinely non-zero and disagree" question is still open), Q10/Q11
(`QuantityBalance`/`Bal*` meaning, is the legacy addition correct — D.5,
still fully open, C.4's schema intentionally stores raw per-location data
without aggregating it pending this answer), Q2/Q3 (multiple-barcode
meaning **confirmed** by both the employee and the audit - the remaining
open part is primary-selection, sharpened as new question 3 below), Q1
(is `ID_nom` ever reused — **partially answered**: the 1C developer
confirmed a known historical bug produced *simultaneous* duplicate
`ID_nom` values; whether an `ID_nom` is ever *reused* for a different
product over time, a related but distinct question, is still open), Q5
(are `VariativeNomenclature`/SKU/Barcode case-sensitive in 1C itself,
independent of V2's own case-normalization choice), Q15 (is `JobVN.json`
SEO-only or should it also carry authoritative price/content), Q16 (what
is `old_products.json`).

**New, sharpened, or added by this sprint's architecture work:**

1. (Sharpens audit Q4 / Sprint 12A.6's open question) Is
   `VariativeNomenclature` scoped per-brand, or truly global across the
   entire catalog? A.3's corroboration-required design is safe either
   way, but knowing the answer lets V2 eventually relax to trusting
   code-string equality alone for performance, if the 1C developer
   confirms global uniqueness is enforced on the 1C side.
2. (New, from D.7) Does any 1C export carry a timestamp, batch ID, or
   generation marker anywhere — in the JSON body, response headers, or
   filename convention — that a future delta-sync design could use to
   order conflicting records deterministically? The forensic audit found
   no such mechanism in the legacy importer's own code, but that does not
   confirm the 1C *exporter* itself lacks one that legacy simply never
   reads.
3. (Sharpens audit Q3, now that A.2 confirms multiple barcodes is the
   correct model, not a feed anomaly) Does 1C itself designate one
   barcode as "primary" per nomenclature position, or is primary-barcode
   selection purely a V2-side UX decision with no 1C-side source of
   truth? This decides whether C.1's `is_primary` is populated from 1C
   data or must be a V2-only default (e.g. "first barcode seen" or
   "shortest/EAN-13-shaped barcode") — a decision this document
   deliberately leaves open rather than guessing.
4. (New, from C.4/D.5–D.6) For each of the 11 observed `Bal*` columns,
   what physical location or channel does it represent, and is
   `QuantityBalance` already inclusive of all of them (making legacy's
   `QuantityBalance + BalMall` addition in `import_variable()` a
   double-count bug) or genuinely independent?
5. (New, from E.10/process) What is the actual intended ongoing
   production trigger for the four import endpoints audit §1.1 found
   (`import`, `import_variable`, `update_price`, `update_seo`) — are they
   cron-scheduled, triggered externally, or run manually? This doesn't
   block Phase B's one-time structural migration, but it directly blocks
   ever designing the "every ~30 minutes" ongoing 1C sync mentioned in
   this Sprint 12 series' original kickoff context, since audit §1.2
   found no such scheduling mechanism exists in the audited code at all.
   **Sprint 12B.1 confirms this sync is not yet live regardless - imports
   are currently manual** - so this question is about future design, not
   a currently-missed signal.
6. (New, from Sprint 12B.1's business-rule confirmations) The 1C
   developer confirmed multiple barcodes occur "including due to
   repackaging" - does 1C's own data distinguish a superseded
   (repackaged-away) barcode from a currently-valid one in any way (a
   status flag, an end-date, simply "the most recent value wins"), or is
   that distinction entirely absent from the source and something V2
   would have to infer (e.g. "the barcode `update_price()`/the latest
   feed row carries is current")? This sharpens new question 3 above
   (primary-barcode selection) with the repackaging angle specifically.
7. (New, from Sprint 12B.1's business-rule confirmations) The 1C
   developer confirmed a variant group has one "main" position with the
   title/description that others inherit. Is that "main" position
   explicitly marked in the 1C data (a flag, a specific field value), or
   is it something the legacy/V2 side has to infer (e.g. "the first
   `ID_nom` seen for the group," or "the one whose title isn't blank")?
   C.7's read-path contract (fall back to the parent `products` row) only
   works correctly if V2's own reconciliation can reliably pick the
   right nomenclature position to source that parent content FROM in the
   first place - this is a Phase B population-rule question, not
   something C.7's schema design itself can resolve.

## Verification

No PostgreSQL schema changed. No migration created. No code changed
beyond one new regression test (see commit) pinning the already-correct
"never construct a product_id=0/1-style placeholder" invariant verified
by reading `apps/api/src/import/reconcile/sql-1c-reconciliation.ts` and
`family-reconciliation.ts` in full: both modules' only possible outcomes
are `'confirmed'`/`'ambiguous'`/`'unmatched'`/`'quarantine'` (whole-dataset
matcher) and `'confirmed_family'`/`'ambiguous_family'`/
`'unmatched_mysql_family'`/`'unmatched_1c_family'` +
`'confirmed_position'`/`'ambiguous_position'`/`'unmatched_position'`/
`'quarantine'` (family matcher) — neither ever assigns a numeric
placeholder foreign key anywhere in either module.

## Sprint 12B.1 verification

C.1-C.4 implemented and applied to the isolated `beauty_store_test`
database (migration `apps/api/drizzle/0013_strong_johnny_storm.sql`) -
never production, never any other shared environment. One narrow,
directly-scoped fix to `apps/api/src/import/reconcile/duplicate-id-nom.ts`
(the 1C developer's confirmation that `DiscountPrice = 0` means "no
discount," not a real zero-price discount - without this, a group where
one record has `DiscountPrice: null` and another has `DiscountPrice: 0`
wrongly escalated to `price_conflict`). No order-creation/reservation
code (Sprint 6/7) touched.

- `bunx tsc --noEmit`: clean.
- `bunx drizzle-kit check`: clean (no drift) after the new migration was
  applied.
- `information_schema` + insert/reject tests against the real applied
  schema (`apps/api/tests/schema-sprint-12b1.test.ts`, 18 tests): confirm
  the new tables' actual constraint shape, not just "the migration ran" -
  multiple barcodes per variant succeed, a duplicate `(variant_id,
  barcode)` pair is rejected, two variants cannot both claim the same
  barcode as globally primary but CAN share a non-primary barcode value,
  cascading delete from a variant removes its barcode/inventory rows, a
  slug alias collision across products within one locale is rejected
  while the same slug text is allowed to repeat across different
  locales, an unrecognized locale is rejected by the check constraint, a
  negative per-location quantity is rejected, deleting a location that
  still has recorded stock is rejected (RESTRICT), and
  `product_variants.sku`/`barcode`'s existing DB-level uniqueness
  (V2-internal identifiers) is confirmed still enforced and unchanged.
- Two new tests in `apps/api/tests/import-duplicate-id-nom.test.ts`
  confirm the `DiscountPrice` fix: `null` vs `0` now classifies as
  `identical`, while `null` vs a real nonzero value still correctly
  classifies as `price_conflict`.
- Full suite, sequential (`bun test --parallel=1`), against the migrated
  isolated test database, after confirming no concurrent `bun test`
  process: **458 passed / 0 failed / 15 skipped** (473 total, 34 files) -
  up from the Sprint 12B.0 baseline of 438/0/15 by exactly the +20 new
  tests this sprint added, with zero regressions in Cart, Checkout,
  Orders, or Catalog.
