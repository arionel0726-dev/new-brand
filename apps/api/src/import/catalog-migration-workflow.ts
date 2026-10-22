/**
 * Sprint 12B.10: the unified local developer workflow for catalog migration
 * analysis/preview and controlled writes.
 *
 * This module introduces NO new reconciliation, matching, or import logic.
 * Every number in its report comes from calling the EXISTING pure functions
 * built across Sprints 12B.5-12B.9 with their own unchanged behavior:
 * `reconcileLegacyVariantFamilies`/`reconcileFamilies`/`reconcileSqlWith1c`/
 * `classifyIdNomDuplicates` (reconciliation), `selectBrandRepresentativeSlice`
 * (Sprint 12B.9's brand-scoped selection), `buildCatalogSlice`/
 * `buildSlicePreview`/`computeSliceManifestHash`/`assertSliceConfirmed`
 * (Sprint 12B.6's slice/preview/confirmation primitives),
 * `runScopedReferenceBootstrap` (Sprint 12B.7's brand/category readiness),
 * and `catalog-slice-post-import-checks.ts`'s six checks. This module only
 * orchestrates calls into them in one sequence and folds their outputs into
 * one human-readable report plus a top-level readiness verdict - the
 * consolidation layer the user asked for, not a rewrite of what already
 * exists underneath it.
 */
import { sql } from 'drizzle-orm'
import type { Database } from '../db/client'
import type { Tx } from '../db/tx'
import type { LegacyCatalogDump } from './parsers/mysql-catalog'
import type { ProductsFeedRecord } from './parsers/products-feed'
import type { QuarantineReasonCode } from './dry-run-catalog'
import { reconcileSqlWith1c } from './reconcile/sql-1c-reconciliation'
import { reconcileFamilies } from './reconcile/family-reconciliation'
import { reconcileLegacyVariantFamilies } from './reconcile/legacy-variant-family-reconciliation'
import { classifyIdNomDuplicates, type IdNomDuplicateReport } from './reconcile/duplicate-id-nom'
import { selectBrandRepresentativeSlice, type RepresentativeSliceResult } from './brand-representative-slice'
import { buildCatalogSlice, resolveLegacyProductIds, UnknownLegacyProductIdError } from './catalog-slice'
import { buildSlicePreview, computeSliceManifestHash, assertSliceConfirmed, SliceConfirmationError, type SlicePreview, type SliceManifestInputs } from './catalog-slice-preview'
import { runInRolledBackTransaction } from './catalog-slice-rollback'
import { runAtomicSliceWriteWithBootstrap, PostImportChecksFailedError, type SliceWriteChecks } from './catalog-slice-write'
import {
	checkRowCounts,
	checkNoOrphanVariants,
	checkNoDuplicateSkus,
	checkNoDuplicateExternalIdMappings,
	checkBarcodeIntegrity,
	checkCategoryBrandLinksResolve
} from './catalog-slice-post-import-checks'
import {
	runCatalogImport,
	assertSafeImportTarget,
	assertLocalHost,
	UnsafeImportTargetError,
	type CatalogImportInput,
	type CatalogImportResult
} from './catalog-importer'
import { runScopedReferenceBootstrap, extractReferencedBrandCategorySlice, type ScopedReferenceBootstrapResult } from './scoped-reference-bootstrap'
import { createDatabaseBackup, BackupFailedError, type BackupResult, type CreateDatabaseBackupOptions } from './catalog-migration-backup'

export type WorkflowSelection =
	| { kind: 'brandId'; brandId: number; minCount?: number; maxCount?: number }
	| { kind: 'legacyProductIds'; legacyProductIds: number[] }

export type WorkflowInputs = {
	dump: LegacyCatalogDump
	rawOneCRecords: Record<string, unknown>[]
	oneCRecords: ProductsFeedRecord[]
	selection: WorkflowSelection
	priorQuarantine?: Map<number, QuarantineReasonCode[]>
}

export type WorkflowVerdict = 'READY' | 'READY_WITH_WARNINGS' | 'NOT_READY'

export type WorkflowPreflightCheck = { ok: boolean; detail: string }
export type WorkflowPreflightResult = {
	safeTarget: WorkflowPreflightCheck
	reachable: WorkflowPreflightCheck
	migrationsCurrent: WorkflowPreflightCheck
	/** True only when every check above passed - the workflow refuses to run any analysis at all otherwise. */
	ok: boolean
}

