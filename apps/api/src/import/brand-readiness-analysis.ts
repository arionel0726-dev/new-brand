/**
 * Sprint 12B.8: read-only, per-brand analysis of the full three-pass
 * reconciliation output, built to help pick a representative brand for the
 * NEXT, larger controlled import slice (the one after the real 4-product/
 * 7-variant Mac run from Sprint 12B.6.1/12B.7).
 *
 * Every number here is derived by calling the EXISTING reconciliation
 * passes (`reconcileLegacyVariantFamilies`, `reconcileFamilies`,
 * `reconcileSqlWith1c`, `classifyIdNomDuplicates`) with their own, unchanged
 * logic - nothing here re-implements matching/classification. The only new
 * work is grouping their already-computed per-legacy-product outcomes by
 * brand, using the same Pass 0 > Pass 1 > Pass 2 precedence
 * `runCatalogImport` itself applies (`handledLegacyIds`), so a legacy
 * product is attributed to exactly one pass here too - never double-counted
 * across passes, and never re-derived independently of what a real import
 * would actually do with it (the same staleness risk `variant-parity-audit.ts`
 * had, which `variant-plan-verification.ts` was built to avoid).
 */
import type { LegacyCatalogDump } from './parsers/mysql-catalog'
import type { ProductsFeedRecord } from './parsers/products-feed'
import type { FamilyReconciliationResult } from './reconcile/family-reconciliation'
import type { ReconciliationResult } from './reconcile/sql-1c-reconciliation'
import type { IdNomDuplicateReport, IdNomDuplicateClassification } from './reconcile/duplicate-id-nom'
import { reconcileLegacyVariantFamilies, type LegacyVariantFamilyReconciliationResult } from './reconcile/legacy-variant-family-reconciliation'
import type { QuarantineReasonCode } from './dry-run-catalog'

export type BrandPassBucket =
	| 'pass0_confirmed'
	| 'pass0_partial'
	| 'pass0_quarantined'
	| 'pass1_confirmed_family'
	| 'pass1_quarantine'
	| 'pass1_unmatched_or_ambiguous'
	| 'pass2_confirmed'
	| 'pass2_quarantine'
	| 'pass2_ambiguous_or_unmatched'

export type BrandConflictCounts = {
	conflicting: number
	priceConflict: number
	barcodeOnlyConflict: number
}

export type BrandAnalysis = {
	/** Legacy `brandId`, or `null` for legacy products with no brand assigned at all. */
	brandId: number | null
	totalLegacyProducts: number
	/** How many legacy products contributed 1 / 2 / 3+ confirmed variants (0 is excluded - nothing was confirmed for it, so it has no variant count yet). */
	variantCountDistribution: { '1': number; '2': number; '3+': number }
	distinctCategoryCount: number
	categoryIds: number[]
	byPassBucket: Record<BrandPassBucket, number>
	conflicts: BrandConflictCounts
}

export type BrandReadinessReport = {
	brands: BrandAnalysis[]
	/** Legacy products whose `brandId` is null - reported separately, never silently folded into one of the real brands. */
	unassignedProductCount: number
}

/** Exported for Sprint 12B.9's brand-representative-slice.ts, which needs the same per-legacy-product pass attribution to pick slice candidates - reused as-is, never re-derived. */
export type Attribution = { legacyProductId: number; confirmedVariantCount: number; bucket: BrandPassBucket }

/**
 * Builds the idNom -> legacyProductId map from every pass's own confirmed
 * matches (Pass 0's `confirmedMembers`, Pass 1's `positions`, Pass 2's
 * `mysqlResults`) - reused as-is to scope the Sprint 12A.5/12B.1
 * duplicate-ID_nom conflict counts (`classifyIdNomDuplicates`'s output) to
 * the brand of the legacy product that ID_nom actually belongs to. An
 * ID_nom with no confirmed owner anywhere is left unattributed rather than
 * guessed.
 */
