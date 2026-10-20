import type { ProductsFeedRecord } from '../parsers/products-feed'
import type { SourceSystem } from '../constants'
import type { ImportIssueCode } from '../issues'

export type CandidateVariant = {
	idNom: string
	barcode: string | null
	colorVar: string | null
	volumeVar: string | null
}

export type NormalizationIssue = {
	code: ImportIssueCode
	detail?: string
	recordIdentifier: string
	severity: 'info' | 'warning' | 'error'
}

/**
 * Where a candidate's display title actually came from (Sprint 10A.1
 * Task 3) - always surfaced, never hidden, so a human (or a later MySQL
 * enrichment pass) can tell a verified title from an interim fallback at
 * a glance.
 */
export type TitleSource = 'mysql_enrichment' | 'variative_name' | 'short_description_fallback' | 'unresolved'

export type CandidateProduct = {
	/** Namespaced by source system (e.g. "1c:A10.XXX") - Task 6: "Namespace group identifiers by source and validate collisions", never assumed globally unique on its own. Null for a standalone (ungrouped) record. */
	groupKey: string | null
	sourceSystem: SourceSystem
	/** @deprecated kept for backward compatibility with Sprint 10A callers - prefer `title`/`titleSource`. Still the raw VariativeName, if any. */
	variativeName: string | null
	title: string | null
	titleSource: TitleSource
	variants: CandidateVariant[]
	issues: NormalizationIssue[]
	/**
	 * False whenever this candidate is missing something this layer refuses
	 * to fabricate (a name, a resolvable group) - Task 6: "If required
	 * fields are missing, produce a validation issue and keep the record
	 * unpublished or rejected." A blocked candidate is still returned (for
	 * dry-run reporting), just never eligible to become a real product.
	 * Driven only by `error`-severity issues - an `info`/`warning` issue
	 * (e.g. "title came from a feed fallback, not MySQL yet") never blocks
	 * publishability on its own.
	 */
	publishable: boolean
}

export type NormalizationResult = {
	candidates: CandidateProduct[]
}

/**
 * Optional, source-aware enrichment a caller can supply to resolve a
 * candidate's display title from something more authoritative than this
 * feed alone (Sprint 10A.1 Task 3). Entirely optional and additive -
 * omitting it reproduces Sprint 10A's original (much more conservative)
 * behavior. Both maps are keyed by `ID_nom` (the only identifier this
 * feed reliably carries per-record) - a real importer would populate
 * `mysqlTitles` from `products`/`products_variable` rows matched by GUID/
 * SKU, and `shortDescriptions` from the JobVN feed's `ShortDescriptionRus`
 * field (see src/import/parsers/jobvn-seo-feed.ts). Neither is ever
 * invented by this module itself.
 */
export type ProductNameEnrichment = {
	/** Verified V2/legacy-MySQL titles, keyed by ID_nom - the single preferred title source once available. */
	mysqlTitles?: Map<string, { titleRu: string | null; titleRo: string | null }>
	/** The JobVN feed's `ShortDescriptionRus` (a *description*, not a curated title) - a documented, explicitly-flagged last-resort fallback, never treated as equivalent to a verified title. */
	shortDescriptions?: Map<string, string | null>
}

function resolveTitleFromEnrichment(
	idNoms: string[],
	enrichment: ProductNameEnrichment | undefined
): { title: string | null; source: Exclude<TitleSource, 'variative_name' | 'unresolved'> | null } {
	if (enrichment?.mysqlTitles) {
		for (const idNom of idNoms) {
			const entry = enrichment.mysqlTitles.get(idNom)
			const title = entry?.titleRu?.trim() || entry?.titleRo?.trim() || null
			if (title) return { title, source: 'mysql_enrichment' }
		}
	}
	if (enrichment?.shortDescriptions) {
		for (const idNom of idNoms) {
			const raw = enrichment.shortDescriptions.get(idNom)
			const title = raw?.trim() || null
			if (title) return { title, source: 'short_description_fallback' }
		}
	}
	return { title: null, source: null }
}

/**
 * Groups a parsed products-feed payload into candidate V2 products (one
 * per VariativeNomenclature group, or one per standalone record) - Task 6.
 * Pure and synchronous: no database access, no mapping resolution (that is
 * src/import/mappings.ts's job, run separately against these candidates).
 *
 * Title resolution order (Sprint 10A.1 Task 3, replacing Sprint 10A's
 * "every standalone record is unconditionally blocked" rule):
 *   1. A verified MySQL title (`enrichment.mysqlTitles`), if supplied.
 *   2. For a grouped candidate: the group's own `VariativeName`, when
 *      every member agrees on it.
 *   3. The JobVN feed's `ShortDescriptionRus` (`enrichment.shortDescriptions`),
 *      if supplied - a documented, explicitly-flagged fallback, never
 *      treated as a verified title. Using it still produces a `warning`
 *      (not `error`) issue so it stays visible in every dry-run report,
 *      but it does **not** block `publishable`.
 *   4. Otherwise: `unresolved`, blocked, with a `missing_required_field`
 *      error - ready to be enriched later, never fabricated now.
 *
 * `WarehouseName` is never consulted here, under any step - Task 3's
 * explicit instruction ("never assume WarehouseName is a customer-facing
 * product title").
 */