export type WorkflowReport = {
	selection: {
		kind: WorkflowSelection['kind']
		brandId: number | null
		legacyProductIds: number[]
		representativeSelection: RepresentativeSliceResult | null
	}
	products: { totalConsidered: number }
	variants: {
		unitsThatWouldWrite: number
		unitsSkipped: number
		productsWithMultipleVariants: number
		variantCountDistribution: SlicePreview['variantCountDistribution']
		legacyVariantFamilyCounts: SlicePreview['legacyVariantFamilyCounts']
	}
	categories: { distinctCount: number; legacyCategoryIds: number[] }
	brandCategoryReadiness: {
		missingBrandLinks: number
		missingCategoryLinks: number
		brandsToBootstrap: number
		categoriesToBootstrap: number
	}
	conflicts: { bySkipReason: SlicePreview['bySkipReason']; idNomDuplicateConflicts: number; idNomDuplicatePriceConflicts: number; idNomDuplicateBarcodeOnlyConflicts: number }
	quarantine: { legacyVariantFamilyQuarantined: number; skippedUnits: number }
	postImportChecksDryRun: SliceWriteChecks
	manifestHash: string
	verdict: WorkflowVerdict
	blockers: string[]
	warnings: string[]
}

/**
 * Shared preflight body: runs `assertTarget` (the only part that differs
 * between read-only and write preflight - see below), then, only if that
 * passes, a cheap `SELECT 1` reachability check, then, only if THAT passes,
 * the read-only `drizzle-kit check` migration-drift check. Nothing here ever
 * writes or auto-migrates.
 */
async function runPreflightChecks(
	db: Database,
	databaseUrl: string,
	checkMigrations: () => Promise<{ ok: boolean; raw: string }>,
	assertTarget: (url: string) => void,
	safeTargetOkDetail: string
): Promise<WorkflowPreflightResult> {
	let safeTarget: WorkflowPreflightCheck
	try {
		assertTarget(databaseUrl)
		safeTarget = { ok: true, detail: safeTargetOkDetail }
	} catch (error) {
		safeTarget = { ok: false, detail: error instanceof UnsafeImportTargetError ? error.message : String(error) }
	}

	let reachable: WorkflowPreflightCheck
	if (!safeTarget.ok) {
		reachable = { ok: false, detail: 'Skipped - the target is not a safe local database to connect to.' }
	} else {
		try {
			await db.execute(sql`select 1`)
			reachable = { ok: true, detail: 'Database connection succeeded.' }
		} catch (error) {
			reachable = { ok: false, detail: `Could not reach the database: ${error instanceof Error ? error.message : String(error)}` }
		}
	}

	let migrationsCurrent: WorkflowPreflightCheck
	if (!reachable.ok) {
		migrationsCurrent = { ok: false, detail: 'Skipped - the database is not reachable.' }
	} else {
		try {
			const result = await checkMigrations()
			migrationsCurrent = { ok: result.ok, detail: result.raw }
		} catch (error) {
			migrationsCurrent = { ok: false, detail: `Could not check migration status: ${error instanceof Error ? error.message : String(error)}` }
		}
	}

	return { safeTarget, reachable, migrationsCurrent, ok: safeTarget.ok && reachable.ok && migrationsCurrent.ok }
}

/**
 * Sprint 12B.10.1 fix: the read-only preflight for `runWorkflowAnalysis`.
 * Deliberately does NOT require the exact `beauty_store_test` database name
 * - a pure read-only analysis/preview is safe against the developer's own
 * local dev database (e.g. `beauty_store_dev`), precisely BECAUSE every DB
 * interaction `runWorkflowAnalysis` performs runs inside
 * `runInRolledBackTransaction` and is therefore guaranteed never to commit
 * anything (see that function's own unconditional-rollback contract, and
 * catalog-slice-db.test.ts's "a real (non-sentinel) error inside the
 * callback still propagates, not swallowed as a rollback" / this module's
 * own "Requirement 4" test proving a real write followed by a thrown error
 * still leaves zero rows). It still refuses a non-local host via
 * `assertLocalHost` - a read-only query against an arbitrary remote or
 * production host is still never something this tool should do silently.
 */
export async function runWorkflowReadOnlyPreflight(
	db: Database,
	databaseUrl: string,
	checkMigrations: () => Promise<{ ok: boolean; raw: string }>
): Promise<WorkflowPreflightResult> {
	return runPreflightChecks(db, databaseUrl, checkMigrations, assertLocalHost, 'DATABASE_URL points at a local Postgres host - safe for a rolled-back read-only analysis.')
}

/**
 * Sprint 12B.10.1 fix: the write preflight for `runWorkflowWrite`, kept
 * EXACTLY as strict as the original single `runWorkflowPreflight` always
 * was - full `assertSafeImportTarget` (localhost allowlist AND exact
 * `beauty_store_test` database name). `runWorkflowWrite` itself still calls
 * `assertSafeImportTarget` directly as its own first line of defense
 * (unchanged); this is the CLI-facing preflight equivalent so write mode
 * gets the same structured preflight report as read-only mode before it
 * ever reaches the write path.
 */
