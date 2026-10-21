/**
 * Legacy variant parity audit (Sprint 12B.4.1).
 *
 * Pure, read-only analysis - no database connection, no mutation, no
 * changes to any existing matching/reconciliation algorithm
 * (`reconcileFamilies`/`reconcileSqlWith1c`/`classifyIdNomDuplicates` are
 * only ever CALLED here, never modified). This module exists to explain,
 * with real counts, why the real dry-run keeps producing one
 * ProductVariant per Product (5972:5972 in the user's real runs after
 * Sprint 12B.4) and to quantify the gap between legacy `products_variable`
 * rows and what `catalog-importer.ts` actually plans to write.
 *
 * Two distinct analyses live here:
 *
 *  1. `computeV2PlanCounts` replicates `runCatalogImport`'s own Pass 1
 *     (confirmed families -> one product + N variants) / Pass 2
 *     (standalone confirmed positions -> product + default variant)
 *     ROUTING decision, read-only, from already-computed
 *     `FamilyReconciliationResult`/`ReconciliationResult` data. It counts
 *     what the importer would plan; it does not re-derive or alter any
 *     match outcome itself. Kept in exact lockstep with
 *     `catalog-importer.ts`'s own Pass 1/Pass 2 logic by design - if that
 *     logic changes, this function must be re-checked against it.
 *
 *  2. `matchLegacyVariants` is NEW, standalone analysis comparing
 *     MySQL-side `products_variable` rows directly against 1C nomenclature
 *     records (SKU-as-ID_nom, per the Sprint 12B.0 forensic audit's §4.2
 *     finding that legacy `products_variable.SKU = value.ID_nom`, and
 *     barcode) - this is NOT part of `reconcileSqlWith1c`/
 *     `reconcileFamilies` (which only ever look at the parent `products`
 *     table) and does not feed back into either; it is purely diagnostic.
 */
import type { LegacyCatalogDump, LegacyProductVariable } from './parsers/mysql-catalog'
import type { ProductsFeedRecord } from './parsers/products-feed'
import type { FamilyReconciliationResult } from './reconcile/family-reconciliation'
import { detectGroupCode, type MysqlReconciliationResult, type ReconciliationResult } from './reconcile/sql-1c-reconciliation'

export type VariantParityCounts = {
	/** `products` rows whose own `sku` looks like a group/variation code (Requirement 4's "legacy parent products") - the MySQL-side signal that a product MIGHT be a multi-variant family's parent card. */
	legacyParentProducts: number
	/** `products_variable` row count. */
	legacyVariants: number
	/** Distinct `products_variable.product_id` values with 2+ rows - real multi-variant families on the MySQL side, independent of whether 1C corroborates them. */
	parentsWithTwoPlusVariants: number
	publishedLegacyVariants: number
	variantsWithUsableSkuOrBarcode: number
	v2PlannedProducts: number
	v2PlannedVariants: number
	v2ProductsWithTwoPlusVariants: number
}

export type LegacyVariantMatchOutcome = 'confirmed' | 'ambiguous' | 'unmatched' | 'orphan'

export type LegacyVariantMatchResult = {
	variableId: number
	productId: number
	outcome: LegacyVariantMatchOutcome
	matchedIdNoms: string[]
	basis: ('sku_as_id_nom' | 'barcode')[]
	reasoning: string
}

