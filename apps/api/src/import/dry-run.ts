/**
 * The core, testable dry-run implementation (Sprint 10A Task 8). The CLI
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
import { normalizeProductsFeed, type CandidateProduct } from './normalize/products'
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
}

export type DryRunMappingPreview = {
	entityType: 'nomenclature' | 'nomenclature_group'
	externalId: string
	willCreateMapping: boolean
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
	duplicateKeyCount: number
	// Only populated for feedType === 'products'.
	candidateGroups?: number
	candidateStandalone?: number
	candidatesBlocked?: number
	mappingsWouldCreate: number
	mappingsAlreadyExist: number
	importRunId: string | null
}

export type DryRunResult = {
	summary: DryRunSummary
	rejectedSamples: { recordIdentifier: string; message: string }[]
	duplicateKeySamples: { key: string; recordIndexes: number[] }[]
	candidateIssueSamples: { recordIdentifier: string; code: string; detail?: string }[]
}

const SAMPLE_LIMIT = 50

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

	switch (options.feedType) {
		case 'products': {
			const result = parseProductsFeed(rawRecords)
			parseResult = result
			candidates = normalizeProductsFeed(result.validRecords, options.sourceSystem).candidates
			break
		}
		case 'pricevn':
			parseResult = parsePricevnFeed(rawRecords)
			break
		case 'jobvn_seo':
			parseResult = parseJobvnSeoFeed(rawRecords)
			break
	}

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
		.flatMap(candidate => candidate.issues.map(issue => ({ recordIdentifier: issue.recordIdentifier, code: issue.code, detail: issue.detail })))
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
			candidateGroups: candidates ? candidates.filter(c => c.groupKey !== null).length : undefined,
			candidateStandalone: candidates ? candidates.filter(c => c.groupKey === null).length : undefined,
			candidatesBlocked: candidates ? candidates.filter(c => !c.publishable).length : undefined,
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
				issueCode: 'validation_failed',
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