/** Exported for Sprint 12B.9's brand-representative-slice.ts - same reuse rationale as `Attribution` above. */
export function buildIdNomOwnerMap(
	legacyVariantFamilies: LegacyVariantFamilyReconciliationResult,
	families: FamilyReconciliationResult,
	positions: ReconciliationResult
): Map<string, number> {
	const owner = new Map<string, number>()
	for (const family of legacyVariantFamilies.families) {
		for (const member of family.confirmedMembers) {
			if (!owner.has(member.idNom)) owner.set(member.idNom, family.legacyProductId)
		}
	}
	for (const position of families.positions) {
		for (const idNom of position.matchedOneCIdNoms) {
			if (!owner.has(idNom)) owner.set(idNom, position.mysqlProductId)
		}
	}
	for (const result of positions.mysqlResults) {
		for (const idNom of result.matchedOneCIdNoms) {
			if (!owner.has(idNom)) owner.set(idNom, result.legacyProductId)
		}
	}
	return owner
}

/**
 * Attributes every legacy product to exactly one pass/bucket, with the same
 * precedence `runCatalogImport` applies at write time (Pass 0 claims a
 * legacy product id first; Pass 1 claims whatever Pass 0 didn't; Pass 2
 * (standalone) only ever sees what neither Pass 0 nor Pass 1 claimed).
 */
/** Exported for Sprint 12B.9's brand-representative-slice.ts - same reuse rationale as `Attribution` above. */
export function attributeLegacyProducts(
	dump: LegacyCatalogDump,
	legacyVariantFamilies: LegacyVariantFamilyReconciliationResult,
	families: FamilyReconciliationResult,
	positions: ReconciliationResult
): Attribution[] {
	const attributions: Attribution[] = []
	const claimed = new Set<number>()

	for (const family of legacyVariantFamilies.families) {
		claimed.add(family.legacyProductId)
		const bucket: BrandPassBucket =
			family.classification === 'confirmed' ? 'pass0_confirmed' : family.classification === 'partial' ? 'pass0_partial' : 'pass0_quarantined'
		attributions.push({ legacyProductId: family.legacyProductId, confirmedVariantCount: family.confirmedMembers.length, bucket })
	}

	for (const family of families.families) {
		for (const memberId of family.mysqlMemberIds) {
			if (claimed.has(memberId)) continue
			claimed.add(memberId)
			const bucket: BrandPassBucket = family.outcome === 'confirmed_family' ? 'pass1_confirmed_family' : 'pass1_unmatched_or_ambiguous'
			// Member-level confirmed-variant count comes from this member's own position outcome, not the whole family.
			const position = families.positions.find(p => p.mysqlProductId === memberId)
			const count = position?.outcome === 'confirmed_position' ? position.matchedOneCIdNoms.length : 0
			attributions.push({ legacyProductId: memberId, confirmedVariantCount: count, bucket })
		}
	}
	for (const position of families.positions) {
		if (claimed.has(position.mysqlProductId)) continue
		if (position.outcome === 'quarantine') {
			claimed.add(position.mysqlProductId)
			attributions.push({ legacyProductId: position.mysqlProductId, confirmedVariantCount: 0, bucket: 'pass1_quarantine' })
		}
	}

	for (const result of positions.mysqlResults) {
		if (claimed.has(result.legacyProductId)) continue
		claimed.add(result.legacyProductId)
		const bucket: BrandPassBucket =
			result.outcome === 'confirmed' ? 'pass2_confirmed' : result.outcome === 'quarantine' ? 'pass2_quarantine' : 'pass2_ambiguous_or_unmatched'
		const count = result.outcome === 'confirmed' ? result.matchedOneCIdNoms.length : 0
		attributions.push({ legacyProductId: result.legacyProductId, confirmedVariantCount: count, bucket })
	}

	// Any legacy product dump.products carries that none of the three passes
	// produced ANY outcome for at all (e.g. no SKU, no group code, never
	// reached by sql-1c-reconciliation's own loop) - reported, never dropped.
	for (const product of dump.products) {
		if (claimed.has(product.id)) continue
		attributions.push({ legacyProductId: product.id, confirmedVariantCount: 0, bucket: 'pass2_ambiguous_or_unmatched' })
	}

	return attributions
}

