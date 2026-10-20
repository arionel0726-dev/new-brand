import { z } from 'zod'

/**
 * Shared between POST /checkout/shipping-quote and POST /orders so the
 * two can never drift - the exact same shape a client fills in once.
 * Address fields don't affect the fee at all (no geocoding - Task 1), but
 * they're collected here too so a client can present one form for both.
 */
export const deliverySchema = z.discriminatedUnion('method', [
	z.object({
		method: z.literal('pickup'),
		pickupLocationId: z.uuid()
	}),
	z.object({
		method: z.literal('courier'),
		deliveryZoneId: z.uuid(),
		recipientName: z.string().trim().min(1).max(200),
		recipientPhone: z.string().trim().min(1).max(32),
		city: z.string().trim().min(1).max(120),
		street: z.string().trim().min(1).max(200),
		house: z.string().trim().min(1).max(20),
		apartment: z.string().trim().max(20).nullable().optional(),
		notes: z.string().trim().max(500).nullable().optional()
	})
])

export type DeliveryBody = z.infer<typeof deliverySchema>

export const paymentMethodSchema = z.enum(['cash_on_delivery', 'card_on_delivery', 'online'])
