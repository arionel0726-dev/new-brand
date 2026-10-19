import { sql } from 'drizzle-orm'
import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { products } from './products'

export const productVariants = pgTable(
	'product_variants',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		productId: uuid('product_id')
			.notNull()
			.references(() => products.id, { onDelete: 'cascade' }),
		sku: text('sku').notNull().unique(),
		nameRu: text('name_ru'),
		nameRo: text('name_ro'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		index('product_variants_product_id_idx').on(table.productId),
		// Referenced by product_images' composite FK so a variant's image can be
		// pinned to its real owning product at the database level.
		unique('product_variants_id_product_id_unique').on(table.id, table.productId)
	]
)
