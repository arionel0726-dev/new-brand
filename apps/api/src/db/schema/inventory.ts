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
		// Physical stock actually on the shelf. Order reservation (Sprint 4B+)
		// will increment quantityReserved without touching this.
		quantityOnHand: integer('quantity_on_hand').notNull().default(0),
		// Stock already committed to an order but not yet shipped. Always 0 in
		// this sprint (no order system yet) - the column exists now so the
		// admin inventory endpoint has the right shape to build on, but
		// clients can only ever set quantityOnHand, never this field directly.
		quantityReserved: integer('quantity_reserved').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		check('inventory_quantity_on_hand_non_negative_check', sql`${table.quantityOnHand} >= 0`),
		check('inventory_quantity_reserved_non_negative_check', sql`${table.quantityReserved} >= 0`),
		check(
			'inventory_quantity_reserved_lte_on_hand_check',
			sql`${table.quantityReserved} <= ${table.quantityOnHand}`
		)
	]
)
