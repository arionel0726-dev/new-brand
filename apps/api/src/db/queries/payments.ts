import { and, desc, eq } from 'drizzle-orm'
import { db } from '../client'
import type { DbOrTx } from '../tx'
import { payments, paymentStatusHistory } from '../schema/payments'
import type { PaymentMethod } from '../schema/payment-method'
import { canTransitionPaymentStatus, type PaymentStatus } from '../../payments/status'
import { AppError } from '../../middleware/error-handler'

export type PaymentRow = typeof payments.$inferSelect
export type PaymentStatusHistoryRow = typeof paymentStatusHistory.$inferSelect

export type CreatePaymentInput = {
	orderId: string
	method: PaymentMethod
	amount: number
	provider: string
	externalReference?: string | null
}

/** Always created inside the same transaction as its order (see createOrderFromCart) - a payment never exists without its order. */
export async function createPayment(dbOrTx: DbOrTx, input: CreatePaymentInput): Promise<PaymentRow> {
	const [row] = await dbOrTx
		.insert(payments)
		.values({
			orderId: input.orderId,
			method: input.method,
			amount: input.amount,
			provider: input.provider,
			externalReference: input.externalReference ?? null
		})
		.returning()
	return row
}

export async function getPaymentsForOrder(orderId: string): Promise<PaymentRow[]> {
	return db.select().from(payments).where(eq(payments.orderId, orderId)).orderBy(desc(payments.createdAt))
}

export async function getPaymentById(paymentId: string): Promise<PaymentRow | null> {
	const [row] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1)
	return row ?? null
}

/**
 * The only way payments.status ever changes - a conditional UPDATE keyed
 * on the current status (read inside this same transaction) plus a
 * centralized legality check, exactly mirroring how order status moves
 * in src/db/queries/orders.ts. Writes payment_status_history every time,
 * so "why did this change" is always reconstructable.
 */
export async function transitionPaymentStatus(
	paymentId: string,
	toStatus: PaymentStatus,
	actorUserId: string | null,
	reason: string,
	options: { refundedAmount?: number } = {}
): Promise<PaymentRow> {
	return db.transaction(async tx => {
		const [current] = await tx.select().from(payments).where(eq(payments.id, paymentId)).limit(1)
		if (!current) {
			throw new AppError('Payment not found', 404, 'payment_not_found')
		}
		if (!canTransitionPaymentStatus(current.status, toStatus)) {
			throw new AppError(
				`Payment cannot move from ${current.status} to ${toStatus}`,
				409,
				'invalid_payment_status_transition'
			)
		}

		const refundedAmount = options.refundedAmount ?? current.refundedAmount

		const [updated] = await tx
			.update(payments)
			.set({ status: toStatus, refundedAmount, updatedAt: new Date() })
			.where(and(eq(payments.id, paymentId), eq(payments.status, current.status)))
			.returning()
		if (!updated) {
			// Lost a race with a concurrent transition - same conditional-update pattern used throughout this codebase.
			throw new AppError(
				`Payment cannot move from ${current.status} to ${toStatus}`,
				409,
				'invalid_payment_status_transition'
			)
		}

		await tx.insert(paymentStatusHistory).values({
			paymentId,
			fromStatus: current.status,
			toStatus,
			changedBy: actorUserId,
			reason
		})

		return updated
	})
}

export async function getPaymentStatusHistory(paymentId: string): Promise<PaymentStatusHistoryRow[]> {
	return db
		.select()
		.from(paymentStatusHistory)
		.where(eq(paymentStatusHistory.paymentId, paymentId))
		.orderBy(desc(paymentStatusHistory.createdAt))
}
