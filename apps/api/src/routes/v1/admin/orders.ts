import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthVariables } from '../../../auth/middleware'
import {
	adminCancelOrder,
	completeOrder,
	listOrdersAdmin,
	transitionOrderStatus
} from '../../../db/queries/admin-orders'
import {
	getOrderById,
	getOrderItemsForOrder,
	getOrderStatusHistoryForOrder
} from '../../../db/queries/orders'
import { getPaymentsForOrder, transitionPaymentStatus } from '../../../db/queries/payments'
import { serializeOrder } from '../../../orders/serialize'
import { localeSchema } from '../../../lib/locale'
import { buildPageMeta, paginationSchema } from '../../../lib/pagination'
import { okWithMeta, ok } from '../../../lib/respond'
import { idParamSchema, validateJson, validateParam, validateQuery } from '../../../lib/validate'
import { AppError } from '../../../middleware/error-handler'

const listQuerySchema = paginationSchema.extend({
	lang: localeSchema.default('ru'),
	status: z.enum(['pending', 'confirmed', 'processing', 'completed', 'cancelled']).optional(),
	deliveryMethod: z.enum(['pickup', 'courier']).optional()
})
const detailQuerySchema = z.object({ lang: localeSchema.default('ru') })
const reasonSchema = z.object({ reason: z.string().trim().max(500).optional() })
const transitionSchema = z.object({
	toStatus: z.enum(['confirmed', 'processing']),
	reason: z.string().trim().max(500).optional()
})
const paymentIdParamSchema = z.object({ id: z.uuid(), paymentId: z.uuid() })
const paymentTransitionSchema = z.object({
	toStatus: z.enum(['requires_action', 'paid', 'failed', 'cancelled', 'refunded', 'partially_refunded']),
	reason: z.string().trim().min(1).max(500),
	// Required (and only meaningful) for partially_refunded - the running
	// total refunded so far, enforced by payments' own check constraint too.
	refundedAmount: z.number().int().min(0).optional()
})

async function loadOrderDetail(orderId: string, lang: 'ru' | 'ro') {
	const order = await getOrderById(orderId)
	if (!order) throw new AppError('Order not found', 404, 'order_not_found')
	const [items, history, payments] = await Promise.all([
		getOrderItemsForOrder(order.id),
		getOrderStatusHistoryForOrder(order.id),
		getPaymentsForOrder(order.id)
	])
	return { ...serializeOrder(order, items, lang, payments), statusHistory: history }
}

export const adminOrdersRoute = new Hono<{ Variables: AuthVariables }>()
	.get('/', validateQuery(listQuerySchema), async c => {
		const query = c.req.valid('query')
		const { items, total } = await listOrdersAdmin(
			{ page: query.page, limit: query.limit },
			{ status: query.status, deliveryMethod: query.deliveryMethod }
		)
		const data = items.map(order => serializeOrder(order, undefined, query.lang))
		return okWithMeta(c, data, buildPageMeta({ page: query.page, limit: query.limit }, total))
	})
	.get('/:id', validateParam(idParamSchema), validateQuery(detailQuerySchema), async c => {
		const { id } = c.req.valid('param')
		const { lang } = c.req.valid('query')
		return ok(c, await loadOrderDetail(id, lang))
	})
	.post('/:id/transition', validateParam(idParamSchema), validateJson(transitionSchema), async c => {
		const { id } = c.req.valid('param')
		const { toStatus, reason } = c.req.valid('json')
		const staff = c.get('user')

		await transitionOrderStatus(id, toStatus, staff.id, reason ?? `Marked ${toStatus} by staff`)
		return ok(c, await loadOrderDetail(id, 'ru'))
	})
	.post('/:id/cancel', validateParam(idParamSchema), validateJson(reasonSchema), async c => {
		const { id } = c.req.valid('param')
		const { reason } = c.req.valid('json')
		const staff = c.get('user')

		await adminCancelOrder(id, staff.id, reason ?? 'Cancelled by staff')
		return ok(c, await loadOrderDetail(id, 'ru'))
	})
	.post('/:id/complete', validateParam(idParamSchema), validateJson(reasonSchema), async c => {
		const { id } = c.req.valid('param')
		const { reason } = c.req.valid('json')
		const staff = c.get('user')

		await completeOrder(id, staff.id, reason ?? 'Fulfillment completed by staff')
		return ok(c, await loadOrderDetail(id, 'ru'))
	})
	.post(
		'/:id/payments/:paymentId/transition',
		validateParam(paymentIdParamSchema),
		validateJson(paymentTransitionSchema),
		async c => {
			const { id, paymentId } = c.req.valid('param')
			const { toStatus, reason, refundedAmount } = c.req.valid('json')
			const staff = c.get('user')

			const order = await getOrderById(id)
			if (!order) throw new AppError('Order not found', 404, 'order_not_found')

			const payments = await getPaymentsForOrder(id)
			if (!payments.some(payment => payment.id === paymentId)) {
				throw new AppError('Payment not found on this order', 404, 'payment_not_found')
			}

			// A trusted, audited staff action - never something a customer or
			// an unverified provider event can trigger (Task 4/Task 6). This is
			// bookkeeping only: it never moves real money.
			await transitionPaymentStatus(paymentId, toStatus, staff.id, reason, { refundedAmount })
			return ok(c, await loadOrderDetail(id, 'ru'))
		}
	)

export type AdminOrdersRouteType = typeof adminOrdersRoute
