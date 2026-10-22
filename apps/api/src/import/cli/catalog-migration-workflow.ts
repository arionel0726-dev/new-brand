/**
 * Unified local developer workflow CLI (Sprint 12B.10).
 *
 * Replaces the 10-20 separate commands a developer previously had to run by
 * hand across Sprints 12B.6-12B.9 (brand-readiness-analysis,
 * brand-representative-slice, catalog-slice dry-run,
 * catalog-slice-reference-bootstrap preview, catalog-slice write,
 * post-import checks, idempotency re-run) with ONE read-only analysis
 * command and ONE clearly separated, safety-gated write command. This file
 * is a thin CLI shell - all real logic lives in catalog-migration-workflow.ts,
 * local-file-discovery.ts, and catalog-migration-backup.ts, all independently
 * unit-testable (this file's own main() runs unconditionally at module
 * load, so it is never imported by a test, per the existing project
 * convention for files under import/cli/).
 *
 * Usage (read-only analysis+preview, brand-scoped, auto-discovering local
 * files):
 *   bun run import:legacy:catalog-workflow -- --brand-id=108
 *
 * Usage (read-only analysis+preview, explicit legacy product ids):
 *   bun run import:legacy:catalog-workflow -- --product-ids=40,984,374,661,2
 *
 * Usage (explicit file paths, overriding auto-discovery):
 *   bun run import:legacy:catalog-workflow -- --brand-id=108 --sql=<path> --products=<path>
 *
 * Usage (controlled write - isolated beauty_store_test only, requires BOTH
 * --write and the --confirm-slice hash printed by the read-only run above):
 *   bun run import:legacy:catalog-workflow -- --brand-id=108 --write --confirm-slice=<hash>
 *
 * Usage (machine-readable output for scripting):
 *   bun run import:legacy:catalog-workflow -- --brand-id=108 --json
 *
 * Requirement 6: write mode shells out to `pg_dump` to create a validated
 * pre-write backup. `pg_dump` must be on PATH - if it is missing, write
 * mode refuses with a clear error rather than silently skipping the backup.
 */
import path from 'node:path'
import { db, queryClient } from '../../db/client'
import { env } from '../../config/env'
import { loadLegacyCatalogDump } from '../parsers/mysql-catalog'
import { parseProductsFeed } from '../parsers/products-feed'
import { readJsonArrayFileBounded } from '../parsers/json-array-stream'
import { runLegacyCatalogDryRun } from '../dry-run-catalog'
import { quarantineMapFromCatalogDryRun } from '../reconcile/sql-1c-reconciliation'
import { resolveSqlPath, resolveProductsPath, FileResolutionError } from '../local-file-discovery'
import {
	runWorkflowReadOnlyPreflight,
	runWorkflowWritePreflight,
	runWorkflowAnalysis,
	runWorkflowWrite,
	renderWorkflowReportText,
	WorkflowWriteRefusedError,
	type WorkflowSelection
} from '../catalog-migration-workflow'
import { checkDrizzleMigrations } from '../drizzle-migration-check'

type Args = {
	sql: string | null
	products: string | null
	brandId: number | null
	productIds: number[] | null
	min: number | null
	max: number | null
	write: boolean
	confirmSlice: string | null
	json: boolean
}

function parseArgs(argv: string[]): Args {
	const args: Args = { sql: null, products: null, brandId: null, productIds: null, min: null, max: null, write: false, confirmSlice: null, json: false }
	for (const arg of argv) {
		if (arg.startsWith('--sql=')) args.sql = arg.slice('--sql='.length)
		else if (arg.startsWith('--products=')) args.products = arg.slice('--products='.length)
		else if (arg.startsWith('--brand-id=')) args.brandId = Number(arg.slice('--brand-id='.length))
		else if (arg.startsWith('--product-ids=')) {
			args.productIds = arg
				.slice('--product-ids='.length)
				.split(',')
				.map(s => Number(s.trim()))
		} else if (arg.startsWith('--min=')) args.min = Number(arg.slice('--min='.length))
		else if (arg.startsWith('--max=')) args.max = Number(arg.slice('--max='.length))
		else if (arg === '--write') args.write = true
		else if (arg.startsWith('--confirm-slice=')) args.confirmSlice = arg.slice('--confirm-slice='.length)
		else if (arg === '--json') args.json = true
	}
	return args
}

const USAGE =
	'Usage: bun run import:legacy:catalog-workflow -- (--brand-id=<id>|--product-ids=<ids>) [--sql=<path>] [--products=<path>] [--min=20] [--max=30] [--write --confirm-slice=<hash>] [--json]'

/** Repo root, computed relative to this file's own location (apps/api/src/import/cli/) - used as a search root for local-file-discovery alongside process.cwd(), since a developer may invoke bun from either the repo root or apps/api. */
const REPO_ROOT = path.resolve(import.meta.dir, '../../../../..')

