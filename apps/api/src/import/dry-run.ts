/**
 * The core, testable dry-run implementation (Sprint 10A Task 8, extended
 * in Sprint 10A.1 Task 8 with verified-mapping-aware reporting). The CLI
 * entrypoint (src/import/cli/dry-run.ts) is a thin wrapper around
 * runDryRun() below - argv parsing and process exit codes only, so this
 * logic is exercised directly by tests without spawning a subprocess.
 *
 * Guarantees (Task 8):
 *   - Never writes to products/product_variants/product_prices/inventory/
 *     product_images, or any other catalog table.
 *   - Never calls Meilisearch.
 *   - Never touches R2 (no upload, no delete).
 *   - By default touches the database not at all - a plain, synchronous,
 *     in-memory analysis. Only when `persistReport: true` is passed does
 *     it write an import_runs row plus import_record_issues rows, both
 *     inside one transaction, and even then only to those two audit
 *     tables - never to a catalog table.
 */
import { db } from '../db/client'
import type { SourceSystem, FeedType } from './constants'
import { parseProductsFeed } from './parsers/products-feed'
import { parsePricevnFeed } from './parsers/pricevn-feed'
import { parseJobvnSeoFeed } from './parsers/jobvn-seo-feed'
import type { FeedParseResult } from './parsers/shared'
import { normalizeProductsFeed, type CandidateProduct, type ProductNameEnrichment } from './normalize/products'
import { computeChecksum } from './checksum'
import { findMapping } from './mappings'
import { createImportRun, completeImportRun, failImportRun, findRunsByChecksum } from './runs'
import { recordIssues, type RecordIssueInput } from './issues'

export type DryRunOptions = {
	feedType: FeedType
	sourceSystem: SourceSystem
	/** Already-parsed JSON value - the CLI reads the file and passes it in, so this function itself never does file I/O (easier to unit test with synthetic fixtures). */
	payload: unknown
	/** Default false (Task 8: "default should be read-only"). */
	persistReport?: boolean
	/** Only meaningful for feedType === 'products' - see src/import/normalize/products.ts's ProductNameEnrichment. Entirely optional; omitting it reproduces the conservative Sprint 10A behavior. */
	nameEnrichment?: ProductNameEnrichment
}

export type DryRunSummary = {
	feedType: FeedType
	sourceSystem: SourceSystem
	checksum: string
	// Prior runs (dry or real) that saw this exact checksum - surfaced, not
	// auto-skipped (Task 3's checksum/reprocessing semantics).
	priorRunsWithSameChecksum: number
	recordsReceived: number
	recordsValid: number
	recordsRejected: number
	// External ID collisions within this one feed payload (e.g. the same
	// ID_nom appearing twice) - Task 8's "external ID collisions".
	duplicateKeyCount: number
	// How many rejected records failed specifically because of price
	// parsing (Task 8's "price parsing errors"), as a subset of
	// recordsRejected - derived from each rejection's own message, since
	// the parser reports failures per-field already.
	priceParsingErrorCount: number
	// Only populated for feedType === 'products'.
	candidateGroups?: number
	candidateStandalone?: number
	candidatesBlocked?: number
	// Candidates whose title could not be resolved from MySQL enrichment,
	// VariativeName, or a feed short-description fallback (Task 8's
	// "missing MySQL enrichment") - a strict subset of candidatesBlocked.
	candidatesMissingEnrichment?: number
	// Distinct legacy brand *name strings* seen in the feed (products feed
	// only) - informational only. A brand name is never used as a mapping
	// key (Task 6: never resolve identity by name) - there is no confirmed
	// legacy brand GUID in any of the three supplied feed samples, so
	// every brand name is necessarily "unresolved" this sprint.
	unresolvedBrandNames?: string[]
	// No category-bearing field was observed in any of the three supplied
	// feed samples (products/pricevn/jobvn_seo) - always 0 this sprint,
	// kept as an explicit field so a future feed sample that does carry
	// one has somewhere to report into.
	unresolvedCategoryCount: number
	// jobvn_seo only: records where both SeoHeaderRU and SeoDescriptionRU
	// are blank (Task 8's "SEO field conflicts"). A dry-run has no live V2
	// product to compare against, so this reports *blank feed values that
	// would need the blank-value guard* (src/import/policy/field-ownership.ts),
	// not a confirmed conflict with real curated content.
	seoBlankFieldCount?: number
	mappingsWouldCreate: number
	mappingsAlreadyExist: number
	importRunId: string | null
}

