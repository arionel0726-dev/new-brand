import { pgEnum } from 'drizzle-orm/pg-core'

/** Shared by promotions and coupons so "20% off" and "500 bani off" mean exactly one thing across both. */
export const discountTypeEnum = pgEnum('discount_type', ['percentage', 'fixed_amount'])
export type DiscountType = (typeof discountTypeEnum.enumValues)[number]
