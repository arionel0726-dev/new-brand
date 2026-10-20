/**
 * The seam a real payment provider (e.g. Paynet) would plug into. Nothing
 * in this file calls a real gateway, and nothing fakes one succeeding -
 * see OfflinePaymentProvider and UnavailableOnlineProvider below.
 *
 * Where a real provider gets added later, it must:
 *  1. Verify the provider's webhook signature before trusting any event
 *     payload (never processVerifiedEvent on unverified input).
 *  2. Record the event in payment_provider_events
 *     (`insert ... on conflict (provider, external_event_id) do nothing`)
 *     *before* applying it, so a provider's duplicate delivery can never
 *     double-apply - the same idempotency pattern order_idempotency_keys
 *     already uses for order creation.
 *  3. Map the provider's own status vocabulary onto PaymentStatus
 *     explicitly (a provider-specific function, not a generic guess) -
 *     this is where "provider-specific mapping" belongs.
 *  4. Only initiate/refund through its own authenticated SDK/API calls;
 *     this project never collects or stores card numbers/CVV itself.
 */
import type { PaymentMethod } from '../db/schema/payment-method'
import type { PaymentStatus } from './status'

export type InitiatePaymentInput = {
	orderId: string
	amount: number
	currency: 'MDL'
}

export type InitiatePaymentResult = {
	status: PaymentStatus
	externalReference: string | null
	/** Where a real online provider would send the shopper to pay - never set by the offline provider. */
	redirectUrl?: string
}

export type VerifiedProviderEvent = {
	externalEventId: string
	externalReference: string
	status: PaymentStatus
	metadata?: Record<string, unknown>
}

export interface PaymentProvider {
	readonly code: string
	initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult>
	getPaymentStatus(externalReference: string): Promise<PaymentStatus>
	/** Only ever called with an input that has already passed provider signature verification upstream. */
	processVerifiedEvent(event: VerifiedProviderEvent): Promise<PaymentStatus>
	/** Returns null if this provider/method doesn't support refunds at all. */
	refundPayment(externalReference: string, amount: number): Promise<{ status: PaymentStatus } | null>
}

/**
 * cash_on_delivery / card_on_delivery: money changes hands physically,
 * off this system entirely. "Initiating" one just opens a pending record
 * for staff to later confirm via the admin payment-confirmation endpoint
 * (Task 6) - there is nothing to redirect to and nothing to poll.
 */
export class OfflinePaymentProvider implements PaymentProvider {
	readonly code = 'offline'

	async initiatePayment(): Promise<InitiatePaymentResult> {
		return { status: 'pending', externalReference: null }
	}

	async getPaymentStatus(): Promise<PaymentStatus> {
		throw new Error('OfflinePaymentProvider has no external status to poll - read payments.status instead')
	}

	async processVerifiedEvent(): Promise<PaymentStatus> {
		throw new Error('OfflinePaymentProvider never receives provider events')
	}

	async refundPayment(): Promise<{ status: PaymentStatus } | null> {
		// Supported only as a bookkeeping transition (Task 6's staff
		// confirmation flow sets payments.status directly); no money is
		// actually moved by this call.
		return null
	}
}

/**
 * Online payment has no real implementation yet - this class exists only
 * to make that refusal explicit and centralized, rather than letting
 * 'online' silently fall through to undefined behavior. Swapping this for
 * a real provider (Paynet or otherwise) is Sprint 8+'s job; see the
 * module doc comment above for what that integration must do.
 */
export class UnavailableOnlineProvider implements PaymentProvider {
	readonly code = 'online_unavailable'

	async initiatePayment(): Promise<InitiatePaymentResult> {
		throw new Error('Online payments are not available: no payment provider is configured yet')
	}
	async getPaymentStatus(): Promise<PaymentStatus> {
		throw new Error('Online payments are not available: no payment provider is configured yet')
	}
	async processVerifiedEvent(): Promise<PaymentStatus> {
		throw new Error('Online payments are not available: no payment provider is configured yet')
	}
	async refundPayment(): Promise<{ status: PaymentStatus } | null> {
		throw new Error('Online payments are not available: no payment provider is configured yet')
	}
}

const offlineProvider = new OfflinePaymentProvider()
const unavailableOnlineProvider = new UnavailableOnlineProvider()

export function getPaymentProvider(method: PaymentMethod): PaymentProvider {
	if (method === 'online') return unavailableOnlineProvider
	return offlineProvider
}

/**
 * The explicit configuration switch Task 5 asks for. Even if this were
 * ever set true, UnavailableOnlineProvider still refuses every call - a
 * real provider implementation must replace that class, not just flip
 * this flag, before 'online' can actually work. See src/config/env.ts.
 */
export function isOnlinePaymentsConfigured(): boolean {
	return false
}
