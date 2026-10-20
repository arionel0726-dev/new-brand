import { z } from 'zod'
import { externalIdSchema, optionalTextSchema, parseFeedRecords, priceBaniSchema, type FeedParseResult } from './shared'

/**
 * The 1C "pricevn" feed - verified against
 * `docs/legacy-reference/legacy-feed-samples.json` (Sprint 10A.1 Task 4).
 *
 * Confirmed fields actually present in the real sample: `ID_nom`,
 * `DiscountPrice`, `VariativeNomenclature`, `Price`. `PriceWH` was **not**
 * present in the real pricevn sample (unlike the products and JobVN
 * samples, which do include it) - kept here as optional for forward
 * compatibility, but its presence in this specific feed is unconfirmed;
 * do not assume every pricevn record carries it.
 *
 * `DiscountPrice: 0` in every sample record is ambiguous: it may mean
 * "no active discount" rather than a genuine zero discounted price. This
 * project does not guess which interpretation is correct - see
 * docs/vizaje-migration-architecture.md's price-field confidence table.
 * Either way, no price synchronization is implemented this sprint
 * (explicitly restricted); this parser only validates and reports.
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
		DiscountPrice: priceBaniSchema,
		VariativeNomenclature: optionalTextSchema
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
