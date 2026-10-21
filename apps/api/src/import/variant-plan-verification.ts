/**
 * Sprint 12B.5 verification follow-up: read-only post-hoc verification of
 * the FULL three-pass (Pass 0/1/2) catalog import plan.
 *
 * Every function here is pure/read-only and operates on data the importer
 * or reconciliation modules already produce - nothing here calls
 * `reconcileLegacyVariantFamilies`/`reconcileFamilies`/`reconcileSqlWith1c`/
 * `runCatalogImport` differently than they already run, and nothing here
 * changes matching or write behavior. It exists to answer, with concrete
 * numbers instead of assumptions, exactly how the combined plan looks.
 */
import type { CatalogImportUnitOutcome } from './catalog-importer'
import type { LegacyVariantFamilyClassification, LegacyVariantFamilyReconciliationResult } from './reconcile/legacy-variant-family-reconciliation'

export type ProductVariantCountBucket = '1' | '2-5' | '6-10' | '11+'

export type VariantPlanVerificationReport = {
	/** Count of created/updated units (across Pass 0/1/2 combined) with 2+ planned ProductVariants. */
	productsWithTwoPlusVariants: number
	/** Histogram of planned-variant-count per created/updated unit, bucketed 1 / 2-5 / 6-10 / 11+. */
	variantCountDistribution: Record<ProductVariantCountBucket, number>
	totalPlannedProducts: number
	totalPlannedVariants: number
}

function bucketFor(count: number): ProductVariantCountBucket {
	if (count === 1) return '1'
	if (count <= 5) return '2-5'
	if (count <= 10) return '6-10'
	return '11+'
}

/**
 * Question 1 and Question 5: computed directly from `runCatalogImport`'s
 * own `units` array - the real combined output of all three passes - rather
 * than re-deriving routing independently. (`computeV2PlanCounts` in
 * variant-parity-audit.ts only models Pass 1/Pass 2 and was never updated
 * for Sprint 12B.5's Pass 0, so it understates `products`/`variants` against
 * a real Pass-0-bearing run; this function is deliberately NOT built on top
 * of it, to avoid inheriting that gap.)
 */
export function computeVariantPlanVerification(units: CatalogImportUnitOutcome[]): VariantPlanVerificationReport {
	const variantCountDistribution: Record<ProductVariantCountBucket, number> = { '1': 0, '2-5': 0, '6-10': 0, '11+': 0 }
	let productsWithTwoPlusVariants = 0
	let totalPlannedProducts = 0
	let totalPlannedVariants = 0

	for (const unit of units) {
		if (unit.action === 'skipped') continue
		const count = unit.variantIds?.length ?? 0
		if (count === 0) continue
		totalPlannedProducts++
		totalPlannedVariants += count
		if (count >= 2) productsWithTwoPlusVariants++
		variantCountDistribution[bucketFor(count)]++
	}

	return { productsWithTwoPlusVariants, variantCountDistribution, totalPlannedProducts, totalPlannedVariants }
}

export type FamilyMemberCountDistribution = Record<LegacyVariantFamilyClassification, number[]>

/**
 * Question 2: per-classification member counts, extending the existing
 * `LegacyVariantFamilyReconciliationSummary` (which only reports family
 * COUNTS per classification) with the member-count DISTRIBUTION within
 * each classification - no new matching logic, just a different view over
 * `reconcileLegacyVariantFamilies`'s own already-computed `families` array.
 */
export function summarizeFamilyMemberCounts(result: LegacyVariantFamilyReconciliationResult): FamilyMemberCountDistribution {
	const byClassification: FamilyMemberCountDistribution = { confirmed: [], partial: [], quarantined: [] }
	for (const family of result.families) {
		byClassification[family.classification].push(family.confirmedMembers.length)
	}
	return byClassification
}
