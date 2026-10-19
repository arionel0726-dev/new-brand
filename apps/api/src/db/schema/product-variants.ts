import { sql } from 'drizzle-orm'
import { boolean, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
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
		// Independent of pricing/stock: a variant can have a price yet be
		// switched off (isActive=false), or have no price yet (isActive=true,
		// still unsellable until priced). Public API requires both isActive
		// and a price row before a variant is exposed. Zero stock does not
		// imply isActive=false — a sold-out variant can still be active.
		isActive: boolean('is_active').notNull().default(true),
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
