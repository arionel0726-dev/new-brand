import { sql } from 'drizzle-orm'
import { check, integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'
import { productVariants } from './product-variants'

export const inventory = pgTable(
	'inventory',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		variantId: uuid('variant_id')
			.notNull()
			.unique()
			.references(() => productVariants.id, { onDelete: 'cascade' }),
		quantity: integer('quantity').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [check('inventory_quantity_non_negative_check', sql`${table.quantity} >= 0`)]
)
