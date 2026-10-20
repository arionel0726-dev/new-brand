/**
 * Legacy import dry-run CLI (Sprint 10A Task 8, enrichment support added
 * in Sprint 10A.1).
 *
 * Usage:
 *   bun run import:legacy:dry-run -- --type=products --file=./path/to/feed.json [--source=1c] [--persist-report] [--enrichment=./path/to/enrichment.json]
 *
 * --type         one of: products, pricevn, jobvn_seo
 * --file         path to a JSON file containing a top-level array of feed records
 * --source       source system (default: 1c)
 * --persist-report  write an import_runs + import_record_issues audit trail
 *                    (default: off - a dry-run touches the database not at
 *                    all unless this is explicitly passed; see Task 8)
 * --enrichment   (products feed only) path to a JSON file shaped
 *                {"mysqlTitles": {"<ID_nom>": {"titleRu": "...", "titleRo": "..."}},
 *                 "shortDescriptions": {"<ID_nom>": "..."}}
 *                - optional, source-aware title resolution (Task 3). Never
 *                required; omitting it reproduces the conservative
 *                Sprint 10A behavior (every title-less candidate blocked).
 *
 * Never writes to any catalog table, never calls Meilisearch, never
 * touches R2, regardless of --persist-report.
 */
import { queryClient } from '../../db/client'
import { FEED_TYPES, SOURCE_SYSTEMS, type FeedType, type SourceSystem } from '../constants'
import { runDryRun } from '../dry-run'
import type { ProductNameEnrichment } from '../normalize/products'

type EnrichmentFile = {
	mysqlTitles?: Record<string, { titleRu?: string | null; titleRo?: string | null }>
	shortDescriptions?: Record<string, string | null>
}

async function loadEnrichment(path: string | null): Promise<ProductNameEnrichment | undefined> {
	if (!path) return undefined
	const file = Bun.file(path)
	if (!(await file.exists())) {
		console.error(`Enrichment file not found: ${path}`)
		process.exit(1)
	}
	const parsed = JSON.parse(await file.text()) as EnrichmentFile
	const mysqlTitles = parsed.mysqlTitles
		? new Map(
				Object.entries(parsed.mysqlTitles).map(([idNom, value]) => [
					idNom,
					{ titleRu: value.titleRu ?? null, titleRo: value.titleRo ?? null }
				])
			)
		: undefined
	const shortDescriptions = parsed.shortDescriptions ? new Map(Object.entries(parsed.shortDescriptions)) : undefined
	return { mysqlTitles, shortDescriptions }
}

// A practical, explicit safe-default limit (Task 8: "safe default limits
// and support large files without unbounded memory usage where
// practical") - large enough for any realistic single-feed export, small
// enough that a mistakenly-pointed multi-gigabyte file fails fast with a
// clear message instead of exhausting process memory. True streaming JSON
// parsing (so even a file above this limit could be processed) is not
// implemented this sprint - see docs/vizaje-migration-architecture.md.
const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024

function parseArgs(argv: string[]): {
	type: string | null
	file: string | null
	source: string
	persistReport: boolean
	enrichmentPath: string | null
} {
	let type: string | null = null
	let file: string | null = null
	let source = '1c'
	let persistReport = false
	let enrichmentPath: string | null = null

	for (const arg of argv) {
		if (arg.startsWith('--type=')) type = arg.slice('--type='.length)
		else if (arg.startsWith('--file=')) file = arg.slice('--file='.length)
		else if (arg.startsWith('--source=')) source = arg.slice('--source='.length)
		else if (arg === '--persist-report') persistReport = true
		else if (arg.startsWith('--enrichment=')) enrichmentPath = arg.slice('--enrichment='.length)
	}

	return { type, file, source, persistReport, enrichmentPath }
}

function isFeedType(value: string): value is FeedType {
	return (FEED_TYPES as readonly string[]).includes(value)
}

function isSourceSystem(value: string): value is SourceSystem {
	return (SOURCE_SYSTEMS as readonly string[]).includes(value)
}

async function main() {
	const { type, file, source, persistReport, enrichmentPath } = parseArgs(process.argv.slice(2))

	if (!type || !file) {
		console.error(
			'Usage: bun run import:legacy:dry-run -- --type=<products|pricevn|jobvn_seo> --file=<path> [--source=1c] [--persist-report]'
		)
		process.exit(1)
	}
	if (!isFeedType(type)) {
		console.error(`Invalid --type "${type}". Must be one of: ${FEED_TYPES.join(', ')}`)
		process.exit(1)
	}
	if (!isSourceSystem(source)) {
		console.error(`Invalid --source "${source}". Must be one of: ${SOURCE_SYSTEMS.join(', ')}`)
		process.exit(1)
	}

	const fileRef = Bun.file(file)
	if (!(await fileRef.exists())) {
		console.error(`File not found: ${file}`)
		process.exit(1)
	}
	if (fileRef.size > MAX_FILE_SIZE_BYTES) {
		console.error(
			`File is ${(fileRef.size / (1024 * 1024)).toFixed(1)} MB, exceeding the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB safe default limit for this dry-run CLI. Streaming support for larger files is not yet implemented.`
		)
		process.exit(1)
	}

	const text = await fileRef.text()
	let payload: unknown
	try {
		payload = JSON.parse(text)
	} catch (error) {
		console.error('File is not valid JSON:', error instanceof Error ? error.message : String(error))
		process.exit(1)
	}

	const nameEnrichment = await loadEnrichment(enrichmentPath)
	const result = await runDryRun({ feedType: type, sourceSystem: source, payload, persistReport, nameEnrichment })

	console.log(JSON.stringify(result.summary, null, 2))
	if (result.rejectedSamples.length > 0) {
		console.log(`\nSample rejected records (up to 50 of ${result.summary.recordsRejected}):`)
		for (const rejected of result.rejectedSamples) {
			console.log(`  - ${rejected.recordIdentifier}: ${rejected.message}`)
		}
	}
	if (result.duplicateKeySamples.length > 0) {
		console.log(`\nSample duplicate keys within this feed:`)
		for (const dup of result.duplicateKeySamples) {
			console.log(`  - ${dup.key}: appears at record indexes ${dup.recordIndexes.join(', ')}`)
		}
	}
	if (result.candidateIssueSamples.length > 0) {
		console.log(`\nSample candidate issues (blocked from auto-publish):`)
		for (const issue of result.candidateIssueSamples) {
			console.log(`  - ${issue.recordIdentifier} [${issue.code}]${issue.detail ? `: ${issue.detail}` : ''}`)
		}
	}
}

main()
	.then(() => queryClient.end())
	.then(() => process.exit(0))
	.catch(error => {
		console.error('Dry-run failed:', error)
		process.exit(1)
	})
