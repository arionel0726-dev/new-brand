import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../client'
import { commitOrderInventory, releaseOrderInventory } from '../../orders/inventory'
import { canTransitionOrderStatus, type OrderStatus } from '../../orders/status'
import { AppError } from '../../middleware/error-handler'
import type { Pagination } from '../../lib/pagination'
import { orderStatusHistory, orders } from '../schema/orders'
import type { OrderRow } from './orders'

export type AdminOrderListFilters = {
	status?: OrderStatus
	deliveryMethod?: 'pickup' | 'courier'
}

function buildAdminOrderFilters(filters: AdminOrderListFilters) {
	const conditions = []
	if (filters.status) conditions.push(eq(orders.status, filters.status))
	if (filters.deliveryMethod) conditions.push(eq(orders.deliveryMethod, filters.deliveryMethod))
	return conditions.length > 0 ? and(...conditions) : undefined
}

export async function listOrdersAdmin(
	pagination: Pagination,
	filters: AdminOrderListFilters
): Promise<{ items: OrderRow[]; total: number }> {
	const where = buildAdminOrderFilters(filters)

	const [items, totalRows] = await Promise.all([
		db
			.select()
			.from(orders)
			.where(where)
			.orderBy(desc(orders.createdAt), desc(orders.id))
			.limit(pagination.limit)
			.offset((pagination.page - 1) * pagination.limit),
		db.select({ count: sql<number>`count(*)::int` }).from(orders).where(where)
	])

	return { items, total: totalRows[0]?.count ?? 0 }
}

/**
 * The one place every staff-initiated order_status change goes through -
 * a SELECT ... FOR UPDATE to learn and lock the current status, a
 * centralized legality check (src/orders/status.ts), then a conditional
 * UPDATE keyed on that exact status so a second concurrent call (e.g. two
 * staff clicking "complete" at once) can't both succeed. `sideEffect` runs
 * *inside* the same transaction, right before the history row is written,
 * so release/commit and the status change always commit or roll back
 * together - never one without the other.
 */
async function performOrderTransition(
	orderId: string,
	toStatus: OrderStatus,
	actorUserId: string,
	reason: string,
	sideEffect?: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<void>
): Promise<OrderRow> {
	return db.transaction(async tx => {
		const [current] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update').limit(1)
		if (!current) {
			throw new AppError('Order not found', 404, 'order_not_found')
		}
		if (!canTransitionOrderStatus(current.status, toStatus)) {
			throw new AppError(
				`Order cannot move from ${current.status} to ${toStatus}`,
				409,
				'invalid_order_status_transition'
			)
		}

		const [updated] = await tx
			.update(orders)
			.set({
				status: toStatus,
				updatedAt: new Date(),
				...(toStatus === 'cancelled' ? { cancelledAt: new Date() } : {})
			})
			.where(and(eq(orders.id, orderId), eq(orders.status, current.status)))
			.returning()
		if (!updated) {
			// Lost a race with a concurrent transition (shouldn't happen given
			// the row lock above, but the conditional UPDATE is the real guard).
			throw new AppError(
				`Order cannot move from ${current.status} to ${toStatus}`,
				409,
				'invalid_order_status_transition'
			)
		}

		if (sideEffect) {
			await sideEffect(tx)
		}

		await tx.insert(orderStatusHistory).values({
			orderId,
			fromStatus: current.status,
			toStatus,
			changedBy: actorUserId,
			reason
		})

		return updated
	})
}

/**
 * Generic staff transitions that have no inventory side effect
 * (pending -> confirmed, confirmed -> processing). Cancelling and
 * completing always go through the dedicated functions below instead,
 * so inventory release/commit can never be bypassed by routing a status
 * change through here.
 */
export async function transitionOrderStatus(
	orderId: string,
	toStatus: 'confirmed' | 'processing',
	actorUserId: string,
	reason: string
): Promise<OrderRow> {
	return performOrderTransition(orderId, toStatus, actorUserId, reason)
}

/**
 * Staff cancellation - unlike the customer's own cancelPendingOrder (Task 8,
 * pending-only), staff may cancel up through 'processing' (anything short
 * of 'completed'). Releases the reservation exactly once, inside the same
 * transaction as the status change.
 */
export async function adminCancelOrder(orderId: string, actorUserId: string, reason: string): Promise<OrderRow> {
	// canTransitionOrderStatus already allows 'cancelled' from pending,
	// confirmed, and processing (src/orders/status.ts) - exactly the "up
	// through processing" rule this function needs, with no extra check.
	return performOrderTransition(orderId, 'cancelled', actorUserId, reason, async tx => {
		await releaseOrderInventory(tx, orderId)
	})
}

/**
 * Fulfillment completion: processing -> completed, invoking
 * commitOrderInventory exactly once (guarded a second time internally by
 * order_items.committedAt). Never asserts anything about payment - an
 * offline order can be fully fulfilled while its payment is still
 * 'pending' (Task 6); see src/db/queries/payments.ts for the separate,
 * explicitly staff-triggered payment confirmation.
 */
export async function completeOrder(orderId: string, actorUserId: string, reason: string): Promise<OrderRow> {
	return performOrderTransition(orderId, 'completed', actorUserId, reason, async tx => {
		await commitOrderInventory(tx, orderId)
	})
}
