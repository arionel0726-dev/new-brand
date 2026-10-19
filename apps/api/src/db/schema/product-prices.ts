import { check, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { productVariants } from './product-variants'

export const productPrices = pgTable(
	'product_prices',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		variantId: uuid('variant_id')
			.notNull()
			.unique()
			.references(() => productVariants.id, { onDelete: 'cascade' }),
		currency: text('currency').notNull().default('MDL'),
		price: integer('price').notNull(),
		compareAtPrice: integer('compare_at_price'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		check('product_prices_currency_check', sql`${table.currency} = 'MDL'`),
		check('product_prices_price_non_negative_check', sql`${table.price} >= 0`),
		check(
			'product_prices_compare_at_price_check',
			sql`${table.compareAtPrice} is null or ${table.compareAtPrice} > ${table.price}`
		)
	]
)
