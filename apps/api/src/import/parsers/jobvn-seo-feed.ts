import { z } from 'zod'
import { externalIdSchema, optionalTextSchema, parseFeedRecords, type FeedParseResult } from './shared'

/**
 * The "JobVN SEO" feed (Sprint 10A Task 5).
 *
 * IMPORTANT - unlike the products and pricevn feeds, this sprint's
 * confirmed legacy findings do not name a single concrete field for this
 * feed (no equivalent of "ID_nom: individual nomenclature identifier" was
 * given for it), and `legacy-feed-samples.json` /
 * `workapp-1c-observed-contract.md` were not present in this environment
 * to inspect directly (see docs/vizaje-migration-architecture.md). This
 * schema is therefore intentionally minimal: it requires only a linking
 * identifier (assumed to be ID_nom, consistent with the other two feeds,
 * but NOT independently confirmed for this feed specifically) and a small
 * set of SEO-shaped fields named defensively as `optional` - every one of
 * which is a guess at a plausible field name, not a verified one.
 * `.passthrough()` retains everything else so a real sample, once
 * available, can be diffed against what actually arrived instead of
 * silently losing data this schema doesn't yet recognize.
 *
 * Do not treat the optional field names below as confirmed. Revise this
 * schema against a real sample before using it for anything beyond a
 * structural dry-run smoke test.
 */
export const jobvnSeoFeedRecordSchema = z
	.object({
		ID_nom: externalIdSchema,
		// Every field below is an unverified guess at a plausible SEO field
		// name, included only so the parser has *something* concrete to
		// validate and so "empty SEO fields" (Task 5) is exercised in tests.
		MetaTitle: optionalTextSchema,
		MetaDescription: optionalTextSchema,
		Url: optionalTextSchema
	})
	.passthrough()

export type JobvnSeoFeedRecord = z.infer<typeof jobvnSeoFeedRecordSchema>

export function parseJobvnSeoFeed(rawRecords: unknown[]): FeedParseResult<JobvnSeoFeedRecord> {
	return parseFeedRecords(rawRecords, jobvnSeoFeedRecordSchema, (raw, parsed) => parsed?.ID_nom ?? idNomOf(raw))
}

function idNomOf(raw: unknown): string {
	if (typeof raw === 'object' && raw !== null && 'ID_nom' in raw) {
		return String((raw as { ID_nom: unknown }).ID_nom ?? '')
	}
	return ''
}
