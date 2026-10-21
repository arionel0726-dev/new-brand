import { sql } from 'drizzle-orm'
import { boolean, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { productVariants } from './product-variants'

/**
 * Sprint 12B.1 - one-to-many barcode table, replacing the 1:1 assumption
 * baked into `product_variants.barcode`. Confirmed twice independently: a
 * VIZAJE-NICA employee (Sprint 12A.6) and the legacy forensic audit (§6.1,
 * Sprint 12B.0) both state a single nomenclature position can legitimately
 * carry multiple barcodes, including due to repackaging over time.
 *
 * `product_variants.barcode` is NOT dropped or deprecated by this table -
 * it stays as a denormalized "current primary barcode" cache so every
 * existing read path (admin variant/product serialization) keeps working
 * unmodified. Application code is responsible for keeping that cache in
 * sync with whichever row here has `isPrimary = true`; this table is the
 * source of truth, the scalar column is a read-optimized mirror of it.
 */
export const productVariantBarcodes = pgTable(
	'product_variant_barcodes',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		variantId: uuid('variant_id')
			.notNull()
			.references(() => productVariants.id, { onDelete: 'cascade' }),
		barcode: text('barcode').notNull(),
		isPrimary: boolean('is_primary').notNull().default(false),
		// Free-text audit trail of which feed/table row contributed this
		// barcode (e.g. 'legacy_mysql', '1c_products_json') - distinct from
		// externalSourceSystemEnum, which names *systems*, not *which feed
		// row within a system*.
		source: text('source'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		index('product_variant_barcodes_variant_id_idx').on(table.variantId),
		// One row per distinct barcode value per variant - the same physical
		// barcode is never recorded twice for the same variant.
		unique('product_variant_barcodes_variant_barcode_unique').on(table.variantId, table.barcode),
		// At most one globally primary barcode value, mirroring today's
		// global uniqueness constraint on product_variants.barcode (the
		// legacy 1:1 assumption this table replaces still holds for "the"
		// canonical barcode, just not for every barcode a position may have).
		uniqueIndex('product_variant_barcodes_primary_barcode_unique_idx')
			.on(table.barcode)
			.where(sql`${table.isPrimary}`)
		// Deliberately no partial-unique-index enforcing "at most one
		// isPrimary=true per variantId" here - left as an application-layer
		// invariant (see docs/vizaje-identity-architecture.md §C.1), since a
		// DB-level version of that specific constraint was an open
		// implementation choice there, not decided for this sprint.
	]
)