export type DryRunResult = {
	summary: DryRunSummary
	rejectedSamples: { recordIdentifier: string; message: string }[]
	duplicateKeySamples: { key: string; recordIndexes: number[] }[]
	candidateIssueSamples: { recordIdentifier: string; code: string; detail?: string; severity: string }[]
}

const SAMPLE_LIMIT = 50
const PRICE_ERROR_PATTERN = /price/i

function requireArray(payload: unknown): unknown[] {
	if (Array.isArray(payload)) return payload
	throw new Error(
		'Expected the feed file to contain a top-level JSON array of records. ' +
			'No wrapper-object envelope (e.g. {"data": [...]}) is assumed without a confirmed real sample - ' +
			'see docs/vizaje-migration-architecture.md.'
	)
}

export async function runDryRun(options: DryRunOptions): Promise<DryRunResult> {
	const rawRecords = requireArray(options.payload)
	const checksum = computeChecksum(rawRecords)
	const priorRuns = await findRunsByChecksum(checksum, options.feedType)

	let parseResult: FeedParseResult<unknown>
	let candidates: CandidateProduct[] | undefined
	let seoBlankFieldCount: number | undefined

	switch (options.feedType) {
		case 'products': {
			const result = parseProductsFeed(rawRecords)
			parseResult = result
			candidates = normalizeProductsFeed(result.validRecords, options.sourceSystem, options.nameEnrichment).candidates
			break
		}
		case 'pricevn':
			parseResult = parsePricevnFeed(rawRecords)
			break
		case 'jobvn_seo': {
			const result = parseJobvnSeoFeed(rawRecords)
			parseResult = result
			seoBlankFieldCount = result.validRecords.filter(
				record => !(record as { SeoHeaderRU: string | null }).SeoHeaderRU && !(record as { SeoDescriptionRU: string | null }).SeoDescriptionRU
			).length
			break
		}
	}

	const priceParsingErrorCount = parseResult.rejected.filter(r => PRICE_ERROR_PATTERN.test(r.message)).length

	const unresolvedBrandNames =
		options.feedType === 'products'
			? [...new Set((parseResult.validRecords as { Brand: string | null }[]).map(r => r.Brand).filter((b): b is string => b !== null))]
			: undefined

	// Read-only mapping resolution (Task 8: "resolve existing external
	// mappings... identify potential creates/updates/skips/conflicts") -
	// every record's own id_nom is checked against 'nomenclature', and for
	// the products feed, every candidate group's raw group id is checked
	// against 'nomenclature_group'. No mapping is ever created here.
	let mappingsWouldCreate = 0
	let mappingsAlreadyExist = 0

	for (const record of parseResult.validRecords) {
		const idNom = (record as { ID_nom?: string }).ID_nom
		if (!idNom) continue
		const existing = await findMapping(db, options.sourceSystem, 'nomenclature', idNom)
		if (existing) mappingsAlreadyExist++
		else mappingsWouldCreate++
	}

	if (candidates) {
		for (const candidate of candidates) {
			if (!candidate.groupKey) continue
			const rawGroupId = candidate.groupKey.slice(candidate.groupKey.indexOf(':') + 1)
			const existing = await findMapping(db, options.sourceSystem, 'nomenclature_group', rawGroupId)
			if (existing) mappingsAlreadyExist++
			else mappingsWouldCreate++
		}
	}

	const candidateIssueSamples = (candidates ?? [])
		.flatMap(candidate =>
			candidate.issues.map(issue => ({
				recordIdentifier: issue.recordIdentifier,
				code: issue.code,
				detail: issue.detail,
				severity: issue.severity
			}))
		)
		.slice(0, SAMPLE_LIMIT)

	let importRunId: string | null = null

	if (options.persistReport) {
		importRunId = await persistDryRunReport(options, checksum, parseResult, candidates)
	}

	return {
		summary: {
			feedType: options.feedType,
			sourceSystem: options.sourceSystem,
			checksum,
			priorRunsWithSameChecksum: priorRuns.length,
			recordsReceived: rawRecords.length,
			recordsValid: parseResult.validRecords.length,
			recordsRejected: parseResult.rejected.length,
			duplicateKeyCount: parseResult.duplicateKeys.length,
			priceParsingErrorCount,
			candidateGroups: candidates ? candidates.filter(c => c.groupKey !== null).length : undefined,
			candidateStandalone: candidates ? candidates.filter(c => c.groupKey === null).length : undefined,
			candidatesBlocked: candidates ? candidates.filter(c => !c.publishable).length : undefined,
			candidatesMissingEnrichment: candidates ? candidates.filter(c => c.titleSource === 'unresolved').length : undefined,
			unresolvedBrandNames,
			unresolvedCategoryCount: 0,
			seoBlankFieldCount,
			mappingsWouldCreate,
			mappingsAlreadyExist,
			importRunId
		},
		rejectedSamples: parseResult.rejected.slice(0, SAMPLE_LIMIT),
		duplicateKeySamples: parseResult.duplicateKeys.slice(0, SAMPLE_LIMIT),
		candidateIssueSamples
	}
}