export async function runWorkflowWritePreflight(
	db: Database,
	databaseUrl: string,
	checkMigrations: () => Promise<{ ok: boolean; raw: string }>
): Promise<WorkflowPreflightResult> {
	return runPreflightChecks(db, databaseUrl, checkMigrations, assertSafeImportTarget, 'DATABASE_URL points at the isolated local beauty_store_test database.')
}

export type ResolvedWorkflowDatabaseUrl = {
	url: string
	/** True when `catalogTestDatabaseUrl` (typically `CATALOG_TEST_DATABASE_URL`) was the source. */
	usedCatalogTestVar: boolean
	/** Non-null only when falling back to `fallbackDatabaseUrl` for a WRITE run - never for read-only, since read-only against the developer's own dev database is the explicitly supported, safe default. */
	warning: string | null
}

/**
 * Sprint 12B.11: precedence for which database URL a catalog-workflow CLI
 * invocation actually targets - an explicit `--database-url` flag, then
 * `CATALOG_TEST_DATABASE_URL` (so a developer sets ONE var once in their
 * `.env`, alongside their normal `DATABASE_URL` which stays pointed at their
 * regular dev database for everything else the app does, and every
 * subsequent write-mode workflow invocation automatically targets the
 * isolated `beauty_store_test` database with no manual DATABASE_URL
 * override in the shell), then `fallbackDatabaseUrl` (plain `DATABASE_URL`).
 * Falling back to plain `DATABASE_URL` for a WRITE run produces a `warning`
 * - `assertSafeImportTarget` will still refuse it outright unless it happens
 * to already be `beauty_store_test`, but the warning makes the reason
 * legible rather than a bare refusal. No warning for read-only mode: running
 * analysis against whatever `DATABASE_URL` is already configured for is the
 * explicitly supported, safe default from Sprint 12B.10.1 (read-only never
 * commits, so it is safe against a developer's own dev database).
 */
export function resolveWorkflowDatabaseUrl(options: {
	explicitFlag: string | null
	catalogTestDatabaseUrl: string | undefined
	fallbackDatabaseUrl: string
	mode: 'read-only' | 'write'
}): ResolvedWorkflowDatabaseUrl {
	if (options.explicitFlag) {
		return { url: options.explicitFlag, usedCatalogTestVar: false, warning: null }
	}
	if (options.catalogTestDatabaseUrl) {
		return { url: options.catalogTestDatabaseUrl, usedCatalogTestVar: true, warning: null }
	}
	const warning =
		options.mode === 'write'
			? 'CATALOG_TEST_DATABASE_URL is not set - falling back to DATABASE_URL for this write. Set CATALOG_TEST_DATABASE_URL in your .env to the isolated beauty_store_test database so write mode never depends on what DATABASE_URL happens to point at.'
			: null
	return { url: options.fallbackDatabaseUrl, usedCatalogTestVar: false, warning }
}

function resolveSelectionIds(inputs: WorkflowInputs, representativeSelection: RepresentativeSliceResult | null): number[] {
	if (inputs.selection.kind === 'legacyProductIds') {
		return resolveLegacyProductIds(inputs.dump, { kind: 'legacyProductIds', legacyProductIds: inputs.selection.legacyProductIds })
	}
	return representativeSelection!.legacyProductIds
}

/**
 * Requirement 1/4: the one read-only entrypoint. Orchestrates brand
 * selection (if `--brand-id` was given), slicing, dry-run import preview,
 * brand/category bootstrap preview (dry-run), and the six post-import
 * checks run against a rolled-back dry-run write - all inside ONE rolled
 * back transaction, so nothing is ever committed - then folds everything
 * into one report with an explicit READY/READY_WITH_WARNINGS/NOT_READY
 * verdict.
 */
