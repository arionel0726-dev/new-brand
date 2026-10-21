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
	//
	// Sprint 12B.3.2 Requirement 3: categories get a PRIMARY (products.category_id)
	// and SECONDARY (product_categories junction row) count, kept separate -
	// a product can have a broken primary category_id while still carrying a
	// valid secondary link (exactly Sprint 12A.2's "30/33 products" finding),
	// so merging the two would hide that some products still genuinely
	// depend on a category that looks unused by primary assignment alone.
	// `productsByCategory` (combined) is still built too, for the existing
	// single-count `referencingProductCount` field callers already rely on.
	const productsByBrand = new Map<number, number>()
	// Deduped by productId per category (not raw row counts) - Requirement 3
	// asks for UNIQUE products, and a junction table can in principle carry
	// more than one row for the same (product, category) pair.
	const uniqueByCategoryPrimary = new Map<number, Set<number>>()
	const uniqueByCategorySecondary = new Map<number, Set<number>>()
	for (const product of dump.products) {
		if (product.brandId !== null) productsByBrand.set(product.brandId, (productsByBrand.get(product.brandId) ?? 0) + 1)
		if (product.categoryId !== null) {
			if (!uniqueByCategoryPrimary.has(product.categoryId)) uniqueByCategoryPrimary.set(product.categoryId, new Set())
			uniqueByCategoryPrimary.get(product.categoryId)!.add(product.id)
		}
	}
	for (const link of dump.productCategories) {
		if (!uniqueByCategorySecondary.has(link.categoryId)) uniqueByCategorySecondary.set(link.categoryId, new Set())
		uniqueByCategorySecondary.get(link.categoryId)!.add(link.productId)
	}
	const productsByCategoryPrimary = new Map([...uniqueByCategoryPrimary].map(([catId, ids]) => [catId, ids.size]))
	const productsByCategorySecondary = new Map([...uniqueByCategorySecondary].map(([catId, ids]) => [catId, ids.size]))
	// Combined (backward-compatible single count): union of the two id sets
	// per category, so a product counted in both primary and secondary for
	// the same category is still only counted once.
	const productsByCategory = new Map<number, number>()
	const allCategoryIds = new Set([...uniqueByCategoryPrimary.keys(), ...uniqueByCategorySecondary.keys()])
	for (const catId of allCategoryIds) {
		const union = new Set<number>([...(uniqueByCategoryPrimary.get(catId) ?? []), ...(uniqueByCategorySecondary.get(catId) ?? [])])
		productsByCategory.set(catId, union.size)
	}

	const mode = args.write ? 'write' : 'dry-run'
	console.log(`\nRunning brand/category bootstrap in ${mode.toUpperCase()} mode...`)

	const result = await db.transaction(async tx => {
		const brandResult = await bootstrapBrands(tx, dump.brands, mode, productsByBrand)
		const categoryResult = await bootstrapCategories(tx, dump.categories, mode, productsByCategory, {
			primary: productsByCategoryPrimary,
			secondary: productsByCategorySecondary
		})
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
