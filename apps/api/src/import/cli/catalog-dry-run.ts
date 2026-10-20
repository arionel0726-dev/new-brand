/**
 * Legacy MySQL catalog dry-run CLI (Sprint 12 Task 7/8). Thin wrapper
 * around runLegacyCatalogDryRun() - argv parsing and process exit codes
 * only, mirroring the existing src/import/cli/dry-run.ts convention for
 * the 1C-feed dry-run.
 *
 * Usage:
 *   bun run import:legacy:catalog-dry-run -- --file=./docs/legacy-reference/vizaje_catalog_only.sql [--use-db]
 *
 * --file     path to a real mysqldump SQL file (read-only, never modified)
 * --use-db   also resolve external_entity_mappings against the configured
 *            database (SELECT only - see src/import/dry-run-catalog.ts's
 *            zero-write guarantee). Without this flag, every product is
 *            reported as "would create" and no database connection is
 *            opened at all.
 *
 * Never writes to any catalog table, never calls Meilisearch, never
 * touches R2, regardless of flags.
 */
import { queryClient } from '../../db/client'
import { runLegacyCatalogDryRun } from '../dry-run-catalog'

function parseArgs(argv: string[]): { file: string | null; useDb: boolean } {
	let file: string | null = null
	let useDb = false
	for (const arg of argv) {
		if (arg.startsWith('--file=')) file = arg.slice('--file='.length)
		else if (arg === '--use-db') useDb = true
	}
	return { file, useDb }
}

async function main() {
	const { file, useDb } = parseArgs(process.argv.slice(2))
	if (!file) {
		console.error('Usage: bun run import:legacy:catalog-dry-run -- --file=<path> [--use-db]')
		process.exit(1)
	}

	const fileRef = Bun.file(file)
	if (!(await fileRef.exists())) {
		console.error(`File not found: ${file}`)
		process.exit(1)
	}

	const sql = await fileRef.text()

	let db: typeof import('../../db/client').db | undefined
	if (useDb) {
		db = (await import('../../db/client')).db
	}

	const result = await runLegacyCatalogDryRun(sql, db)
	const { audit, ...summary } = result.summary
	console.log(JSON.stringify(summary, null, 2))
	console.log('\n--- audit.counts ---')
	console.log(JSON.stringify(audit.counts, null, 2))
}

main()
	.then(() => queryClient.end())
	.then(() => process.exit(0))
	.catch(error => {
		console.error('Catalog dry-run failed:', error)
		process.exit(1)
	})