export async function runWorkflowAnalysis(db: Database, inputs: WorkflowInputs): Promise<WorkflowReport> {
	const idNomDuplicates: IdNomDuplicateReport = classifyIdNomDuplicates(inputs.rawOneCRecords, 'ID_nom')
	const legacyVariantFamilies = reconcileLegacyVariantFamilies(inputs.dump, inputs.oneCRecords, inputs.priorQuarantine)
	const families = reconcileFamilies(inputs.dump, inputs.oneCRecords, inputs.priorQuarantine)
	const positions = reconcileSqlWith1c(inputs.dump, inputs.oneCRecords, inputs.priorQuarantine)

	let representativeSelection: RepresentativeSliceResult | null = null
	if (inputs.selection.kind === 'brandId') {
		representativeSelection = selectBrandRepresentativeSlice({
			dump: inputs.dump,
			brandId: inputs.selection.brandId,
			legacyVariantFamilies,
			families,
			positions,
			idNomDuplicates,
			minCount: inputs.selection.minCount,
			maxCount: inputs.selection.maxCount
		})
	}

	const legacyProductIds = resolveSelectionIds(inputs, representativeSelection)

	if (legacyProductIds.length === 0) {
		return emptySelectionReport(inputs.selection, representativeSelection)
	}

	let slicedDump: LegacyCatalogDump
	try {
		slicedDump = buildCatalogSlice(inputs.dump, legacyProductIds)
	} catch (error) {
		if (error instanceof UnknownLegacyProductIdError) {
			return {
				selection: { kind: inputs.selection.kind, brandId: inputs.selection.kind === 'brandId' ? inputs.selection.brandId : null, legacyProductIds, representativeSelection },
				...emptyAnalysisBody(),
				verdict: 'NOT_READY',
				blockers: [error.message],
				warnings: []
			}
		}
		throw error
	}

	// Re-reconciled against the SLICED dump, exactly the same way
	// cli/catalog-slice-import.ts already does - never against the full dump,
	// so the manifest hash and preview are faithful to exactly what a real
	// write of this selection would do.
	const slicedFamilies = reconcileFamilies(slicedDump, inputs.oneCRecords, inputs.priorQuarantine)
	const slicedPositions = reconcileSqlWith1c(slicedDump, inputs.oneCRecords, inputs.priorQuarantine)
	const slicedLegacyVariantFamilies = reconcileLegacyVariantFamilies(slicedDump, inputs.oneCRecords, inputs.priorQuarantine)

	const relevantIdNoms = [
		...slicedPositions.mysqlResults.flatMap(r => r.matchedOneCIdNoms),
		...slicedLegacyVariantFamilies.families.flatMap(f => f.confirmedMembers.map(m => m.idNom))
	]

	const manifestInputs: SliceManifestInputs = {
		legacyProductIds,
		slicedDump,
		relevantIdNoms,
		importParams: {
			workflow: true,
			selectionKind: inputs.selection.kind,
			brandId: inputs.selection.kind === 'brandId' ? inputs.selection.brandId : null,
			minCount: inputs.selection.kind === 'brandId' ? inputs.selection.minCount ?? null : null,
			maxCount: inputs.selection.kind === 'brandId' ? inputs.selection.maxCount ?? null : null
		}
	}
	const manifestHash = computeSliceManifestHash(manifestInputs)

	const importInput: CatalogImportInput = {
		dump: slicedDump,
		oneCRecords: inputs.oneCRecords,
		families: slicedFamilies,
		positions: slicedPositions,
		idNomDuplicates
	}

	const dryRunResult = await runInRolledBackTransaction(db, tx => runCatalogImport(tx, importInput, 'dry-run'))
	const preview = buildSlicePreview(dryRunResult)

	// Requirement 1: "would the post-import checks pass" - a REAL write
	// followed by the real six checks, inside a transaction that is always
	// rolled back at the end (`runInRolledBackTransaction`'s contract),
	// regardless of whether the checks pass or fail. Nothing from this is
	// ever committed.
	const postImportChecksDryRun = await runInRolledBackTransaction(db, async tx => {
		await runCatalogImport(tx, importInput, 'write')
		return collectPostImportChecks(tx, dryRunResult)
	})

	// Requirement 1: brand/category bootstrap readiness preview, dry-run only.
	const referenceSlice = extractReferencedBrandCategorySlice(inputs.dump, legacyProductIds)
	const bootstrapPreview = await runInRolledBackTransaction(db, tx => runScopedReferenceBootstrap(tx, inputs.dump, legacyProductIds, 'dry-run'))

	const conflicts = {
		bySkipReason: preview.bySkipReason,
		idNomDuplicateConflicts: slicedPositions.mysqlResults.length === 0 ? 0 : countIdNomConflicts(idNomDuplicates, 'conflicting'),
		idNomDuplicatePriceConflicts: countIdNomConflicts(idNomDuplicates, 'price_conflict'),
		idNomDuplicateBarcodeOnlyConflicts: countIdNomConflicts(idNomDuplicates, 'barcode_only_conflict')
	}

	const report: WorkflowReport = {
		selection: {
			kind: inputs.selection.kind,
			brandId: inputs.selection.kind === 'brandId' ? inputs.selection.brandId : null,
			legacyProductIds,
			representativeSelection
		},
		products: { totalConsidered: slicedDump.products.length },
		variants: {
			unitsThatWouldWrite: preview.unitsThatWouldWrite,
			unitsSkipped: preview.unitsSkipped,
			productsWithMultipleVariants: preview.productsWithMultipleVariants,
			variantCountDistribution: preview.variantCountDistribution,
			legacyVariantFamilyCounts: preview.legacyVariantFamilyCounts
		},
		categories: { distinctCount: referenceSlice.categories.length, legacyCategoryIds: referenceSlice.categories.map(c => c.id) },
		brandCategoryReadiness: {
			missingBrandLinks: postImportChecksDryRun.categoryBrandLinks.missingBrandLinks,
			missingCategoryLinks: postImportChecksDryRun.categoryBrandLinks.missingCategoryLinks,
			brandsToBootstrap: bootstrapPreview.brandResult.units.filter(u => u.action !== 'skipped').length,
			categoriesToBootstrap: bootstrapPreview.categoryResult.units.filter(u => u.action !== 'skipped').length
		},
		conflicts,
		quarantine: {
			legacyVariantFamilyQuarantined: preview.legacyVariantFamilyCounts.quarantined,
			skippedUnits: preview.unitsSkipped
		},
		postImportChecksDryRun,
		manifestHash,
		verdict: 'READY',
		blockers: [],
		warnings: []
	}

	return applyVerdict(report)
}

