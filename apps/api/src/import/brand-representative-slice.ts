/**
 * Sprint 12B.9: picks a small (20-30, configurable), representative subset
 * of ONE brand's legacy products for the next, larger controlled import
 * slice - narrower than Sprint 12B.6's `autoSelectDiverseSlice` (which picks
 * ONE example of each scenario kind across the WHOLE dump) and scoped to a
 * single brand chosen via Sprint 12B.8's `selectRepresentativeBrand`.
 *
 * This module never re-implements matching or classification. It only
 * COMPOSES already-computed reconciliation output:
 *   - `attributeLegacyProducts`/`buildIdNomOwnerMap` (brand-readiness-
 *     analysis.ts, Sprint 12B.8) for the Pass 0/1/2 bucket + confirmed-
 *     variant-count every legacy product already has, and for mapping a
 *     duplicate-ID_nom conflict group back to the brand that owns it.
 *   - `reconcileLegacyVariantFamilies` (Sprint 12B.5)'s own family objects,
 *     read only to inspect `confirmedMembers`' colorRu/colorHex/volumeVar
 *     fields for shade/volume diversity - never to re-decide membership.
 *   - `buildCatalogSlice` (Sprint 12B.6) to turn the final legacy product id
 *     selection into an FK-closed, reviewable slice.
 *
 * Selection is deterministic: every candidate pool is sorted by legacy
 * product id ascending before the first (lowest id) candidate is taken, so
 * running this twice on the same input always produces the same slice - the
 * user reviews it once and then needs the SAME set reflected in the write
 * step.
 */
import type { LegacyCatalogDump } from './parsers/mysql-catalog'
import type { LegacyVariantFamilyReconciliationResult, LegacyVariantFamily } from './reconcile/legacy-variant-family-reconciliation'
import type { FamilyReconciliationResult } from './reconcile/family-reconciliation'
import type { ReconciliationResult } from './reconcile/sql-1c-reconciliation'
import type { IdNomDuplicateReport } from './reconcile/duplicate-id-nom'
import { attributeLegacyProducts, buildIdNomOwnerMap, type Attribution } from './brand-readiness-analysis'
import { buildCatalogSlice } from './catalog-slice'

export type RepresentativeSliceReasonKind =
	| 'standalone'
	| 'multi_variant_2'
	| 'multi_variant_3plus'
	| 'confirmed_family'
	| 'partial_family'
	| 'hidden_product'
	| 'quarantined_family'
	| 'id_nom_conflict_barcode_only'
	| 'id_nom_conflict_other'
	| 'multi_image'
	| 'shade_volume_spread'
	| 'category_diversity_fill'

/** The mandatory categories a slice must try to cover - `category_diversity_fill` is a budget-filler, never mandatory on its own. */
const MANDATORY_REASON_KINDS: RepresentativeSliceReasonKind[] = [
	'standalone',
	'multi_variant_2',
	'multi_variant_3plus',
	'confirmed_family',
	'partial_family',
	'hidden_product',
	'quarantined_family',
	'id_nom_conflict_barcode_only',
	'id_nom_conflict_other',
	'multi_image',
	'shade_volume_spread'
]

export type RepresentativeSliceReason = { kind: RepresentativeSliceReasonKind; detail: string }

export type RepresentativeSliceSelection = {
	legacyProductId: number
	reasons: RepresentativeSliceReason[]
	categoryIds: number[]
}

export type RepresentativeSliceResult = {
	brandId: number
	totalBrandProducts: number
	legacyProductIds: number[]
	selections: RepresentativeSliceSelection[]
	/** Mandatory categories for which NO candidate existed anywhere in this brand's data - never silently omitted. */
	missingCategories: RepresentativeSliceReasonKind[]
	distinctCategoryCount: number
	slice: LegacyCatalogDump
}

export type BrandRepresentativeSliceInputs = {
	dump: LegacyCatalogDump
	brandId: number
	legacyVariantFamilies: LegacyVariantFamilyReconciliationResult
	families: FamilyReconciliationResult
	positions: ReconciliationResult
	idNomDuplicates: IdNomDuplicateReport
	/** Default 20. */
	minCount?: number
	/** Default 30. */
	maxCount?: number
}

const DEFAULT_MIN = 20
const DEFAULT_MAX = 30

