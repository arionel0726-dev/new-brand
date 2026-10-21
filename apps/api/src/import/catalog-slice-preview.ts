/**
 * Sprint 12B.6 Requirement 4/5: the human-reviewable artifact a controlled
 * test write is approved against, and the slice-confirmation guard that
 * makes sure a real write can never silently diverge from what was
 * reviewed.
 *
 * `buildSlicePreview` is pure and read-only: it just reshapes
 * `runCatalogImport`'s own dry-run output (unchanged - the existing
 * dry-run/write unification already makes a dry-run summary faithful, this
 * module never re-derives IDs independently) into the exact
 * Product/Variant id listing, with legacy-id provenance and pass origin,
 * that Requirement 4 asks a human to review before any write happens.
 */
import crypto from 'node:crypto'
import type { CatalogImportResult, CatalogImportSkipReason, CatalogImportUnitKind, CatalogImportUnitOutcome } from './catalog-importer'
import type { LegacyCatalogDump } from './parsers/mysql-catalog'

export type SlicePreviewPass = 'pass0_legacy_variant_family' | 'pass1_family' | 'pass2_standalone'

function passFor(kind: CatalogImportUnitKind): SlicePreviewPass {
	if (kind === 'legacy_variant_family') return 'pass0_legacy_variant_family'
	if (kind === 'family') return 'pass1_family'
	return 'pass2_standalone'
}

export type SlicePreviewEntry = {
	pass: SlicePreviewPass
	/** The legacy-id-derived key `runCatalogImport` used for this unit - exactly as it appears on the real `CatalogImportUnitOutcome`, never rewritten. */
	legacyKey: string
	action: 'created' | 'updated' | 'skipped'
	skipReason?: CatalogImportSkipReason
	productId?: string
	variantIds?: string[]
	/** Sprint 12B.6.1 Task 6: the `legacyProductId -> 1C ID_nom -> V2 variantId` chain for every variant this unit resolved, exactly as `runCatalogImport` already produced it - never re-derived. */
	identities?: { legacyProductId: number; idNom: string; variantId: string }[]
}

/** Sprint 12B.6.1 Task 4: how many Products this slice would write carry N variants, bucketed the same way a human reviewer would scan it. */
export type VariantCountBucket = '1' | '2-5' | '6-10' | '11+'

export type SlicePreview = {
	entries: SlicePreviewEntry[]
	productIdsThatWouldBeWritten: string[]
	variantIdsThatWouldBeWritten: string[]
	totalUnits: number
	unitsThatWouldWrite: number
	unitsSkipped: number
	/** Task 4: count of Products (among those that would be written) that carry 2 or more variants. */
	productsWithMultipleVariants: number
	/** Task 4: distribution of variant count per Product that would be written. */
	variantCountDistribution: Record<VariantCountBucket, number>
	/** Task 4: skip reasons bucketed by count, present only for reasons that actually occurred. */
	bySkipReason: Partial<Record<CatalogImportSkipReason, number>>
	/** Task 4: Pass 0 (legacy_variant_family) reconstructed families, bucketed by their reconciliation classification. */
	legacyVariantFamilyCounts: { confirmed: number; partial: number; quarantined: number }
}

/** Requirement 4 (extended by Task 4/6): the exact list of Product/Variant ids a dry run says WOULD be written, before any write happens, plus the diagnostics a human reviewer needs to approve a controlled write. */
export function buildSlicePreview(result: CatalogImportResult): SlicePreview {
	const entries: SlicePreviewEntry[] = result.units.map((unit: CatalogImportUnitOutcome) => ({
		pass: passFor(unit.kind),
		legacyKey: unit.key,
		action: unit.action,
		skipReason: unit.skipReason,
		productId: unit.productId,
		variantIds: unit.variantIds,
		identities: unit.variantIdentities
	}))

	const productIdsThatWouldBeWritten = [...new Set(entries.filter(e => e.action !== 'skipped' && e.productId).map(e => e.productId!))]
	const variantIdsThatWouldBeWritten = [...new Set(entries.flatMap(e => (e.action !== 'skipped' ? (e.variantIds ?? []) : [])))]

	let productsWithMultipleVariants = 0
	const variantCountDistribution: Record<VariantCountBucket, number> = { '1': 0, '2-5': 0, '6-10': 0, '11+': 0 }
	for (const entry of entries) {
		if (entry.action === 'skipped') continue
		const n = entry.variantIds?.length ?? 0
		if (n === 0) continue
		if (n >= 2) productsWithMultipleVariants++
		const bucket: VariantCountBucket = n === 1 ? '1' : n <= 5 ? '2-5' : n <= 10 ? '6-10' : '11+'
		variantCountDistribution[bucket]++
	}

	const bySkipReason: Partial<Record<CatalogImportSkipReason, number>> = {}
	for (const entry of entries) {
		if (entry.action !== 'skipped' || !entry.skipReason) continue
		bySkipReason[entry.skipReason] = (bySkipReason[entry.skipReason] ?? 0) + 1
	}

	const legacyVariantFamilyCounts = { confirmed: 0, partial: 0, quarantined: 0 }
	for (const unit of result.units) {
		if (unit.legacyVariantFamilyClassification) legacyVariantFamilyCounts[unit.legacyVariantFamilyClassification]++
	}

	return {
		entries,
		productIdsThatWouldBeWritten,
		variantIdsThatWouldBeWritten,
		totalUnits: entries.length,
		unitsThatWouldWrite: entries.filter(e => e.action !== 'skipped').length,
		unitsSkipped: entries.filter(e => e.action === 'skipped').length,
		productsWithMultipleVariants,
		variantCountDistribution,
		bySkipReason,
		legacyVariantFamilyCounts
	}
}