export type FamilyParityDiagnostics = {
	totalGroups: number
	confirmedFamilies: number
	familiesRejectedForCollisionRisk: number
	familiesWithTwoPlusConfirmedPositions: number
	/**
	 * Requirement 7's literal question: how many confirmed-family MEMBERS
	 * end up imported as their OWN separate V2 Product (rather than as a
	 * variant of their family's one Product)? Under the importer's current
	 * Pass 1 design this is architecturally always 0 - every member of
	 * every family bucket (confirmed or not) is marked "handled" in Pass 1
	 * and so never reaches Pass 2's standalone path, regardless of outcome.
	 * See `familyMembersEligibleForStandaloneButPreempted` below for the
	 * real, nonzero finding this investigation surfaced.
	 */
	familiesWhoseMembersAppearAsSeparateV2Products: number
	/**
	 * NOT one of the user's 10 requested counts - kept separate from the
	 * (architecturally-always-0) count above as a distinct hypothesis this
	 * investigation checked: "does any confirmed-family member that misses
	 * `confirmed_position` individually have its own clean, unique global
	 * 1C match it could have used as a standalone product instead?"
	 *
	 * Verified (see the tests pinning this), this is ALSO always 0 under
	 * the current code, for a stronger reason than the count above:
	 * `reconcileFamilies`' per-family corroboration/contradiction check
	 * (`guidIndex`/`barcodeIndex` built by the exact same `buildGuidIndex`/
	 * `buildBarcodeIndex` functions `reconcileSqlWith1c` uses globally) is
	 * family-WIDE, not per-member - the moment ANY member's GUID/barcode
	 * evidence points outside the family, the ENTIRE family flips to
	 * `ambiguous_family` (never just that one member), so a family can only
	 * stay `confirmed_family` if EVERY member's evidence (if any) agrees
	 * with the family. A member excluded from `confirmedPositions` within a
	 * genuinely `confirmed_family` therefore has either (a) no GUID/barcode
	 * evidence anywhere, which also reads as globally `unmatched`, or
	 * (b) multiple family-internal candidates, which also reads as
	 * globally `ambiguous` (the same indices produce the same candidate
	 * set either way) - never a unique global `confirmed`. So this counter
	 * is retained only as a structural proof point/regression guard, not
	 * because it was ever observed to be nonzero.
	 */
	familyMembersEligibleForStandaloneButPreempted: number
}

export type MissingVariantReason =
	| 'existing_in_legacy_absent_from_1c'
	| 'present_in_1c_not_reconciled'
	| 'quarantined'
	| 'already_represented_elsewhere_in_v2'

export type MissingVariantExample = {
	legacyProductId: number
	legacyVariableId: number
	sku: string | null
	variationType: 'color' | 'volume' | 'barcode_only' | 'other'
	siblingCount: number
	reason: MissingVariantReason
	note: string
}

export type VariantParityReport = {
	counts: VariantParityCounts
	legacyVariantMatches: LegacyVariantMatchResult[]
	legacyVariantMatchSummary: Record<LegacyVariantMatchOutcome, number>
	families: FamilyParityDiagnostics
	examples: MissingVariantExample[]
}

function buildOneCByIdNom(oneC: ProductsFeedRecord[]): Map<string, ProductsFeedRecord[]> {
	const index = new Map<string, ProductsFeedRecord[]>()
	for (const record of oneC) {
		const list = index.get(record.ID_nom) ?? []
		list.push(record)
		index.set(record.ID_nom, list)
	}
	return index
}

function buildOneCByBarcode(oneC: ProductsFeedRecord[]): Map<string, ProductsFeedRecord[]> {
	const index = new Map<string, ProductsFeedRecord[]>()
	for (const record of oneC) {
		if (record.Barcode === null) continue
		const list = index.get(record.Barcode) ?? []
		list.push(record)
		index.set(record.Barcode, list)
	}
	return index
}

