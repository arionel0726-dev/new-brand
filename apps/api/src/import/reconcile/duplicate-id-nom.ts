/**
 * Duplicate-`ID_nom` classification (Sprint 12A.4 Task 4, refined in
 * Sprint 12A.5 Tasks 1 & 6 against the real reconciliation run's findings).
 *
 * Sprint 12A.3's own aggregate audit (`docs/legacy-audit/vizaje-1c-audit.md`)
 * found that `ID_nom` - the field every prior sprint (10A/10A.1/12A.2)
 * treated as the clean 1C identity key - has duplicate groups *within the
 * 1C feed itself*: 771 groups / 1594 rows in `products.json` alone, plus
 * smaller rates in `pricevn.json`, `JobVN.json`, and `old_products.json`.
 * That finding only says *how many* rows collide on `ID_nom`; it says
 * nothing about *why*. This module answers "why", deterministically.
 *
 * Sprint 12A.5's real run against the actual files reported 768/771
 * `products.json` groups as `conflicting` and 0 as `variant_or_warehouse`.
 * Reading this module's Sprint 12A.4 logic explains why: `Barcode` was
 * classified as an ordinary "unrecognized" field, so *any* group whose
 * records differ in `Barcode` - which, per the real audit, is the
 * overwhelmingly common case since `Barcode` is 99.9% distinct across the
 * feed - fell straight into `conflicting`, indistinguishable from a group
 * that differs in `Brand` or `NomenclatureCategory*`. That is a real
 * classification gap, not a report formatting issue: a barcode-only
 * difference under one `ID_nom` is very plausibly a multi-pack or
 * variant-level barcode, which is a materially different situation from a
 * brand/category/title conflict, and deserves its own bucket so a human
 * reviewer doesn't have to re-derive "oh, this 'conflict' is just a
 * barcode" by hand for every one of 768 groups. The same real run also
 * reported pricevn.json groups differing only in `Price`/`DiscountPrice`
 * being silently folded into the same soft `mutable_only` bucket as
 * `QuantityBalance`/`PriceWH` - the user's Task 6 explicitly requires a
 * price disagreement between two rows sharing one `ID_nom` to be
 * surfaced as its own, more serious category, never silently averaged,
 * first-picked, or last-picked (no code anywhere in this project
 * currently selects a price at all - see `docs/vizaje-1c-reconciliation-
 * plan.md` §8 for the full finding - but this classifier is the layer
 * that must make a future price-selection feature's job safe by refusing
 * to call a real price disagreement "benign").
 *
 * Five possible explanations per duplicate group, decided in this strict
 * priority order (most conservative/dangerous first - a field in an
 * earlier tier always wins over a later one, even when some other
 * differing field in the same group would also qualify for a later tier):
 *
 *   1. `conflicting`         - at least one field outside every other
 *      recognized set below differs (e.g. `Brand`, `VariativeName`, a
 *      title/description field, `Sex`, a `NomenclatureCategory*` field).
 *      This is the dangerous case: two materially different records
 *      sharing one `ID_nom`.
 *   2. `price_conflict`      - (and nothing from tier 1 differs) `Price`
 *      and/or `DiscountPrice` differ. A real, actionable pricing
 *      disagreement between two rows claiming the same `ID_nom` - always
 *      surfaced for human resolution, never silently resolved by picking
 *      either value.
 *   3. `barcode_only_conflict` - (and nothing from tiers 1-2 differs)
 *      only `Barcode` differs. A distinct, less severe signal than a
 *      general conflict. Sprint 12A.6: a VIZAJE-NICA employee confirmed
 *      this is a *known, legitimately occurring* real-world pattern - a
 *      single nomenclature position can have more than one barcode
 *      (observed manually in the live 1C system). This classification
 *      name is kept for continuity with Sprint 12A.5's real run, but it
 *      must NOT be read as "these are probably different products" - the
 *      confirmed interpretation is "one `ID_nom` identity, multiple
 *      barcodes", not a conflict about identity at all. Still never
 *      auto-merged - a human decides what to do with the confirmed
 *      multi-barcode set. See `docs/vizaje-1c-reconciliation-plan.md`
 *      §12A.6-A for the updated identity model and §12A.6-B for how this
 *      maps onto V2's schema.
 *   4. `variant_or_warehouse` - (and nothing from tiers 1-3 differs)
 *      every remaining differing field is a recognized variant-attribute
 *      marker (`ColorVar`, `ColorVarMD`, `VolumeVar`) or a per-warehouse
 *      stock column (`Bal*`, e.g. `BalMall`, `BalUNIC`). A *candidate*
 *      finding, not a proven one: it suggests the "duplicate" rows may
 *      actually be encoding distinct variant or per-warehouse dimensions
 *      under one shared `ID_nom`.
 *   5. `mutable_only`        - every differing field is a *soft* mutable
 *      field (`PriceWH`, `QuantityBalance`) - fields that legitimately
 *      fluctuate across re-exports/snapshots without indicating any real
 *      conflict. Still surfaced, never silently collapsed.
 *
 *   `identical` (no priority tier - checked first) - every field matches
 *   across all rows. A harmless repeated-row export artifact.
 *
 * This module never compares, merges, or discards records - it only
 * labels a group and lists *which field names* differ (never the field
 * *values*, per the Sprint 12 "no raw rows" restriction that still applies
 * here even though this module's own test fixtures are synthetic).
 */