function countIdNomConflicts(report: IdNomDuplicateReport, classification: 'conflicting' | 'price_conflict' | 'barcode_only_conflict'): number {
	return report.groups.filter(g => g.classification === classification).length
}

async function collectPostImportChecks(tx: Tx, dryRunResult: CatalogImportResult): Promise<SliceWriteChecks> {
	return {
		rowCounts: await checkRowCounts(tx, {
			products: dryRunResult.summary.productsCreated + dryRunResult.summary.productsUpdated,
			variants: dryRunResult.summary.variantsWritten
		}),
		orphanVariants: await checkNoOrphanVariants(tx),
		duplicateSkus: await checkNoDuplicateSkus(tx),
		duplicateExternalIdMappings: await checkNoDuplicateExternalIdMappings(tx),
		barcodeIntegrity: await checkBarcodeIntegrity(tx),
		categoryBrandLinks: await checkCategoryBrandLinksResolve(tx)
	}
}

function emptyAnalysisBody() {
	return {
		products: { totalConsidered: 0 },
		variants: {
			unitsThatWouldWrite: 0,
			unitsSkipped: 0,
			productsWithMultipleVariants: 0,
			variantCountDistribution: { '1': 0, '2-5': 0, '6-10': 0, '11+': 0 },
			legacyVariantFamilyCounts: { confirmed: 0, partial: 0, quarantined: 0 }
		},
		categories: { distinctCount: 0, legacyCategoryIds: [] },
		brandCategoryReadiness: { missingBrandLinks: 0, missingCategoryLinks: 0, brandsToBootstrap: 0, categoriesToBootstrap: 0 },
		conflicts: { bySkipReason: {}, idNomDuplicateConflicts: 0, idNomDuplicatePriceConflicts: 0, idNomDuplicateBarcodeOnlyConflicts: 0 },
		quarantine: { legacyVariantFamilyQuarantined: 0, skippedUnits: 0 },
		postImportChecksDryRun: {
			rowCounts: { ok: true, issues: [], actual: { products: 0, variants: 0 } },
			orphanVariants: { ok: true, issues: [] },
			duplicateSkus: { ok: true, issues: [] },
			duplicateExternalIdMappings: { ok: true, issues: [] },
			barcodeIntegrity: { ok: true, issues: [] },
			categoryBrandLinks: { ok: true, issues: [], missingBrandLinks: 0, missingCategoryLinks: 0 }
		} satisfies SliceWriteChecks,
		manifestHash: ''
	}
}

function emptySelectionReport(selection: WorkflowSelection, representativeSelection: RepresentativeSliceResult | null): WorkflowReport {
	return {
		selection: {
			kind: selection.kind,
			brandId: selection.kind === 'brandId' ? selection.brandId : null,
			legacyProductIds: [],
			representativeSelection
		},
		...emptyAnalysisBody(),
		verdict: 'NOT_READY',
		blockers: ['Selection resolved to zero legacy product ids - nothing to analyze.'],
		warnings: []
	}
}

