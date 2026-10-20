import { z } from 'zod'
import { externalIdSchema, parseFeedRecords, priceBaniSchema, type FeedParseResult } from './shared'

/**
 * The 1C "pricevn" feed (Sprint 10A Task 5) - Price, PriceWH and
 * DiscountPrice, keyed by ID_nom. Built strictly from this sprint's
 * confirmed legacy findings ("DiscountPrice appears in pricevn.json");
 * no real sample file was available in this environment (see
 * docs/vizaje-migration-architecture.md). `.passthrough()` retains any
 * field this schema doesn't yet know about.
 *
 * Every price field is optional *at the schema level* (a feed row might
 * legitimately omit PriceWH or DiscountPrice) but Price itself is treated
 * as required - a price row with no price at all has nothing to import
 * and is rejected as missing_required_field, not silently accepted as a
 * zero.
 */
export const pricevnFeedRecordSchema = z
	.object({
		ID_nom: externalIdSchema,
		Price: priceBaniSchema,
		PriceWH: priceBaniSchema,
		DiscountPrice: priceBaniSchema
	})
	.passthrough()
	.refine(record => record.Price !== null, { message: 'Price is required and cannot be empty' })

export type PricevnFeedRecord = z.infer<typeof pricevnFeedRecordSchema>

export function parsePricevnFeed(rawRecords: unknown[]): FeedParseResult<PricevnFeedRecord> {
	return parseFeedRecords(rawRecords, pricevnFeedRecordSchema, (raw, parsed) => parsed?.ID_nom ?? idNomOf(raw))
}

function idNomOf(raw: unknown): string {
	if (typeof raw === 'object' && raw !== null && 'ID_nom' in raw) {
		return String((raw as { ID_nom: unknown }).ID_nom ?? '')
	}
	return ''
}
