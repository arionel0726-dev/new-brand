import { db } from '../db/client'
import { getCheckoutLines, type CheckoutLine } from '../db/queries/orders'
import type { CartRow } from '../db/queries/cart'
import { localize, type Locale } from '../lib/locale'

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

function serializeLine(line: CheckoutLine, lang: Locale) {
	const problemCode = classify(line)
	const availableQuantity = Math.max(0, (line.quantityOnHand ?? 0) - (line.quantityReserved ?? 0))

	return {
		variantId: line.variantId,
		productId: line.productId,
		productName: localize(lang, line.productNameRu, line.productNameRo),
		variantName: localize(lang, line.variantNameRu, line.variantNameRo),
		sku: line.variantSku,
		quantity: line.quantity,
		unitPrice: problemCode ? null : line.price,
		lineTotal: problemCode ? null : (line.price as number) * line.quantity,
		availableQuantity,
		available: problemCode === null,
		problemCode
	}
}

export type CheckoutPreview = {
	items: ReturnType<typeof serializeLine>[]
	subtotal: number
	currency: 'MDL'
	available: boolean
	canCheckout: boolean
	problems: PreviewProblem[]
	shippingNote: string
}

/**
 * Read-only: never creates an order, never touches inventory.quantity_reserved.
 * Every price and availability figure here is recomputed from the catalog
 * right now - nothing from the client, and nothing cached from an earlier
 * GET /cart response is treated as final.
 */
export async function buildCheckoutPreview(cart: CartRow | null, lang: Locale): Promise<CheckoutPreview> {
	const lines = cart ? await getCheckoutLines(db, cart.id) : []
	const items = lines.map(line => serializeLine(line, lang))

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
	const canCheckout = items.length > 0 && problems.length === 0

	return {
		items,
		subtotal,
		currency: 'MDL',
		available: problems.length === 0,
		canCheckout,
		problems,
		// Delivery/promo pricing doesn't exist yet (Sprint 7+) - this is never
		// the final payable total, and callers must not present it as one.
		shippingNote: 'Shipping cost is not yet calculated. This subtotal does not include delivery.'
	}
}
