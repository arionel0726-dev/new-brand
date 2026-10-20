import type { orderStatusEnum } from '../db/schema/orders'

export type OrderStatus = (typeof orderStatusEnum.enumValues)[number]

/**
 * The one place that defines which order_status transitions are legal.
 * Every status change in this codebase (order creation's implicit
 * null -> 'pending', and cancelOrder's 'pending' -> 'cancelled') must go
 * through this, rather than writing `status` directly - there is no route
 * that lets a client set order_status to anything at all; this table only
 * exists so the handful of *server-initiated* transitions stay consistent
 * and auditable via order_status_history.
 *
 * Only 'pending' -> 'cancelled' is reachable by the customer themselves in
 * this sprint (Task 8). The rest (confirmed/processing/completed, and
 * cancelling anything past 'pending') are reserved for a future
 * admin/staff workflow this sprint does not implement.
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
	pending: ['confirmed', 'cancelled'],
	confirmed: ['processing', 'cancelled'],
	processing: ['completed', 'cancelled'],
	completed: [],
	cancelled: []
}

export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus): boolean {
	return ORDER_STATUS_TRANSITIONS[from].includes(to)
}
