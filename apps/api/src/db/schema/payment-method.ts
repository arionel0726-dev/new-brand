import { pgEnum } from 'drizzle-orm/pg-core'

/**
 * Its own file (not payments.ts) specifically to avoid a circular import:
 * payments.ts references orders.ts (payments.order_id FK), and orders.ts
 * needs this enum for its own payment_method column - putting the enum in
 * either of those two files would make them import each other.
 */
export const paymentMethodEnum = pgEnum('payment_method', ['cash_on_delivery', 'card_on_delivery', 'online'])
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number]
