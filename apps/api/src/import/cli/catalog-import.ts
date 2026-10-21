/**
 * Controlled catalog import CLI (Sprint 12B.2). Runs `runCatalogImport`
 * (../catalog-importer.ts) against explicit local file paths, mirroring
 * reconcile-1c-local.ts's argument shape so the same real local files the
 * user already has can be reused.
 *
 * SAFETY: defaults to dry-run. Write mode requires BOTH the explicit
 * `--write` flag AND DATABASE_URL pointing at a database whose name
 * contains "test" and not "prod" (`assertSafeImportTarget`, enforced in
 * code, not just by this CLI's own argument parsing) - the two together are
 * what make `--write` possible at all; neither alone is enough.
 *
 * Usage:
 *   bun run import:legacy:catalog-import -- \
 *     --sql=/path/to/legacy_dump.sql \
 *     --products=/path/to/products.json \
 *     [--write]
 *
 * Without --write: a full dry-run preview - identical decision logic, zero
 * database writes (see catalog-importer.ts's resolveIdentity for how this
 * is enforced, not just assumed).
 *
 * This sprint authorizes implementation and synthetic testing only. This
 * CLI has never been run against the user's real catalog SQL/JSON - see
 * docs/vizaje-catalog-importer.md for the readiness criteria that must be
 * met before a real --write run against real data is authorized.
 */
import { db, queryClient } from '../../db/client'
import { env } from '../../config/env'
import { readJsonArrayFileBounded } from '../parsers/json-array-stream'
import { loadLegacyCatalogDump } from '../parsers/mysql-catalog'
import { parseProductsFeed } from '../parsers/products-feed'
import { classifyIdNomDuplicates } from '../reconcile/duplicate-id-nom'
import { reconcileFamilies } from '../reconcile/family-reconciliation'
import { quarantineMapFromCatalogDryRun, reconcileSqlWith1c } from '../reconcile/sql-1c-reconciliation'
import { runLegacyCatalogDryRun } from '../dry-run-catalog'
import { assertSafeImportTarget, runCatalogImport, UnsafeImportTargetError } from '../catalog-importer'

type Args = { sql: string | null; products: string | null; write: boolean }

function parseArgs(argv: string[]): Args {
	const args: Args = { sql: null, products: null, write: false }
	for (const arg of argv) {
		if (arg.startsWith('--sql=')) args.sql = arg.slice('--sql='.length)
		else if (arg.startsWith('--products=')) args.products = arg.slice('--products='.length)
		else if (arg === '--write') args.write = true
	}
	return args
}

const USAGE = 'Usage: bun run import:legacy:catalog-import -- --sql=<path> --products=<path> [--write]'

async function main() {
	const args = parseArgs(process.argv.slice(2))
	if (!args.sql || !args.products) {
		console.error(USAGE)
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

	console.log('Loading legacy MySQL catalog dump...')
	const dump = loadLegacyCatalogDump(sql)
	console.log(`  ${dump.products.length} products parsed from SQL.`)

	console.log('Running Sprint 12A.2 catalog dry-run for quarantine state...')
	const catalogDryRun = await runLegacyCatalogDryRun(sql)
	const priorQuarantine = quarantineMapFromCatalogDryRun(catalogDryRun.products)

	console.log(`Streaming ${args.products} ...`)
	const file = Bun.file(args.products)
	if (!(await file.exists())) {
		console.error(`File not found: ${args.products}`)
		process.exit(1)
	}
	const rawRecords = (await readJsonArrayFileBounded(args.products)).filter(
		(r): r is Record<string, unknown> => typeof r === 'object' && r !== null
	)
	const { validRecords: oneCRecords } = parseProductsFeed(rawRecords)
	console.log(`  ${rawRecords.length} raw records, ${oneCRecords.length} valid.`)

	console.log('Reconciling SQL catalog against 1C records...')
	const positions = reconcileSqlWith1c(dump, oneCRecords, priorQuarantine)
	const families = reconcileFamilies(dump, oneCRecords, priorQuarantine)
	const idNomDuplicates = classifyIdNomDuplicates(rawRecords, 'ID_nom')

	const mode = args.write ? 'write' : 'dry-run'
	console.log(`\nRunning catalog import in ${mode.toUpperCase()} mode...`)

	const result = await db.transaction(tx => runCatalogImport(tx, { dump, oneCRecords, families, positions, idNomDuplicates }, mode))

	console.log('\n=== Catalog import summary ===')
	console.log(JSON.stringify(result.summary, null, 2))

	if (mode === 'dry-run') {
		console.log(
			'\nThis was a DRY RUN - zero rows were written. Re-run with --write (against an isolated test database only) to actually import.'
		)
	}
}

main()
	.then(() => queryClient.end())
	.then(() => process.exit(0))
	.catch(error => {
		console.error('Catalog import failed:', error)
		process.exit(1)
	})

export { parseArgs }