/** Requirement 4: folds the checks/counters already computed into one top-level verdict, never leaving the user to re-derive it by hand from the raw numbers. */
function applyVerdict(report: WorkflowReport): WorkflowReport {
	const blockers: string[] = []
	const warnings: string[] = []

	for (const [name, check] of Object.entries(report.postImportChecksDryRun) as [string, { ok: boolean; issues: string[] }][]) {
		if (!check.ok) blockers.push(`Post-import check "${name}" would fail: ${check.issues.join('; ')}`)
	}
	if (report.variants.unitsThatWouldWrite === 0) blockers.push('No units would actually be written - every selected legacy product resolved to skipped.')

	if (report.brandCategoryReadiness.missingBrandLinks > 0 || report.brandCategoryReadiness.missingCategoryLinks > 0) {
		if (report.brandCategoryReadiness.brandsToBootstrap > 0 || report.brandCategoryReadiness.categoriesToBootstrap > 0) {
			warnings.push(
				`${report.brandCategoryReadiness.missingBrandLinks} product(s) would be missing a brand link and ${report.brandCategoryReadiness.missingCategoryLinks} missing a category link until the brand/category bootstrap preview below is run for real.`
			)
		}
	}
	if (report.quarantine.legacyVariantFamilyQuarantined > 0) {
		warnings.push(`${report.quarantine.legacyVariantFamilyQuarantined} legacy variant family/families in this selection are quarantined and will not be written - expected, not a defect.`)
	}
	if (report.variants.unitsSkipped > 0 && report.variants.unitsThatWouldWrite > 0) {
		warnings.push(`${report.variants.unitsSkipped} unit(s) in this selection would be skipped (see conflicts.bySkipReason for why).`)
	}

	const verdict: WorkflowVerdict = blockers.length > 0 ? 'NOT_READY' : warnings.length > 0 ? 'READY_WITH_WARNINGS' : 'READY'
	return { ...report, verdict, blockers, warnings }
}

/** Human-readable rendering of a WorkflowReport - Requirement 4's "genuinely easy to scan" deliverable. `--json` mode should print `JSON.stringify(report, null, 2)` instead of calling this. */
export function renderWorkflowReportText(report: WorkflowReport): string {
	const lines: string[] = []
	lines.push('=== VIZAJE-NICA catalog migration workflow: read-only analysis ===')
	lines.push(`Selection: ${report.selection.kind}${report.selection.brandId !== null ? ` (brandId=${report.selection.brandId})` : ''}`)
	lines.push(`Legacy product ids considered: ${report.selection.legacyProductIds.length}`)
	lines.push('')
	lines.push(`Products: ${report.products.totalConsidered}`)
	lines.push(
		`Variants: ${report.variants.unitsThatWouldWrite} would write, ${report.variants.unitsSkipped} skipped, ${report.variants.productsWithMultipleVariants} product(s) with 2+ variants`
	)
	lines.push(
		`  Pass 0 family classification: confirmed=${report.variants.legacyVariantFamilyCounts.confirmed} partial=${report.variants.legacyVariantFamilyCounts.partial} quarantined=${report.variants.legacyVariantFamilyCounts.quarantined}`
	)
	lines.push(`Categories spanned: ${report.categories.distinctCount}`)
	lines.push(
		`Brand/category readiness: ${report.brandCategoryReadiness.missingBrandLinks} missing brand link(s), ${report.brandCategoryReadiness.missingCategoryLinks} missing category link(s) ` +
			`(${report.brandCategoryReadiness.brandsToBootstrap} brand(s) and ${report.brandCategoryReadiness.categoriesToBootstrap} category/categories would be bootstrapped)`
	)
	lines.push(
		`Conflicts: ${report.conflicts.idNomDuplicateConflicts} conflicting ID_nom, ${report.conflicts.idNomDuplicatePriceConflicts} price conflict(s), ${report.conflicts.idNomDuplicateBarcodeOnlyConflicts} barcode-only duplicate(s)`
	)
	lines.push(`Quarantine: ${report.quarantine.legacyVariantFamilyQuarantined} legacy variant family/families quarantined`)
	lines.push('')
	lines.push(`VERDICT: ${report.verdict}`)
	if (report.blockers.length > 0) {
		lines.push('Blockers:')
		for (const b of report.blockers) lines.push(`  - ${b}`)
	}
	if (report.warnings.length > 0) {
		lines.push('Warnings:')
		for (const w of report.warnings) lines.push(`  - ${w}`)
	}
	lines.push('')
	lines.push(`Manifest hash (for --confirm-slice on a controlled write): ${report.manifestHash}`)
	return lines.join('\n')
}

/**
 * Requirement 6 (report format): a genuinely readable, human-facing summary
 * of a completed write - products/variants written, brand/category link
 * resolution, and the idempotency re-run's created/updated counts - instead
 * of the raw JSON blocks the CLI previously printed for each sub-step.
 * `--json` mode should print `JSON.stringify(result, null, 2)` instead.
 */
