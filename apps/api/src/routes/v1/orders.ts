import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthVariables } from '../../auth/middleware'
import { requireAuth } from '../../auth/middleware'
import { hashGuestToken, resolveIdentity, clearGuestCartCookie } from '../../cart/identity'
import { deliverySchema, paymentMethodSchema } from '../../checkout/validation'
import {
	cancelPendingOrder,
	createOrderFromCart,
	getOrderItemsForOrder,
	listOrdersForUser,
	type CartOwnerIdentity,
	type DeliveryInput
} from '../../db/queries/orders'
import { getPaymentsForOrder } from '../../db/queries/payments'
import { InsufficientStockError } from '../../orders/inventory'
import { resolveOrderAccessOrThrow } from '../../orders/access'
import { IDEMPOTENCY_KEY_HEADER } from '../../orders/constants'
import { normalizeMoldovanPhone } from '../../orders/phone'
import { serializeOrder } from '../../orders/serialize'
import { isOnlinePaymentsConfigured } from '../../payments/provider'
import { localeSchema } from '../../lib/locale'
import { clientIpFor, createRateLimiter } from '../../middleware/rate-limit'
import { buildPageMeta, paginationSchema } from '../../lib/pagination'
import { okWithMeta, ok } from '../../lib/respond'
import { idParamSchema, validateJson, validateParam, validateQuery } from '../../lib/validate'
import { AppError } from '../../middleware/error-handler'

const createOrderSchema = z.object({
	customerName: z.string().trim().min(1).max(200),
	customerEmail: z.string().trim().toLowerCase().email().max(254),
	customerPhone: z.string().trim().min(1).max(32),
	customerNote: z.string().trim().max(1000).nullable().optional(),
	delivery: deliverySchema,
	paymentMethod: paymentMethodSchema
})

const listQuerySchema = paginationSchema.extend({ lang: localeSchema.default('ru') })
const detailQuerySchema = z.object({ lang: localeSchema.default('ru') })
const cancelSchema = z.object({ reason: z.string().trim().max(500).optional() })