const FAMILY_BUCKETS_2PLUS = new Set<Attribution['bucket']>(['pass0_confirmed', 'pass0_partial', 'pass1_confirmed_family'])
const QUARANTINE_BUCKETS = new Set<Attribution['bucket']>(['pass0_quarantined', 'pass1_quarantine', 'pass2_quarantine'])

function categoryIdsFor(dump: LegacyCatalogDump, legacyProductId: number): number[] {
	const product = dump.products.find(p => p.id === legacyProductId)
	const ids = new Set<number>()
	if (product?.categoryId !== null && product?.categoryId !== undefined) ids.add(product.categoryId)
	for (const link of dump.productCategories) if (link.productId === legacyProductId) ids.add(link.categoryId)
	return [...ids].sort((a, b) => a - b)
}

/** True when a Pass 0 family's confirmed members show 2+ distinct shade values (colorRu/colorHex) or 2+ distinct volume values. */
function hasShadeOrVolumeSpread(family: LegacyVariantFamily): boolean {
	const shades = new Set(family.confirmedMembers.map(m => m.colorRu ?? m.colorHex).filter((v): v is string => v !== null))
	const volumes = new Set(family.confirmedMembers.map(m => m.volumeVar).filter((v): v is string => v !== null))
	return shades.size >= 2 || volumes.size >= 2
}

function hasMultipleImages(dump: LegacyCatalogDump, legacyProductId: number): boolean {
	const productImageCount = dump.productImgs.filter(img => img.productId === legacyProductId).length
	const variableImageCount = dump.productVariableImgs.filter(img => img.productId === legacyProductId).length
	return productImageCount + variableImageCount >= 2
}

type MutableSelection = { legacyProductId: number; reasons: RepresentativeSliceReason[] }

/**
 * Sprint 12B.9: selects a representative 20-30 (configurable) legacy product
 * ids from ONE brand, covering standalone/multi-variant/confirmed+partial
 * family/hidden/quarantined/conflicting/multi-image/shade-volume-spread
 * scenarios wherever a real candidate exists in this brand's data - and
 * reports, rather than fabricates, any mandatory scenario with zero
 * candidates.
 */
