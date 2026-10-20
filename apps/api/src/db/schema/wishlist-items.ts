import { sql } from 'drizzle-orm'
import { index, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { products } from './products'
import { user } from './auth'

export const wishlistItems = pgTable(
	'wishlist_items',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		userId: uuid('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		productId: uuid('product_id')
			.notNull()
			.references(() => products.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		index('wishlist_items_user_id_idx').on(table.userId),
		unique('wishlist_items_user_id_product_id_unique').on(table.userId, table.productId)
	]
)
