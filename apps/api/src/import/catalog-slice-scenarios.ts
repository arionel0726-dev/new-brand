/**
 * Sprint 12B.6 Requirement 2: a convenience "auto-select" mode on top of
 * `catalog-slice.ts`'s generic FK-closure primitive, which picks a small
 * set of legacy product ids covering the scenario diversity a first
 * controlled integration test needs to see:
 *   - a standalone product
 *   - a multi-variant (Pass 0 `confirmed`) family
 *   - a partially-confirmed (Pass 0 `partial`) family
 *   - a hidden product (`isShown = false`)
 *   - a barcode-only duplicate ID_nom group (aggregates onto one variant)
 *   - a genuinely conflicting case that should end up quarantined
 *
 * This module only INSPECTS already-computed reconciliation results (Pass 0
 * family reconciliation, Pass 2 position reconciliation, ID_nom duplicate
 * classification) to decide which legacy product ids to hand to
 * `buildCatalogSlice` - it never re-implements or second-guesses their
 * matching logic, and it never fabricates an id: a scenario that genuinely
 * has no example in the dump is reported as missing, not invented.
 */
import type { LegacyCatalogDump } from './parsers/mysql-catalog'
import type { LegacyVariantFamilyReconciliationResult } from './reconcile/legacy-variant-family-reconciliation'
import type { ReconciliationResult } from './reconcile/sql-1c-reconciliation'
import type { IdNomDuplicateReport } from './reconcile/duplicate-id-nom'

export type SliceScenarioKind =
	| 'standalone'
	| 'confirmed_multi_variant_family'
	| 'partial_family'
	| 'quarantined_family'
	| 'hidden_product'
	| 'barcode_only_duplicate_group'

export type SliceScenarioCoverage = {
	kind: SliceScenarioKind
	legacyProductId: number
	note: string
}

export type AutoSelectDiverseSliceInputs = {
	dump: LegacyCatalogDump
	legacyVariantFamilies: LegacyVariantFamilyReconciliationResult
	positions: ReconciliationResult
	idNomDuplicates: IdNomDuplicateReport
}

export type AutoSelectDiverseSliceResult = {
	legacyProductIds: number[]
	coverage: SliceScenarioCoverage[]
	/** Scenario kinds requested but not found anywhere in the supplied dump/reconciliation results - never silently dropped. */
	missingScenarios: SliceScenarioKind[]
}

/**
 * Requirement 2's auto-select convenience mode: scans the supplied
 * reconciliation results (not the raw dump alone - a hidden product or a
 * barcode-duplicate group can only be identified from 1C-side evidence)
 * for one real example of each scenario kind.
 */
