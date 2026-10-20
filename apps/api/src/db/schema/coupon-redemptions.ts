import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { coupons } from './coupons'
import { orders } from './orders'

/**
 * One row per order that actually redeemed a coupon - never restored on
 * cancellation (src/orders/policy.ts documents why). 'restrict' on both
 * FKs: a coupon or order with a redemption on record can never be
 * hard-deleted out from under its own audit trail (Task 6).
 *
 * In its own file (not coupons.ts or orders.ts) specifically to avoid a
 * circular import: orders.ts needs coupons.ts for orders.couponId, and
 * this table needs both - putting it in either of those two would make
 * them import each other.
 */
export const couponRedemptions = pgTable(
	'coupon_redemptions',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		couponId: uuid('coupon_id')
			.notNull()
			.references(() => coupons.id, { onDelete: 'restrict' }),
		orderId: uuid('order_id')
			.notNull()
			.unique()
			.references(() => orders.id, { onDelete: 'restrict' }),
		// Null for a guest redemption (only ever allowed for a coupon with no
		// maxUsesPerCustomer - see src/coupons/validate.ts).
		userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
		discountAmount: integer('discount_amount').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		index('coupon_redemptions_coupon_id_idx').on(table.couponId),
		index('coupon_redemptions_user_id_idx').on(table.userId),
		check('coupon_redemptions_discount_amount_non_negative_check', sql`${table.discountAmount} >= 0`)
	]
)
