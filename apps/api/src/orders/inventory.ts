/**
 * The three internal reservation-lifecycle operations order creation,
 * cancellation, and (future) fulfillment use. None of these is a route
 * handler - they only ever run inside a caller's existing transaction, so
 * a failure here rolls back everything else that transaction did too.
 *
 * All three take their rows pre-sorted by variantId by the caller (see
 * sortLinesByVariantId) - touching inventory rows in a single stable order
 * across every code path is what keeps two orders that both touch
 * variants A and B from deadlocking each other.
 */
import { and, eq, gte, sql } from 'drizzle-orm'
import type { Database } from '../db/client'
import { inventory } from '../db/schema/inventory'
import { orderItems } from '../db/schema/orders'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

export class InsufficientStockError extends Error {
	variantId: string
	constructor(variantId: string) {
		super(`Insufficient stock for variant ${variantId}`)
		this.variantId = variantId
	}
}

export type ReservationLine = { variantId: string; quantity: number }

export function sortLinesByVariantId<T extends { variantId: string }>(lines: T[]): T[] {
	return [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId))
}

/**
 * Reserves stock for every line, one variant at a time in the caller's
 * given order. Each reservation is a single conditional UPDATE - the
 * WHERE clause re-checks "enough available" and the increment happens in
 * the same atomic statement, so there is no separate SELECT-then-UPDATE
 * window for a concurrent order to slip through. Throws
 * InsufficientStockError (and leaves it to the caller's transaction to
 * roll everything back) the moment any line can't be covered.
 */
export async function reserveOrderInventory(tx: Tx, lines: ReservationLine[]): Promise<void> {
	for (const line of sortLinesByVariantId(lines)) {
		const [row] = await tx
			.update(inventory)
			.set({ quantityReserved: sql`${inventory.quantityReserved} + ${line.quantity}`, updatedAt: new Date() })
			.where(
				and(
					eq(inventory.variantId, line.variantId),
					sql`${inventory.quantityOnHand} - ${inventory.quantityReserved} >= ${line.quantity}`
				)
			)
			.returning({ variantId: inventory.variantId })
		if (!row) {
			throw new InsufficientStockError(line.variantId)
		}
	}
}

/**
 * Releases the reservation held by every order_items row of `orderId`
 * that hasn't already been released - guarded by releasedAt, so calling
 * this twice for the same order (e.g. two cancel attempts racing) only
 * ever decrements quantity_reserved once per line. The WHERE clause also
 * refuses to take quantity_reserved below 0, as a second line of defense
 * behind the inventory table's own check constraint.
 */
export async function releaseOrderInventory(tx: Tx, orderId: string): Promise<void> {
	const lines = await tx
		.select({ id: orderItems.id, variantId: orderItems.variantId, quantity: orderItems.quantity })
		.from(orderItems)
		.where(and(eq(orderItems.orderId, orderId), sql`${orderItems.releasedAt} is null`))

	for (const line of sortLinesByVariantId(lines.filter(hasVariant))) {
		await tx
			.update(inventory)
			.set({ quantityReserved: sql`${inventory.quantityReserved} - ${line.quantity}`, updatedAt: new Date() })
			.where(and(eq(inventory.variantId, line.variantId), gte(inventory.quantityReserved, line.quantity)))

		await tx
			.update(orderItems)
			.set({ releasedAt: new Date() })
			.where(and(eq(orderItems.id, line.id), sql`${orderItems.releasedAt} is null`))
	}
}

/**
 * Physical fulfillment: decrements quantity_on_hand *and* quantity_reserved
 * together for every not-yet-committed line of `orderId`. Never called
 * automatically by order creation or cancellation - placing an order only
 * ever reserves; an actual stock decrease is a distinct future event
 * (fulfillment), guarded the same way release is (via committedAt) so it
 * can't double-apply either.
 */
export async function commitOrderInventory(tx: Tx, orderId: string): Promise<void> {
	const lines = await tx
		.select({ id: orderItems.id, variantId: orderItems.variantId, quantity: orderItems.quantity })
		.from(orderItems)
		.where(and(eq(orderItems.orderId, orderId), sql`${orderItems.committedAt} is null`))

	for (const line of sortLinesByVariantId(lines.filter(hasVariant))) {
		const [row] = await tx
			.update(inventory)
			.set({
				quantityOnHand: sql`${inventory.quantityOnHand} - ${line.quantity}`,
				quantityReserved: sql`${inventory.quantityReserved} - ${line.quantity}`,
				updatedAt: new Date()
			})
			.where(
				and(
					eq(inventory.variantId, line.variantId),
					gte(inventory.quantityOnHand, line.quantity),
					gte(inventory.quantityReserved, line.quantity)
				)
			)
			.returning({ variantId: inventory.variantId })
		if (!row) {
			throw new InsufficientStockError(line.variantId)
		}

		await tx
			.update(orderItems)
			.set({ committedAt: new Date() })
			.where(and(eq(orderItems.id, line.id), sql`${orderItems.committedAt} is null`))
	}
}

function hasVariant<T extends { variantId: string | null }>(line: T): line is T & { variantId: string } {
	return line.variantId !== null
}
