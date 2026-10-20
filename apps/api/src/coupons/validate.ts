import { and, eq, sql } from 'drizzle-orm'
import type { DbOrTx } from '../db/tx'
import { couponBrands, couponCategories, couponProducts, coupons } from '../db/schema/coupons'
import { couponRedemptions } from '../db/schema/coupon-redemptions'
import { getProductScopeInfo } from '../promotions/scope'
import { matchesScope } from '../promotions/scope-match'
import { normalizeCouponCode } from './normalize'

export type CouponRow = typeof coupons.$inferSelect

export type CouponLine = {
	variantId: string
	productId: string
	/** Already net of any promotion discount - a coupon applies on top of promotions, never before them (Task 1's pricing order). */
	netAmount: number
}

export type CouponProblemCode =
	| 'coupon_not_found'
	| 'coupon_inactive'
	| 'coupon_not_started'
	| 'coupon_expired'
	| 'coupon_below_minimum_order'
	| 'coupon_usage_limit_reached'
	| 'coupon_requires_account'
	| 'coupon_per_customer_limit_reached'
	| 'coupon_not_applicable'

const COUPON_PROBLEM_MESSAGES: Record<CouponProblemCode, string> = {
	coupon_not_found: 'This coupon code does not exist.',
	coupon_inactive: 'This coupon is no longer active.',
	coupon_not_started: 'This coupon is not active yet.',
	coupon_expired: 'This coupon has expired.',
	coupon_below_minimum_order: 'Your order does not meet this coupon\'s minimum order amount.',
	coupon_usage_limit_reached: 'This coupon has reached its usage limit.',
	coupon_requires_account: 'This coupon requires a customer account.',
	coupon_per_customer_limit_reached: 'You have already used this coupon the maximum number of times.',
	coupon_not_applicable: 'None of the items in your cart are eligible for this coupon.'
}

export type CouponValidationResult =
	| { ok: true; coupon: CouponRow; eligibleSubtotal: number; discountAmount: number }
	| { ok: false; code: CouponProblemCode; message: string; minOrderAmount?: number }

function problem(code: CouponProblemCode, minOrderAmount?: number): CouponValidationResult {
	return {
		ok: false,
		code,
		message: COUPON_PROBLEM_MESSAGES[code],
		...(minOrderAmount !== undefined ? { minOrderAmount } : {})
	}
}

function computeCouponDiscount(coupon: CouponRow, eligibleSubtotal: number): number {
	let discount: number
	if (coupon.discountType === 'percentage') {
		discount = Math.round((eligibleSubtotal * (coupon.percentageValue ?? 0)) / 100)
	} else {
		discount = coupon.fixedAmount ?? 0
	}
	return Math.max(0, Math.min(discount, eligibleSubtotal))
}

/**
 * Read-only: checks a coupon against the current cart/identity without
 * reserving or redeeming anything (Task 4 - POST /checkout/apply-coupon
 * must not change order data). Order creation calls this same function
 * for its own first pass, then additionally redeems atomically inside
 * its transaction (src/coupons/redeem.ts) - re-checking the global and
 * per-customer limits there too, since availability can change between
 * this read and that write.
 */
export async function validateCoupon(
	dbOrTx: DbOrTx,
	rawCode: string,
	params: { subtotalAmount: number; lines: CouponLine[]; userId: string | null }
): Promise<CouponValidationResult> {
	const code = normalizeCouponCode(rawCode)
	const [coupon] = await dbOrTx.select().from(coupons).where(eq(coupons.code, code)).limit(1)
	if (!coupon) return problem('coupon_not_found')
	if (!coupon.isActive) return problem('coupon_inactive')

	const now = new Date()
	if (coupon.startsAt && coupon.startsAt > now) return problem('coupon_not_started')
	if (coupon.endsAt && coupon.endsAt <= now) return problem('coupon_expired')

	if (coupon.minOrderAmount !== null && params.subtotalAmount < coupon.minOrderAmount) {
		return problem('coupon_below_minimum_order', coupon.minOrderAmount)
	}

	if (coupon.maxTotalUses !== null && coupon.usesCount >= coupon.maxTotalUses) {
		return problem('coupon_usage_limit_reached')
	}

	if (coupon.maxUsesPerCustomer !== null) {
		if (!params.userId) return problem('coupon_requires_account')
		const [{ count }] = await dbOrTx
			.select({ count: sql<number>`count(*)::int` })
			.from(couponRedemptions)
			.where(and(eq(couponRedemptions.couponId, coupon.id), eq(couponRedemptions.userId, params.userId)))
		if (count >= coupon.maxUsesPerCustomer) {
			return problem('coupon_per_customer_limit_reached')
		}
	}

	const [productRows, brandRows, categoryRows] = await Promise.all([
		dbOrTx.select().from(couponProducts).where(eq(couponProducts.couponId, coupon.id)),
		dbOrTx.select().from(couponBrands).where(eq(couponBrands.couponId, coupon.id)),
		dbOrTx.select().from(couponCategories).where(eq(couponCategories.couponId, coupon.id))
	])
	const scope = {
		productIds: new Set(productRows.map(row => row.productId)),
		brandIds: new Set(brandRows.map(row => row.brandId)),
		categoryIds: new Set(categoryRows.map(row => row.categoryId))
	}

	const scopeInfo = await getProductScopeInfo(
		dbOrTx,
		params.lines.map(line => line.productId)
	)
	const eligibleLines = params.lines.filter(line => {
		const info = scopeInfo.get(line.productId) ?? { brandId: null, categoryIds: [] }
		return matchesScope(scope, line.productId, info.brandId, info.categoryIds)
	})

	const eligibleSubtotal = eligibleLines.reduce((sum, line) => sum + line.netAmount, 0)
	if (eligibleLines.length === 0 || eligibleSubtotal <= 0) {
		return problem('coupon_not_applicable')
	}

	const discountAmount = computeCouponDiscount(coupon, eligibleSubtotal)
	return { ok: true, coupon, eligibleSubtotal, discountAmount }
}
