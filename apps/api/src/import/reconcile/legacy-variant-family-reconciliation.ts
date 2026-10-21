/**
 * Sprint 12B.5: legacy `products_variable.product_id`-hypothesis family
 * reconstruction.
 *
 * Context (Sprint 12B.4.1 finding): the existing family-level matcher
 * (family-reconciliation.ts) groups by `VariativeNomenclature` group code and
 * flips an ENTIRE family to `ambiguous_family` the moment any single member
 * contradicts the shared 1C evidence, using the same global GUID/barcode
 * indices the position-level matcher (sql-1c-reconciliation.ts) uses - so an
 * excluded member can never independently surface as a unique confirmed
 * position either. That makes `familiesWhoseMembersAppearAsSeparateV2Products`
 * architecturally always 0, and is why the user's real parity report shows
 * 1,513 legacy parents with 2+ variants but 0 confirmed multi-position
 * families.
 *
 * This module adds a SEPARATE reconciliation path, keyed by legacy
 * `products.id` (the parent a `products_variable` row claims via its own
 * `product_id` column) rather than by group code. Requirement 1: that
 * parent claim is a HYPOTHESIS only - legacy's own product_id is known (per
 * the Sprint 12B.0 forensic audit) to fall back to 0 (new variant, parent
 * lookup failed) or 1 (existing variant, parent lookup failed on update), so
 * it is never treated as ground truth. Requirement 2: a variable row only
 * joins the reconstructed family once `matchLegacyVariants` (reused as-is
 * from variant-parity-audit.ts, never reimplemented) independently confirms
 * it against 1C via SKU-as-ID_nom or barcode. Requirement 10: a family with
 * zero independently-confirmed members never gets fabricated - it is simply
 * not reconstructed here (unrelated to any quarantine state).
 */
import type { LegacyCatalogDump } from '../parsers/mysql-catalog'
import type { ProductsFeedRecord } from '../parsers/products-feed'
import type { QuarantineReasonCode } from '../dry-run-catalog'
import { matchLegacyVariants, type LegacyVariantMatchResult } from '../variant-parity-audit'

export type LegacyVariantFamilyClassification = 'confirmed' | 'partial' | 'quarantined'

export type LegacyVariantFamilyMember = {
	variableId: number
	idNom: string
	basis: LegacyVariantMatchResult['basis']
	colorRu: string | null
	colorRo: string | null
	colorHex: string | null
	volumeVar: string | null
	barcode: string | null
	titleRu: string | null
	titleRo: string | null
	isShown: boolean
}

export type LegacyVariantFamilyUnconfirmedReason =
	| 'ambiguous'
	| 'unmatched'
	| 'orphan'
	| 'duplicate_membership_conflict'
	| 'insufficient_corroboration'

export type LegacyVariantFamilyUnconfirmedMember = {
	variableId: number
	reason: LegacyVariantFamilyUnconfirmedReason
	note: string
}

export type LegacyVariantFamily = {
	/** The legacy `products.id` every member variable row claims via its own product_id - a hypothesis, not ground truth. */
	legacyProductId: number
	classification: LegacyVariantFamilyClassification
	confirmedMembers: LegacyVariantFamilyMember[]
	unconfirmedMembers: LegacyVariantFamilyUnconfirmedMember[]
	reasoning: string
}

export type DuplicateMembershipConflict = {
	idNom: string
	claimedByLegacyProductId: number
	alsoClaimedByLegacyProductId: number
	losingVariableId: number
}

export type LegacyVariantFamilyReconciliationSummary = {
	candidateParents: number
	confirmedFamilies: number
	partialFamilies: number
	quarantinedFamilies: number
	insufficientEvidenceParents: number
	totalConfirmedVariants: number
	duplicateMembershipConflicts: number
}

export type LegacyVariantFamilyReconciliationResult = {
	summary: LegacyVariantFamilyReconciliationSummary
	families: LegacyVariantFamily[]
	duplicateMembershipConflicts: DuplicateMembershipConflict[]
}

/**
 * Requirement 1/2/4/6/10/11/12: reconstruct multi-variant families from the
 * legacy `products_variable.product_id` hypothesis, confirming each member
 * through independent 1C evidence and never letting two reconstructed
 * families both claim the same 1C ID_nom.
 */