function variantBucketFor(count: number): '1' | '2' | '3+' {
	if (count <= 1) return '1'
	if (count === 2) return '2'
	return '3+'
}

const EMPTY_BUCKETS: Record<BrandPassBucket, number> = {
	pass0_confirmed: 0,
	pass0_partial: 0,
	pass0_quarantined: 0,
	pass1_confirmed_family: 0,
	pass1_quarantine: 0,
	pass1_unmatched_or_ambiguous: 0,
	pass2_confirmed: 0,
	pass2_quarantine: 0,
	pass2_ambiguous_or_unmatched: 0
}

const CONFLICT_CLASSIFICATIONS: Record<IdNomDuplicateClassification, keyof BrandConflictCounts | null> = {
	identical: null,
	mutable_only: null,
	variant_or_warehouse: null,
	conflicting: 'conflicting',
	price_conflict: 'priceConflict',
	barcode_only_conflict: 'barcodeOnlyConflict'
}

/**
 * The single entrypoint. Takes the exact same inputs `runCatalogImport`
 * takes (plus an optional `priorQuarantine`, same as the importer threads
 * into `reconcileLegacyVariantFamilies`) and returns a per-brand breakdown.
 * Read-only: calls the reconciliation passes, writes nothing, requires no
 * database transaction.
 */
export function analyzeBrandReadiness(
	dump: LegacyCatalogDump,
	oneCRecords: ProductsFeedRecord[],
	families: FamilyReconciliationResult,
	positions: ReconciliationResult,
	idNomDuplicates: IdNomDuplicateReport,
	priorQuarantine?: Map<number, QuarantineReasonCode[]>
): BrandReadinessReport {
	const legacyVariantFamilies = reconcileLegacyVariantFamilies(dump, oneCRecords, priorQuarantine)
	const attributions = attributeLegacyProducts(dump, legacyVariantFamilies, families, positions)
	const idNomOwner = buildIdNomOwnerMap(legacyVariantFamilies, families, positions)
	const productById = new Map(dump.products.map(p => [p.id, p]))

	type MutableAnalysis = {
		brandId: number | null
		totalLegacyProducts: number
		variantCountDistribution: { '1': number; '2': number; '3+': number }
		categoryIds: Set<number>
		byPassBucket: Record<BrandPassBucket, number>
		conflicts: BrandConflictCounts
	}
	const byBrand = new Map<number | null, MutableAnalysis>()
	let unassignedProductCount = 0

	function bucketFor(brandId: number | null): MutableAnalysis {
		let entry = byBrand.get(brandId)
		if (!entry) {
			entry = {
				brandId,
				totalLegacyProducts: 0,
				variantCountDistribution: { '1': 0, '2': 0, '3+': 0 },
				categoryIds: new Set(),
				byPassBucket: { ...EMPTY_BUCKETS },
				conflicts: { conflicting: 0, priceConflict: 0, barcodeOnlyConflict: 0 }
			}
			byBrand.set(brandId, entry)
		}
		return entry
	}

	for (const attribution of attributions) {
		const product = productById.get(attribution.legacyProductId)
		if (!product) continue
		if (product.brandId === null) unassignedProductCount++

		const entry = bucketFor(product.brandId)
		entry.totalLegacyProducts++
		entry.byPassBucket[attribution.bucket]++
		if (product.categoryId !== null) entry.categoryIds.add(product.categoryId)
		if (attribution.confirmedVariantCount > 0) {
			entry.variantCountDistribution[variantBucketFor(attribution.confirmedVariantCount)]++
		}
	}

	for (const group of idNomDuplicates.groups) {
		const field = CONFLICT_CLASSIFICATIONS[group.classification]
		if (!field) continue
		const ownerLegacyId = idNomOwner.get(group.idNom)
		if (ownerLegacyId === undefined) continue
		const product = productById.get(ownerLegacyId)
		if (!product) continue
		const entry = bucketFor(product.brandId)
		entry.conflicts[field]++
	}

	const brands: BrandAnalysis[] = [...byBrand.values()]
		.filter(entry => entry.brandId !== null)
		.map(entry => ({
			brandId: entry.brandId,
			totalLegacyProducts: entry.totalLegacyProducts,
			variantCountDistribution: entry.variantCountDistribution,
			distinctCategoryCount: entry.categoryIds.size,
			categoryIds: [...entry.categoryIds].sort((a, b) => a - b),
			byPassBucket: entry.byPassBucket,
			conflicts: entry.conflicts
		}))
		.sort((a, b) => (a.brandId ?? 0) - (b.brandId ?? 0))

	return { brands, unassignedProductCount }
}