export function autoSelectDiverseSlice(inputs: AutoSelectDiverseSliceInputs): AutoSelectDiverseSliceResult {
	const dumpProductIds = new Set(inputs.dump.products.map(p => p.id))
	const coverage: SliceScenarioCoverage[] = []
	const missingScenarios: SliceScenarioKind[] = []
	const picked = new Set<number>()

	function record(kind: SliceScenarioKind, legacyProductId: number | undefined, note: string) {
		if (legacyProductId !== undefined && dumpProductIds.has(legacyProductId) && !picked.has(legacyProductId)) {
			coverage.push({ kind, legacyProductId, note })
			picked.add(legacyProductId)
		} else {
			missingScenarios.push(kind)
		}
	}

	// Pass 0 multi-variant families: `legacyProductId` is the hypothesis
	// parent id - only usable as a slice seed when that id is itself a real
	// `products` row in this dump (never fabricated as a stand-in).
	const confirmedFamily = inputs.legacyVariantFamilies.families.find(
		f => f.classification === 'confirmed' && f.confirmedMembers.length >= 2 && dumpProductIds.has(f.legacyProductId)
	)
	record(
		'confirmed_multi_variant_family',
		confirmedFamily?.legacyProductId,
		confirmedFamily
			? `Pass 0 confirmed family with ${confirmedFamily.confirmedMembers.length} confirmed members`
			: 'no Pass 0 confirmed multi-variant family (2+ confirmed members) found in this dump'
	)

	const partialFamily = inputs.legacyVariantFamilies.families.find(
		f => f.classification === 'partial' && dumpProductIds.has(f.legacyProductId)
	)
	record(
		'partial_family',
		partialFamily?.legacyProductId,
		partialFamily
			? `Pass 0 partial family: ${partialFamily.confirmedMembers.length} confirmed / ${partialFamily.unconfirmedMembers.length} unconfirmed members`
			: 'no Pass 0 partial family found in this dump'
	)

	const quarantinedFamily = inputs.legacyVariantFamilies.families.find(
		f => f.classification === 'quarantined' && dumpProductIds.has(f.legacyProductId)
	)
	if (quarantinedFamily) {
		record('quarantined_family', quarantinedFamily.legacyProductId, `Pass 0 quarantined family: ${quarantinedFamily.reasoning}`)
	} else {
		// Fall back to a Pass 2 position-level quarantine - either source
		// satisfies "a genuinely conflicting case that should end up
		// quarantined", and Pass 0 quarantine candidates are comparatively rare.
		const quarantinedPosition = inputs.positions.mysqlResults.find(r => r.outcome === 'quarantine')
		record(
			'quarantined_family',
			quarantinedPosition?.legacyProductId,
			quarantinedPosition
				? `Pass 2 quarantined position: ${quarantinedPosition.reasoning}`
				: 'no quarantined family or position found in this dump'
		)
	}

	const hiddenProduct = inputs.dump.products.find(p => p.isShown === false)
	record('hidden_product', hiddenProduct?.id, hiddenProduct ? 'legacy isShown=false' : 'no isShown=false product found in this dump')

	// A barcode-only-duplicate ID_nom group makes `matchProduct`
	// (sql-1c-reconciliation.ts) see 2+ raw 1C records on a single matched
	// key, so the position-level outcome here is `ambiguous`
	// (`duplicate_1c_records_on_single_key`), not `confirmed` - exactly the
	// module's own documented stance that a barcode-only duplicate is
	// "never auto-merged - a human decides". `matchedOneCIdNoms` is
	// populated on the raw match attempt regardless of final outcome, so it
	// still identifies which legacy product carries this group.
	const barcodeDuplicateGroup = inputs.idNomDuplicates.groups.find(g => g.classification === 'barcode_only_conflict')
	const barcodeDuplicatePosition = barcodeDuplicateGroup
		? inputs.positions.mysqlResults.find(r => r.matchedOneCIdNoms.includes(barcodeDuplicateGroup.idNom))
		: undefined
	record(
		'barcode_only_duplicate_group',
		barcodeDuplicatePosition?.legacyProductId,
		barcodeDuplicateGroup
			? barcodeDuplicatePosition
				? `ID_nom ${barcodeDuplicateGroup.idNom} has ${barcodeDuplicateGroup.recordCount} barcode-only-duplicate 1C records (position outcome: ${barcodeDuplicatePosition.outcome}) - surfaced for human review, never auto-merged`
				: `ID_nom ${barcodeDuplicateGroup.idNom} is a barcode-only duplicate group, but no Pass 2 position resolves to it`
			: 'no barcode_only_conflict ID_nom duplicate group found'
	)

	const familyMemberIds = new Set(
		inputs.legacyVariantFamilies.families.flatMap(f => (f.classification === 'quarantined' ? [] : [f.legacyProductId]))
	)
	const standaloneProduct = inputs.positions.mysqlResults.find(
		r => r.outcome === 'confirmed' && r.legacyProductId !== undefined && !familyMemberIds.has(r.legacyProductId) && !picked.has(r.legacyProductId)
	)
	record(
		'standalone',
		standaloneProduct?.legacyProductId,
		standaloneProduct ? 'Pass 2 confirmed standalone position, not claimed by any Pass 0 family' : 'no standalone confirmed position found in this dump'
	)

	return { legacyProductIds: [...picked], coverage, missingScenarios }
}
