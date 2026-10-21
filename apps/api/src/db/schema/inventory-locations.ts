import { sql } from 'drizzle-orm'
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Sprint 12B.1 - one row per legacy per-warehouse `Bal*` column observed in
 * the 1C feed (BalAtrium, BalELAT, BalG3, BalGRHILLS, BalMall, BalNR1,
 * BalSC1, BalSC3, BalSOIUZ, BalUNIC, BalUNIC1 - Sprint 12A.3's field
 * audit). `code` is proposed to mirror each `Bal*` suffix 1:1
 * (lowercased, e.g. 'atrium', 'mall') so the mapping back to the source
 * column stays traceable rather than re-invented later.
 *
 * This table and variant_inventory_by_location exist so the per-location
 * modeling work isn't blocked, but neither this sprint nor Phase B
 * populates or aggregates them yet - how the 11 `Bal*` values (and the
 * separate `QuantityBalance`) combine into a single sellable quantity is
 * an open business rule (docs/vizaje-identity-architecture.md §D.5-D.6),
 * not decided here.
 */
export const inventoryLocations = pgTable('inventory_locations', {
	id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
	code: text('code').notNull().unique(),
	nameRu: text('name_ru'),
	nameRo: text('name_ro'),
	isActive: boolean('is_active').notNull().default(true),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})