function hashRequestPayload(payload: unknown): string {
	return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

/** 20 order attempts per 10 minutes per IP - generous for a real shopper, enough friction to blunt scripted abuse of the guest checkout. See src/middleware/rate-limit.ts for why this is in-memory, not Redis-backed. */
const orderCreationRateLimit = createRateLimiter({
	windowMs: 10 * 60 * 1000,
	max: 20,
	keyFor: clientIpFor
})

export const ordersRoute = new Hono<{ Variables: AuthVariables }>()
	.post('/', orderCreationRateLimit, validateQuery(detailQuerySchema), validateJson(createOrderSchema), async c => {
		const { lang } = c.req.valid('query')
		const body = c.req.valid('json')

		const idempotencyKey = c.req.header(IDEMPOTENCY_KEY_HEADER)
		if (!idempotencyKey || idempotencyKey.length > 200) {
			throw new AppError(
				`The ${IDEMPOTENCY_KEY_HEADER} header is required and must be at most 200 characters`,
				400,
				'idempotency_key_required'
			)
		}

		const normalizedPhone = normalizeMoldovanPhone(body.customerPhone)
		if (!normalizedPhone) {
			throw new AppError('Please provide a valid Moldovan phone number', 400, 'invalid_phone')
		}

		// Rejected here too (not just inside createOrderFromCart) so a bad
		// request never even reaches the cart lock/reservation work - online
		// payment is unavailable until a real provider exists (Task 4).
		if (body.paymentMethod === 'online' && !isOnlinePaymentsConfigured()) {
			throw new AppError('Online payment is not currently available', 422, 'online_payment_unavailable')
		}

		let delivery: DeliveryInput
		if (body.delivery.method === 'pickup') {
			delivery = { method: 'pickup', pickupLocationId: body.delivery.pickupLocationId }
		} else {
			const normalizedRecipientPhone = normalizeMoldovanPhone(body.delivery.recipientPhone)
			if (!normalizedRecipientPhone) {
				throw new AppError('Please provide a valid Moldovan recipient phone number', 400, 'invalid_phone')
			}
			delivery = {
				method: 'courier',
				deliveryZoneId: body.delivery.deliveryZoneId,
				recipientName: body.delivery.recipientName,
				recipientPhone: normalizedRecipientPhone,
				city: body.delivery.city,
				street: body.delivery.street,
				house: body.delivery.house,
				apartment: body.delivery.apartment ?? null,
				notes: body.delivery.notes ?? null
			}
		}

		const identity = await resolveIdentity(c)
		let cartOwner: CartOwnerIdentity
		let identityKey: string
		if (identity.type === 'user') {
			cartOwner = { type: 'user', userId: identity.userId }
			identityKey = `user:${identity.userId}`
		} else {
			if (!identity.token) {
				throw new AppError('Your cart is empty', 422, 'cart_empty')
			}
			const guestTokenHash = hashGuestToken(identity.token)
			cartOwner = { type: 'guest', guestTokenHash }
			identityKey = `guest:${guestTokenHash}`
		}

		const customer = {
			name: body.customerName,
			email: body.customerEmail,
			phone: normalizedPhone,
			note: body.customerNote ?? null
		}
		// Includes delivery and paymentMethod (Task 3): a replay of the same
		// Idempotency-Key with a different delivery/payment selection must be
		// a conflict, not a silent reuse of the original choice.
		const requestHash = hashRequestPayload({ customer, delivery, paymentMethod: body.paymentMethod })

		let result: Awaited<ReturnType<typeof createOrderFromCart>>
		try {
			result = await createOrderFromCart({
				identityKey,
				idempotencyKey,
				requestHash,
				cartOwner,
				customer,
				delivery,
				paymentMethod: body.paymentMethod
			})
		} catch (error) {
			if (error instanceof InsufficientStockError) {
				throw new AppError('Insufficient stock for one or more items', 409, 'insufficient_stock', {
					variantId: error.variantId
				})
			}
			throw error
		}

		const items = await getOrderItemsForOrder(result.order.id)
		const orderPayments = await getPaymentsForOrder(result.order.id)
		const payload = {
			...serializeOrder(result.order, items, lang, orderPayments),
			// The *only* time the raw guest access token is ever returned - only
			// its hash is stored, so if this response is lost there is no
			// unauthenticated recovery path (by design - see Task 7).
			accessToken: result.outcome === 'created' ? result.accessToken : null,
			replayed: result.outcome === 'replayed'
		}

		if (result.outcome === 'created' && cartOwner.type === 'guest') {
			clearGuestCartCookie(c)
		}

		return ok(c, payload, result.outcome === 'created' ? 201 : 200)
	})
	.get('/', requireAuth, validateQuery(listQuerySchema), async c => {
		const query = c.req.valid('query')
		const user = c.get('user')

		const { items, total } = await listOrdersForUser(user.id, { page: query.page, limit: query.limit })
		const data = items.map(order => serializeOrder(order, undefined, query.lang))

		return okWithMeta(c, data, buildPageMeta({ page: query.page, limit: query.limit }, total))
	})
	.get('/:id', validateParam(idParamSchema), validateQuery(detailQuerySchema), async c => {
		const { id } = c.req.valid('param')
		const { lang } = c.req.valid('query')

		const { order } = await resolveOrderAccessOrThrow(c, id)
		const items = await getOrderItemsForOrder(order.id)
		const orderPayments = await getPaymentsForOrder(order.id)

		return ok(c, serializeOrder(order, items, lang, orderPayments))
	})
	.post('/:id/cancel', validateParam(idParamSchema), validateJson(cancelSchema), async c => {
		const { id } = c.req.valid('param')
		const { reason } = c.req.valid('json')

		const { actorUserId } = await resolveOrderAccessOrThrow(c, id)
		const cancelled = await cancelPendingOrder(id, actorUserId, reason ?? 'Cancelled by customer')
		const items = await getOrderItemsForOrder(cancelled.id)
		const orderPayments = await getPaymentsForOrder(cancelled.id)

		return ok(c, serializeOrder(cancelled, items, 'ru', orderPayments))
	})

export type OrdersRouteType = typeof ordersRoute
