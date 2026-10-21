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
import { formatSkippedUnits } from '../format-bootstrap-report'

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

/**
 * Sprint 12B.3.1 follow-up: the summary JSON only carries counts
 * (`93/94 planned`, `1 empty_title`) - it never names which legacy row was
 * skipped or why, even though bootstrapBrands/bootstrapCategories already
 * compute exactly that per-unit detail. Formatting itself lives in the pure,
 * testable format-bootstrap-report.ts; this is just the print step.
 */
function printSkippedUnits(label: string, units: Parameters<typeof formatSkippedUnits>[1]) {
	console.log(`\n${formatSkippedUnits(label, units).join('\n')}`)
}

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

	console.log('Loading legacy MySQL catalog dump (brands + categories + products for reference counts)...')
	const dump = loadLegacyCatalogDump(sql)
	console.log(`  ${dump.brands.length} brands, ${dump.categories.length} categories, ${dump.products.length} products parsed from SQL.`)

	// Requirement 1/5: how many legacy product rows reference each legacy
	// brand_id/category_id - computed once here from the already-parsed dump
	// (loadLegacyCatalogDump already loads products, no extra parsing cost)
	// and passed into the bootstrap as a read-only cross-reference, so a
	// skipped brand/category's real-world impact is visible directly in the
	// dry-run report instead of requiring a separate manual lookup.
	const productsByBrand = new Map<number, number>()
	const productsByCategory = new Map<number, number>()
	for (const product of dump.products) {
		if (product.brandId !== null) productsByBrand.set(product.brandId, (productsByBrand.get(product.brandId) ?? 0) + 1)
		if (product.categoryId !== null) productsByCategory.set(product.categoryId, (productsByCategory.get(product.categoryId) ?? 0) + 1)
	}
	for (const link of dump.productCategories) {
		productsByCategory.set(link.categoryId, (productsByCategory.get(link.categoryId) ?? 0) + 1)
	}

	const mode = args.write ? 'write' : 'dry-run'
	console.log(`\nRunning brand/category bootstrap in ${mode.toUpperCase()} mode...`)

	const result = await db.transaction(async tx => {
		const brandResult = await bootstrapBrands(tx, dump.brands, mode, productsByBrand)
		const categoryResult = await bootstrapCategories(tx, dump.categories, mode, productsByCategory)
		return { brandResult, categoryResult }
	})

	console.log('\n=== Brand bootstrap summary ===')
	console.log(JSON.stringify(result.brandResult.summary, null, 2))
	console.log('\n=== Category bootstrap summary ===')
	console.log(JSON.stringify(result.categoryResult.summary, null, 2))

	printSkippedUnits('brands', result.brandResult.units)
	printSkippedUnits('categories', result.categoryResult.units)

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