/** Requirement 5/6: legacy `products_variable` rows matched against 1C nomenclature by SKU-as-ID_nom and barcode, independent of (and not feeding back into) the existing product-level reconciliation. */
export function matchLegacyVariants(dump: LegacyCatalogDump, oneC: ProductsFeedRecord[]): LegacyVariantMatchResult[] {
	const productById = new Map(dump.products.map(p => [p.id, p]))
	const byIdNom = buildOneCByIdNom(oneC)
	const byBarcode = buildOneCByBarcode(oneC)
	const results: LegacyVariantMatchResult[] = []

	for (const v of dump.productVariables) {
		if (!productById.has(v.productId)) {
			results.push({
				variableId: v.id,
				productId: v.productId,
				outcome: 'orphan',
				matchedIdNoms: [],
				basis: [],
				reasoning:
					'parent product_id does not exist anywhere in the parsed SQL dump - a true orphan, consistent with the Phase A/12B.0 product_id=0/1 finding'
			})
			continue
		}

		const basis: ('sku_as_id_nom' | 'barcode')[] = []
		const candidates = new Set<string>()

		if (v.sku !== null) {
			const bySku = byIdNom.get(v.sku)
			if (bySku && bySku.length > 0) {
				basis.push('sku_as_id_nom')
				for (const r of bySku) candidates.add(r.ID_nom)
			}
		}
		if (v.barcode !== null) {
			const byBc = byBarcode.get(v.barcode)
			if (byBc && byBc.length > 0) {
				basis.push('barcode')
				for (const r of byBc) candidates.add(r.ID_nom)
			}
		}

		if (candidates.size === 0) {
			results.push({
				variableId: v.id,
				productId: v.productId,
				outcome: 'unmatched',
				matchedIdNoms: [],
				basis,
				reasoning: 'no 1C record found on SKU-as-ID_nom or barcode'
			})
		} else if (candidates.size === 1) {
			results.push({
				variableId: v.id,
				productId: v.productId,
				outcome: 'confirmed',
				matchedIdNoms: [...candidates],
				basis,
				reasoning: `unique 1C ID_nom match via ${basis.join('+')}`
			})
		} else {
			results.push({
				variableId: v.id,
				productId: v.productId,
				outcome: 'ambiguous',
				matchedIdNoms: [...candidates],
				basis,
				reasoning: 'SKU-as-ID_nom and/or barcode point at more than one distinct 1C ID_nom'
			})
		}
	}

	return results
}

export function summarizeLegacyVariantMatches(results: LegacyVariantMatchResult[]): Record<LegacyVariantMatchOutcome, number> {
	const summary: Record<LegacyVariantMatchOutcome, number> = { confirmed: 0, ambiguous: 0, unmatched: 0, orphan: 0 }
	for (const r of results) summary[r.outcome]++
	return summary
}

/**
 * Requirement 4's base counts, computed directly from the parsed dump -
 * no reconciliation needed for these.
 */
export function computeLegacyCounts(dump: LegacyCatalogDump): Omit<VariantParityCounts, 'v2PlannedProducts' | 'v2PlannedVariants' | 'v2ProductsWithTwoPlusVariants'> {
	const legacyParentProducts = dump.products.filter(p => detectGroupCode(p.sku) !== null).length

	const variantsByProduct = new Map<number, number>()
	for (const v of dump.productVariables) variantsByProduct.set(v.productId, (variantsByProduct.get(v.productId) ?? 0) + 1)
	let parentsWithTwoPlusVariants = 0
	for (const count of variantsByProduct.values()) if (count >= 2) parentsWithTwoPlusVariants++

	return {
		legacyParentProducts,
		legacyVariants: dump.productVariables.length,
		parentsWithTwoPlusVariants,
		publishedLegacyVariants: dump.productVariables.filter(v => v.isShown).length,
		variantsWithUsableSkuOrBarcode: dump.productVariables.filter(v => v.sku !== null || v.barcode !== null).length
	}
}

/**
 * Replicates `runCatalogImport`'s Pass 1 (confirmed families) / Pass 2
 * (standalone) ROUTING decision, read-only, from already-computed
 * reconciliation results - counts what the real importer would plan
 * without running it (no DB connection needed) and without altering any
 * match outcome. Kept in lockstep with `catalog-importer.ts`'s own
 * Pass 1/Pass 2 logic - see that file's `runCatalogImport` for the
 * authoritative implementation this mirrors.
 */
