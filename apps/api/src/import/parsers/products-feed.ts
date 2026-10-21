import { z } from 'zod'
import { barcodeSchema, externalIdSchema, optionalTextSchema, parseFeedRecords, priceBaniSchema, type FeedParseResult } from './shared'

/**
 * The 1C nomenclature ("products") feed record shape - Sprint 10A.1
 * Task 4, now verified against `docs/legacy-reference/legacy-feed-samples.json`
 * (real sanitized samples of `public/import/products.json`), rather than
 * Sprint 10A's field-list-only guess.
 *
 * Confirmed fields present in the real sample: `ID_nom`,
 * `VariativeNomenclature`, `VariativeName`, `Barcode`, `ColorVar`,
 * `VolumeVar`, `Brand`, `Sex`, `QuantityBalance`, `Price`, `PriceWH`.
 * `WarehouseName` is also confirmed present but is deliberately **never**
 * parsed as a title/name candidate anywhere in this pipeline (Sprint
 * 10A.1 Task 3 explicit instruction) - it is retained only via
 * `.passthrough()` for diagnostic visibility, never typed as a trusted
 * field.
 *
 * `Brand` here is the legacy *brand name string* observed in the feed
 * (e.g. "Anny") - not yet resolved to a V2 brand id. Matching it to
 * `external_entity_mappings` (entity_type 'brand') is a dry-run/
 * normalization concern (reported as `unmatched_brand` when no mapping
 * exists), never assumed to be a reliable match key on its own (a brand
 * *name* string is not a stable external identifier - see
 * docs/vizaje-migration-architecture.md's identity-correctness section).
 *
 * `Price`/`PriceWH`/`QuantityBalance` are parsed here (decimal-safe,
 * never acted on) purely so the dry-run can report what the feed
 * actually contains - Sprint 10A.1 still does not synchronize production
 * price or stock (explicitly restricted).
 */
export const productsFeedRecordSchema = z
	.object({
		ID_nom: externalIdSchema,
		// The group identifier (Task 6 groups sellable variants under this).
		// Optional: a record with no group is a standalone product/variant.
		VariativeNomenclature: optionalTextSchema,
		VariativeName: optionalTextSchema,
		Barcode: barcodeSchema,
		ColorVar: optionalTextSchema,
		VolumeVar: optionalTextSchema,
		Brand: optionalTextSchema,
		Sex: optionalTextSchema,
		QuantityBalance: z.number().nullish(),
		Price: priceBaniSchema,
		PriceWH: priceBaniSchema,
		// Sprint 12B.2: typed (previously only reachable via .passthrough())
		// because the catalog importer now reads these as the content source
		// for products.short_description_ru/ro, ingredients_ru/ro and
		// instructions_ru/ro (Sprint 12B.1's new columns) - see
		// docs/vizaje-identity-architecture.md's field-correspondence matrix.
		// Still fully optional: a confirmed-matched product with none of
		// these populated simply imports with those columns left null, never
		// fabricated.
		ShortDescriptionRus: optionalTextSchema,
		ShortDescriptionMD: optionalTextSchema,
		InstructionRU: optionalTextSchema,
		InstructionMD: optionalTextSchema,
		componentsRu: optionalTextSchema,
		componentsMD: optionalTextSchema
	})
	.passthrough()

export type ProductsFeedRecord = z.infer<typeof productsFeedRecordSchema>

export function parseProductsFeed(rawRecords: unknown[]): FeedParseResult<ProductsFeedRecord> {
	return parseFeedRecords(
		rawRecords,
		productsFeedRecordSchema,
		(raw, parsed) => parsed?.ID_nom ?? idNomOf(raw)
	)
}

function idNomOf(raw: unknown): string {
	if (typeof raw === 'object' && raw !== null && 'ID_nom' in raw) {
		return String((raw as { ID_nom: unknown }).ID_nom ?? '')
	}
	return ''
}
