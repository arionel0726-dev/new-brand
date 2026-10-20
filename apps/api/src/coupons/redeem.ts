import { and, eq, or, sql } from 'drizzle-orm'
import type { Tx } from '../db/tx'
import { coupons } from '../db/schema/coupons'
import { couponRedemptions } from '../db/schema/coupon-redemptions'

export type RedeemCouponResult =
	| { ok: true }
	| { ok: false; code: 'coupon_usage_limit_reached' | 'coupon_per_customer_limit_reached' }

/**
 * Only ever called from inside the order-creation transaction, after
 * validateCoupon's read-only pass already said yes once - this is the
 * second, authoritative check-and-claim under real concurrency.
 *
 * Global limit: a conditional UPDATE (WHERE max_total_uses IS NULL OR
 * uses_count < max_total_uses) - the same pattern this codebase uses for
 * every other limited counter (stock, promotion redemptions).
 *
 * Per-customer limit: a plain SELECT count() isn't safe here - two
 * concurrent transactions could each count the same (not-yet-committed)
 * number of prior redemptions and both pass. pg_advisory_xact_lock
 * serializes any two transactions trying to redeem the same coupon as
 * the same user at the same time: the second one blocks until the first
 * commits or rolls back, so its own count() (taken after the lock, i.e.
 * after the first's insert is visible) is always accurate.
 */
export async function redeemCoupon(
	tx: Tx,
	couponId: string,
	userId: string | null,
	orderId: string,
	discountAmount: number
): Promise<RedeemCouponResult> {
	if (userId) {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${couponId} || ':' || ${userId}))`)
	}

	const [claimed] = await tx
		.update(coupons)
		.set({ usesCount: sql`${coupons.usesCount} + 1`, updatedAt: new Date() })
		.where(
			and(eq(coupons.id, couponId), or(sql`${coupons.maxTotalUses} is null`, sql`${coupons.usesCount} < ${coupons.maxTotalUses}`))
		)
		.returning({ id: coupons.id, maxUsesPerCustomer: coupons.maxUsesPerCustomer })
	if (!claimed) {
		return { ok: false, code: 'coupon_usage_limit_reached' }
	}

	if (userId && claimed.maxUsesPerCustomer !== null) {
		const [{ count }] = await tx
			.select({ count: sql<number>`count(*)::int` })
			.from(couponRedemptions)
			.where(and(eq(couponRedemptions.couponId, couponId), eq(couponRedemptions.userId, userId)))
		if (count >= claimed.maxUsesPerCustomer) {
			// The global-use increment above is undone automatically: the
			// caller rolls back this whole transaction (and therefore the
			// order itself) on a non-ok result, so nothing here needs to be
			// manually reversed.
			return { ok: false, code: 'coupon_per_customer_limit_reached' }
		}
	}

	await tx.insert(couponRedemptions).values({ couponId, orderId, userId, discountAmount })
	return { ok: true }
}