export function renderWorkflowWriteReportText(result: WorkflowWriteResult): string {
	const lines: string[] = []
	lines.push('=== VIZAJE-NICA catalog migration workflow: write summary ===')
	lines.push(`Backup: ${result.backup.path} (${result.backup.sizeBytes} bytes)`)
	lines.push('')
	lines.push('First run (brand/category bootstrap + product/variant import + checks, one transaction):')
	lines.push(
		`  Brands bootstrapped: ${result.firstRun.bootstrap.brandResult.summary.created} created, ${result.firstRun.bootstrap.brandResult.summary.updated} updated, ${result.firstRun.bootstrap.brandResult.summary.skipped} skipped`
	)
	lines.push(
		`  Categories bootstrapped: ${result.firstRun.bootstrap.categoryResult.summary.created} created, ${result.firstRun.bootstrap.categoryResult.summary.updated} updated, ${result.firstRun.bootstrap.categoryResult.summary.skipped} skipped`
	)
	lines.push(
		`  Products: ${result.firstRun.importResult.summary.productsCreated} created, ${result.firstRun.importResult.summary.productsUpdated} updated`
	)
	lines.push(`  Variants written: ${result.firstRun.importResult.summary.variantsWritten}`)
	lines.push(
		`  Brand/category links: ${result.firstRun.checks.categoryBrandLinks.missingBrandLinks} missing brand link(s), ${result.firstRun.checks.categoryBrandLinks.missingCategoryLinks} missing category link(s) after bootstrap`
	)
	const firstRunFailures = Object.entries(result.firstRun.checks).filter(([, check]) => !(check as { ok: boolean }).ok)
	lines.push(`  Post-import checks: ${firstRunFailures.length === 0 ? 'all 6 passed' : `${firstRunFailures.length} FAILED (${firstRunFailures.map(([name]) => name).join(', ')})`}`)
	lines.push('')
	lines.push('Idempotency re-run (identical write, same slice, against the now-committed state):')
	lines.push(
		`  Products: ${result.secondRun.importResult.summary.productsCreated} created, ${result.secondRun.importResult.summary.productsUpdated} updated`
	)
	lines.push(`  Variants written: ${result.secondRun.importResult.summary.variantsWritten}`)
	lines.push('')
	lines.push(`IDEMPOTENT: ${result.idempotent ? 'YES (0 products created on re-run)' : 'NO - re-run created new products, investigate before trusting this import'}`)
	return lines.join('\n')
}

export type WorkflowWriteInputs = WorkflowInputs & {
	confirmSlice: string
	databaseUrl: string
	backupDir: string
	backupOptions?: CreateDatabaseBackupOptions
}

export type WorkflowWriteRun = { importResult: CatalogImportResult; checks: SliceWriteChecks; bootstrap: ScopedReferenceBootstrapResult }
export type WorkflowWriteResult = {
	backup: BackupResult
	firstRun: WorkflowWriteRun
	secondRun: WorkflowWriteRun
	idempotent: boolean
}

export class WorkflowWriteRefusedError extends Error {}

/**
 * Requirement 5/6/7: the one write entrypoint, a DISTINCT code path from
 * `runWorkflowAnalysis` - never silently falls into writing. Requires an
 * explicit `--write` at the CLI layer (checked before this is even called)
 * AND a `confirmSlice` hash matching the EXACT slice content (reusing
 * `assertSliceConfirmed`, Sprint 12B.6 - not a second confirmation
 * mechanism) AND a safe target (`assertSafeImportTarget`, reused). Creates
 * and validates a `pg_dump` backup BEFORE writing (Requirement 6); refuses
 * to proceed if the backup fails. After the backup, runs
 * `runAtomicSliceWriteWithBootstrap` (Sprint 12B.10.2) - scoped brand/
 * category reference bootstrap, THEN product/variant import, THEN all six
 * post-import checks, all composed into ONE transaction, rolled back
 * atomically if any check (or the import itself) fails. This ordering fix
 * closes a real gap: a brand-new target database (no existing brands/
 * categories - exactly the state the user's confirmed real Pupa read-only
 * run reported, 1 brand + 20 categories needing bootstrap) previously went
 * straight to product import with no reference rows for
 * `resolveBrandId`/`writeCategoryLinksPreview` to find, leaving products
 * `unpublishedForMissingBrand`/`unpublishedForMissingCategory` exactly as
 * Sprint 12B.7 already found and fixed for the separate manual CLI flow.
 * Re-runs the identical write a second time to prove idempotency
 * (Requirement 7) - bootstrap is additive and idempotent by construction
 * (Sprint 12B.7), so the second pass resolves it to all-'updated', never a
 * second 'created'.
 */