/**
 * Sprint 12B.6.1 Task 5: everything the manifest hash must be sensitive to -
 * not just WHICH legacy products were selected (the original Requirement
 * 1/5 scope), but the actual content of the slice being imported, the 1C
 * identities it resolves against, and the CLI parameters controlling the
 * import. A change to ANY of these must invalidate a prior
 * `--confirm-slice` hash, closing the gap where e.g. the underlying SQL
 * dump or 1C feed changes between "review this preview" and "write this
 * slice" while the legacy product id selection itself stays the same.
 */
export type SliceManifestInputs = {
	legacyProductIds: readonly number[]
	slicedDump: LegacyCatalogDump
	/** Every 1C ID_nom this slice's reconciliation actually resolved against (Pass 0/1/2 combined) - NOT the whole 1C feed, which is almost always far larger than what this slice touches. */
	relevantIdNoms: readonly string[]
	/** CLI/import parameters that change what gets written without changing the legacy product id selection itself (e.g. the selection mode and its raw criteria). */
	importParams: Record<string, string | number | boolean | null>
}

/** Deterministic JSON serialization (object keys sorted) so the hash never depends on property insertion order. */
function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
	if (value !== null && typeof value === 'object') {
		const keys = Object.keys(value as Record<string, unknown>).sort()
		return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`
	}
	return JSON.stringify(value)
}

/**
 * Requirement 1/5 (extended by Task 5): a stable fingerprint of exactly
 * WHICH legacy products a slice covers AND what they, their 1C matches, and
 * the import parameters actually contain - so the hash answers "is this
 * still the same slice, from the same inputs, that was reviewed?" rather
 * than only "is this the same id selection?"
 */
export function computeSliceManifestHash(inputs: SliceManifestInputs): string {
	const payload = {
		legacyProductIds: [...new Set(inputs.legacyProductIds)].sort((a, b) => a - b),
		slicedDump: inputs.slicedDump,
		relevantIdNoms: [...new Set(inputs.relevantIdNoms)].sort(),
		importParams: inputs.importParams
	}
	return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex')
}

export class SliceConfirmationError extends Error {}

/**
 * Requirement 5: write mode must additionally pass an explicit
 * `--confirm-slice=<hash>` that matches the manifest hash of the slice
 * actually being imported - a companion to `assertSafeImportTarget`
 * (unchanged), not a replacement for it. Fails closed: no supplied hash,
 * or a mismatched one, both refuse to proceed.
 */
export function assertSliceConfirmed(inputs: SliceManifestInputs, suppliedHash: string | undefined): void {
	const expected = computeSliceManifestHash(inputs)
	if (!suppliedHash) {
		throw new SliceConfirmationError(
			`Refusing write-mode slice import: no --confirm-slice=<hash> was supplied. This slice's manifest hash is ${expected} - re-run with --confirm-slice=${expected} only after reviewing the dry-run preview for exactly this slice.`
		)
	}
	if (suppliedHash !== expected) {
		throw new SliceConfirmationError(
			`Refusing write-mode slice import: --confirm-slice=${suppliedHash} does not match this slice's manifest hash (${expected}). The slice being imported (its content, 1C matches, or import parameters) has diverged from whatever was reviewed - failing closed rather than writing an unreviewed slice.`
		)
	}
}
