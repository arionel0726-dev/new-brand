import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { productVariants } from './product-variants'
import { products } from './products'

export const productImages = pgTable(
	'product_images',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }),
		variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'cascade' }),
		url: text('url').notNull(),
		altRu: text('alt_ru'),
		altRo: text('alt_ro'),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		index('product_images_product_id_idx').on(table.productId),
		index('product_images_variant_id_idx').on(table.variantId),
		check(
			'product_images_owner_check',
			sql`${table.productId} is not null or ${table.variantId} is not null`
		)
	]
)
