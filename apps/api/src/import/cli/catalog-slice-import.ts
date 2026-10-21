/**
 * Controlled test-slice catalog import CLI (Sprint 12B.6).
 *
 * Builds a small, internally-consistent slice of a full legacy SQL dump
 * (Requirement 1/2), previews exactly what it would write (Requirement 4),
 * and - only in write mode - requires BOTH `assertSafeImportTarget`
 * (unchanged, catalog-importer.ts) AND an explicit `--confirm-slice=<hash>`
 * matching the previewed slice's own manifest hash (Requirement 5) before
 * running `runCatalogImport` in write mode and reporting the Requirement 6
 * post-import checks against what was actually written.
 *
 * Usage (dry-run preview of an explicit slice):
 *   bun run import:legacy:catalog-slice -- --sql=<path> --products=<path> --legacy-product-ids=101,102,103
 *
 * Usage (auto-select a small scenario-diverse slice, dry-run only):
 *   bun run import:legacy:catalog-slice -- --sql=<path> --products=<path> --auto
 *
 * Usage (write mode - isolated test database only, requires BOTH --write
 * and the exact --confirm-slice hash the dry-run preview reported):
 *   bun run import:legacy:catalog-slice -- --sql=<path> --products=<path> --legacy-product-ids=101,102,103 --write --confirm-slice=<hash>
 *
 * This sprint authorizes implementation and synthetic testing only - this
 * CLI has never been run with --write against real data, and this sprint's
 * own tests never run it against anything but synthetic fixtures.
 */
import { db, queryClient } from '../../db/client'
import { env } from '../../config/env'
import { loadLegacyCatalogDump } from '../parsers/mysql-catalog'
import { parseProductsFeed } from '../parsers/products-feed'
import { readJsonArrayFileBounded } from '../parsers/json-array-stream'
import { runLegacyCatalogDryRun } from '../dry-run-catalog'
import { reconcileSqlWith1c, quarantineMapFromCatalogDryRun } from '../reconcile/sql-1c-reconciliation'
import { reconcileFamilies } from '../reconcile/family-reconciliation'
import { reconcileLegacyVariantFamilies } from '../reconcile/legacy-variant-family-reconciliation'
import { classifyIdNomDuplicates } from '../reconcile/duplicate-id-nom'
import { assertSafeImportTarget, runCatalogImport, UnsafeImportTargetError, type CatalogImportInput } from '../catalog-importer'
import { buildCatalogSlice, resolveLegacyProductIds, UnknownLegacyProductIdError, type SliceCriteria } from '../catalog-slice'
import { autoSelectDiverseSlice } from '../catalog-slice-scenarios'
import { runInRolledBackTransaction } from '../catalog-slice-rollback'
import { buildSlicePreview, computeSliceManifestHash, assertSliceConfirmed, SliceConfirmationError } from '../catalog-slice-preview'
import { runAtomicSliceWrite, PostImportChecksFailedError } from '../catalog-slice-write'
import { parseSliceCliArgs } from '../catalog-slice-cli-args'

const USAGE =
	'Usage: bun run import:legacy:catalog-slice -- --sql=<path> --products=<path> (--legacy-product-ids=<ids>|--brand-ids=<ids>|--legacy-category-ids=<ids>|--auto) [--write --confirm-slice=<hash>]'