async function main() {
	const args = parseArgs(process.argv.slice(2))
	if ((args.brandId === null) === (args.productIds === null)) {
		console.error(`Exactly one of --brand-id or --product-ids is required.\n${USAGE}`)
		process.exit(1)
	}
	if (args.write && !args.confirmSlice) {
		console.error(`--write requires --confirm-slice=<hash> (from a prior read-only run of this exact selection).\n${USAGE}`)
		process.exit(1)
	}

	// Sprint 12B.10.1 fix: read-only analysis and write mode get DISTINCT
	// preflight checks. Read-only mode only requires a local Postgres host
	// (it never requires the exact `beauty_store_test` database name - every
	// query it runs is inside a rolled-back transaction) so it works safely
	// against a developer's own local dev database. Write mode keeps the
	// original strict check (local host AND exact `beauty_store_test` name).
	console.log(`=== Preflight checks (${args.write ? 'write mode' : 'read-only analysis'}) ===`)
	const preflight = args.write
		? await runWorkflowWritePreflight(db, env.DATABASE_URL, () => checkDrizzleMigrations())
		: await runWorkflowReadOnlyPreflight(db, env.DATABASE_URL, () => checkDrizzleMigrations())
	console.log(`  Safe target: ${preflight.safeTarget.ok ? 'OK' : 'FAILED'} - ${preflight.safeTarget.detail}`)
	console.log(`  Reachable: ${preflight.reachable.ok ? 'OK' : 'FAILED'} - ${preflight.reachable.detail}`)
	console.log(`  Migrations current: ${preflight.migrationsCurrent.ok ? 'OK' : 'FAILED'} - ${preflight.migrationsCurrent.detail}`)
	if (!preflight.ok) {
		console.error(`\nPreflight failed - refusing to run any ${args.write ? 'write' : 'analysis'}. Fix the above before retrying.`)
		process.exit(1)
	}

	const searchRoots = [process.cwd(), REPO_ROOT]
	let sqlPath: string
	let productsPath: string
	try {
		sqlPath = resolveSqlPath(args.sql, searchRoots)
		productsPath = resolveProductsPath(args.products, searchRoots)
	} catch (error) {
		if (error instanceof FileResolutionError) {
			console.error(`\n${error.message}`)
			process.exit(1)
		}
		throw error
	}
	console.log(`\nSQL dump: ${sqlPath}`)
	console.log(`Products feed: ${productsPath}`)

	const sqlFile = Bun.file(sqlPath)
	if (!(await sqlFile.exists())) {
		console.error(`SQL file not found: ${sqlPath}`)
		process.exit(1)
	}
	const sql = await sqlFile.text()
	const dump = loadLegacyCatalogDump(sql)

	const rawOneCRecords = (await readJsonArrayFileBounded(productsPath)).filter(
		(r): r is Record<string, unknown> => typeof r === 'object' && r !== null
	)
	const oneCRecords = parseProductsFeed(rawOneCRecords).validRecords

	const catalogDryRun = await runLegacyCatalogDryRun(sql)
	const priorQuarantine = quarantineMapFromCatalogDryRun(catalogDryRun.products)

	const selection: WorkflowSelection =
		args.brandId !== null
			? { kind: 'brandId', brandId: args.brandId, minCount: args.min ?? undefined, maxCount: args.max ?? undefined }
			: { kind: 'legacyProductIds', legacyProductIds: args.productIds! }

	const workflowInputs = { dump, rawOneCRecords, oneCRecords, selection, priorQuarantine }

	if (!args.write) {
		const report = await runWorkflowAnalysis(db, workflowInputs)
		if (args.json) {
			console.log(JSON.stringify(report, null, 2))
		} else {
			console.log(`\n${renderWorkflowReportText(report)}`)
		}
		console.log('\nThis was READ-ONLY - nothing was written. Re-run with --write --confirm-slice=<hash above> to write exactly this selection into beauty_store_test.')
		return
	}

	console.log('\n=== Controlled write mode ===')
	try {
		const result = await runWorkflowWrite(db, {
			...workflowInputs,
			confirmSlice: args.confirmSlice!,
			databaseUrl: env.DATABASE_URL,
			backupDir: path.join(REPO_ROOT, '.catalog-migration-backups')
		})
		console.log(`Backup created and validated: ${result.backup.path} (${result.backup.sizeBytes} bytes)`)
		console.log('\n=== First write ===')
		console.log(JSON.stringify(result.firstRun.importResult.summary, null, 2))
		console.log(JSON.stringify(result.firstRun.checks, null, 2))
		console.log('\n=== Idempotency re-run ===')
		console.log(JSON.stringify(result.secondRun.importResult.summary, null, 2))
		console.log(JSON.stringify(result.secondRun.checks, null, 2))
		console.log(`\nIdempotent: ${result.idempotent ? 'YES (0 created on re-run)' : 'NO - re-run created new products, investigate before trusting this import'}`)
	} catch (error) {
		if (error instanceof WorkflowWriteRefusedError) {
			console.error(`\nWrite refused: ${error.message}`)
			process.exit(1)
		}
		throw error
	}
}

main()
	.then(() => queryClient.end())
	.then(() => process.exit(0))
	.catch(error => {
		console.error('Catalog migration workflow failed:', error)
		process.exit(1)
	})

export { parseArgs }
