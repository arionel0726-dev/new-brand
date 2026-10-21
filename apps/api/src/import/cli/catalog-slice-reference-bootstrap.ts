/**
 * Scoped Brand/Category reference bootstrap CLI (Sprint 12B.7).
 *
 * Answers the real Mac gap directly: the controlled slice importer
 * (cli/catalog-slice-import.ts) already wrote 4 Products / 7 Variants into
 * `beauty_store_test`, but every one of them is `unpublishedForMissingBrand`
 * / `unpublishedForMissingCategory` because no brand/category reference
 * data had been bootstrapped for that database yet. This CLI bootstraps
 * ONLY the brand/category rows the given (already-imported) legacy product
 * ids actually reference - not the entire legacy dump - by reusing
 * `runScopedReferenceBootstrap` (scoped-reference-bootstrap.ts), which
 * itself reuses `bootstrapBrands`/`bootstrapCategories`
 * (brand-category-bootstrap.ts) unchanged.
 *
 * Usage (read-only dry-run preview - exactly which brand/category legacy
 * ids products 40,984,374,661,2 need, with RU/RO names and parent chain):
 *   bun run import:legacy:catalog-slice-reference-bootstrap -- --sql=<path> --legacy-product-ids=40,984,374,661,2
 *
 * Usage (controlled write - isolated test database only, requires --write;
 * additive only, never touches products/product_variants, never resets
 * anything):
 *   bun run import:legacy:catalog-slice-reference-bootstrap -- --sql=<path> --legacy-product-ids=40,984,374,661,2 --write
 *
 * This sprint authorizes implementation and synthetic testing only - this
 * CLI has never been run with --write against real data.
 */
import { db, queryClient } from '../../db/client'
import { env } from '../../config/env'
import { loadLegacyCatalogDump } from '../parsers/mysql-catalog'
import { assertSafeImportTarget, UnsafeImportTargetError } from '../catalog-importer'
import { runScopedReferenceBootstrap } from '../scoped-reference-bootstrap'
import { UnknownLegacyProductIdError } from '../catalog-slice'
import { formatSkippedUnits } from '../format-bootstrap-report'
import { parseIdList } from '../catalog-slice-cli-args'

type Args = { sql: string | null; legacyProductIds: number[] | null; write: boolean }

function parseArgs(argv: string[]): Args {
	const args: Args = { sql: null, legacyProductIds: null, write: false }
	for (const arg of argv) {
		if (arg.startsWith('--sql=')) args.sql = arg.slice('--sql='.length)
		else if (arg.startsWith('--legacy-product-ids=')) args.legacyProductIds = parseIdList(arg.slice('--legacy-product-ids='.length))
		else if (arg === '--write') args.write = true
	}
	return args
}

const USAGE =
	'Usage: bun run import:legacy:catalog-slice-reference-bootstrap -- --sql=<path> --legacy-product-ids=<ids> [--write]'

async function main() {
	const args = parseArgs(process.argv.slice(2))
	if (!args.sql || !args.legacyProductIds || args.legacyProductIds.length === 0) {
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
	const dump = loadLegacyCatalogDump(sql)
	console.log(`Full dump: ${dump.products.length} products, ${dump.brands.length} brands, ${dump.categories.length} categories.`)
	console.log(`Scoping reference bootstrap to legacy product ids: ${args.legacyProductIds.join(', ')}`)

	const mode = args.write ? 'write' : 'dry-run'
	console.log(`\nRunning SCOPED brand/category bootstrap in ${mode.toUpperCase()} mode...`)

	let result: Awaited<ReturnType<typeof runScopedReferenceBootstrap>>
	try {
		result = await db.transaction(tx => runScopedReferenceBootstrap(tx, dump, args.legacyProductIds!, mode))
	} catch (error) {
		if (error instanceof UnknownLegacyProductIdError) {
			console.error(error.message)
			process.exit(1)
		}
		throw error
	}

	console.log(
		`\nScoped reference slice: ${result.slice.brands.length} brand(s), ${result.slice.categories.length} category/categories (including parent chain) referenced by the given product ids.`
	)
	console.log('\n=== Brand bootstrap summary ===')
	console.log(JSON.stringify(result.brandResult.summary, null, 2))
	console.log('\n=== Category bootstrap summary ===')
	console.log(JSON.stringify(result.categoryResult.summary, null, 2))

	printSkippedUnits('brands', result.brandResult.units)
	printSkippedUnits('categories', result.categoryResult.units)

	console.log('\n=== Resolved units (created/updated), for parent-hierarchy/RU-RO verification ===')
	for (const u of [...result.brandResult.units, ...result.categoryResult.units]) {
		if (u.action === 'skipped') continue
		console.log(`  ${u.kind} legacyId=${u.legacyId} internalId=${u.internalId} action=${u.action} note=${u.note}`)
	}

	if (mode === 'dry-run') {
		console.log(
			'\nThis was a DRY RUN - zero rows were written. Re-run with --write (against the isolated test database only) to actually bootstrap exactly this scoped reference slice.'
		)
	}
}

function printSkippedUnits(label: string, units: Parameters<typeof formatSkippedUnits>[1]) {
	console.log(`\n${formatSkippedUnits(label, units).join('\n')}`)
}

main()
	.then(() => queryClient.end())
	.then(() => process.exit(0))
	.catch(error => {
		console.error('Scoped reference bootstrap failed:', error)
		process.exit(1)
	})

export { parseArgs }
