import { and, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import type { DbOrTx, Tx } from '../db/tx'
import {
	promotionBrands,
	promotionCategories,
	promotionExcludedProducts,
	promotionProducts,
	promotions
} from '../db/schema/promotions'
import { getProductScopeInfo } from './scope'
import { matchesScope } from './scope-match'

export type PromotionRow = typeof promotions.$inferSelect

export type PricingLine = {
	variantId: string
	productId: string
	unitPrice: number
	quantity: number
}

export type LineDiscount = {
	variantId: string
	promotionId: string | null
	discountAmount: number
}

/**
 * Deterministic pricing order (Task 1):
 *   1. product_prices.price is the only base price - never touched here.
 *   2. compare_at_price is reference-only, never an automatic discount.
 *   3. At most one promotion applies per line - never stacked (Task 2).
 *      Among every active, date-valid, scope-matching, not-excluded,
 *      not-at-its-redemption-limit promotion, the winner is chosen by:
 *        a. highest `priority` (admin-set)
 *        b. then the larger computed discount (more favorable to the
 *           customer, since priority alone may tie)
 *        c. then older `createdAt`
 *        d. then lower `id` (final, fully deterministic tiebreak)
 *   4. A coupon (if any) is applied after promotions - see
 *      src/coupons/apply.ts - against the post-promotion subtotal.
 *
 * Rounding: percentage discounts round to the nearest whole bano
 * (Math.round - ties round up), since bani are the smallest unit and
 * there is nothing smaller to carry a remainder into.
 */
function computeLineDiscountAmount(promotion: PromotionRow, unitPrice: number, quantity: number): number {
	const lineTotal = unitPrice * quantity
	let discount: number
	if (promotion.discountType === 'percentage') {
		discount = Math.round((lineTotal * (promotion.percentageValue ?? 0)) / 100)
	} else {
		discount = (promotion.fixedAmount ?? 0) * quantity
	}
	if (promotion.maxDiscountAmount !== null) {
		discount = Math.min(discount, promotion.maxDiscountAmount)
	}
	// Never reduces a line below zero (Task 2).
	return Math.max(0, Math.min(discount, lineTotal))
}

type PromotionScope = {
	productIds: Set<string>
	brandIds: Set<string>
	categoryIds: Set<string>
	excludedProductIds: Set<string>
}

async function loadActivePromotionsWithScope(
	dbOrTx: DbOrTx
): Promise<{ promotion: PromotionRow; scope: PromotionScope }[]> {
	const now = new Date()
	const activePromotions = await dbOrTx
		.select()
		.from(promotions)
		.where(
			and(
				eq(promotions.isActive, true),
				or(isNull(promotions.startsAt), lte(promotions.startsAt, now)),
				or(isNull(promotions.endsAt), gt(promotions.endsAt, now)),
				or(isNull(promotions.maxTotalRedemptions), sql`${promotions.redemptionCount} < ${promotions.maxTotalRedemptions}`)
			)
		)

	if (activePromotions.length === 0) return []
	const ids = activePromotions.map(p => p.id)

	const [productRows, brandRows, categoryRows, excludedRows] = await Promise.all([
		dbOrTx.select().from(promotionProducts).where(inArray(promotionProducts.promotionId, ids)),
		dbOrTx.select().from(promotionBrands).where(inArray(promotionBrands.promotionId, ids)),
		dbOrTx.select().from(promotionCategories).where(inArray(promotionCategories.promotionId, ids)),
		dbOrTx.select().from(promotionExcludedProducts).where(inArray(promotionExcludedProducts.promotionId, ids))
	])

	const scopeFor = new Map<string, PromotionScope>()
	for (const id of ids) {
		scopeFor.set(id, {
			productIds: new Set(),
			brandIds: new Set(),
			categoryIds: new Set(),
			excludedProductIds: new Set()
		})
	}
	for (const row of productRows) scopeFor.get(row.promotionId)?.productIds.add(row.productId)
	for (const row of brandRows) scopeFor.get(row.promotionId)?.brandIds.add(row.brandId)
	for (const row of categoryRows) scopeFor.get(row.promotionId)?.categoryIds.add(row.categoryId)
	for (const row of excludedRows) scopeFor.get(row.promotionId)?.excludedProductIds.add(row.productId)

	return activePromotions.map(promotion => ({ promotion, scope: scopeFor.get(promotion.id)! }))
}

function isEligible(
	scope: PromotionScope,
	productId: string,
	brandId: string | null,
	categoryIds: string[]
): boolean {
	if (scope.excludedProductIds.has(productId)) return false
	return matchesScope(scope, productId, brandId, categoryIds)
}

/**
 * Picks (at most) one winning promotion per line and computes its
 * discount - read-only, makes no database writes. Used by both the
 * checkout preview and (inside its own transaction) order creation; the
 * caller is responsible for atomically incrementing redemptionCount for
 * whichever promotions actually get used (see incrementPromotionRedemption)
 * and must re-check availability there too, since this function doesn't
 * lock anything.
 */
export async function computePromotionDiscounts(
	dbOrTx: DbOrTx,
	lines: PricingLine[]
): Promise<Map<string, LineDiscount>> {
	const result = new Map<string, LineDiscount>()
	for (const line of lines) {
		result.set(line.variantId, { variantId: line.variantId, promotionId: null, discountAmount: 0 })
	}
	if (lines.length === 0) return result

	const [candidates, scopeInfo] = await Promise.all([
		loadActivePromotionsWithScope(dbOrTx),
		getProductScopeInfo(
			dbOrTx,
			lines.map(line => line.productId)
		)
	])
	if (candidates.length === 0) return result

	for (const line of lines) {
		const productScope = scopeInfo.get(line.productId) ?? { brandId: null, categoryIds: [] }
		const eligible = candidates.filter(candidate =>
			isEligible(candidate.scope, line.productId, productScope.brandId, productScope.categoryIds)
		)
		if (eligible.length === 0) continue

		const withDiscounts = eligible.map(candidate => ({
			candidate,
			discountAmount: computeLineDiscountAmount(candidate.promotion, line.unitPrice, line.quantity)
		}))

		withDiscounts.sort((a, b) => {
			if (a.candidate.promotion.priority !== b.candidate.promotion.priority) {
				return b.candidate.promotion.priority - a.candidate.promotion.priority
			}
			if (a.discountAmount !== b.discountAmount) {
				return b.discountAmount - a.discountAmount
			}
			if (a.candidate.promotion.createdAt.getTime() !== b.candidate.promotion.createdAt.getTime()) {
				return a.candidate.promotion.createdAt.getTime() - b.candidate.promotion.createdAt.getTime()
			}
			return a.candidate.promotion.id.localeCompare(b.candidate.promotion.id)
		})

		const winner = withDiscounts[0]
		if (winner.discountAmount > 0) {
			result.set(line.variantId, {
				variantId: line.variantId,
				promotionId: winner.candidate.promotion.id,
				discountAmount: winner.discountAmount
			})
		}
	}

	return result
}

/**
 * Atomically claims one use of a promotion's redemption limit - the same
 * conditional-UPDATE pattern every other limited counter in this codebase
 * uses. Returns false if the promotion is at its limit (a concurrent
 * order got there first, or it was exhausted between the read-only
 * computePromotionDiscounts call and now) - the caller's policy (see
 * createOrderFromCart) is to simply not apply that line's discount rather
 * than fail the whole checkout.
 */
export async function incrementPromotionRedemption(tx: Tx, promotionId: string): Promise<boolean> {
	const [row] = await tx
		.update(promotions)
		.set({ redemptionCount: sql`${promotions.redemptionCount} + 1`, updatedAt: new Date() })
		.where(
			and(
				eq(promotions.id, promotionId),
				or(isNull(promotions.maxTotalRedemptions), sql`${promotions.redemptionCount} < ${promotions.maxTotalRedemptions}`)
			)
		)
		.returning({ id: promotions.id })
	return row !== undefined
}
