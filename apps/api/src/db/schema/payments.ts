import { sql } from 'drizzle-orm'
import { check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { orders } from './orders'
import { paymentMethodEnum } from './payment-method'

export { paymentMethodEnum }

/**
 * Deliberately never inferred from order_status (Task 4) - an order can
 * be 'completed' (physically fulfilled) while its payment is still
 * 'pending' (cash on delivery, collected but not yet reconciled by
 * staff), and a 'paid' payment doesn't by itself make an order
 * 'completed'. Two independent state machines, two independent history
 * tables (order_status_history / payment_status_history).
 */
export const paymentStatusEnum = pgEnum('payment_status', [
	'pending',
	'requires_action',
	'paid',
	'failed',
	'cancelled',
	'refunded',
	'partially_refunded'
])

export const payments = pgTable(
	'payments',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		orderId: uuid('order_id')
			.notNull()
			.references(() => orders.id, { onDelete: 'cascade' }),
		method: paymentMethodEnum('method').notNull(),
		status: paymentStatusEnum('status').notNull().default('pending'),
		currency: text('currency').notNull().default('MDL'),
		amount: integer('amount').notNull(),
		// Reliable partial-refund accounting: refundedAmount is the running
		// total actually refunded, always consistent with `status` via the
		// check below - never a bare boolean "was it refunded".
		refundedAmount: integer('refunded_amount').notNull().default(0),
		// 'offline' for cash/card-on-delivery (this project's own bookkeeping,
		// no external gateway); a real provider code (e.g. a future 'paynet')
		// once one is implemented - see src/payments/provider.ts.
		provider: text('provider').notNull(),
		// Only ever set by processing a verified provider event or (for
		// offline methods) a staff confirmation - never from client input.
		externalReference: text('external_reference'),
		metadata: jsonb('metadata'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		index('payments_order_id_idx').on(table.orderId),
		check('payments_currency_check', sql`${table.currency} = 'MDL'`),
		check('payments_amount_non_negative_check', sql`${table.amount} >= 0`),
		check('payments_refunded_amount_non_negative_check', sql`${table.refundedAmount} >= 0`),
		check('payments_refunded_amount_lte_amount_check', sql`${table.refundedAmount} <= ${table.amount}`),
		check(
			'payments_refund_status_consistency_check',
			sql`(${table.status} = 'refunded' and ${table.refundedAmount} = ${table.amount})
				or (${table.status} = 'partially_refunded' and ${table.refundedAmount} > 0 and ${table.refundedAmount} < ${table.amount})
				or (${table.status} not in ('refunded', 'partially_refunded') and ${table.refundedAmount} = 0)`
		)
	]
)

export const paymentStatusHistory = pgTable(
	'payment_status_history',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		paymentId: uuid('payment_id')
			.notNull()
			.references(() => payments.id, { onDelete: 'cascade' }),
		fromStatus: paymentStatusEnum('from_status'),
		toStatus: paymentStatusEnum('to_status').notNull(),
		// Staff member for a manual confirmation/refund; null for a
		// provider-event-driven change (none exist yet in this sprint).
		changedBy: uuid('changed_by').references(() => user.id, { onDelete: 'set null' }),
		reason: text('reason'),
		metadata: jsonb('metadata'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [index('payment_status_history_payment_id_idx').on(table.paymentId)]
)

/**
 * Event-idempotency seam for a future real provider's webhooks (Task 5).
 * Nothing in this sprint writes to this table over HTTP - there is no
 * webhook endpoint yet, because there is no real provider to receive
 * webhooks from. When one is added: verify the provider's signature
 * first, then INSERT ... ON CONFLICT (provider, external_event_id) DO
 * NOTHING before processing - exactly the pattern this table enforces at
 * the database level, the same way order_idempotency_keys does for order
 * creation.
 */
export const paymentProviderEvents = pgTable(
	'payment_provider_events',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		provider: text('provider').notNull(),
		externalEventId: text('external_event_id').notNull(),
		paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
		receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
		processedAt: timestamp('processed_at', { withTimezone: true })
	},
	table => [unique('payment_provider_events_provider_external_event_id_unique').on(table.provider, table.externalEventId)]
)