async function persistDryRunReport(
	options: DryRunOptions,
	checksum: string,
	parseResult: FeedParseResult<unknown>,
	candidates: CandidateProduct[] | undefined
): Promise<string> {
	return db.transaction(async tx => {
		const run = await createImportRun(tx, {
			sourceSystem: options.sourceSystem,
			feedType: options.feedType,
			dryRun: true,
			sourceChecksum: checksum
		})

		const issueInputs: RecordIssueInput[] = []
		for (const rejected of parseResult.rejected) {
			issueInputs.push({
				importRunId: run.id,
				recordIdentifier: rejected.recordIdentifier,
				entityType: 'nomenclature',
				severity: 'error',
				issueCode: PRICE_ERROR_PATTERN.test(rejected.message) ? 'invalid_price' : 'validation_failed',
				detail: rejected.message
			})
		}
		for (const duplicate of parseResult.duplicateKeys) {
			issueInputs.push({
				importRunId: run.id,
				recordIdentifier: duplicate.key,
				entityType: 'nomenclature',
				severity: 'warning',
				issueCode: 'duplicate_guid',
				detail: `appears ${duplicate.recordIndexes.length} times in this feed`
			})
		}
		for (const candidate of candidates ?? []) {
			for (const issue of candidate.issues) {
				issueInputs.push({
					importRunId: run.id,
					recordIdentifier: issue.recordIdentifier,
					entityType: 'nomenclature_group',
					severity: issue.severity,
					issueCode: issue.code,
					detail: issue.detail
				})
			}
		}

		await recordIssues(tx, issueInputs)

		try {
			await completeImportRun(tx, run.id, {
				recordsReceived: parseResult.validRecords.length + parseResult.rejected.length,
				recordsCreated: 0,
				recordsUpdated: 0,
				recordsSkipped: parseResult.validRecords.length,
				recordsRejected: parseResult.rejected.length
			})
		} catch (error) {
			await failImportRun(tx, run.id, error instanceof Error ? error.message : String(error))
			throw error
		}

		return run.id
	})
}
