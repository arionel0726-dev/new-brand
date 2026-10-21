/**
 * Legacy brand & category bootstrap CLI (Sprint 12B.3).
 *
 * Reuses the existing legacy SQL parser (parsers/mysql-catalog.ts) and the
 * same dry-run/write safety posture as catalog-import.ts: defaults to
 * dry-run, write mode requires BOTH the explicit `--write` flag AND
 * `assertSafeImportTarget` (catalog-importer.ts) passing against
 * DATABASE_URL - reused directly, not reimplemented.
 *
 * Usage (read-only dry-run, safe against real local files):
 *   bun run import:legacy:brand-category-bootstrap -- --sql=/path/to/legacy_dump.sql
 *
 * Usage (write mode - isolated test database only, requires --write):
 *   bun run import:legacy:brand-category-bootstrap -- --sql=/path/to/legacy_dump.sql --write
 *
 * This sprint authorizes implementation and synthetic testing only - this
 * CLI has never been run with --write against real data.
 */
import { db, queryClient } from '../../db/client'
import { env } from '../../config/env'
import { loadLegacyCatalogDump } from '../parsers/mysql-catalog'
import { assertSafeImportTarget, UnsafeImportTargetError } from '../catalog-importer'
import { bootstrapBrands, bootstrapCategories } from '../brand-category-bootstrap'

type Args = { sql: string | null; write: boolean }

function parseArgs(argv: string[]): Args {
	const args: Args = { sql: null, write: false }
	for (const arg of argv) {
		if (arg.startsWith('--sql=')) args.sql = arg.slice('--sql='.length)
		else if (arg === '--write') args.write = true
	}
	return args
}

const USAGE = 'Usage: bun run import:legacy:brand-category-bootstrap -- --sql=<path> [--write]'

async function main() {
	const args = parseArgs(process.argv.slice(2))
	if (!args.sql) {
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

	console.log('Loading legacy MySQL catalog dump (brands + categories only)...')
	const dump = loadLegacyCatalogDump(sql)
	console.log(`  ${dump.brands.length} brands, ${dump.categories.length} categories parsed from SQL.`)

	const mode = args.write ? 'write' : 'dry-run'
	console.log(`\nRunning brand/category bootstrap in ${mode.toUpperCase()} mode...`)

	const result = await db.transaction(async tx => {
		const brandResult = await bootstrapBrands(tx, dump.brands, mode)
		const categoryResult = await bootstrapCategories(tx, dump.categories, mode)
		return { brandResult, categoryResult }
	})

	console.log('\n=== Brand bootstrap summary ===')
	console.log(JSON.stringify(result.brandResult.summary, null, 2))
	console.log('\n=== Category bootstrap summary ===')
	console.log(JSON.stringify(result.categoryResult.summary, null, 2))

	if (mode === 'dry-run') {
		console.log(
			'\nThis was a DRY RUN - zero rows were written. Re-run with --write (against an isolated test database only) to actually bootstrap brands/categories.'
		)
	}
}

main()
	.then(() => queryClient.end())
	.then(() => process.exit(0))
	.catch(error => {
		console.error('Brand/category bootstrap failed:', error)
		process.exit(1)
	})

export { parseArgs }