export function selectBrandRepresentativeSlice(inputs: BrandRepresentativeSliceInputs): RepresentativeSliceResult {
	const minCount = inputs.minCount ?? DEFAULT_MIN
	const maxCount = inputs.maxCount ?? DEFAULT_MAX
	if (minCount > maxCount) throw new Error(`selectBrandRepresentativeSlice: minCount (${minCount}) cannot exceed maxCount (${maxCount})`)

	const brandProductIds = new Set(inputs.dump.products.filter(p => p.brandId === inputs.brandId).map(p => p.id))
	const totalBrandProducts = brandProductIds.size

	const attributions = attributeLegacyProducts(inputs.dump, inputs.legacyVariantFamilies, inputs.families, inputs.positions).filter(a =>
		brandProductIds.has(a.legacyProductId)
	)
	const selections = new Map<number, MutableSelection>()
	const missingCategories: RepresentativeSliceReasonKind[] = []

	function selectionFor(legacyProductId: number): MutableSelection {
		let entry = selections.get(legacyProductId)
		if (!entry) {
			entry = { legacyProductId, reasons: [] }
			selections.set(legacyProductId, entry)
		}
		return entry
	}

	function addReason(legacyProductId: number, kind: RepresentativeSliceReasonKind, detail: string) {
		const entry = selectionFor(legacyProductId)
		if (!entry.reasons.some(r => r.kind === kind)) entry.reasons.push({ kind, detail })
	}

	/** Picks the lowest-id brand attribution matching `predicate`, deterministically, and records it under `kind` - or records `kind` as missing. */
	function pickAttribution(kind: RepresentativeSliceReasonKind, predicate: (a: Attribution) => boolean, detail: (a: Attribution) => string) {
		const candidates = attributions.filter(predicate).sort((a, b) => a.legacyProductId - b.legacyProductId)
		const chosen = candidates[0]
		if (!chosen) {
			missingCategories.push(kind)
			return
		}
		addReason(chosen.legacyProductId, kind, detail(chosen))
	}

	// standalone: Pass 2 confirmed, by precedence not claimed by any Pass 0/1 family.
	pickAttribution(
		'standalone',
		a => a.bucket === 'pass2_confirmed',
		a => `Pass 2 confirmed standalone position (legacy product ${a.legacyProductId}, not claimed by any Pass 0/1 family)`
	)

	// multi-variant, 2 confirmed variants.
	pickAttribution(
		'multi_variant_2',
		a => FAMILY_BUCKETS_2PLUS.has(a.bucket) && a.confirmedVariantCount === 2,
		a => `${a.bucket} family/position with exactly 2 confirmed variants`
	)

	// multi-variant, 3+ confirmed variants.
	pickAttribution(
		'multi_variant_3plus',
		a => FAMILY_BUCKETS_2PLUS.has(a.bucket) && a.confirmedVariantCount >= 3,
		a => `${a.bucket} family with ${a.confirmedVariantCount} confirmed variants`
	)

	// confirmed family (Pass 0 confirmed or Pass 1 confirmed_family), 2+ variants.
	pickAttribution(
		'confirmed_family',
		a => (a.bucket === 'pass0_confirmed' || a.bucket === 'pass1_confirmed_family') && a.confirmedVariantCount >= 2,
		a => `${a.bucket} with ${a.confirmedVariantCount} confirmed members`
	)

	// partial family (Pass 0 only - Pass 1 has no "partial" concept).
	pickAttribution(
		'partial_family',
		a => a.bucket === 'pass0_partial',
		a => `Pass 0 partial family (legacy product ${a.legacyProductId}): ${a.confirmedVariantCount} confirmed member(s), not fully confirmed`
	)

	// hidden product: legacy isShown=false, belonging to this brand - only if any genuinely exists.
	const hiddenCandidates = [...brandProductIds]
		.map(id => inputs.dump.products.find(p => p.id === id))
		.filter((p): p is NonNullable<typeof p> => p !== undefined && p.isShown === false)
		.sort((a, b) => a.id - b.id)
	if (hiddenCandidates[0]) {
		addReason(hiddenCandidates[0].id, 'hidden_product', `legacy isShown=false (legacy product ${hiddenCandidates[0].id})`)
	} else {
		missingCategories.push('hidden_product')
	}

	// quarantined family/position.
	pickAttribution(
		'quarantined_family',
		a => QUARANTINE_BUCKETS.has(a.bucket),
		a => `${a.bucket}: quarantined, never written by a real import`
	)

	// ID_nom conflicts, scoped to this brand via the owner map - try to surface BOTH a barcode-only case and a more severe (conflicting/price_conflict) case, not just one bucket.
	const idNomOwner = buildIdNomOwnerMap(inputs.legacyVariantFamilies, inputs.families, inputs.positions)
	const brandConflictGroups = inputs.idNomDuplicates.groups
		.map(group => ({ group, ownerLegacyId: idNomOwner.get(group.idNom) }))
		.filter(({ ownerLegacyId }) => ownerLegacyId !== undefined && brandProductIds.has(ownerLegacyId))
		.sort((a, b) => a.ownerLegacyId! - b.ownerLegacyId!)

	const barcodeOnlyConflict = brandConflictGroups.find(({ group }) => group.classification === 'barcode_only_conflict')
	if (barcodeOnlyConflict) {
		addReason(
			barcodeOnlyConflict.ownerLegacyId!,
			'id_nom_conflict_barcode_only',
			`ID_nom ${barcodeOnlyConflict.group.idNom} is a barcode-only duplicate group (${barcodeOnlyConflict.group.recordCount} records)`
		)
	} else {
		missingCategories.push('id_nom_conflict_barcode_only')
	}

	const otherConflict = brandConflictGroups.find(({ group }) => group.classification === 'conflicting' || group.classification === 'price_conflict')
	if (otherConflict) {
		addReason(
			otherConflict.ownerLegacyId!,
			'id_nom_conflict_other',
			`ID_nom ${otherConflict.group.idNom} is a ${otherConflict.group.classification} duplicate group (${otherConflict.group.recordCount} records)`
		)
	} else {
		missingCategories.push('id_nom_conflict_other')
	}

	// multi-image product.
	const multiImageCandidate = [...brandProductIds]
		.filter(id => hasMultipleImages(inputs.dump, id))
		.sort((a, b) => a - b)[0]
	if (multiImageCandidate !== undefined) {
		addReason(multiImageCandidate, 'multi_image', `legacy product ${multiImageCandidate} has 2+ product/variant image rows`)
	} else {
		missingCategories.push('multi_image')
	}

	// shade/volume spread: a Pass 0 family (confirmed or partial) whose confirmed members show 2+ distinct shades or volumes.
	const shadeVolumeFamily = inputs.legacyVariantFamilies.families
		.filter(f => brandProductIds.has(f.legacyProductId) && f.classification !== 'quarantined' && hasShadeOrVolumeSpread(f))
		.sort((a, b) => a.legacyProductId - b.legacyProductId)[0]
	if (shadeVolumeFamily) {
		const shades = new Set(shadeVolumeFamily.confirmedMembers.map(m => m.colorRu ?? m.colorHex).filter((v): v is string => v !== null))
		const volumes = new Set(shadeVolumeFamily.confirmedMembers.map(m => m.volumeVar).filter((v): v is string => v !== null))
		addReason(
			shadeVolumeFamily.legacyProductId,
			'shade_volume_spread',
			`Pass 0 ${shadeVolumeFamily.classification} family: ${shades.size} distinct shade(s), ${volumes.size} distinct volume(s) among confirmed members`
		)
	} else {
		missingCategories.push('shade_volume_spread')
	}

	// Category-diversity fill: add more brand products (lowest id first, skipping those already selected) until minCount is reached, preferring ids whose category isn't covered yet.
	const coveredCategoryIds = new Set<number>()
	for (const id of selections.keys()) for (const catId of categoryIdsFor(inputs.dump, id)) coveredCategoryIds.add(catId)

	const remainingBrandIds = [...brandProductIds].filter(id => !selections.has(id)).sort((a, b) => a - b)
	// Prefer ids that introduce a new category first, then fall back to any remaining id.
	const newCategoryFirst = [...remainingBrandIds].sort((a, b) => {
		const aNew = categoryIdsFor(inputs.dump, a).some(c => !coveredCategoryIds.has(c)) ? 0 : 1
		const bNew = categoryIdsFor(inputs.dump, b).some(c => !coveredCategoryIds.has(c)) ? 0 : 1
		return aNew - bNew || a - b
	})

	for (const id of newCategoryFirst) {
		if (selections.size >= minCount) break
		const newCats = categoryIdsFor(inputs.dump, id).filter(c => !coveredCategoryIds.has(c))
		addReason(
			id,
			'category_diversity_fill',
			newCats.length > 0
				? `fills minimum slice size while adding category/categories ${newCats.join(', ')}`
				: 'fills minimum slice size (no new category introduced)'
		)
		for (const c of categoryIdsFor(inputs.dump, id)) coveredCategoryIds.add(c)
	}

	// Trim down to maxCount if the mandatory selections alone exceeded it: drop `category_diversity_fill`-only entries first (highest id first), never a mandatory-reason entry.
	while (selections.size > maxCount) {
		const fillOnly = [...selections.values()]
			.filter(s => s.reasons.every(r => r.kind === 'category_diversity_fill'))
			.sort((a, b) => b.legacyProductId - a.legacyProductId)[0]
		if (!fillOnly) break // every remaining selection carries a mandatory reason - leave the slice over maxCount rather than drop a required scenario.
		selections.delete(fillOnly.legacyProductId)
	}

	const finalSelections: RepresentativeSliceSelection[] = [...selections.values()]
		.sort((a, b) => a.legacyProductId - b.legacyProductId)
		.map(s => ({ legacyProductId: s.legacyProductId, reasons: s.reasons, categoryIds: categoryIdsFor(inputs.dump, s.legacyProductId) }))

	const legacyProductIds = finalSelections.map(s => s.legacyProductId)
	const distinctCategoryIds = new Set(finalSelections.flatMap(s => s.categoryIds))

	return {
		brandId: inputs.brandId,
		totalBrandProducts,
		legacyProductIds,
		selections: finalSelections,
		missingCategories: [...new Set(missingCategories)].filter(k => MANDATORY_REASON_KINDS.includes(k)),
		distinctCategoryCount: distinctCategoryIds.size,
		slice: buildCatalogSlice(inputs.dump, legacyProductIds)
	}
}
