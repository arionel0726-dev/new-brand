import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { productVariants } from './product-variants'
import { inventoryLocations } from './inventory-locations'

/**
 * Sprint 12B.1 - raw per-location stock, one row per (variant, location).
 * Deliberately stores only the raw observed quantity, never a computed
 * aggregate: the existing `inventory` table's single `quantity_on_hand`
 * stays the one place a sellable quantity is read from today, and remains
 * untouched by this sprint. Whether/how this table's rows should someday
 * feed that aggregate (sum all locations? a specific subset? does legacy's
 * own `QuantityBalance + BalMall` addition double-count, per forensic
 * audit §13 Q10/Q11?) is an explicit open question
 * (docs/vizaje-identity-architecture.md §D.5-D.6), not decided or
 * implemented here.
 */
export const variantInventoryByLocation = pgTable(
	'variant_inventory_by_location',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		variantId: uuid('variant_id')
			.notNull()
			.references(() => productVariants.id, { onDelete: 'cascade' }),
		// RESTRICT (not CASCADE): deleting a location that still has recorded
		// stock rows must fail explicitly, matching this schema's existing
		// convention for a parent whose removal would silently orphan
		// historical data (see categories.parentId).
		locationId: uuid('location_id')
			.notNull()
			.references(() => inventoryLocations.id, { onDelete: 'restrict' }),
		quantity: integer('quantity').notNull().default(0),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		index('variant_inventory_by_location_variant_id_idx').on(table.variantId),
		index('variant_inventory_by_location_location_id_idx').on(table.locationId),
		unique('variant_inventory_by_location_variant_location_unique').on(table.variantId, table.locationId),
		check('variant_inventory_by_location_quantity_non_negative_check', sql`${table.quantity} >= 0`)
	]
)