export function computeV2PlanCounts(
	dump: LegacyCatalogDump,
	familyResult: FamilyReconciliationResult,
	positionResult: ReconciliationResult
): { products: number; variants: number; productsWithTwoPlusVariants: number } {
	const positionByLegacyId = new Map(positionResult.mysqlResults.map(r => [r.legacyProductId, r]))
	const handled = new Set<number>()
	let products = 0
	let variants = 0
	let productsWithTwoPlusVariants = 0

	for (const family of familyResult.families) {
		if (family.mysqlMemberIds.length === 0) continue
		for (const id of family.mysqlMemberIds) handled.add(id)
		if (family.outcome !== 'confirmed_family' || family.collisionRisk) continue

		const positions = familyResult.positions.filter(p => p.normalizedCode === family.normalizedCode && family.mysqlMemberIds.includes(p.mysqlProductId))
		const confirmedPositions = positions.filter(p => p.outcome === 'confirmed_position')
		if (confirmedPositions.length === 0) continue

		products++
		variants += confirmedPositions.length
		if (confirmedPositions.length >= 2) productsWithTwoPlusVariants++
	}

	for (const product of dump.products) {
		if (handled.has(product.id)) continue
		handled.add(product.id)
		const position = positionByLegacyId.get(product.id)
		if (!position || position.outcome !== 'confirmed' || position.matchedOneCIdNoms.length !== 1) continue
		products++
		variants++
	}

	return { products, variants, productsWithTwoPlusVariants }
}

/** Requirement 7: family-level diagnostics explaining the 1:1 ratio. */
export function computeFamilyParityDiagnostics(familyResult: FamilyReconciliationResult, positionResult: ReconciliationResult): FamilyParityDiagnostics {
	const positionByLegacyId = new Map(positionResult.mysqlResults.map((r: MysqlReconciliationResult) => [r.legacyProductId, r]))

	let familiesWithTwoPlusConfirmedPositions = 0
	let familiesWhoseMembersAppearAsSeparateV2Products = 0
	let familyMembersEligibleForStandaloneButPreempted = 0

	for (const family of familyResult.families) {
		if (family.outcome !== 'confirmed_family' || family.collisionRisk) continue
		const positions = familyResult.positions.filter(p => p.normalizedCode === family.normalizedCode && family.mysqlMemberIds.includes(p.mysqlProductId))
		const confirmedPositions = positions.filter(p => p.outcome === 'confirmed_position')
		if (confirmedPositions.length >= 2) familiesWithTwoPlusConfirmedPositions++

		if (family.mysqlMemberIds.length < 2) continue
		for (const memberId of family.mysqlMemberIds) {
			if (confirmedPositions.some(p => p.mysqlProductId === memberId)) continue
			// Under the current importer, EVERY member of EVERY family bucket
			// is claimed by Pass 1 (`handledLegacyIds`) regardless of that
			// family's own outcome - so a non-confirmed-position member can
			// architecturally never reach Pass 2's standalone path, and
			// `familiesWhoseMembersAppearAsSeparateV2Products` (declared
			// above, never incremented here) must always be 0. Verified, not
			// assumed - see the test pinning this invariant.
			//
			// This loop body is only reached for a family that already IS
			// `confirmed_family` with `collisionRisk === false` (checked
			// above), which - per the proof in `familyMembersEligibleFor-
			// StandaloneButPreempted`'s own doc comment - means this
			// `standalonePosition` can never independently read `confirmed`
			// either, so this counter is also provably always 0. Kept as a
			// live structural check rather than removed.
			const standalonePosition = positionByLegacyId.get(memberId)
			if (standalonePosition && standalonePosition.outcome === 'confirmed' && standalonePosition.matchedOneCIdNoms.length === 1) {
				familyMembersEligibleForStandaloneButPreempted++
			}
		}
	}

	return {
		totalGroups: familyResult.summary.totalOneCFamilies,
		confirmedFamilies: familyResult.summary.confirmedFamilies,
		familiesRejectedForCollisionRisk: familyResult.summary.collisionRiskFamilies,
		familiesWithTwoPlusConfirmedPositions,
		familiesWhoseMembersAppearAsSeparateV2Products,
		familyMembersEligibleForStandaloneButPreempted
	}
}