export async function runWorkflowWrite(db: Database, inputs: WorkflowWriteInputs): Promise<WorkflowWriteResult> {
	assertSafeImportTarget(inputs.databaseUrl)

	const legacyProductIds = resolveSelectionIdsForWrite(inputs)

	const slicedDump = buildCatalogSlice(inputs.dump, legacyProductIds)
	const slicedFamilies = reconcileFamilies(slicedDump, inputs.oneCRecords, inputs.priorQuarantine)
	const slicedPositions = reconcileSqlWith1c(slicedDump, inputs.oneCRecords, inputs.priorQuarantine)
	const slicedLegacyVariantFamilies = reconcileLegacyVariantFamilies(slicedDump, inputs.oneCRecords, inputs.priorQuarantine)
	const idNomDuplicates = classifyIdNomDuplicates(inputs.rawOneCRecords, 'ID_nom')

	const relevantIdNoms = [
		...slicedPositions.mysqlResults.flatMap(r => r.matchedOneCIdNoms),
		...slicedLegacyVariantFamilies.families.flatMap(f => f.confirmedMembers.map(m => m.idNom))
	]
	const manifestInputs: SliceManifestInputs = {
		legacyProductIds,
		slicedDump,
		relevantIdNoms,
		importParams: {
			workflow: true,
			selectionKind: inputs.selection.kind,
			brandId: inputs.selection.kind === 'brandId' ? inputs.selection.brandId : null,
			minCount: inputs.selection.kind === 'brandId' ? inputs.selection.minCount ?? null : null,
			maxCount: inputs.selection.kind === 'brandId' ? inputs.selection.maxCount ?? null : null
		}
	}

	try {
		assertSliceConfirmed(manifestInputs, inputs.confirmSlice)
	} catch (error) {
		if (error instanceof SliceConfirmationError) throw new WorkflowWriteRefusedError(error.message)
		throw error
	}

	// Requirement 6: pre-write backup, validated before any write happens.
	let backup: BackupResult
	try {
		backup = await createDatabaseBackup(inputs.databaseUrl, inputs.backupDir, inputs.backupOptions)
	} catch (error) {
		if (error instanceof BackupFailedError) {
			throw new WorkflowWriteRefusedError(`Refusing to write: pre-write backup failed. ${error.message}`)
		}
		throw error
	}

	const importInput: CatalogImportInput = {
		dump: slicedDump,
		oneCRecords: inputs.oneCRecords,
		families: slicedFamilies,
		positions: slicedPositions,
		idNomDuplicates
	}

	// Sprint 12B.10.2 fix: scoped brand/category reference bootstrap, THEN
	// product/variant import, THEN the six post-import checks - all inside
	// ONE transaction (`runAtomicSliceWriteWithBootstrap`), so a brand-new
	// target database with no existing brand/category rows succeeds
	// end-to-end instead of leaving products with unresolved links.
	let firstRun: WorkflowWriteRun
	try {
		firstRun = await runAtomicSliceWriteWithBootstrap(db, inputs.dump, legacyProductIds, importInput)
	} catch (error) {
		if (error instanceof PostImportChecksFailedError) {
			throw new WorkflowWriteRefusedError(`Write rolled back - one or more post-import checks failed: ${JSON.stringify(error.checks)}`)
		}
		throw error
	}

	// Requirement 7: idempotency - identical bootstrap+import run a second
	// time against the now-committed state. Bootstrap is additive/idempotent
	// (Sprint 12B.7) so it resolves to all-'updated'; a correct repeat import
	// creates 0 new products.
	let secondRun: WorkflowWriteRun
	try {
		secondRun = await runAtomicSliceWriteWithBootstrap(db, inputs.dump, legacyProductIds, importInput)
	} catch (error) {
		if (error instanceof PostImportChecksFailedError) {
			throw new WorkflowWriteRefusedError(`Idempotency re-run's post-import checks failed: ${JSON.stringify(error.checks)}`)
		}
		throw error
	}

	const idempotent = secondRun.importResult.summary.productsCreated === 0

	return { backup, firstRun, secondRun, idempotent }
}

function resolveSelectionIdsForWrite(inputs: WorkflowWriteInputs): number[] {
	if (inputs.selection.kind === 'legacyProductIds') {
		return resolveLegacyProductIds(inputs.dump, { kind: 'legacyProductIds', legacyProductIds: inputs.selection.legacyProductIds })
	}
	const idNomDuplicates = classifyIdNomDuplicates(inputs.rawOneCRecords, 'ID_nom')
	const legacyVariantFamilies = reconcileLegacyVariantFamilies(inputs.dump, inputs.oneCRecords, inputs.priorQuarantine)
	const families = reconcileFamilies(inputs.dump, inputs.oneCRecords, inputs.priorQuarantine)
	const positions = reconcileSqlWith1c(inputs.dump, inputs.oneCRecords, inputs.priorQuarantine)
	const result = selectBrandRepresentativeSlice({
		dump: inputs.dump,
		brandId: inputs.selection.brandId,
		legacyVariantFamilies,
		families,
		positions,
		idNomDuplicates,
		minCount: inputs.selection.minCount,
		maxCount: inputs.selection.maxCount
	})
	return result.legacyProductIds
}
