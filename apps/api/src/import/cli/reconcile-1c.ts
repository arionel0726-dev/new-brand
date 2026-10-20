/**
 * SQL ↔ 1C reconciliation CLI (Sprint 12A.3). Thin wrapper around
 * reconcileSqlWith1c() - argv parsing and process exit codes only, mirroring
 * the existing catalog-dry-run.ts / dry-run.ts CLI convention.
 *
 * Usage:
 *   bun run import:legacy:reconcile-1c -- --sql=./docs/legacy-reference/vizaje_catalog_only.sql --feed=<path-to-1c-products-feed.json>
 *
 * --sql    path to the real mysqldump SQL file (read-only, never modified)
 * --feed   path to a 1C products-feed JSON file (top-level array, parsed by
 *          the existing Sprint 10A `parseProductsFeed`)
 *
 * IMPORTANT: as of Sprint 12A.3, no real 1C export exists in this repo. The
 * only available 1C-shaped file,
 * docs/legacy-reference/legacy-feed-samples.json, is an anonymized design
 * sample (its own meta.purpose says so), not a real export. Running this
 * CLI against it is a capability demo, never a real reconciliation - the
 * output says so explicitly. See docs/vizaje-sql-1c-reconciliation.md for
 * what a real run needs.
 *
 * Never writes to any catalog table, never mutates external_entity_mappings,
 * never calls Meilisearch, never touches R2.
 */
import { runLegacyCatalogDryRun } from '../dry-run-catalog'
import { loadLegacyCatalogDump } from '../parsers/mysql-catalog'
import { parseProductsFeed } from '../parsers/products-feed'
import { quarantineMapFromCatalogDryRun, reconcileSqlWith1c } from '../reconcile/sql-1c-reconciliation'

function parseArgs(argv: string[]): { sql: string | null; feed: string | null } {
	let sql: string | null = null
	let feed: string | null = null
	for (const arg of argv) {
		if (arg.startsWith('--sql=')) sql = arg.slice('--sql='.length)
		else if (arg.startsWith('--feed=')) feed = arg.slice('--feed='.length)
	}
	return { sql, feed }
}

const SAMPLE_FEED_MARKER = 'legacy-feed-samples.json'

async function main() {
	const { sql: sqlPath, feed: feedPath } = parseArgs(process.argv.slice(2))
	if (!sqlPath || !feedPath) {
		console.error('Usage: bun run import:legacy:reconcile-1c -- --sql=<path> --feed=<path>')
		process.exit(1)
	}

	const sqlFile = Bun.file(sqlPath)
	if (!(await sqlFile.exists())) {
		console.error(`SQL file not found: ${sqlPath}`)
		process.exit(1)
	}
	const feedFile = Bun.file(feedPath)
	if (!(await feedFile.exists())) {
		console.error(`1C feed file not found: ${feedPath}`)
		process.exit(1)
	}

	if (feedPath.includes(SAMPLE_FEED_MARKER)) {
		console.warn(
			'\n*** NOTICE: this is the anonymized design sample (legacy-feed-samples.json), not a real 1C export. ***\n' +
				'*** This run is a capability demo only - it is NOT a real reconciliation. ***\n' +
				'*** See docs/vizaje-sql-1c-reconciliation.md for what real 1C file(s) are needed. ***\n'
		)
	}

	const sql = await sqlFile.text()
	const dump = loadLegacyCatalogDump(sql)

	const feedJson = JSON.parse(await feedFile.text())
	const feedRaw = Array.isArray(feedJson) ? feedJson : (feedJson as { products?: unknown[] }).products
	if (!Array.isArray(feedRaw)) {
		console.error('1C feed file must be a top-level JSON array, or an object with a top-level "products" array (the shape legacy-feed-samples.json uses).')
		process.exit(1)
	}
	const { validRecords, rejected } = parseProductsFeed(feedRaw)
	if (rejected.length > 0) {
		console.warn(`${rejected.length} 1C feed record(s) failed validation and were excluded from reconciliation.`)
	}

	const dryRun = await runLegacyCatalogDryRun(sql)
	const priorQuarantine = quarantineMapFromCatalogDryRun(dryRun.products)

	const result = reconcileSqlWith1c(dump, validRecords, priorQuarantine)
	console.log(JSON.stringify(result.summary, null, 2))
	console.log('\n--- unmatched 1C records (sample, up to 10) ---')
	console.log(JSON.stringify(result.unmatchedOneCRecords.slice(0, 10), null, 2))
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error('Reconciliation failed:', error)
		process.exit(1)
	})
