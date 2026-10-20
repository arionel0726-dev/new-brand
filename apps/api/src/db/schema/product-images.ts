import { sql } from 'drizzle-orm'
import {
	foreignKey,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uuid
} from 'drizzle-orm/pg-core'
import { productVariants } from './product-variants'
import { products } from './products'

export const productImages = pgTable(
	'product_images',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		// Always set: every image belongs to a product, optionally pinned to one
		// of its variants via variantId below.
		productId: uuid('product_id')
			.notNull()
			.references(() => products.id, { onDelete: 'cascade' }),
		variantId: uuid('variant_id'),
		// Still the field every read path (public + admin) actually uses. For
		// R2-backed images it's computed once at upload-complete time from
		// R2_PUBLIC_URL + objectKey and stored here, so nothing downstream
		// needs to know how the URL was produced.
		url: text('url').notNull(),
		// The canonical identifier for R2-backed images (what gets HEAD'd and
		// deleted there). Null for any image that isn't R2-backed (e.g. a row
		// inserted directly with an external url).
		objectKey: text('object_key').unique(),
		mimeType: text('mime_type'),
		fileSize: integer('file_size'),
		width: integer('width'),
		height: integer('height'),
		altRu: text('alt_ru'),
		altRo: text('alt_ro'),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		index('product_images_product_id_idx').on(table.productId),
		index('product_images_variant_id_idx').on(table.variantId),
		// Composite FK (instead of a plain FK on variantId) so the database rejects
		// an image whose variantId belongs to a different product than productId.
		// With the default MATCH SIMPLE, a null variantId skips this check entirely,
		// which is what product-level (non-variant) images need.
		foreignKey({
			columns: [table.variantId, table.productId],
			foreignColumns: [productVariants.id, productVariants.productId],
			name: 'product_images_variant_product_fk'
		}).onDelete('cascade')
	]
)