function detectVariationType(v: LegacyProductVariable): MissingVariantExample['variationType'] {
	if (v.colorRu !== null || v.colorRo !== null || v.colorHex !== null) return 'color'
	if (v.volumeVar !== null || v.dose !== null) return 'volume'
	if (v.barcode !== null) return 'barcode_only'
	return 'other'
}

/** Requirements 8/9: up to 10 representative examples of a legacy multi-variant family (2+ `products_variable` rows) where the V2 plan ends up with fewer variants than the legacy data has, each classified into one of 4 reasons. */
export function buildMissingVariantExamples(
	dump: LegacyCatalogDump,
	variantMatches: LegacyVariantMatchResult[],
	positionResult: ReconciliationResult,
	v2VariantCountByProductId: Map<number, number>,
	limit = 10
): MissingVariantExample[] {
	const positionByLegacyId = new Map(positionResult.mysqlResults.map(r => [r.legacyProductId, r]))
	const variablesByProduct = new Map<number, LegacyProductVariable[]>()
	for (const v of dump.productVariables) {
		const list = variablesByProduct.get(v.productId) ?? []
		list.push(v)
		variablesByProduct.set(v.productId, list)
	}
	const matchByVariableId = new Map(variantMatches.map(m => [m.variableId, m]))

	const examples: MissingVariantExample[] = []
	for (const [productId, variables] of variablesByProduct) {
		if (examples.length >= limit) break
		if (variables.length < 2) continue
		const v2Count = v2VariantCountByProductId.get(productId) ?? 0
		if (v2Count >= variables.length) continue // this family's legacy variant count is already fully represented

		for (const v of variables) {
			if (examples.length >= limit) break
			const match = matchByVariableId.get(v.id)
			if (!match) continue

			const position = positionByLegacyId.get(productId)
			let reason: MissingVariantReason
			let note: string
			if (position?.outcome === 'quarantine') {
				reason = 'quarantined'
				note = 'parent product is quarantined at the position level - never auto-resolved by this audit'
			} else if (match.outcome === 'confirmed') {
				reason = 'already_represented_elsewhere_in_v2'
				note = `has a confirmed 1C match (${match.matchedIdNoms.join(', ')}) but the family/position-level import plan only accounted for ${v2Count} of ${variables.length} legacy variant(s)`
			} else if (match.outcome === 'ambiguous') {
				reason = 'present_in_1c_not_reconciled'
				note = `multiple 1C candidates found (${match.matchedIdNoms.join(', ')}) - present in 1C but not deterministically reconciled`
			} else {
				reason = 'existing_in_legacy_absent_from_1c'
				note = 'no 1C record found on SKU-as-ID_nom or barcode for this legacy variant row'
			}

			examples.push({
				legacyProductId: productId,
				legacyVariableId: v.id,
				sku: v.sku,
				variationType: detectVariationType(v),
				siblingCount: variables.length,
				reason,
				note
			})
		}
	}

	return examples
}

