/**
 * Brand representative slice CLI (Sprint 12B.9).
 *
 * Read-only: loads a real local legacy SQL dump + 1C products feed (both
 * local-only, never available in this sandbox), runs the exact same
 * reconciliation passes `brand-readiness-analysis.ts`'s CLI already does,
 * and prints a 20-30 (configurable) legacy product id selection for ONE
 * brand, with the exact reason(s) each id was picked - for human review
 * BEFORE any bootstrap or write step runs. Never writes anything, never
 * touches the database.
 *
 * Usage:
 *   bun run import:legacy:brand-representative-slice -- --sql=<path-to-dump.sql> --products=<path-to-products.json> --brand-id=108 [--min=20] [--max=30]
 */
import { loadLegacyCatalogDump } from '../parsers/mysql-catalog'
import { parseProductsFeed } from '../parsers/products-feed'
import { readJsonArrayFileBounded } from '../parsers/json-array-stream'
import { runLegacyCatalogDryRun } from '../dry-run-catalog'
import { reconcileSqlWith1c, quarantineMapFromCatalogDryRun } from '../reconcile/sql-1c-reconciliation'
import { reconcileFamilies } from '../reconcile/family-reconciliation'
import { reconcileLegacyVariantFamilies } from '../reconcile/legacy-variant-family-reconciliation'
import { classifyIdNomDuplicates } from '../reconcile/duplicate-id-nom'
import { selectBrandRepresentativeSlice } from '../brand-representative-slice'

type Args = { sql: string | null; products: string | null; brandId: number | null; min: number | null; max: number | null }

function parseArgs(argv: string[]): Args {
	const args: Args = { sql: null, products: null, brandId: null, min: null, max: null }
	for (const arg of argv) {
		if (arg.startsWith('--sql=')) args.sql = arg.slice('--sql='.length)
		else if (arg.startsWith('--products=')) args.products = arg.slice('--products='.length)
		else if (arg.startsWith('--brand-id=')) args.brandId = Number(arg.slice('--brand-id='.length))
		else if (arg.startsWith('--min=')) args.min = Number(arg.slice('--min='.length))
		else if (arg.startsWith('--max=')) args.max = Number(arg.slice('--max='.length))
	}
	return args
}

const USAGE =
	'Usage: bun run import:legacy:brand-representative-slice -- --sql=<path> --products=<path> --brand-id=<id> [--min=20] [--max=30]'

async function main() {
	const args = parseArgs(process.argv.slice(2))
	if (!args.sql || !args.products || args.brandId === null || Number.isNaN(args.brandId)) {
		console.error(USAGE)
		process.exit(1)
	}

	const sqlFile = Bun.file(args.sql!)
	if (!(await sqlFile.exists())) {
		console.error(`SQL file not found: ${args.sql}`)
		process.exit(1)
	}
	const sql = await sqlFile.text()
	const dump = loadLegacyCatalogDump(sql)

	const rawOneCRecords = (await readJsonArrayFileBounded(args.products!)).filter(
		(r): r is Record<string, unknown> => typeof r === 'object' && r !== null
	)
	const oneCRecords = parseProductsFeed(rawOneCRecords).validRecords

	console.log(`Loaded ${dump.products.length} legacy products, ${oneCRecords.length} valid 1C records.`)

	const catalogDryRun = await runLegacyCatalogDryRun(sql)
	const priorQuarantine = quarantineMapFromCatalogDryRun(catalogDryRun.products)
	const positions = reconcileSqlWith1c(dump, oneCRecords, priorQuarantine)
	const families = reconcileFamilies(dump, oneCRecords)
	const legacyVariantFamilies = reconcileLegacyVariantFamilies(dump, oneCRecords, priorQuarantine)
	const idNomDuplicates = classifyIdNomDuplicates(rawOneCRecords, 'ID_nom')

	const result = selectBrandRepresentativeSlice({
		dump,
		brandId: args.brandId!,
		legacyVariantFamilies,
		families,
		positions,
		idNomDuplicates,
		minCount: args.min ?? undefined,
		maxCount: args.max ?? undefined
	})

	console.log(`\n=== Representative slice for brandId=${args.brandId} (${result.totalBrandProducts} total legacy product(s) for this brand) ===`)
	console.log(`Selected ${result.legacyProductIds.length} legacy product id(s), spanning ${result.distinctCategoryCount} distinct category/categories.`)
	console.log(`legacyProductIds: ${result.legacyProductIds.join(',')}`)

	console.log('\n=== Selection reasons (one entry per selected legacy product id) ===')
	console.log(JSON.stringify(result.selections, null, 2))

	if (result.missingCategories.length > 0) {
		console.log('\n=== Mandatory scenarios with NO candidate found in this brand\'s data (reported, never fabricated) ===')
		for (const kind of result.missingCategories) console.log(`  - ${kind}`)
	} else {
		console.log('\nEvery mandatory scenario has at least one real candidate in this brand\'s data.')
	}

	// No manifest hash is computed or printed here: `import:legacy:catalog-slice`
	// re-reconciles --legacy-product-ids against the SLICED dump before
	// computing its own hash (Sprint 12B.6.1 Task 5), which this tool cannot
	// reproduce without duplicating that step - printing a different hash
	// here would only risk the user copying the wrong value into
	// --confirm-slice. The real hash to use always comes from that CLI's own
	// dry-run output.
	console.log(
		'\nThis was READ-ONLY - nothing was written. Review the selection above, then feed result.legacyProductIds into ' +
			'import:legacy:catalog-slice-reference-bootstrap and import:legacy:catalog-slice as --legacy-product-ids=<comma-separated ids> ' +
			'(dry-run first to get the --confirm-slice hash from THAT tool, never from this one).'
	)
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error('Brand representative slice selection failed:', error)
		process.exit(1)
	})

export { parseArgs }
