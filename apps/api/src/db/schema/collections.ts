import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { products } from './products'

/**
 * Editorial merchandising (Task 7) - "Новинки", "Хиты", etc. Membership is
 * always explicit (collection_products), never a fabricated "popularity"
 * or "newest N products" rule computed on the fly - staff curate every
 * collection by hand, with their own sort order independent of the
 * product's own catalog ordering.
 */
export const collections = pgTable(
	'collections',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		slug: text('slug').notNull().unique(),
		titleRu: text('title_ru').notNull(),
		titleRo: text('title_ro').notNull(),
		descriptionRu: text('description_ru'),
		descriptionRo: text('description_ro'),
		isActive: boolean('is_active').notNull().default(true),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [index('collections_is_active_idx').on(table.isActive)]
)

export const collectionProducts = pgTable(
	'collection_products',
	{
		collectionId: uuid('collection_id')
			.notNull()
			.references(() => collections.id, { onDelete: 'cascade' }),
		productId: uuid('product_id')
			.notNull()
			.references(() => products.id, { onDelete: 'cascade' }),
		// Per-collection ordering - independent of any other list a product
		// appears in.
		sortOrder: integer('sort_order').notNull().default(0)
	},
	table => [
		primaryKey({ columns: [table.collectionId, table.productId] }),
		index('collection_products_product_id_idx').on(table.productId)
	]
)
