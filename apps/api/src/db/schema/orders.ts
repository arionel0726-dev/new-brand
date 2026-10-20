import { sql } from 'drizzle-orm'
import { check, index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { deliveryMethodEnum, deliveryZones, pickupLocations } from './delivery'
import { paymentMethodEnum } from './payment-method'
import { products } from './products'
import { productVariants } from './product-variants'

/**
 * Deliberately only the order's own lifecycle - never conflated with
 * payment. A 'completed' order is not necessarily paid online, and a paid
 * order is not necessarily completed; that distinction (payment_status)
 * is Sprint 7's job once a real payment method exists. No 'paid' state
 * here on purpose.
 */
export const orderStatusEnum = pgEnum('order_status', [
	'pending',
	'confirmed',
	'processing',
	'completed',
	'cancelled'
])

export const orders = pgTable(
	'orders',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		// A random, non-sequential public reference - see
		// src/orders/order-number.ts. Never the sole means of guest access;
		// that's order_access_tokens below.
		orderNumber: text('order_number').notNull().unique(),
		// Nullable: a guest checkout has no account. onDelete 'set null', never
		// 'cascade' - an order is a historical record that must outlive the
		// customer account that placed it.
		userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
		status: orderStatusEnum('status').notNull().default('pending'),
		currency: text('currency').notNull().default('MDL'),
		subtotalAmount: integer('subtotal_amount').notNull(),
		discountAmount: integer('discount_amount').notNull().default(0),
		shippingAmount: integer('shipping_amount').notNull().default(0),
		totalAmount: integer('total_amount').notNull(),
		customerName: text('customer_name').notNull(),
		customerEmail: text('customer_email').notNull(),
		customerPhone: text('customer_phone').notNull(),
		customerNote: text('customer_note'),
		// Sprint 6 left these as plain nullable text with every row NULL;
		// Sprint 7 narrows them to real enums (a safe ALTER COLUMN TYPE - every
		// existing value is NULL, which casts to NULL in either type).
		deliveryMethod: deliveryMethodEnum('delivery_method'),
		paymentMethod: paymentMethodEnum('payment_method'),
		// Pickup: set together with pickupLocationId, nothing else below.
		pickupLocationId: uuid('pickup_location_id').references(() => pickupLocations.id, { onDelete: 'set null' }),
		// Courier: set together with deliveryZoneId and every recipient field.
		// These are the address *snapshot* at order time - never a live
		// reference into a shared, editable address book (this project has
		// none), so a shopper editing their profile later can never alter a
		// past order's delivery details.
		deliveryZoneId: uuid('delivery_zone_id').references(() => deliveryZones.id, { onDelete: 'set null' }),
		recipientName: text('recipient_name'),
		recipientPhone: text('recipient_phone'),
		deliveryCity: text('delivery_city'),
		deliveryStreet: text('delivery_street'),
		deliveryHouse: text('delivery_house'),
		deliveryApartment: text('delivery_apartment'),
		deliveryNotes: text('delivery_notes'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true })
	},
	table => [
		index('orders_user_id_idx').on(table.userId),
		index('orders_status_idx').on(table.status),
		check('orders_currency_check', sql`${table.currency} = 'MDL'`),
		check('orders_subtotal_non_negative_check', sql`${table.subtotalAmount} >= 0`),
		check('orders_discount_non_negative_check', sql`${table.discountAmount} >= 0`),
		check('orders_shipping_non_negative_check', sql`${table.shippingAmount} >= 0`),
		check('orders_total_non_negative_check', sql`${table.totalAmount} >= 0`),
		check(
			'orders_total_consistency_check',
			sql`${table.totalAmount} = ${table.subtotalAmount} - ${table.discountAmount} + ${table.shippingAmount}`
		),
		// Exactly one coherent delivery shape: no delivery info at all
		// (every Sprint 6 order, and still a valid state), a complete pickup
		// selection, or a complete courier selection - never a mix, and
		// never a partial one.
		check(
			'orders_delivery_shape_check',
			sql`
				(${table.deliveryMethod} is null
					and ${table.pickupLocationId} is null and ${table.deliveryZoneId} is null
					and ${table.recipientName} is null and ${table.recipientPhone} is null
					and ${table.deliveryCity} is null and ${table.deliveryStreet} is null and ${table.deliveryHouse} is null)
				or (${table.deliveryMethod} = 'pickup'
					and ${table.pickupLocationId} is not null and ${table.deliveryZoneId} is null
					and ${table.recipientName} is null and ${table.recipientPhone} is null
					and ${table.deliveryCity} is null and ${table.deliveryStreet} is null and ${table.deliveryHouse} is null)
				or (${table.deliveryMethod} = 'courier'
					and ${table.pickupLocationId} is null and ${table.deliveryZoneId} is not null
					and ${table.recipientName} is not null and ${table.recipientPhone} is not null
					and ${table.deliveryCity} is not null and ${table.deliveryStreet} is not null and ${table.deliveryHouse} is not null)
			`
		)
	]
)