async function main() {
	const args = parseSliceCliArgs(process.argv.slice(2))
	if (!args.sql || !args.products) {
		console.error(USAGE)
		process.exit(1)
	}
	const selectionModesChosen = [args.legacyProductIds, args.brandIds, args.legacyCategoryIds, args.auto || null].filter(
		v => v !== null
	).length
	if (selectionModesChosen !== 1) {
		console.error(`Exactly one selection mode is required (--legacy-product-ids, --brand-ids, --legacy-category-ids, or --auto).\n${USAGE}`)
		process.exit(1)
	}

	if (args.write) {
		try {
			assertSafeImportTarget(env.DATABASE_URL)
		} catch (error) {
			if (error instanceof UnsafeImportTargetError) {
				console.error(error.message)
				process.exit(1)
			}
			throw error
		}
	}

	const sqlFile = Bun.file(args.sql)
	if (!(await sqlFile.exists())) {
		console.error(`SQL file not found: ${args.sql}`)
		process.exit(1)
	}
	const sql = await sqlFile.text()
	const fullDump = loadLegacyCatalogDump(sql)

	const rawOneCRecords = (await readJsonArrayFileBounded(args.products)).filter(
		(r): r is Record<string, unknown> => typeof r === 'object' && r !== null
	)
	const oneCRecords = parseProductsFeed(rawOneCRecords).validRecords

	console.log(`Full dump: ${fullDump.products.length} products, ${fullDump.brands.length} brands, ${fullDump.categories.length} categories.`)

	const catalogDryRun = await runLegacyCatalogDryRun(sql)
	const priorQuarantine = quarantineMapFromCatalogDryRun(catalogDryRun.products)
	const idNomDuplicates = classifyIdNomDuplicates(rawOneCRecords, 'ID_nom')

	let legacyProductIds: number[]
	if (args.auto) {
		const positions = reconcileSqlWith1c(fullDump, oneCRecords, priorQuarantine)
		const legacyVariantFamilies = reconcileLegacyVariantFamilies(fullDump, oneCRecords, priorQuarantine)
		const auto = autoSelectDiverseSlice({ dump: fullDump, legacyVariantFamilies, positions, idNomDuplicates })
		legacyProductIds = auto.legacyProductIds
		console.log('\n=== Auto-selected scenario coverage ===')
		console.log(JSON.stringify({ coverage: auto.coverage, missingScenarios: auto.missingScenarios }, null, 2))
	} else {
		const criteria: SliceCriteria = args.legacyProductIds
			? { kind: 'legacyProductIds', legacyProductIds: args.legacyProductIds }
			: args.brandIds
				? { kind: 'brandIds', brandIds: args.brandIds }
				: { kind: 'legacyCategoryIds', legacyCategoryIds: args.legacyCategoryIds! }
		legacyProductIds = resolveLegacyProductIds(fullDump, criteria)
	}

	if (legacyProductIds.length === 0) {
		console.error('Selection resolved to zero legacy product ids - nothing to slice. Aborting.')
		process.exit(1)
	}

	let slicedDump: ReturnType<typeof buildCatalogSlice>
	try {
		slicedDump = buildCatalogSlice(fullDump, legacyProductIds)
	} catch (error) {
		if (error instanceof UnknownLegacyProductIdError) {
			console.error(error.message)
			process.exit(1)
		}
		throw error
	}

	const positions = reconcileSqlWith1c(slicedDump, oneCRecords, priorQuarantine)
	const legacyVariantFamilies = reconcileLegacyVariantFamilies(slicedDump, oneCRecords, priorQuarantine)

	// Sprint 12B.6.1 Task 5: every 1C ID_nom this slice's own reconciliation
	// (Pass 0 + Pass 1/2) actually resolved against - not the whole 1C feed,
	// which is almost always far larger than what this slice touches.
	const relevantIdNoms = [
		...positions.mysqlResults.flatMap(r => r.matchedOneCIdNoms),
		...legacyVariantFamilies.families.flatMap(f => f.confirmedMembers.map(m => m.idNom))
	]

	const manifestInputs = {
		legacyProductIds,
		slicedDump,
		relevantIdNoms,
		importParams: {
			auto: args.auto ?? false,
			legacyProductIds: args.legacyProductIds ? args.legacyProductIds.join(',') : null,
			brandIds: args.brandIds ? args.brandIds.join(',') : null,
			legacyCategoryIds: args.legacyCategoryIds ? args.legacyCategoryIds.join(',') : null
		}
	}
	const manifestHash = computeSliceManifestHash(manifestInputs)
	console.log(
		`\nSlice: ${slicedDump.products.length} products, ${slicedDump.productVariables.length} variables, ${slicedDump.brands.length} brands, ${slicedDump.categories.length} categories.`
	)
	console.log(`Slice manifest hash: ${manifestHash}`)

	const input: CatalogImportInput = {
		dump: slicedDump,
		oneCRecords,
		families: reconcileFamilies(slicedDump, oneCRecords, priorQuarantine),
		positions,
		idNomDuplicates
	}

	const dryRunResult = await runInRolledBackTransaction(db, tx => runCatalogImport(tx, input, 'dry-run'))
	const preview = buildSlicePreview(dryRunResult)
	console.log('\n=== Dry-run preview (nothing written) ===')
	console.log(JSON.stringify(preview, null, 2))

	if (!args.write) {
		console.log(
			`\nThis was a DRY RUN - zero rows were written. Re-run with --write --confirm-slice=${manifestHash} (against the isolated test database only) to actually import exactly this slice.`
		)
		return
	}

	try {
		assertSliceConfirmed(manifestInputs, args.confirmSlice ?? undefined)
	} catch (error) {
		if (error instanceof SliceConfirmationError) {
			console.error(error.message)
			process.exit(1)
		}
		throw error
	}

	// Sprint 12B.6.1 Task 1: the write AND every mandatory post-import check
	// run inside ONE transaction (see `runAtomicSliceWrite`). Postgres never
	// commits a transaction whose callback throws - so a failing check rolls
	// back the write it just made, atomically, rather than leaving a
	// committed-but-invalid import behind for a human to notice and clean up
	// by hand.
	try {
		const { importResult, checks } = await runAtomicSliceWrite(db, input)
		console.log('\n=== Write summary ===')
		console.log(JSON.stringify(importResult.summary, null, 2))
		console.log('\n=== Post-import checks ===')
		console.log(JSON.stringify(checks, null, 2))
		console.log('\nAll post-import checks passed. Transaction committed.')
	} catch (error) {
		if (error instanceof PostImportChecksFailedError) {
			console.log('\n=== Post-import checks ===')
			console.log(JSON.stringify(error.checks, null, 2))
			console.error(`\n${error.message}`)
			process.exit(1)
		}
		throw error
	}
}

main()
	.then(() => queryClient.end())
	.then(() => process.exit(0))
	.catch(error => {
		console.error('Catalog slice import failed:', error)
		process.exit(1)
	})

