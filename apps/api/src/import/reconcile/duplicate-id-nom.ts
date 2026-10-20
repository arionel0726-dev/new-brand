/**
 * Duplicate-`ID_nom` classification (Sprint 12A.4 Task 4).
 *
 * Sprint 12A.3's own aggregate audit (`docs/legacy-audit/vizaje-1c-audit.md`)
 * found that `ID_nom` - the field every prior sprint (10A/10A.1/12A.2)
 * treated as the clean 1C identity key - has duplicate groups *within the
 * 1C feed itself*: 771 groups / 1594 rows in `products.json` alone, plus
 * smaller rates in `pricevn.json`, `JobVN.json`, and `old_products.json`.
 * That finding only says *how many* rows collide on `ID_nom`; it says
 * nothing about *why*. This module answers "why", deterministically, once
 * real row-level records are available (today it is exercised only
 * against synthetic fixtures - see the accompanying test file).
 *
 * Four possible explanations per duplicate group, decided in this strict
 * priority order (most conservative first - a genuine identity conflict
 * always wins over a more benign explanation, even if some fields would
 * also qualify as "just mutable" or "just a variant marker"):
 *
 *   1. `identical`         - every field matches across all rows. A
 *      harmless repeated-row export artifact.
 *   2. `conflicting`       - at least one field outside the recognized
 *      "mutable" and "variant/warehouse marker" sets differs (e.g. `Brand`,
 *      `VariativeName`, a title/description field, `Sex`, `Barcode`,
 *      a `NomenclatureCategory*` field). This is the dangerous case: two
 *      materially different records sharing one `ID_nom`.
 *   3. `variant_or_warehouse` - every differing field is a recognized
 *      variant-attribute marker (`ColorVar`, `ColorVarMD`, `VolumeVar`) or
 *      a per-warehouse stock column (`Bal*`, e.g. `BalMall`, `BalUNIC`).
 *      This is a *candidate* finding, not a proven one: it suggests the
 *      "duplicate" rows may actually be encoding distinct variant or
 *      per-warehouse dimensions under one shared `ID_nom`, which a human
 *      reviewer should treat as informative, never as license to silently
 *      merge or split records automatically.
 *   4. `mutable_only`      - every differing field is a known mutable
 *      field (`Price`, `PriceWH`, `QuantityBalance`, `DiscountPrice`).
 *      Plausibly a re-export/snapshot of the same record at two different
 *      times, not a true conflict - but still surfaced, never silently
 *      collapsed, since this project's price/stock fields are explicitly
 *      out of scope for any automated resolution this sprint.
 *
 * This module never compares, merges, or discards records - it only
 * labels a group and lists *which field names* differ (never the field
 * *values*, per the Sprint 12 "no raw rows" restriction that still applies
 * here even though this module's own test fixtures are synthetic).
 */

export type IdNomDuplicateClassification = 'identical' | 'conflicting' | 'mutable_only' | 'variant_or_warehouse'

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

/** Price/stock fields known to be legitimately mutable across re-exports of the same logical row. */
const MUTABLE_FIELDS = new Set(['Price', 'PriceWH', 'QuantityBalance', 'DiscountPrice'])

/** Variant-attribute markers - a difference here suggests distinct variants sharing one ID_nom, not a conflict. */
const VARIANT_MARKER_FIELDS = new Set(['ColorVar', 'ColorVarMD', 'VolumeVar'])

/** Per-warehouse stock columns observed in the real audit (BalAtrium, BalELAT, BalG3, BalGRHILLS, BalMall, BalNR1, BalSC1, BalSC3, BalSOIUZ, BalUNIC, BalUNIC1, and any future BalXxx column). */
const WAREHOUSE_STOCK_FIELD_PATTERN = /^Bal/

function normalizeForComparison(value: unknown): string {
	if (value === undefined || value === null) return '\u0000NULL'
	return JSON.stringify(value)
}

function fieldsDiffer(records: Record<string, unknown>[], key: string): boolean {
	const first = normalizeForComparison(records[0][key])
	return records.some(r => normalizeForComparison(r[key]) !== first)
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

	const conflictingFields = differingFields.filter(
		f => !MUTABLE_FIELDS.has(f) && !VARIANT_MARKER_FIELDS.has(f) && !WAREHOUSE_STOCK_FIELD_PATTERN.test(f)
	)
	if (conflictingFields.length > 0) {
		return {
			idNom,
			recordCount: records.length,
			classification: 'conflicting',
			differingFields,
			note: `conflicts on field(s) outside the recognized mutable/variant sets: ${conflictingFields.join(', ')} - needs human review, never auto-resolved`
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
		note: `differs only in known-mutable field(s): ${differingFields.join(', ')} - plausibly a re-export/snapshot at a different time, not a true conflict`
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

	const byClassification: Record<IdNomDuplicateClassification, number> = {
		identical: 0,
		conflicting: 0,
		mutable_only: 0,
		variant_or_warehouse: 0
	}
	const exampleBuckets: Record<IdNomDuplicateClassification, IdNomDuplicateGroup[]> = {
		identical: [],
		conflicting: [],
		mutable_only: [],
		variant_or_warehouse: []
	}
	for (const group of classifiedGroups) {
		byClassification[group.classification]++
		if (exampleBuckets[group.classification].length < EXAMPLE_LIMIT) exampleBuckets[group.classification].push(group)
	}

	const toExample = (g: IdNomDuplicateGroup) => ({ idNom: g.idNom, recordCount: g.recordCount, differingFields: g.differingFields })

	return {
		totalGroups: classifiedGroups.length,
		byClassification,
		groups: classifiedGroups,
		examples: {
			identical: exampleBuckets.identical.map(toExample),
			conflicting: exampleBuckets.conflicting.map(toExample),
			mutable_only: exampleBuckets.mutable_only.map(toExample),
			variant_or_warehouse: exampleBuckets.variant_or_warehouse.map(toExample)
		}
	}
}