export const orderItems = pgTable(
	'order_items',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		orderId: uuid('order_id')
			.notNull()
			.references(() => orders.id, { onDelete: 'cascade' }),
		// Nullable + 'set null': the *Snapshot columns below are the historical
		// record. An order_item must stay complete and readable even after the
		// live product/variant it pointed to is deleted.
		productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
		variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'set null' }),
		skuSnapshot: text('sku_snapshot').notNull(),
		productNameRuSnapshot: text('product_name_ru_snapshot').notNull(),
		productNameRoSnapshot: text('product_name_ro_snapshot').notNull(),
		variantNameRuSnapshot: text('variant_name_ru_snapshot'),
		variantNameRoSnapshot: text('variant_name_ro_snapshot'),
		quantity: integer('quantity').notNull(),
		unitPrice: integer('unit_price').notNull(),
		lineTotal: integer('line_total').notNull(),
		// Reservation-lifecycle guards (src/orders/inventory.ts): each is set
		// exactly once, so a release or commit can never double-apply to the
		// same line even if called more than once for the same order.
		releasedAt: timestamp('released_at', { withTimezone: true }),
		committedAt: timestamp('committed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		index('order_items_order_id_idx').on(table.orderId),
		check('order_items_quantity_positive_check', sql`${table.quantity} > 0`),
		check('order_items_unit_price_non_negative_check', sql`${table.unitPrice} >= 0`),
		check('order_items_line_total_non_negative_check', sql`${table.lineTotal} >= 0`),
		check(
			'order_items_line_total_consistency_check',
			sql`${table.lineTotal} = ${table.unitPrice} * ${table.quantity}`
		)
	]
)

export const orderStatusHistory = pgTable(
	'order_status_history',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		orderId: uuid('order_id')
			.notNull()
			.references(() => orders.id, { onDelete: 'cascade' }),
		// Null only for the very first row (order creation has no "from").
		fromStatus: orderStatusEnum('from_status'),
		toStatus: orderStatusEnum('to_status').notNull(),
		// Null for a guest's own self-service action, or a purely automated
		// step - never required, since not every actor has a user id.
		changedBy: uuid('changed_by').references(() => user.id, { onDelete: 'set null' }),
		reason: text('reason'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [index('order_status_history_order_id_idx').on(table.orderId)]
)

/**
 * Backs Idempotency-Key handling (Task 6). The unique constraint is what
 * makes two concurrent requests with the same key safe: a second insert
 * attempting the same (identityKey, idempotencyKey) pair blocks on
 * Postgres's own row lock until the first transaction commits or rolls
 * back, then either sees the committed row (and does nothing) or - if the
 * first rolled back - succeeds itself. The uniqueness is enforced by
 * Postgres, not application code.
 */
export const orderIdempotencyKeys = pgTable(
	'order_idempotency_keys',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		// "user:<uuid>" or "guest:<sha256 of their cart cookie token>" - always
		// derived server-side from the session or hashed cookie, never from
		// anything the client asserts about who it is.
		identityKey: text('identity_key').notNull(),
		idempotencyKey: text('idempotency_key').notNull(),
		// sha256 of the (canonicalized) request body - lets a replay with
		// different content be rejected as a conflict instead of silently
		// returning the wrong order.
		requestHash: text('request_hash').notNull(),
		// Null only for the instant between claiming the key and the order
		// actually being created, within the same transaction - never
		// observable by another request (see above).
		orderId: uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		unique('order_idempotency_keys_identity_key_idempotency_key_unique').on(
			table.identityKey,
			table.idempotencyKey
		)
	]
)

/**
 * Guest order access (Task 7): a random per-order token, never the
 * order_number or order id, and never stored in the clear - only its hash.
 * One row per order; created only for a guest checkout (an authenticated
 * customer's own session is already sufficient proof of ownership).
 */
export const orderAccessTokens = pgTable('order_access_tokens', {
	id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
	orderId: uuid('order_id')
		.notNull()
		.unique()
		.references(() => orders.id, { onDelete: 'cascade' }),
	tokenHash: text('token_hash').notNull().unique(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})
