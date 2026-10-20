import { sql } from 'drizzle-orm'
import { boolean, check, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Only two fulfillment methods this sprint. Both are extensible (a third
 * method later is a new enum value + migration, not a schema rewrite),
 * but nothing here invents coverage this project doesn't actually have -
 * zones/locations are empty until staff configure them via the admin API.
 */
export const deliveryMethodEnum = pgEnum('delivery_method', ['pickup', 'courier'])

/**
 * A named courier delivery area with its own flat fee, independent of any
 * map/geocoding provider (explicitly out of scope) - an address is
 * collected for the courier but the fee is driven only by which zone the
 * shopper picks.
 */
export const deliveryZones = pgTable(
	'delivery_zones',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		code: text('code').notNull().unique(),
		nameRu: text('name_ru').notNull(),
		nameRo: text('name_ro').notNull(),
		isActive: boolean('is_active').notNull().default(true),
		feeAmount: integer('fee_amount').notNull(),
		// Below this cart subtotal, the zone can't be selected at all (null = no minimum).
		minOrderAmount: integer('min_order_amount'),
		// At or above this cart subtotal, feeAmount is waived (null = never free).
		freeThresholdAmount: integer('free_threshold_amount'),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		check('delivery_zones_fee_non_negative_check', sql`${table.feeAmount} >= 0`),
		check(
			'delivery_zones_min_order_non_negative_check',
			sql`${table.minOrderAmount} is null or ${table.minOrderAmount} >= 0`
		),
		check(
			'delivery_zones_free_threshold_non_negative_check',
			sql`${table.freeThresholdAmount} is null or ${table.freeThresholdAmount} >= 0`
		)
	]
)

/** A real physical pickup point is staff-entered data, never hardcoded here. */
export const pickupLocations = pgTable('pickup_locations', {
	id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
	code: text('code').notNull().unique(),
	nameRu: text('name_ru').notNull(),
	nameRo: text('name_ro').notNull(),
	address: text('address').notNull(),
	isActive: boolean('is_active').notNull().default(true),
	sortOrder: integer('sort_order').notNull().default(0),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})
