import type { ProductsFeedRecord } from '../parsers/products-feed'
import type { SourceSystem } from '../constants'
import type { ImportIssueCode } from '../issues'

export type CandidateVariant = {
	idNom: string
	barcode: string | null
	colorVar: string | null
	volumeVar: string | null
}

export type NormalizationIssue = {
	code: ImportIssueCode
	detail?: string
	recordIdentifier: string
	severity: 'warning' | 'error'
}

export type CandidateProduct = {
	/** Namespaced by source system (e.g. "1c:A10.XXX") - Task 6: "Namespace group identifiers by source and validate collisions", never assumed globally unique on its own. Null for a standalone (ungrouped) record. */
	groupKey: string | null
	sourceSystem: SourceSystem
	variativeName: string | null
	variants: CandidateVariant[]
	issues: NormalizationIssue[]
	/**
	 * False whenever this candidate is missing something this layer refuses
	 * to fabricate (a name, a resolvable group) - Task 6: "If required
	 * fields are missing, produce a validation issue and keep the record
	 * unpublished or rejected." A blocked candidate is still returned (for
	 * dry-run reporting), just never eligible to become a real product.
	 */
	publishable: boolean
}

export type NormalizationResult = {
	candidates: CandidateProduct[]
}

/**
 * Groups a parsed products-feed payload into candidate V2 products (one
 * per VariativeNomenclature group, or one per standalone record) - Task 6.
 * Pure and synchronous: no database access, no mapping resolution (that is
 * src/import/mappings.ts's job, run separately against these candidates).
 *
 * A critical, deliberate limitation given the data actually confirmed this
 * sprint: the products feed (per the confirmed legacy findings) carries no
 * field that names an *individual* product/variant - only VariativeName,
 * which names a *group*. A standalone record (no VariativeNomenclature)
 * therefore has no name source at all here, and even a grouped candidate
 * has no name for its variants individually (only the group/parent).
 * Rather than inventing one, every candidate this function cannot name is
 * returned with `publishable: false` and a `missing_required_field` issue
 * - see docs/vizaje-migration-architecture.md's "Unresolved" field-
 * ownership section. This is expected to resolve once the legacy MySQL
 * side (products.nameRu/nameRo, if any) is actually inspected.
 */
export function normalizeProductsFeed(records: ProductsFeedRecord[], sourceSystem: SourceSystem): NormalizationResult {
	const grouped = new Map<string, ProductsFeedRecord[]>()
	const standalone: ProductsFeedRecord[] = []

	for (const record of records) {
		if (record.VariativeNomenclature) {
			const groupKey = `${sourceSystem}:${record.VariativeNomenclature}`
			const bucket = grouped.get(groupKey) ?? []
			bucket.push(record)
			grouped.set(groupKey, bucket)
		} else {
			standalone.push(record)
		}
	}

	const candidates: CandidateProduct[] = []

	for (const [groupKey, members] of grouped) {
		candidates.push(buildGroupedCandidate(groupKey, members, sourceSystem))
	}

	for (const record of standalone) {
		candidates.push(buildStandaloneCandidate(record, sourceSystem))
	}

	return { candidates }
}

function buildGroupedCandidate(
	groupKey: string,
	members: ProductsFeedRecord[],
	sourceSystem: SourceSystem
): CandidateProduct {
	const issues: NormalizationIssue[] = []
	const distinctNames = [...new Set(members.map(m => m.VariativeName).filter((n): n is string => n !== null))]

	// Inconsistent group naming (Task 6: "detect duplicate and inconsistent
	// group membership") - the group is still produced, so a human reviewing
	// the dry-run report can see exactly what disagreed, but it is blocked
	// from auto-publishing until resolved.
	if (distinctNames.length > 1) {
		issues.push({
			code: 'ambiguous_variant_parent',
			detail: `group ${groupKey} has conflicting VariativeName values: ${distinctNames.join(' / ')}`,
			recordIdentifier: groupKey,
			severity: 'error'
		})
	}

	const variativeName = distinctNames[0] ?? null
	if (!variativeName) {
		issues.push({
			code: 'missing_required_field',
			detail: `group ${groupKey} has no VariativeName on any member`,
			recordIdentifier: groupKey,
			severity: 'error'
		})
	}

	const variants: CandidateVariant[] = members.map(toCandidateVariant)
	const publishable = issues.length === 0

	return { groupKey, sourceSystem, variativeName, variants, issues, publishable }
}

function buildStandaloneCandidate(record: ProductsFeedRecord, sourceSystem: SourceSystem): CandidateProduct {
	// No VariativeNomenclature means no VariativeName either (it is a
	// property of the group, not the individual record) - so a standalone
	// candidate from this feed alone never has a name source. Always
	// blocked until a name is supplied from elsewhere (Task 6/7).
	const issues: NormalizationIssue[] = [
		{
			code: 'missing_required_field',
			detail: `standalone record ${record.ID_nom} has no confirmed name source in the products feed`,
			recordIdentifier: record.ID_nom,
			severity: 'error'
		}
	]

	return {
		groupKey: null,
		sourceSystem,
		variativeName: null,
		variants: [toCandidateVariant(record)],
		issues,
		publishable: false
	}
}

function toCandidateVariant(record: ProductsFeedRecord): CandidateVariant {
	return {
		idNom: record.ID_nom,
		barcode: record.Barcode,
		colorVar: record.ColorVar,
		volumeVar: record.VolumeVar
	}
}

/**
 * Validates that no two candidate groups collide on groupKey across more
 * than one call to normalizeProductsFeed (e.g. two different feed files
 * processed in the same run) - Task 6: "validate collisions". Returns the
 * groupKeys that appear in more than one of the given candidate lists.
 */
export function findCrossBatchGroupCollisions(batches: CandidateProduct[][]): string[] {
	const seenIn = new Map<string, number>()
	for (const batch of batches) {
		for (const key of new Set(batch.map(c => c.groupKey).filter((k): k is string => k !== null))) {
			seenIn.set(key, (seenIn.get(key) ?? 0) + 1)
		}
	}
	return [...seenIn.entries()].filter(([, count]) => count > 1).map(([key]) => key)
}
