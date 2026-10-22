/**
 * Brand readiness analysis CLI (Sprint 12B.8 Task 2/3).
 *
 * Read-only: loads a real local legacy SQL dump + 1C products feed (both
 * local-only, never available in this sandbox), runs the exact same
 * reconciliation passes `catalog-slice-import.ts` already does, and prints a
 * per-brand breakdown plus a ranked recommendation for the next, LARGER
 * controlled import slice (bigger than the 4-product slice already
 * confirmed written in Sprint 12B.6.1/12B.7). Never writes anything, never
 * requires `--write`, never touches the database at all.
 *
 * Usage:
 *   bun run import:legacy:brand-readiness-analysis -- --sql=<path-to-dump.sql> --products=<path-to-products.json>
 */
import { loadLegacyCatalogDump } from '../parsers/mysql-catalog'
import { parseProductsFeed } from '../parsers/products-feed'
import { readJsonArrayFileBounded } from '../parsers/json-array-stream'
import { runLegacyCatalogDryRun } from '../dry-run-catalog'
import { reconcileSqlWith1c, quarantineMapFromCatalogDryRun } from '../reconcile/sql-1c-reconciliation'
import { reconcileFamilies } from '../reconcile/family-reconciliation'
import { classifyIdNomDuplicates } from '../reconcile/duplicate-id-nom'
import { analyzeBrandReadiness, rankBrandsForRepresentativeSlice } from '../brand-readiness-analysis'

type Args = { sql: string | null; products: string | null }

function parseArgs(argv: string[]): Args {
	const args: Args = { sql: null, products: null }
	for (const arg of argv) {
		if (arg.startsWith('--sql=')) args.sql = arg.slice('--sql='.length)
		else if (arg.startsWith('--products=')) args.products = arg.slice('--products='.length)
	}
	return args
}

const USAGE = 'Usage: bun run import:legacy:brand-readiness-analysis -- --sql=<path> --products=<path>'

async function main() {
	const args = parseArgs(process.argv.slice(2))
	if (!args.sql || !args.products) {
		console.error(USAGE)
		process.exit(1)
	}

	const sqlFile = Bun.file(args.sql)
	if (!(await sqlFile.exists())) {
		console.error(`SQL file not found: ${args.sql}`)
		process.exit(1)
	}
	const sql = await sqlFile.text()
	const dump = loadLegacyCatalogDump(sql)

	const rawOneCRecords = (await readJsonArrayFileBounded(args.products)).filter(
		(r): r is Record<string, unknown> => typeof r === 'object' && r !== null
	)
	const oneCRecords = parseProductsFeed(rawOneCRecords).validRecords

	console.log(`Loaded ${dump.products.length} legacy products, ${dump.brands.length} brands, ${oneCRecords.length} valid 1C records.`)

	const catalogDryRun = await runLegacyCatalogDryRun(sql)
	const priorQuarantine = quarantineMapFromCatalogDryRun(catalogDryRun.products)
	const positions = reconcileSqlWith1c(dump, oneCRecords, priorQuarantine)
	const families = reconcileFamilies(dump, oneCRecords)
	const idNomDuplicates = classifyIdNomDuplicates(rawOneCRecords, 'ID_nom')

	const report = analyzeBrandReadiness(dump, oneCRecords, families, positions, idNomDuplicates, priorQuarantine)
	const ranked = rankBrandsForRepresentativeSlice(report)

	console.log(`\n=== Per-brand analysis (${report.brands.length} brand(s), ${report.unassignedProductCount} unassigned product(s)) ===`)
	console.log(JSON.stringify(report, null, 2))

	console.log('\n=== Ranked candidates for the next, larger controlled import slice ===')
	for (const candidate of ranked) {
		console.log(`brandId=${candidate.brandId} score=${candidate.score} - ${candidate.reasoning}`)
	}

	if (ranked.length > 0) {
		console.log(`\nRecommended: brandId=${ranked[0].brandId}`)
	} else {
		console.log('\nNo brand could be analyzed (every legacy product has brandId=null).')
	}
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error('Brand readiness analysis failed:', error)
		process.exit(1)
	})

export { parseArgs }