export function normalizeProductsFeed(
	records: ProductsFeedRecord[],
	sourceSystem: SourceSystem,
	enrichment?: ProductNameEnrichment
): NormalizationResult {
	const grouped = new Map<string, ProductsFeedRecord[]>()
	const standalone: ProductsFeedRecord[] = []

	for (const record of records) {
		if (record.VariativeNomenclature) {
			const groupKey = `${sourceSystem}:${record.VariativeNomenclature}`
			const bucket = grouped.get(groupKey) ?? []
			bucket.push(record)
			grouped.set(groupKey, bucket)
		} else {
			standalone.push(record)
		}
	}

	const candidates: CandidateProduct[] = []

	for (const [groupKey, members] of grouped) {
		candidates.push(buildGroupedCandidate(groupKey, members, sourceSystem, enrichment))
	}

	for (const record of standalone) {
		candidates.push(buildStandaloneCandidate(record, sourceSystem, enrichment))
	}

	return { candidates }
}

function buildGroupedCandidate(
	groupKey: string,
	members: ProductsFeedRecord[],
	sourceSystem: SourceSystem,
	enrichment: ProductNameEnrichment | undefined
): CandidateProduct {
	const issues: NormalizationIssue[] = []
	const distinctNames = [...new Set(members.map(m => m.VariativeName).filter((n): n is string => n !== null))]

	// Inconsistent group naming (Task 6: "detect duplicate and inconsistent
	// group membership") - the group is still produced, so a human reviewing
	// the dry-run report can see exactly what disagreed, but it is blocked
	// from auto-publishing until resolved.
	if (distinctNames.length > 1) {
		issues.push({
			code: 'ambiguous_variant_parent',
			detail: `group ${groupKey} has conflicting VariativeName values: ${distinctNames.join(' / ')}`,
			recordIdentifier: groupKey,
			severity: 'error'
		})
	}

	const variativeName = distinctNames[0] ?? null
	const idNoms = members.map(m => m.ID_nom)

	let title: string | null = null
	let titleSource: TitleSource = 'unresolved'

	const fromEnrichment = resolveTitleFromEnrichment(idNoms, enrichment)
	if (fromEnrichment.title) {
		title = fromEnrichment.title
		titleSource = fromEnrichment.source!
		issues.push({
			code: 'validation_failed',
			detail: `title resolved from ${fromEnrichment.source} rather than VariativeName`,
			recordIdentifier: groupKey,
			severity: 'info'
		})
	} else if (variativeName) {
		title = variativeName
		titleSource = 'variative_name'
	} else {
		issues.push({
			code: 'missing_required_field',
			detail: `group ${groupKey} has no VariativeName on any member and no enrichment title was supplied`,
			recordIdentifier: groupKey,
			severity: 'error'
		})
	}

	const variants: CandidateVariant[] = members.map(toCandidateVariant)
	const publishable = !issues.some(issue => issue.severity === 'error')

	return { groupKey, sourceSystem, variativeName, title, titleSource, variants, issues, publishable }
}

function buildStandaloneCandidate(
	record: ProductsFeedRecord,
	sourceSystem: SourceSystem,
	enrichment: ProductNameEnrichment | undefined
): CandidateProduct {
	const issues: NormalizationIssue[] = []
	let title: string | null = null
	let titleSource: TitleSource = 'unresolved'

	// No VariativeNomenclature means no VariativeName either (it is a
	// property of the group, not the individual record) - but that alone
	// is never a reason to reject a legitimate standalone product
	// (Task 3's explicit instruction). A real title can still come from
	// MySQL enrichment or the JobVN feed's own ShortDescriptionRus.
	const fromEnrichment = resolveTitleFromEnrichment([record.ID_nom], enrichment)
	if (fromEnrichment.title) {
		title = fromEnrichment.title
		titleSource = fromEnrichment.source!
		issues.push({
			code: 'validation_failed',
			detail: `title resolved from ${fromEnrichment.source}`,
			recordIdentifier: record.ID_nom,
			// A short-description fallback is real content, not a fabrication,
			// but it is still an interim measure pending real MySQL
			// enrichment - kept visible as a warning, never silently treated
			// as equivalent to a verified title.
			severity: fromEnrichment.source === 'short_description_fallback' ? 'warning' : 'info'
		})
	} else {
		// Insufficient data: return an explicit, unresolved candidate ready
		// for a later MySQL enrichment pass (Task 3) - never blocked
		// silently, never fabricated.
		issues.push({
			code: 'missing_required_field',
			detail: `standalone record ${record.ID_nom} has no confirmed name source (no VariativeName, no MySQL enrichment, no feed short description)`,
			recordIdentifier: record.ID_nom,
			severity: 'error'
		})
	}

	const publishable = !issues.some(issue => issue.severity === 'error')

	return {
		groupKey: null,
		sourceSystem,
		variativeName: null,
		title,
		titleSource,
		variants: [toCandidateVariant(record)],
		issues,
		publishable
	}
}

function toCandidateVariant(record: ProductsFeedRecord): CandidateVariant {
	return {
		idNom: record.ID_nom,
		barcode: record.Barcode,
		colorVar: record.ColorVar,
		volumeVar: record.VolumeVar
	}
}

/**
 * Validates that no two candidate groups collide on groupKey across more
 * than one call to normalizeProductsFeed (e.g. two different feed files
 * processed in the same run) - Task 6: "validate collisions". Returns the
 * groupKeys that appear in more than one of the given candidate lists.
 */
export function findCrossBatchGroupCollisions(batches: CandidateProduct[][]): string[] {
	const seenIn = new Map<string, number>()
	for (const batch of batches) {
		for (const key of new Set(batch.map(c => c.groupKey).filter((k): k is string => k !== null))) {
			seenIn.set(key, (seenIn.get(key) ?? 0) + 1)
		}
	}
	return [...seenIn.entries()].filter(([, count]) => count > 1).map(([key]) => key)
}