export type IdNomDuplicateClassification =
	| 'identical'
	| 'conflicting'
	| 'price_conflict'
	| 'barcode_only_conflict'
	| 'mutable_only'
	| 'variant_or_warehouse'

export type IdNomDuplicateGroup = {
	idNom: string
	recordCount: number
	classification: IdNomDuplicateClassification
	/** Field *names* that differ across the group's records - never the values themselves. */
	differingFields: string[]
	note: string
}

export type IdNomDuplicateReport = {
	totalGroups: number
	byClassification: Record<IdNomDuplicateClassification, number>
	groups: IdNomDuplicateGroup[]
	/** A bounded number of sanitized illustrative examples per classification - ids, record counts, and differing field *names* only. */
	examples: Record<IdNomDuplicateClassification, { idNom: string; recordCount: number; differingFields: string[] }[]>
}

const EXAMPLE_LIMIT = 3

/**
 * Real price fields (Sprint 12A.5 Task 6) - a difference here is a genuine
 * pricing disagreement, never folded into the softer `mutable_only`
 * bucket and never silently resolved by any downstream code.
 */
const PRICE_FIELDS = new Set(['Price', 'DiscountPrice'])

/** Soft mutable fields: legitimately fluctuate across re-exports/snapshots of the same logical row without indicating a real conflict. */
const SOFT_MUTABLE_FIELDS = new Set(['PriceWH', 'QuantityBalance'])

/** Physical/supplier identifier - a difference here (Sprint 12A.5 Task 1) is its own, less severe signal than a general field conflict, never treated as proof of anything on its own. */
const BARCODE_FIELD = new Set(['Barcode'])

/** Variant-attribute markers - a difference here suggests distinct variants sharing one ID_nom, not a conflict. */
const VARIANT_MARKER_FIELDS = new Set(['ColorVar', 'ColorVarMD', 'VolumeVar'])

/** Per-warehouse stock columns observed in the real audit (BalAtrium, BalELAT, BalG3, BalGRHILLS, BalMall, BalNR1, BalSC1, BalSC3, BalSOIUZ, BalUNIC, BalUNIC1, and any future BalXxx column). */
const WAREHOUSE_STOCK_FIELD_PATTERN = /^Bal/

function normalizeForComparison(value: unknown): string {
	if (value === undefined || value === null) return '\u0000NULL'
	return JSON.stringify(value)
}

/**
 * Sprint 12B.1 (1C developer confirmation): `DiscountPrice = 0` means "no
 * discount," the same real-world state as a missing/null `DiscountPrice` -
 * never a genuine zero-price discount. Without this, a group where one
 * record has `DiscountPrice: null` and another has `DiscountPrice: 0`
 * would register as a real difference and wrongly escalate to
 * `price_conflict`, even though both records agree there is no discount.
 * Scoped to `DiscountPrice` only - a real `Price` of 0 is not confirmed
 * equivalent to anything and must keep comparing literally.
 */
function normalizeDiscountPriceForComparison(value: unknown): string {
	if (value === undefined || value === null || value === 0) return '\u0000NO_DISCOUNT'
	return JSON.stringify(value)
}

function fieldsDiffer(records: Record<string, unknown>[], key: string): boolean {
	const normalize = key === 'DiscountPrice' ? normalizeDiscountPriceForComparison : normalizeForComparison
	const first = normalize(records[0][key])
	return records.some(r => normalize(r[key]) !== first)
}