export function reconcileLegacyVariantFamilies(
	dump: LegacyCatalogDump,
	oneCRecords: ProductsFeedRecord[],
	priorQuarantine?: Map<number, QuarantineReasonCode[]>
): LegacyVariantFamilyReconciliationResult {
	const matches = matchLegacyVariants(dump, oneCRecords)
	const matchByVariableId = new Map(matches.map(m => [m.variableId, m]))
	const productById = new Map(dump.products.map(p => [p.id, p]))

	const variablesByProductId = new Map<number, typeof dump.productVariables>()
	for (const v of dump.productVariables) {
		const list = variablesByProductId.get(v.productId) ?? []
		list.push(v)
		variablesByProductId.set(v.productId, list)
	}

	// Requirement 11: a given 1C ID_nom may only be CONFIRMED into one
	// reconstructed family. Candidate parents are processed in ascending
	// legacyProductId order so conflict resolution is deterministic and
	// reproducible, never arbitrary - the loser is reported, never silently
	// dropped in favor of whichever happened to run first by iteration luck.
	const idNomClaimedBy = new Map<string, number>()
	const duplicateMembershipConflicts: DuplicateMembershipConflict[] = []

	const families: LegacyVariantFamily[] = []
	let insufficientEvidenceParents = 0

	const candidateParentIds = [...variablesByProductId.keys()]
		.filter(id => (variablesByProductId.get(id)?.length ?? 0) >= 2)
		.sort((a, b) => a - b)

	for (const legacyProductId of candidateParentIds) {
		const variables = variablesByProductId.get(legacyProductId)!

		// Requirement 10: never fabricate a parent - a product_id that
		// doesn't resolve to any parsed parent row (the 0/1 fallback
		// anti-pattern) can never anchor a reconstructed family.
		if (!productById.has(legacyProductId)) {
			insufficientEvidenceParents++
			continue
		}

		const existingQuarantine = priorQuarantine?.get(legacyProductId)
		if (existingQuarantine && existingQuarantine.length > 0) {
			families.push({
				legacyProductId,
				classification: 'quarantined',
				confirmedMembers: [],
				unconfirmedMembers: variables.map(v => ({
					variableId: v.id,
					reason: 'insufficient_corroboration',
					note: `parent legacy product ${legacyProductId} already quarantined (${existingQuarantine.join(', ')}) - variant-level evidence does not clear a position-level quarantine`
				})),
				reasoning: `parent product quarantined for: ${existingQuarantine.join(', ')}`
			})
			continue
		}

		const confirmedMembers: LegacyVariantFamilyMember[] = []
		const unconfirmedMembers: LegacyVariantFamilyUnconfirmedMember[] = []

		for (const v of variables) {
			const match = matchByVariableId.get(v.id)
			if (!match) {
				unconfirmedMembers.push({ variableId: v.id, reason: 'unmatched', note: 'no match computed for this variable row' })
				continue
			}
			if (match.outcome !== 'confirmed') {
				unconfirmedMembers.push({ variableId: v.id, reason: match.outcome, note: match.reasoning })
				continue
			}

			const idNom = match.matchedIdNoms[0]
			const claimedBy = idNomClaimedBy.get(idNom)
			if (claimedBy !== undefined && claimedBy !== legacyProductId) {
				duplicateMembershipConflicts.push({
					idNom,
					claimedByLegacyProductId: claimedBy,
					alsoClaimedByLegacyProductId: legacyProductId,
					losingVariableId: v.id
				})
				unconfirmedMembers.push({
					variableId: v.id,
					reason: 'duplicate_membership_conflict',
					note: `1C ID_nom ${idNom} already confirmed under legacy product ${claimedBy} - never auto-resolved in favor of either family`
				})
				continue
			}

			idNomClaimedBy.set(idNom, legacyProductId)
			confirmedMembers.push({
				variableId: v.id,
				idNom,
				basis: match.basis,
				colorRu: v.colorRu,
				colorRo: v.colorRo,
				colorHex: v.colorHex,
				volumeVar: v.volumeVar,
				barcode: v.barcode,
				titleRu: v.titleRu,
				titleRo: v.titleRo,
				isShown: v.isShown
			})
		}

		// Requirement 15: a single independently-confirmed member is not a
		// "reconstructed family" - there is nothing to merge, so this parent
		// is left for the existing standalone-position path to handle
		// instead of being reported here as a (misleadingly inflated) family.
		if (confirmedMembers.length < 2) {
			for (const m of confirmedMembers) idNomClaimedBy.delete(m.idNom)
			insufficientEvidenceParents++
			continue
		}

		const classification: LegacyVariantFamilyClassification =
			confirmedMembers.length === variables.length ? 'confirmed' : 'partial'
		families.push({
			legacyProductId,
			classification,
			confirmedMembers,
			unconfirmedMembers,
			reasoning:
				classification === 'confirmed'
					? `all ${variables.length} products_variable rows under legacy product_id=${legacyProductId} independently confirmed via 1C evidence`
					: `${confirmedMembers.length} of ${variables.length} products_variable rows under legacy product_id=${legacyProductId} independently confirmed; remaining ${unconfirmedMembers.length} stay unresolved, never guessed`
		})
	}

	const summary: LegacyVariantFamilyReconciliationSummary = {
		candidateParents: candidateParentIds.length,
		confirmedFamilies: families.filter(f => f.classification === 'confirmed').length,
		partialFamilies: families.filter(f => f.classification === 'partial').length,
		quarantinedFamilies: families.filter(f => f.classification === 'quarantined').length,
		insufficientEvidenceParents,
		totalConfirmedVariants: families.reduce((sum, f) => sum + f.confirmedMembers.length, 0),
		duplicateMembershipConflicts: duplicateMembershipConflicts.length
	}

	return { summary, families, duplicateMembershipConflicts }
}
