import type { Context } from 'hono'
import { auth } from '../auth/config'
import { getOrderById, verifyOrderAccessToken, type OrderRow } from '../db/queries/orders'
import { AppError } from '../middleware/error-handler'
import { ORDER_ACCESS_TOKEN_HEADER } from './constants'

export type OrderAccess = { order: OrderRow; actorUserId: string | null }

/**
 * The only two ways into an order: the matching authenticated session, or
 * (for a guest order) the exact bearer token from X-Order-Access-Token.
 * Never email, phone, or order_number - and a wrong guess of any kind
 * gets the identical 404 a nonexistent order id would, so a client can't
 * use the response to tell "no such order" apart from "not yours".
 */
export async function resolveOrderAccessOrThrow(c: Context, orderId: string): Promise<OrderAccess> {
	const order = await getOrderById(orderId)
	if (!order) {
		throw new AppError('Order not found', 404, 'order_not_found')
	}

	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (session) {
		if (order.userId === session.user.id) {
			return { order, actorUserId: session.user.id }
		}
	} else if (order.userId === null) {
		const token = c.req.header(ORDER_ACCESS_TOKEN_HEADER)
		if (token && (await verifyOrderAccessToken(order.id, token))) {
			return { order, actorUserId: null }
		}
	}

	throw new AppError('Order not found', 404, 'order_not_found')
}
