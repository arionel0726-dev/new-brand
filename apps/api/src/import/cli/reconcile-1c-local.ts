/**
 * Local macOS reconciliation CLI (Sprint 12A.4). Runs the full
 * SQL-dump ↔ 1C-export reconciliation against **explicit local file
 * paths** supplied on the command line - designed to be run from the
 * user's own machine against their real local files
 * (`~/Downloads/b2b-patch/public/import/{products,pricevn,JobVN,
 * old_products}.json` and a local legacy MySQL dump), none of which are
 * present in this repository or this cloud sandbox.
 *
 * IMPORTANT: this CLI was built and tested in this sandbox exclusively
 * against synthetic fixtures shaped like the real field layouts recorded
 * in `docs/legacy-audit/vizaje-1c-audit.{md,json}` (Sprint 12A.3's
 * aggregate-only audit of the real exports). No real SQL or JSON data is
 * available in this environment - nothing here has been run against the
 * user's actual files, and nothing in this codebase claims otherwise.
 * See the bottom of `docs/vizaje-1c-reconciliation-plan.md` for the exact
 * commands to run this locally.
 *
 * Usage (see also the doc above for full setup steps):
 *
 *   bun run import:legacy:reconcile-1c-local -- \
 *     --sql=/path/to/legacy_dump.sql \
 *     --products=/path/to/products.json \
 *     [--old-products=/path/to/old_products.json] \
 *     [--pricevn=/path/to/pricevn.json] \
 *     [--jobvn=/path/to/JobVN.json]
 *
 * --sql            required. Path to the real mysqldump SQL file
 *                   (read-only, never modified, never re-serialized).
 * --products        required. Path to the real `products.json` 1C export -
 *                   the primary 1C identity source used for SQL↔1C
 *                   matching (GUID/ID_nom, barcode, VariativeNomenclature
 *                   group-code).
 * --old-products    optional. Path to `old_products.json`. Per the Sprint
 *                   12A.3 audit this file's `ID_nom`s are ~fully contained
 *                   in `products.json` (702/703 overlap), so it is treated
 *                   as a *secondary, stale-snapshot* matching source: only
 *                   consulted for MySQL products the primary pass left
 *                   `unmatched`, and its matches are reported in a clearly
 *                   separate section - never merged into the primary
 *                   confirmed/ambiguous counts, and never able to override
 *                   a Sprint 12A.2 quarantine decision (quarantine is
 *                   checked independently of which 1C source matched, in
 *                   the underlying `reconcileSqlWith1c`).
 * --pricevn         optional. Path to `pricevn.json`. Used only for its
 *                   own duplicate-ID_nom classification and an ID_nom
 *                   coverage check against the SQL-matched set - `pricevn`
 *                   has no `Barcode` field (confirmed by the Sprint 10A.1
 *                   parser and the real audit's field-coverage table), so
 *                   it is never used as a SQL↔1C matching source.
 * --jobvn           optional. Path to `JobVN.json`. Same treatment as
 *                   --pricevn: duplicate-ID_nom classification and
 *                   coverage only, not a matching source (its schema,
 *                   `jobvnSeoFeedRecordSchema`, does not declare the
 *                   fields `reconcileSqlWith1c` needs for matching).
 *
 * Read-only, zero database writes, zero mutation of
 * `external_entity_mappings`, no R2, no live 1C requests. Never commits
 * or re-prints raw source rows - every report section below is counts,
 * category buckets, and a bounded number of sanitized examples (ids,
 * reason codes, and field *names* only - never field values).
 */
import { readJsonArrayFileBounded } from '../parsers/json-array-stream'
import { loadLegacyCatalogDump } from '../parsers/mysql-catalog'
import { parseProductsFeed, type ProductsFeedRecord } from '../parsers/products-feed'
import { classifyIdNomDuplicates, type IdNomDuplicateReport } from '../reconcile/duplicate-id-nom'
import { computeSecondarySourceRescues } from '../reconcile/secondary-source-rescue'
import { quarantineMapFromCatalogDryRun, reconcileSqlWith1c, type ReconciliationResult } from '../reconcile/sql-1c-reconciliation'
import { runLegacyCatalogDryRun } from '../dry-run-catalog'

