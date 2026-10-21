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
}

export type SlicePreview = {
	entries: SlicePreviewEntry[]
	productIdsThatWouldBeWritten: string[]
	variantIdsThatWouldBeWritten: string[]
	totalUnits: number
	unitsThatWouldWrite: number
	unitsSkipped: number
}

/** Requirement 4: the exact list of Product/Variant ids a dry run says WOULD be written, before any write happens. */
export function buildSlicePreview(result: CatalogImportResult): SlicePreview {
	const entries: SlicePreviewEntry[] = result.units.map((unit: CatalogImportUnitOutcome) => ({
		pass: passFor(unit.kind),
		legacyKey: unit.key,
		action: unit.action,
		skipReason: unit.skipReason,
		productId: unit.productId,
		variantIds: unit.variantIds
	}))

	const productIdsThatWouldBeWritten = [...new Set(entries.filter(e => e.action !== 'skipped' && e.productId).map(e => e.productId!))]
	const variantIdsThatWouldBeWritten = [...new Set(entries.flatMap(e => (e.action !== 'skipped' ? (e.variantIds ?? []) : [])))]

	return {
		entries,
		productIdsThatWouldBeWritten,
		variantIdsThatWouldBeWritten,
		totalUnits: entries.length,
		unitsThatWouldWrite: entries.filter(e => e.action !== 'skipped').length,
		unitsSkipped: entries.filter(e => e.action === 'skipped').length
	}
}

/**
 * Requirement 1/5: a stable fingerprint of exactly WHICH legacy products a
 * slice covers - deliberately keyed only on the sorted, deduplicated legacy
 * product id set (never on anything computed from reconciliation, which
 * can legitimately change between review and write, e.g. if the 1C feed is
 * re-fetched) so the hash answers one narrow question: "is this the same
 * slice selection that was reviewed?"
 */
export function computeSliceManifestHash(legacyProductIds: readonly number[]): string {
	const sorted = [...new Set(legacyProductIds)].sort((a, b) => a - b)
	return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex')
}

export class SliceConfirmationError extends Error {}

/**
 * Requirement 5: write mode must additionally pass an explicit
 * `--confirm-slice=<hash>` that matches the manifest hash of the slice
 * actually being imported - a companion to `assertSafeImportTarget`
 * (unchanged), not a replacement for it. Fails closed: no supplied hash,
 * or a mismatched one, both refuse to proceed.
 */
export function assertSliceConfirmed(legacyProductIds: readonly number[], suppliedHash: string | undefined): void {
	const expected = computeSliceManifestHash(legacyProductIds)
	if (!suppliedHash) {
		throw new SliceConfirmationError(
			`Refusing write-mode slice import: no --confirm-slice=<hash> was supplied. This slice's manifest hash is ${expected} - re-run with --confirm-slice=${expected} only after reviewing the dry-run preview for exactly this slice.`
		)
	}
	if (suppliedHash !== expected) {
		throw new SliceConfirmationError(
			`Refusing write-mode slice import: --confirm-slice=${suppliedHash} does not match this slice's manifest hash (${expected}). The slice being imported has diverged from whatever was reviewed - failing closed rather than writing an unreviewed slice.`
		)
	}
}