export function classifyIdNomDuplicateGroup(idNom: string, records: Record<string, unknown>[]): IdNomDuplicateGroup {
	if (records.length < 2) {
		throw new Error('classifyIdNomDuplicateGroup requires at least 2 records to classify a duplicate group')
	}

	const allKeys = new Set<string>()
	for (const r of records) for (const k of Object.keys(r)) allKeys.add(k)
	allKeys.delete('ID_nom')

	const differingFields = [...allKeys].filter(key => fieldsDiffer(records, key)).sort()

	if (differingFields.length === 0) {
		return {
			idNom,
			recordCount: records.length,
			classification: 'identical',
			differingFields: [],
			note: 'byte-for-byte identical repeated records - a harmless re-export artifact'
		}
	}

	const isRecognized = (f: string) =>
		PRICE_FIELDS.has(f) || SOFT_MUTABLE_FIELDS.has(f) || BARCODE_FIELD.has(f) || VARIANT_MARKER_FIELDS.has(f) || WAREHOUSE_STOCK_FIELD_PATTERN.test(f)

	// Tier 1: anything not recognized by a later, more specific tier is a
	// genuine conflict - always wins, even if some other differing field in
	// the same group would also qualify for a later tier.
	const conflictingFields = differingFields.filter(f => !isRecognized(f))
	if (conflictingFields.length > 0) {
		return {
			idNom,
			recordCount: records.length,
			classification: 'conflicting',
			differingFields,
			note: `conflicts on field(s) outside every recognized set: ${conflictingFields.join(', ')} - needs human review, never auto-resolved`
		}
	}

	// Tier 2: a real price disagreement - always its own category, never
	// folded into the softer mutable_only bucket (Sprint 12A.5 Task 6).
	const priceFields = differingFields.filter(f => PRICE_FIELDS.has(f))
	if (priceFields.length > 0) {
		return {
			idNom,
			recordCount: records.length,
			classification: 'price_conflict',
			differingFields,
			note: `price field(s) disagree between records sharing this ID_nom: ${priceFields.join(', ')} - a real pricing conflict requiring human resolution, never silently resolved by picking either value`
		}
	}

	// Tier 3: barcode-only difference - distinct from a general conflict
	// (Sprint 12A.5 Task 1): plausibly a multi-pack/variant-level barcode
	// under one ID_nom, never treated as proof on its own.
	const barcodeFields = differingFields.filter(f => BARCODE_FIELD.has(f))
	if (barcodeFields.length > 0) {
		return {
			idNom,
			recordCount: records.length,
			classification: 'barcode_only_conflict',
			differingFields,
			note: 'only Barcode differs between records sharing this ID_nom - confirmed by a VIZAJE-NICA employee (Sprint 12A.6) to be a real, legitimate pattern: one nomenclature position can have multiple barcodes. Not evidence of a different product; still never auto-merged - a human decides what to do with the confirmed multi-barcode set'
		}
	}

	const warehouseOrVariantFields = differingFields.filter(f => VARIANT_MARKER_FIELDS.has(f) || WAREHOUSE_STOCK_FIELD_PATTERN.test(f))
	if (warehouseOrVariantFields.length > 0) {
		return {
			idNom,
			recordCount: records.length,
			classification: 'variant_or_warehouse',
			differingFields,
			note: `differs only in variant/warehouse-dimension field(s): ${warehouseOrVariantFields.join(', ')} - candidate explanation only, may encode distinct variants or per-warehouse rows under one ID_nom`
		}
	}

	return {
		idNom,
		recordCount: records.length,
		classification: 'mutable_only',
		differingFields,
		note: `differs only in soft-mutable field(s): ${differingFields.join(', ')} - plausibly a re-export/snapshot at a different time, not a true conflict`
	}
}

/**
 * Groups `rawRecords` by their `idNomField` value and classifies every
 * group with 2+ members. Records with a missing/null id field are
 * excluded from grouping entirely (they cannot collide on an id they
 * don't have) rather than being bucketed under a fabricated empty-string
 * key.
 */
export function classifyIdNomDuplicates(rawRecords: Record<string, unknown>[], idNomField = 'ID_nom'): IdNomDuplicateReport {
	const groups = new Map<string, Record<string, unknown>[]>()
	for (const record of rawRecords) {
		const idRaw = record[idNomField]
		if (idRaw === undefined || idRaw === null) continue
		const id = String(idRaw)
		const list = groups.get(id) ?? []
		list.push(record)
		groups.set(id, list)
	}

	const classifiedGroups: IdNomDuplicateGroup[] = []
	for (const [idNom, records] of groups) {
		if (records.length < 2) continue
		classifiedGroups.push(classifyIdNomDuplicateGroup(idNom, records))
	}

	const ALL_CLASSIFICATIONS: IdNomDuplicateClassification[] = [
		'identical',
		'conflicting',
		'price_conflict',
		'barcode_only_conflict',
		'variant_or_warehouse',
		'mutable_only'
	]

	const byClassification = Object.fromEntries(ALL_CLASSIFICATIONS.map(c => [c, 0])) as Record<IdNomDuplicateClassification, number>
	const exampleBuckets = Object.fromEntries(ALL_CLASSIFICATIONS.map(c => [c, [] as IdNomDuplicateGroup[]])) as Record<
		IdNomDuplicateClassification,
		IdNomDuplicateGroup[]
	>
	for (const group of classifiedGroups) {
		byClassification[group.classification]++
		if (exampleBuckets[group.classification].length < EXAMPLE_LIMIT) exampleBuckets[group.classification].push(group)
	}

	const toExample = (g: IdNomDuplicateGroup) => ({ idNom: g.idNom, recordCount: g.recordCount, differingFields: g.differingFields })

	return {
		totalGroups: classifiedGroups.length,
		byClassification,
		groups: classifiedGroups,
		examples: Object.fromEntries(ALL_CLASSIFICATIONS.map(c => [c, exampleBuckets[c].map(toExample)])) as IdNomDuplicateReport['examples']
	}
}