export type RankedBrandCandidate = {
	brandId: number
	score: number
	reasoning: string
	analysis: BrandAnalysis
}

/**
 * Sprint 12B.8 Task 3: ranks brands for the NEXT, larger controlled import
 * slice (bigger than the 4-product Mac slice already written). The goal is
 * representativeness, not size alone or cleanliness alone:
 *  - product count and category spread reward a brand that actually
 *    exercises pagination/filtering/multiple categories, not a one-off.
 *  - multi-variant products (2, and especially 3+) reward a brand that
 *    exercises Pass 0/Pass 1 family logic, not only Pass 2 standalone.
 *  - a SMALL number of conflicts (duplicate ID_nom conflicts, price
 *    conflicts, barcode-only duplicates) is rewarded, capped - it proves
 *    the quarantine/conflict-reporting path end-to-end without making the
 *    slice itself impractical to manually review.
 *  - a brand whose legacy products are MOSTLY quarantined (more than half)
 *    is penalized - that signals a brand that is too broken to be a good
 *    first bigger test, not a representative one.
 * Every number driving the score is read directly off `BrandAnalysis` -
 * nothing here recomputes reconciliation outcomes.
 */
export function rankBrandsForRepresentativeSlice(report: BrandReadinessReport): RankedBrandCandidate[] {
	return report.brands
		.map(analysis => {
			const productScore = Math.min(analysis.totalLegacyProducts, 50)
			const variantRichnessScore = analysis.variantCountDistribution['2'] + analysis.variantCountDistribution['3+'] * 2
			const categoryScore = analysis.distinctCategoryCount * 3
			const totalConflicts = analysis.conflicts.conflicting + analysis.conflicts.priceConflict + analysis.conflicts.barcodeOnlyConflict
			const conflictBonus = Math.min(totalConflicts, 5) * 2
			const quarantinedCount = analysis.byPassBucket.pass0_quarantined + analysis.byPassBucket.pass1_quarantine + analysis.byPassBucket.pass2_quarantine
			const quarantineRatio = analysis.totalLegacyProducts > 0 ? quarantinedCount / analysis.totalLegacyProducts : 0
			const quarantinePenalty = quarantineRatio > 0.5 ? 20 : 0

			const score = productScore + variantRichnessScore + categoryScore + conflictBonus - quarantinePenalty

			const reasoning =
				`${analysis.totalLegacyProducts} legacy product(s) across ${analysis.distinctCategoryCount} category/categories; ` +
				`variant mix 1=${analysis.variantCountDistribution['1']}/2=${analysis.variantCountDistribution['2']}/3+=${analysis.variantCountDistribution['3+']}; ` +
				`${totalConflicts} conflict(s) (conflicting=${analysis.conflicts.conflicting}, price_conflict=${analysis.conflicts.priceConflict}, barcode_only=${analysis.conflicts.barcodeOnlyConflict}); ` +
				`${quarantinedCount}/${analysis.totalLegacyProducts} quarantined` +
				(quarantinePenalty > 0 ? ' (over half quarantined - penalized, too broken for a representative slice)' : '')

			return { brandId: analysis.brandId as number, score, reasoning, analysis }
		})
		.sort((a, b) => b.score - a.score)
}

/** Convenience wrapper: the single top-ranked candidate, or `null` if there are no brands to choose from. */
export function selectRepresentativeBrand(report: BrandReadinessReport): RankedBrandCandidate | null {
	const ranked = rankBrandsForRepresentativeSlice(report)
	return ranked[0] ?? null
}
