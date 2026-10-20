import { z } from 'zod'
import { barcodeSchema, externalIdSchema, optionalTextSchema, parseFeedRecords, type FeedParseResult } from './shared'

/**
 * The 1C nomenclature ("products") feed record shape (Sprint 10A Task 5) -
 * built strictly from the fields named in this sprint's confirmed legacy
 * findings (ID_nom, VariativeNomenclature, VariativeName, Barcode,
 * ColorVar, VolumeVar). No real `legacy-feed-samples.json` was available
 * in this environment (see docs/vizaje-migration-architecture.md) - this
 * schema is a best-effort shape from the textual field list only, not a
 * verified export structure, and is expected to need revision once real
 * samples are inspected. `.passthrough()` keeps any unrecognized field
 * instead of silently discarding it, so a real sample can be diffed
 * against what this schema currently expects.
 *
 * QuantityBalance and WarehouseName are deliberately NOT part of this
 * schema - they are confirmed as existing fields, but their feed
 * membership (this feed vs. a dedicated stock feed) was never confirmed,
 * and stock import is out of scope for this sprint regardless (see
 * Sprint 10A restrictions: "Implement stock sync" is explicitly
 * disallowed).
 */
export const productsFeedRecordSchema = z
	.object({
		ID_nom: externalIdSchema,
		// The group identifier (Task 6 groups sellable variants under this).
		// Optional: a record with no group is a standalone product/variant
		// (Task 6: "For records without a group identifier, define safe
		// standalone behavior").
		VariativeNomenclature: optionalTextSchema,
		VariativeName: optionalTextSchema,
		Barcode: barcodeSchema,
		ColorVar: optionalTextSchema,
		VolumeVar: optionalTextSchema
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
