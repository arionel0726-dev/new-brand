import { z } from 'zod'
import { externalIdSchema, optionalTextSchema, parseFeedRecords, priceBaniSchema, type FeedParseResult } from './shared'

/**
 * The "JobVN" feed - Sprint 10A.1 Task 4 correction.
 *
 * Sprint 10A's placeholder (`MetaTitle`/`MetaDescription`/`Url`) is
 * replaced with the fields actually confirmed present in
 * `docs/legacy-reference/legacy-feed-samples.json`'s JobVN sample:
 * `ID_nom`, `WarehouseName`, `Brand`, `ShortDescriptionRus`,
 * `VariativeNomenclature`, `VariativeName`, `SeoHeaderRU`,
 * `SeoDescriptionRU`, `Price`, `PriceWH`.
 *
 * `workapp-1c-observed-contract.md` additionally confirms (by direct
 * reference to `Import::update_seo()`) that this feed is what the legacy
 * site's SEO title/description update actually reads from - this is no
 * longer a guess.
 *
 * **Still unconfirmed:** no `SeoHeaderRO`/`SeoDescriptionRO` (or any RO
 * SEO field) appears anywhere in the supplied JobVN sample, even though
 * the legacy MySQL `products`/`brands`/`categories` tables all have
 * `seoTitleRO`/`seoDescRO` columns. This parser therefore does **not**
 * assert an RO SEO field exists in this feed - including one would be
 * exactly the kind of invented mapping this project is told not to
 * produce. If a real RO SEO field exists in this feed, it must be
 * confirmed from a fuller sample before being added here.
 *
 * `ShortDescriptionRus` is the field the legacy `Import::import()` logic
 * (per `vizaje-legacy-discovery.md`) uses as a *gate*: a new product is
 * skipped entirely if it is absent. It is a RU short description, not
 * itself a display title - see `src/import/normalize/products.ts` for how
 * it is used only as a last-resort, explicitly-flagged standalone-title
 * fallback, never confused with a curated title.
 */
export const jobvnSeoFeedRecordSchema = z
	.object({
		ID_nom: externalIdSchema,
		VariativeNomenclature: optionalTextSchema,
		VariativeName: optionalTextSchema,
		Brand: optionalTextSchema,
		ShortDescriptionRus: optionalTextSchema,
		SeoHeaderRU: optionalTextSchema,
		SeoDescriptionRU: optionalTextSchema,
		Price: priceBaniSchema,
		PriceWH: priceBaniSchema
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
