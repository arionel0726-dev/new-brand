import type { paymentStatusEnum } from '../db/schema/payments'

export type PaymentStatus = (typeof paymentStatusEnum.enumValues)[number]

/**
 * Entirely independent of src/orders/status.ts's order-status table -
 * payment state is never inferred from order state (Task 4). Every
 * transition here is written through src/db/queries/payments.ts's
 * transitionPaymentStatus, which records it in payment_status_history
 * the same way order transitions are recorded in order_status_history.
 */
export const PAYMENT_STATUS_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
	pending: ['requires_action', 'paid', 'failed', 'cancelled'],
	requires_action: ['paid', 'failed', 'cancelled'],
	paid: ['refunded', 'partially_refunded'],
	partially_refunded: ['partially_refunded', 'refunded'],
	failed: [],
	cancelled: [],
	refunded: []
}

export function canTransitionPaymentStatus(from: PaymentStatus, to: PaymentStatus): boolean {
	return PAYMENT_STATUS_TRANSITIONS[from].includes(to)
}
