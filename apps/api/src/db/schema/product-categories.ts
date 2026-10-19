import { index, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core'
import { categories } from './categories'
import { products } from './products'

export const productCategories = pgTable(
	'product_categories',
	{
		productId: uuid('product_id')
			.notNull()
			.references(() => products.id, { onDelete: 'cascade' }),
		categoryId: uuid('category_id')
			.notNull()
			.references(() => categories.id, { onDelete: 'cascade' })
	},
	table => [
		primaryKey({ columns: [table.productId, table.categoryId] }),
		index('product_categories_category_id_idx').on(table.categoryId)
	]
)