type Args = {
	sql: string | null
	products: string | null
	oldProducts: string | null
	pricevn: string | null
	jobvn: string | null
}

function parseArgs(argv: string[]): Args {
	const args: Args = { sql: null, products: null, oldProducts: null, pricevn: null, jobvn: null }
	for (const arg of argv) {
		if (arg.startsWith('--sql=')) args.sql = arg.slice('--sql='.length)
		else if (arg.startsWith('--products=')) args.products = arg.slice('--products='.length)
		else if (arg.startsWith('--old-products=')) args.oldProducts = arg.slice('--old-products='.length)
		else if (arg.startsWith('--pricevn=')) args.pricevn = arg.slice('--pricevn='.length)
		else if (arg.startsWith('--jobvn=')) args.jobvn = arg.slice('--jobvn='.length)
	}
	return args
}

const USAGE =
	'Usage: bun run import:legacy:reconcile-1c-local -- --sql=<path> --products=<path> ' +
	'[--old-products=<path>] [--pricevn=<path>] [--jobvn=<path>]'

async function loadRawJsonArray(path: string): Promise<Record<string, unknown>[]> {
	const file = Bun.file(path)
	if (!(await file.exists())) {
		console.error(`File not found: ${path}`)
		process.exit(1)
	}
	const raw = await readJsonArrayFileBounded(path)
	return raw.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null) as Record<string, unknown>[]
}

function printDuplicateReport(label: string, report: IdNomDuplicateReport) {
	console.log(`\n--- duplicate ID_nom classification: ${label} ---`)
	console.log(JSON.stringify({ totalGroups: report.totalGroups, byClassification: report.byClassification, examples: report.examples }, null, 2))
}

