import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthVariables } from '../../auth/middleware'
import { buildCheckoutPreview } from '../../checkout/preview'
import { computeShipping, type DeliverySelection } from '../../checkout/shipping'
import { deliverySchema } from '../../checkout/validation'
import { resolveExistingCart } from '../../cart/resolve'
import { db } from '../../db/client'
import { localeSchema } from '../../lib/locale'
import { ok } from '../../lib/respond'
import { validateJson, validateQuery } from '../../lib/validate'

const previewQuerySchema = z.object({ lang: localeSchema.default('ru') })
const shippingQuoteSchema = z.object({ delivery: deliverySchema })

function toSelection(delivery: z.infer<typeof deliverySchema>): DeliverySelection {
	return delivery.method === 'pickup'
		? { method: 'pickup', pickupLocationId: delivery.pickupLocationId }
		: { method: 'courier', deliveryZoneId: delivery.deliveryZoneId }
}

export const checkoutRoute = new Hono<{ Variables: AuthVariables }>()
	.post('/preview', validateQuery(previewQuerySchema), async c => {
		const { lang } = c.req.valid('query')
		const cart = await resolveExistingCart(c)
		const preview = await buildCheckoutPreview(cart, lang)
		return ok(c, preview)
	})
	.post('/shipping-quote', validateQuery(previewQuerySchema), validateJson(shippingQuoteSchema), async c => {
		const { lang } = c.req.valid('query')
		const { delivery } = c.req.valid('json')

		const cart = await resolveExistingCart(c)
		const preview = await buildCheckoutPreview(cart, lang)

		// The cart itself might already be unsellable/empty/out of stock -
		// that's reported via `problems` same as /preview, and canCheckout
		// stays false; shipping is still computed below so the client can
		// show "this zone/location is also invalid" in the same response.
		const shipping = await computeShipping(db, toSelection(delivery), preview.subtotal)

		const shippingFee = shipping.ok ? shipping.fee : 0
		const canCheckout = preview.canCheckout && shipping.ok

		return ok(c, {
			deliveryMethod: delivery.method,
			subtotal: preview.subtotal,
			shippingFee,
			total: preview.subtotal + shippingFee,
			currency: 'MDL' as const,
			available: canCheckout,
			canCheckout,
			problems: [
				...preview.problems,
				...(shipping.ok
					? []
					: [{ code: shipping.code, message: shipping.message, minOrderAmount: shipping.minOrderAmount }])
			]
		})
	})

export type CheckoutRouteType = typeof checkoutRoute
