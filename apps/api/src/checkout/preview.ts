import { db } from '../db/client'
import { getCheckoutLines, type CheckoutLine } from '../db/queries/orders'
import type { CartRow } from '../db/queries/cart'
import { localize, type Locale } from '../lib/locale'
import { computePromotionDiscounts, type LineDiscount } from '../promotions/pricing'

export type PreviewProblemCode = 'product_unavailable' | 'variant_inactive' | 'price_missing' | 'insufficient_stock'

export type PreviewProblem = {
	variantId: string
	productId: string
	code: PreviewProblemCode
	message: string
	availableQuantity?: number
}

function classify(line: CheckoutLine): PreviewProblemCode | null {
	if (line.productStatus !== 'active') return 'product_unavailable'
	if (!line.variantIsActive) return 'variant_inactive'
	if (line.price === null) return 'price_missing'
	const available = (line.quantityOnHand ?? 0) - (line.quantityReserved ?? 0)
	if (available < line.quantity) return 'insufficient_stock'
	return null
}

const PROBLEM_MESSAGES: Record<PreviewProblemCode, string> = {
	product_unavailable: 'This product is no longer published.',
	variant_inactive: 'This variant has been disabled.',
	price_missing: 'This variant currently has no price set.',
	insufficient_stock: 'There is not enough stock available for the requested quantity.'
}

function serializeLine(line: CheckoutLine, lang: Locale, discount: LineDiscount | undefined) {
	const problemCode = classify(line)
	const availableQuantity = Math.max(0, (line.quantityOnHand ?? 0) - (line.quantityReserved ?? 0))
	const lineTotal = problemCode ? null : (line.price as number) * line.quantity
	// A blocked line (archived/inactive/no price/out of stock) never shows a
	// promotion discount - there is nothing purchasable to discount.
	const promotionDiscountAmount = problemCode ? 0 : (discount?.discountAmount ?? 0)

	return {
		variantId: line.variantId,
		productId: line.productId,
		productName: localize(lang, line.productNameRu, line.productNameRo),
		variantName: localize(lang, line.variantNameRu, line.variantNameRo),
		sku: line.variantSku,
		quantity: line.quantity,
		unitPrice: problemCode ? null : line.price,
		lineTotal,
		promotionId: problemCode ? null : (discount?.promotionId ?? null),
		promotionDiscountAmount,
		netLineTotal: lineTotal === null ? null : lineTotal - promotionDiscountAmount,
		availableQuantity,
		available: problemCode === null,
		problemCode
	}
}

export type CheckoutPreview = {
	items: ReturnType<typeof serializeLine>[]
	subtotal: number
	promotionDiscountTotal: number
	discountedSubtotal: number
	currency: 'MDL'
	available: boolean
	canCheckout: boolean
	problems: PreviewProblem[]
	shippingNote: string
}

/**
 * Read-only: never creates an order, never touches inventory.quantity_reserved,
 * and never claims a promotion's redemption limit (that only ever happens
 * inside order creation's own transaction). Every price and availability
 * figure here is recomputed from the catalog right now - nothing from the
 * client, and nothing cached from an earlier GET /cart response is
 * treated as final.
 *
 * `subtotal` is the original, pre-discount sum (unchanged meaning from
 * Sprint 6/7, for backward compatibility); `discountedSubtotal` is what
 * promotions alone bring it down to - still before any coupon, which is
 * a separate, explicit step (POST /checkout/apply-coupon).
 */
export async function buildCheckoutPreview(cart: CartRow | null, lang: Locale): Promise<CheckoutPreview> {
	const lines = cart ? await getCheckoutLines(db, cart.id) : []
	const discounts = await computePromotionDiscounts(
		db,
		lines.map(line => ({
			variantId: line.variantId,
			productId: line.productId,
			unitPrice: line.price ?? 0,
			quantity: line.quantity
		}))
	)
	const items = lines.map(line => serializeLine(line, lang, discounts.get(line.variantId)))

	const problems: PreviewProblem[] = []
	for (const item of items) {
		if (!item.problemCode) continue
		problems.push({
			variantId: item.variantId,
			productId: item.productId,
			code: item.problemCode,
			message: PROBLEM_MESSAGES[item.problemCode],
			...(item.problemCode === 'insufficient_stock' ? { availableQuantity: item.availableQuantity } : {})
		})
	}

	const subtotal = items.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0)
	const promotionDiscountTotal = items.reduce((sum, item) => sum + item.promotionDiscountAmount, 0)
	const canCheckout = items.length > 0 && problems.length === 0

	return {
		items,
		subtotal,
		promotionDiscountTotal,
		discountedSubtotal: subtotal - promotionDiscountTotal,
		currency: 'MDL',
		available: problems.length === 0,
		canCheckout,
		problems,
		// Delivery pricing and any coupon are still not reflected here - this
		// is never the final payable total, and callers must not present it
		// as one.
		shippingNote: 'Shipping cost is not yet calculated. This subtotal does not include delivery.'
	}
}
