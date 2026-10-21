/**
 * Legacy variant parity audit CLI (Sprint 12B.4.1).
 *
 * STRICTLY READ-ONLY: no database connection, no PostgreSQL writes, no
 * mutation of `external_entity_mappings`, no R2, no live 1C requests, no
 * price/stock reads at all. Reuses the existing SQL and 1C parsers and
 * reconciliation logic (`loadLegacyCatalogDump`, `parseProductsFeed`,
 * `reconcileFamilies`, `reconcileSqlWith1c`, `classifyIdNomDuplicates`)
 * exactly as `reconcile-1c-local.ts` does - no matching algorithm is
 * reimplemented or changed by this CLI. See
 * `../variant-parity-audit.ts` for the analysis itself.
 *
 * Usage:
 *   bun run import:legacy:variant-parity-local -- \
 *     --sql=/path/to/vizaje_catalog_only.sql \
 *     --products=/path/to/products.json \
 *     [--out=/path/to/output/dir]
 *
 * Writes a JSON report and a Markdown report to the --out directory
 * (default: current directory), timestamped, and also prints the counts
 * to stdout. Nothing here was run against real data in this sandbox - no
 * real SQL/JSON files are available here. See
 * docs/vizaje-identity-architecture.md for how to interpret the output.
 */
import { readJsonArrayFileBounded } from '../parsers/json-array-stream'
import { loadLegacyCatalogDump } from '../parsers/mysql-catalog'
import { parseProductsFeed } from '../parsers/products-feed'
import { reconcileFamilies } from '../reconcile/family-reconciliation'
import { quarantineMapFromCatalogDryRun, reconcileSqlWith1c } from '../reconcile/sql-1c-reconciliation'
import { runLegacyCatalogDryRun } from '../dry-run-catalog'
import { buildVariantParityReport, formatVariantParityReportMarkdown } from '../variant-parity-audit'

type Args = { sql: string | null; products: string | null; out: string }

function parseArgs(argv: string[]): Args {
	const args: Args = { sql: null, products: null, out: '.' }
	for (const arg of argv) {
		if (arg.startsWith('--sql=')) args.sql = arg.slice('--sql='.length)
		else if (arg.startsWith('--products=')) args.products = arg.slice('--products='.length)
		else if (arg.startsWith('--out=')) args.out = arg.slice('--out='.length)
	}
	return args
}

const USAGE = 'Usage: bun run import:legacy:variant-parity-local -- --sql=<path> --products=<path> [--out=<dir>]'

async function loadRawJsonArray(path: string): Promise<Record<string, unknown>[]> {
	const file = Bun.file(path)
	if (!(await file.exists())) {
		console.error(`File not found: ${path}`)
		process.exit(1)
	}
	const raw = await readJsonArrayFileBounded(path)
	return raw.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null) as Record<string, unknown>[]
}

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

	console.log('Loading legacy MySQL catalog dump (read-only)...')
	const dump = loadLegacyCatalogDump(sql)
	console.log(`  ${dump.products.length} products, ${dump.productVariables.length} products_variable rows, ${dump.productVariableImgs.length} products_variable_img rows parsed.`)

	console.log('Running Sprint 12A.2 catalog dry-run for quarantine state (read-only, no DB)...')
	const dryRun = await runLegacyCatalogDryRun(sql)
	const priorQuarantine = quarantineMapFromCatalogDryRun(dryRun.products)

	console.log(`Streaming ${args.products} ...`)
	const productsRaw = await loadRawJsonArray(args.products)
	const { validRecords: oneCRecords, rejected } = parseProductsFeed(productsRaw)
	console.log(`  ${productsRaw.length} raw records read, ${oneCRecords.length} valid, ${rejected.length} rejected.`)

	console.log('Reconciling SQL catalog against 1C (position-level)...')
	const positionResult = reconcileSqlWith1c(dump, oneCRecords, priorQuarantine)

	console.log('Reconciling SQL catalog against 1C (family-level, Sprint 12A.7)...')
	const familyResult = reconcileFamilies(dump, oneCRecords, priorQuarantine)

	console.log('Building variant parity report (no matching algorithm changed)...')
	const report = buildVariantParityReport(dump, oneCRecords, familyResult, positionResult)

	console.log('\n=== Counts ===')
	console.log(JSON.stringify(report.counts, null, 2))
	console.log('\n=== Legacy variant -> 1C match summary ===')
	console.log(JSON.stringify(report.legacyVariantMatchSummary, null, 2))
	console.log('\n=== Family diagnostics ===')
	console.log(JSON.stringify(report.families, null, 2))

	const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
	const jsonPath = `${args.out}/variant-parity-report-${timestamp}.json`
	const mdPath = `${args.out}/variant-parity-report-${timestamp}.md`
	await Bun.write(jsonPath, JSON.stringify(report, null, 2))
	await Bun.write(mdPath, formatVariantParityReportMarkdown(report))

	console.log(`\nReports written:\n  ${jsonPath}\n  ${mdPath}`)
	console.log('\nThis was a read-only diagnostic - zero PostgreSQL writes, zero mutation, no matching algorithm changed.')
}

main().then(
	() => process.exit(0),
	error => {
		console.error('Variant parity audit failed:', error)
		process.exit(1)
	}
)
