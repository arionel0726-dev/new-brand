import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthVariables } from '../../auth/middleware'
import { resolveIdentity } from '../../cart/identity'
import { resolveExistingCart } from '../../cart/resolve'
import { buildCheckoutPreview } from '../../checkout/preview'
import { computeShipping, type DeliverySelection } from '../../checkout/shipping'
import { deliverySchema } from '../../checkout/validation'
import { db } from '../../db/client'
import type { CouponLine } from '../../coupons/validate'
import { validateCoupon } from '../../coupons/validate'
import { localeSchema } from '../../lib/locale'
import { ok } from '../../lib/respond'
import { validateJson, validateQuery } from '../../lib/validate'
import { AppError } from '../../middleware/error-handler'

const previewQuerySchema = z.object({ lang: localeSchema.default('ru') })
const shippingQuoteSchema = z.object({ delivery: deliverySchema })
const applyCouponSchema = z.object({ code: z.string().trim().min(1).max(64) })

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

		// Free-shipping thresholds compare against the subtotal *after*
		// applicable (promotion) discounts, per Task 5 - never the raw,
		// pre-discount subtotal. A coupon isn't known at quote time (it's a
		// separate endpoint); order creation recomputes shipping once more
		// against the fully-discounted (promotion + coupon) subtotal.
		const shipping = await computeShipping(db, toSelection(delivery), preview.discountedSubtotal)

		const shippingFee = shipping.ok ? shipping.fee : 0
		const canCheckout = preview.canCheckout && shipping.ok

		return ok(c, {
			deliveryMethod: delivery.method,
			subtotal: preview.subtotal,
			promotionDiscountTotal: preview.promotionDiscountTotal,
			discountedSubtotal: preview.discountedSubtotal,
			shippingFee,
			total: preview.discountedSubtotal + shippingFee,
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
	.post('/apply-coupon', validateQuery(previewQuerySchema), validateJson(applyCouponSchema), async c => {
		const { code } = c.req.valid('json')

		const cart = await resolveExistingCart(c)
		const preview = await buildCheckoutPreview(cart, 'ru')
		if (!cart || preview.items.length === 0) {
			throw new AppError('Your cart is empty', 422, 'cart_empty')
		}

		const identity = await resolveIdentity(c)
		const userId = identity.type === 'user' ? identity.userId : null

		// Only lines that are actually purchasable right now count toward a
		// coupon's eligible subtotal - an archived/out-of-stock line isn't
		// part of what a coupon could ever apply to.
		const lines: CouponLine[] = preview.items
			.filter(item => item.problemCode === null)
			.map(item => ({
				variantId: item.variantId,
				productId: item.productId,
				netAmount: (item.lineTotal ?? 0) - item.promotionDiscountAmount
			}))

		// Read-only (Task 4): never reserves a use or writes anything. Order
		// creation re-validates and actually redeems inside its own
		// transaction - this response is a preview only.
		const result = await validateCoupon(db, code, { subtotalAmount: preview.subtotal, lines, userId })
		if (!result.ok) {
			throw new AppError(result.message, 422, result.code, {
				...(result.minOrderAmount !== undefined ? { minOrderAmount: result.minOrderAmount } : {})
			})
		}

		const discountedSubtotal = preview.discountedSubtotal - result.discountAmount
		return ok(c, {
			code: result.coupon.code,
			discountType: result.coupon.discountType,
			promotionDiscountTotal: preview.promotionDiscountTotal,
			couponDiscountAmount: result.discountAmount,
			subtotal: preview.subtotal,
			discountedSubtotal,
			currency: 'MDL' as const
		})
	})

export type CheckoutRouteType = typeof checkoutRoute
