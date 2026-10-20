import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { brands } from './brands'
import { categories } from './categories'
import { discountTypeEnum } from './discount-type'
import { products } from './products'

/**
 * A code-redeemable discount (contrast with promotions, which are
 * automatic). Scope works exactly like promotions: no rows in
 * coupon_products/coupon_brands/coupon_categories means "every line is
 * eligible"; any rows mean only a matching line counts toward both the
 * coupon's own discount calculation (see src/promotions/pricing.ts) - there
 * is no separate exclusion list for coupons (Task 3 doesn't ask for one).
 */
export const coupons = pgTable(
	'coupons',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		// Normalized once at creation (src/coupons/normalize.ts) - trimmed,
		// uppercased - so lookups never have to guess at casing/whitespace.
		code: text('code').notNull().unique(),
		discountType: discountTypeEnum('discount_type').notNull(),
		percentageValue: integer('percentage_value'),
		fixedAmount: integer('fixed_amount'),
		isActive: boolean('is_active').notNull().default(true),
		startsAt: timestamp('starts_at', { withTimezone: true }),
		endsAt: timestamp('ends_at', { withTimezone: true }),
		// Checked against the full cart subtotal, before any discount.
		minOrderAmount: integer('min_order_amount'),
		// Total redemptions across every customer ever (null = unlimited).
		// usesCount only ever increases, via the same conditional-UPDATE
		// pattern every other limited counter in this codebase uses.
		maxTotalUses: integer('max_total_uses'),
		usesCount: integer('uses_count').notNull().default(0),
		// Per-authenticated-customer cap (null = no per-customer cap). Any
		// coupon with this set can only ever be redeemed by a signed-in
		// customer - see src/coupons/validate.ts - because a guest has no
		// identity reliable enough to enforce it against (Task 3 explicitly
		// forbids an email-only guest limit, which a guest can trivially
		// bypass by typing a different email).
		maxUsesPerCustomer: integer('max_uses_per_customer'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		index('coupons_is_active_idx').on(table.isActive),
		check(
			'coupons_discount_value_check',
			sql`(${table.discountType} = 'percentage' and ${table.percentageValue} between 1 and 100 and ${table.fixedAmount} is null)
				or (${table.discountType} = 'fixed_amount' and ${table.fixedAmount} > 0 and ${table.percentageValue} is null)`
		),
		check(
			'coupons_min_order_amount_non_negative_check',
			sql`${table.minOrderAmount} is null or ${table.minOrderAmount} >= 0`
		),
		check(
			'coupons_date_range_check',
			sql`${table.startsAt} is null or ${table.endsAt} is null or ${table.startsAt} <= ${table.endsAt}`
		),
		check(
			'coupons_uses_count_non_negative_check',
			sql`${table.usesCount} >= 0 and (${table.maxTotalUses} is null or ${table.usesCount} <= ${table.maxTotalUses})`
		),
		check(
			'coupons_max_uses_per_customer_positive_check',
			sql`${table.maxUsesPerCustomer} is null or ${table.maxUsesPerCustomer} > 0`
		)
	]
)

export const couponProducts = pgTable(
	'coupon_products',
	{
		couponId: uuid('coupon_id')
			.notNull()
			.references(() => coupons.id, { onDelete: 'cascade' }),
		productId: uuid('product_id')
			.notNull()
			.references(() => products.id, { onDelete: 'cascade' })
	},
	table => [
		primaryKey({ columns: [table.couponId, table.productId] }),
		index('coupon_products_product_id_idx').on(table.productId)
	]
)

export const couponBrands = pgTable(
	'coupon_brands',
	{
		couponId: uuid('coupon_id')
			.notNull()
			.references(() => coupons.id, { onDelete: 'cascade' }),
		brandId: uuid('brand_id')
			.notNull()
			.references(() => brands.id, { onDelete: 'cascade' })
	},
	table => [
		primaryKey({ columns: [table.couponId, table.brandId] }),
		index('coupon_brands_brand_id_idx').on(table.brandId)
	]
)

export const couponCategories = pgTable(
	'coupon_categories',
	{
		couponId: uuid('coupon_id')
			.notNull()
			.references(() => coupons.id, { onDelete: 'cascade' }),
		categoryId: uuid('category_id')
			.notNull()
			.references(() => categories.id, { onDelete: 'cascade' })
	},
	table => [
		primaryKey({ columns: [table.couponId, table.categoryId] }),
		index('coupon_categories_category_id_idx').on(table.categoryId)
	]
)
