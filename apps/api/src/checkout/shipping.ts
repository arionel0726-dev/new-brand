import { and, eq } from 'drizzle-orm'
import type { DbOrTx } from '../db/tx'
import { deliveryZones, pickupLocations } from '../db/schema/delivery'

type DeliveryZoneRow = typeof deliveryZones.$inferSelect
type PickupLocationRow = typeof pickupLocations.$inferSelect

export type DeliverySelection =
	| { method: 'pickup'; pickupLocationId: string }
	| { method: 'courier'; deliveryZoneId: string }

export type ShippingProblemCode =
	| 'pickup_location_not_found'
	| 'pickup_location_inactive'
	| 'delivery_zone_not_found'
	| 'delivery_zone_inactive'
	| 'below_minimum_order'

export type ShippingResult =
	| { ok: true; method: 'pickup'; fee: number; pickupLocation: PickupLocationRow }
	| { ok: true; method: 'courier'; fee: number; zone: DeliveryZoneRow }
	| { ok: false; code: ShippingProblemCode; message: string; minOrderAmount?: number }

const SHIPPING_PROBLEM_MESSAGES: Record<ShippingProblemCode, string> = {
	pickup_location_not_found: 'This pickup location does not exist.',
	pickup_location_inactive: 'This pickup location is no longer available.',
	delivery_zone_not_found: 'This delivery zone does not exist.',
	delivery_zone_inactive: 'This delivery zone is no longer available.',
	below_minimum_order: 'Your order subtotal is below this zone\'s minimum order amount.'
}

function problem(code: ShippingProblemCode, minOrderAmount?: number): ShippingResult {
	return { ok: false, code, message: SHIPPING_PROBLEM_MESSAGES[code], ...(minOrderAmount !== undefined ? { minOrderAmount } : {}) }
}

/**
 * The one place shipping fee is computed - used identically by the
 * read-only POST /checkout/shipping-quote and by order creation inside
 * its own transaction (Task 3: a prior quote is never authoritative, so
 * order creation calls this again itself rather than trusting a client-
 * supplied fee). `subtotalAmount` must already be server-computed (e.g.
 * from getCheckoutLines) - never taken from the client.
 */
export async function computeShipping(
	dbOrTx: DbOrTx,
	selection: DeliverySelection,
	subtotalAmount: number
): Promise<ShippingResult> {
	if (selection.method === 'pickup') {
		const [location] = await dbOrTx
			.select()
			.from(pickupLocations)
			.where(eq(pickupLocations.id, selection.pickupLocationId))
			.limit(1)
		if (!location) return problem('pickup_location_not_found')
		if (!location.isActive) return problem('pickup_location_inactive')
		// Pickup is always free - the customer collects it themselves.
		return { ok: true, method: 'pickup', fee: 0, pickupLocation: location }
	}

	const [zone] = await dbOrTx
		.select()
		.from(deliveryZones)
		.where(and(eq(deliveryZones.id, selection.deliveryZoneId)))
		.limit(1)
	if (!zone) return problem('delivery_zone_not_found')
	if (!zone.isActive) return problem('delivery_zone_inactive')
	if (zone.minOrderAmount !== null && subtotalAmount < zone.minOrderAmount) {
		return problem('below_minimum_order', zone.minOrderAmount)
	}

	const fee = zone.freeThresholdAmount !== null && subtotalAmount >= zone.freeThresholdAmount ? 0 : zone.feeAmount
	return { ok: true, method: 'courier', fee, zone }
}