/** Builds the full report (Requirements 4-9), composing the pieces above. Counts in `counts.v2Planned*` come from `computeV2PlanCounts` - callers must pass the SAME `familyResult`/`positionResult` used elsewhere so the numbers are internally consistent. */
export function buildVariantParityReport(
	dump: LegacyCatalogDump,
	oneCRecords: ProductsFeedRecord[],
	familyResult: FamilyReconciliationResult,
	positionResult: ReconciliationResult
): VariantParityReport {
	const legacyCounts = computeLegacyCounts(dump)
	const plan = computeV2PlanCounts(dump, familyResult, positionResult)
	const variantMatches = matchLegacyVariants(dump, oneCRecords)
	const families = computeFamilyParityDiagnostics(familyResult, positionResult)

	// v2 variant count per legacy product id, for the example generator -
	// derived the same way computeV2PlanCounts derives it, kept local since
	// it is only needed here (not part of the public counts shape).
	const v2VariantCountByProductId = new Map<number, number>()
	const positionByLegacyId = new Map(positionResult.mysqlResults.map(r => [r.legacyProductId, r]))
	const handled = new Set<number>()
	for (const family of familyResult.families) {
		if (family.mysqlMemberIds.length === 0) continue
		for (const id of family.mysqlMemberIds) handled.add(id)
		if (family.outcome !== 'confirmed_family' || family.collisionRisk) continue
		const positions = familyResult.positions.filter(p => p.normalizedCode === family.normalizedCode && family.mysqlMemberIds.includes(p.mysqlProductId))
		const confirmedPositions = positions.filter(p => p.outcome === 'confirmed_position')
		if (confirmedPositions.length === 0) continue
		for (const member of family.mysqlMemberIds) v2VariantCountByProductId.set(member, confirmedPositions.some(p => p.mysqlProductId === member) ? confirmedPositions.length : 0)
	}
	for (const product of dump.products) {
		if (handled.has(product.id)) continue
		const position = positionByLegacyId.get(product.id)
		if (position && position.outcome === 'confirmed' && position.matchedOneCIdNoms.length === 1) v2VariantCountByProductId.set(product.id, 1)
	}

	const examples = buildMissingVariantExamples(dump, variantMatches, positionResult, v2VariantCountByProductId)

	return {
		counts: { ...legacyCounts, v2PlannedProducts: plan.products, v2PlannedVariants: plan.variants, v2ProductsWithTwoPlusVariants: plan.productsWithTwoPlusVariants },
		legacyVariantMatches: variantMatches,
		legacyVariantMatchSummary: summarizeLegacyVariantMatches(variantMatches),
		families,
		examples
	}
}

export function formatVariantParityReportMarkdown(report: VariantParityReport): string {
	const lines: string[] = []
	lines.push('# VIZAJE-NICA V2 — Legacy Variant Parity Report')
	lines.push('')
	lines.push('Strictly read-only diagnostic (Sprint 12B.4.1). No PostgreSQL writes, no matching-algorithm changes.')
	lines.push('')
	lines.push('## Counts')
	lines.push('')
	lines.push('| Metric | Value |')
	lines.push('|---|---:|')
	for (const [key, value] of Object.entries(report.counts)) lines.push(`| ${key} | ${value} |`)
	lines.push('')
	lines.push('## Legacy variant → 1C match summary')
	lines.push('')
	lines.push('| Outcome | Count |')
	lines.push('|---|---:|')
	for (const [key, value] of Object.entries(report.legacyVariantMatchSummary)) lines.push(`| ${key} | ${value} |`)
	lines.push('')
	lines.push('## Family diagnostics')
	lines.push('')
	lines.push('| Metric | Value |')
	lines.push('|---|---:|')
	for (const [key, value] of Object.entries(report.families)) lines.push(`| ${key} | ${value} |`)
	lines.push('')
	lines.push(`## Representative examples (${report.examples.length})`)
	lines.push('')
	lines.push('| legacyProductId | legacyVariableId | sku | variationType | siblingCount | reason | note |')
	lines.push('|---|---|---|---|---:|---|---|')
	for (const ex of report.examples) {
		lines.push(`| ${ex.legacyProductId} | ${ex.legacyVariableId} | ${ex.sku ?? ''} | ${ex.variationType} | ${ex.siblingCount} | ${ex.reason} | ${ex.note} |`)
	}
	lines.push('')
	return lines.join('\n')
}
