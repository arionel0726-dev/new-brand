import { getCartItemDetails, type CartItemDetailRow, type CartRow } from '../db/queries/cart'
import { localize, type Locale } from '../lib/locale'

export type CartItemStatus = 'available' | 'out_of_stock' | 'unavailable'

/**
 * The cart table never stores price or stock - this is computed fresh from
 * product_prices/inventory on every read. 'unavailable' covers every reason
 * the line can no longer be bought at all (archived product, disabled
 * variant, deleted price); 'out_of_stock' is a priced, sellable variant
 * that currently can't cover the requested quantity.
 */
function statusFor(row: CartItemDetailRow): CartItemStatus {
	if (row.productStatus !== 'active' || !row.variantIsActive || row.price === null) {
		return 'unavailable'
	}
	const available = (row.quantityOnHand ?? 0) - (row.quantityReserved ?? 0)
	return available >= row.quantity ? 'available' : 'out_of_stock'
}

function serializeItem(row: CartItemDetailRow, lang: Locale) {
	const status = statusFor(row)
	const availableQuantity = Math.max(0, (row.quantityOnHand ?? 0) - (row.quantityReserved ?? 0))
	const unitPrice = status === 'unavailable' ? null : row.price
	const lineTotal = unitPrice === null ? null : unitPrice * row.quantity

	return {
		id: row.id,
		variantId: row.variantId,
		quantity: row.quantity,
		status,
		availableQuantity,
		unitPrice,
		compareAtPrice: status === 'unavailable' ? null : row.compareAtPrice,
		currency: row.currency,
		lineTotal,
		product: {
			id: row.productId,
			slug: row.productSlug,
			name: localize(lang, row.productNameRu, row.productNameRo)
		},
		variant: {
			sku: row.variantSku,
			name: localize(lang, row.variantNameRu, row.variantNameRo)
		},
		createdAt: row.createdAt
	}
}

export async function serializeCart(cart: CartRow, lang: Locale) {
	const rows = await getCartItemDetails(cart.id)
	const items = rows.map(row => serializeItem(row, lang))
	// Only lines with a real, current price contribute - never a client-
	// supplied or stale/cached amount.
	const subtotal = items.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0)

	return {
		id: cart.id,
		status: cart.status,
		items,
		itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
		subtotal,
		currency: 'MDL' as const,
		updatedAt: cart.updatedAt
	}
}

/** The conceptual empty cart for a caller who has no cart row at all yet - used by DELETE /cart so clearing never has to create one first. */
export function emptyCartView() {
	return {
		id: null as string | null,
		status: 'active' as const,
		items: [] as ReturnType<typeof serializeItem>[],
		itemCount: 0,
		subtotal: 0,
		currency: 'MDL' as const,
		updatedAt: null as Date | null
	}
}