function idNomSet(records: Record<string, unknown>[]): Set<string> {
	const set = new Set<string>()
	for (const r of records) {
		const id = r.ID_nom
		if (id !== undefined && id !== null) set.add(String(id))
	}
	return set
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

	console.log('Loading legacy MySQL catalog dump...')
	const dump = loadLegacyCatalogDump(sql)
	console.log(`  ${dump.products.length} products, ${dump.productVariables.length} variants parsed from SQL.`)

	console.log('Running Sprint 12A.2 catalog dry-run for quarantine state...')
	const dryRun = await runLegacyCatalogDryRun(sql)
	const priorQuarantine = quarantineMapFromCatalogDryRun(dryRun.products)

	console.log(`Streaming ${args.products} ...`)
	const productsRaw = await loadRawJsonArray(args.products)
	console.log(`  ${productsRaw.length} raw records read.`)
	const { validRecords: productsValid, rejected: productsRejected } = parseProductsFeed(productsRaw)
	if (productsRejected.length > 0) {
		console.warn(`  ${productsRejected.length} record(s) failed schema validation and were excluded from matching (still included in duplicate-ID_nom analysis).`)
	}

	console.log('Reconciling SQL catalog against products.json (primary 1C source)...')
	const primary: ReconciliationResult = reconcileSqlWith1c(dump, productsValid, priorQuarantine)
	console.log('\n=== Primary reconciliation summary (products.json) ===')
	console.log(JSON.stringify(primary.summary, null, 2))

	console.log('\n--- unmatched 1C records (products.json, sample up to 10) ---')
	console.log(JSON.stringify(primary.unmatchedOneCRecords.slice(0, 10), null, 2))

	printDuplicateReport('products.json', classifyIdNomDuplicates(productsRaw))

	if (args.oldProducts) {
		console.log(`\nStreaming ${args.oldProducts} (secondary/stale-snapshot source)...`)
		const oldRaw = await loadRawJsonArray(args.oldProducts)
		console.log(`  ${oldRaw.length} raw records read.`)
		const { validRecords: oldValid } = parseProductsFeed(oldRaw)

		const secondary = reconcileSqlWith1c(dump, oldValid, priorQuarantine)
		const secondaryRescues = computeSecondarySourceRescues(primary.mysqlResults, secondary.mysqlResults)
		const primaryUnmatchedCount = primary.mysqlResults.filter(r => r.outcome === 'unmatched').length

		console.log('\n=== Secondary reconciliation via old_products.json (stale-snapshot evidence only - never auto-promoted) ===')
		console.log(
			JSON.stringify(
				{
					totalOldProductsRecords: oldValid.length,
					primaryUnmatchedCount,
					rescuedByOldProductsCount: secondaryRescues.length,
					note: 'These are products the primary products.json pass could not match, for which old_products.json offers additional evidence. This is informational only: it does not change the primary confirmed/ambiguous/unmatched/quarantine counts above, and a quarantined product stays quarantined regardless.',
					sample: secondaryRescues.slice(0, 10)
				},
				null,
				2
			)
		)

		printDuplicateReport('old_products.json', classifyIdNomDuplicates(oldRaw))
	}

	if (args.pricevn) {
		console.log(`\nStreaming ${args.pricevn} (duplicate-ID_nom + coverage only, not a matching source)...`)
		const pricevnRaw = await loadRawJsonArray(args.pricevn)
		console.log(`  ${pricevnRaw.length} raw records read.`)
		printDuplicateReport('pricevn.json', classifyIdNomDuplicates(pricevnRaw))
		const matchedIdNoms = new Set(primary.mysqlResults.flatMap(r => r.matchedOneCIdNoms))
		const pricevnIds = idNomSet(pricevnRaw)
		const coveredByPricevn = [...matchedIdNoms].filter(id => pricevnIds.has(id)).length
		console.log(`\n--- pricevn.json coverage of SQL-matched ID_nom set ---`)
		console.log(JSON.stringify({ sqlMatchedIdNomCount: matchedIdNoms.size, alsoInPricevn: coveredByPricevn }, null, 2))
	}

	if (args.jobvn) {
		console.log(`\nStreaming ${args.jobvn} (duplicate-ID_nom + coverage only, not a matching source)...`)
		const jobvnRaw = await loadRawJsonArray(args.jobvn)
		console.log(`  ${jobvnRaw.length} raw records read.`)
		printDuplicateReport('JobVN.json', classifyIdNomDuplicates(jobvnRaw))
		const matchedIdNoms = new Set(primary.mysqlResults.flatMap(r => r.matchedOneCIdNoms))
		const jobvnIds = idNomSet(jobvnRaw)
		const coveredByJobvn = [...matchedIdNoms].filter(id => jobvnIds.has(id)).length
		console.log(`\n--- JobVN.json coverage of SQL-matched ID_nom set ---`)
		console.log(JSON.stringify({ sqlMatchedIdNomCount: matchedIdNoms.size, alsoInJobvn: coveredByJobvn }, null, 2))
	}

	console.log('\n=== Quarantined variants (Sprint 12A.2 orphan-variant set, unchanged by this run) ===')
	console.log(
		JSON.stringify(
			{
				totalVariantsQuarantined: dryRun.summary.quarantine.totalVariantsQuarantined,
				byReasonCode: dryRun.summary.quarantine.byReasonCode,
				note: 'Reconciliation against 1C never clears these - see docs/vizaje-catalog-migration-report.md and docs/vizaje-1c-reconciliation-plan.md.'
			},
			null,
			2
		)
	)

	console.log('\n=== Remaining Phase B blockers (standing as of Sprint 12A.3, unchanged by this tool) ===')
	console.log(
		'  - 3 products with no valid category anywhere (ids 1455, 6519, 7698) - to be imported unpublished/uncategorized per the user\'s 12A.2 decision.\n' +
			'  - The 463-orphan-variant product_id=1 cluster - stays quarantined until resolved against real row-level 1C data.\n' +
			'  - The 128 SKU-duplicate groups - to be resolved by reconstructing real V2 variant families, not synthetic SKUs, per the user\'s 12A.2 decision.\n' +
			'  - ID_nom duplicates within the 1C feed itself - see the duplicate-ID_nom sections above for this run\'s actual classification breakdown.'
	)
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error('Local reconciliation failed:', error)
		process.exit(1)
	})

export { parseArgs }
