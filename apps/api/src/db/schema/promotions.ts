import { sql } from 'drizzle-orm'
import {
	boolean,
	check,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid
} from 'drizzle-orm/pg-core'
import { brands } from './brands'
import { categories } from './categories'
import { discountTypeEnum } from './discount-type'
import { products } from './products'

/**
 * An automatic, code-less discount (contrast with coupons, which require a
 * code). Scope is "global" (applies to every product) when a promotion has
 * no rows at all in promotion_products/promotion_brands/promotion_categories;
 * otherwise it applies only to a line whose product/brand/category matches
 * at least one scope row - and never to one listed in
 * promotion_excluded_products, even if it would otherwise match.
 *
 * product_prices remains the only authoritative base-price table; nothing
 * here ever writes a promotional price back into it or into Meilisearch -
 * see src/promotions/pricing.ts for where the discount is actually
 * computed, at checkout/order-creation time only.
 */
export const promotions = pgTable(
	'promotions',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		// Admin/internal label - not guaranteed to be shown to a customer.
		name: text('name').notNull(),
		nameRu: text('name_ru'),
		nameRo: text('name_ro'),
		discountType: discountTypeEnum('discount_type').notNull(),
		// 1-100, required when discountType = 'percentage'.
		percentageValue: integer('percentage_value'),
		// Bani, required when discountType = 'fixed_amount' - applied per
		// qualifying unit (fixedAmount * quantity), capped at the line total.
		fixedAmount: integer('fixed_amount'),
		// Caps the bani value of a single line's discount - mainly useful for
		// percentage promotions ("20% off, max 5000 bani"). Null = no cap.
		maxDiscountAmount: integer('max_discount_amount'),
		isActive: boolean('is_active').notNull().default(true),
		startsAt: timestamp('starts_at', { withTimezone: true }),
		endsAt: timestamp('ends_at', { withTimezone: true }),
		// Higher wins when more than one promotion matches the same line -
		// see src/promotions/pricing.ts for the full deterministic order.
		priority: integer('priority').notNull().default(0),
		// Total times this promotion may be applied across all orders ever
		// (null = unlimited). redemptionCount only ever increases, via a
		// conditional UPDATE (WHERE max_total_redemptions IS NULL OR
		// redemption_count < max_total_redemptions) at order-creation time -
		// never decremented, including on order cancellation (documented
		// policy, see src/orders/policy.ts).
		maxTotalRedemptions: integer('max_total_redemptions'),
		redemptionCount: integer('redemption_count').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		index('promotions_is_active_idx').on(table.isActive),
		check(
			'promotions_discount_value_check',
			sql`(${table.discountType} = 'percentage' and ${table.percentageValue} between 1 and 100 and ${table.fixedAmount} is null)
				or (${table.discountType} = 'fixed_amount' and ${table.fixedAmount} > 0 and ${table.percentageValue} is null)`
		),
		check(
			'promotions_max_discount_non_negative_check',
			sql`${table.maxDiscountAmount} is null or ${table.maxDiscountAmount} >= 0`
		),
		check(
			'promotions_date_range_check',
			sql`${table.startsAt} is null or ${table.endsAt} is null or ${table.startsAt} <= ${table.endsAt}`
		),
		check(
			'promotions_redemption_count_non_negative_check',
			sql`${table.redemptionCount} >= 0 and (${table.maxTotalRedemptions} is null or ${table.redemptionCount} <= ${table.maxTotalRedemptions})`
		)
	]
)

export const promotionProducts = pgTable(
	'promotion_products',
	{
		promotionId: uuid('promotion_id')
			.notNull()
			.references(() => promotions.id, { onDelete: 'cascade' }),
		productId: uuid('product_id')
			.notNull()
			.references(() => products.id, { onDelete: 'cascade' })
	},
	table => [
		primaryKey({ columns: [table.promotionId, table.productId] }),
		index('promotion_products_product_id_idx').on(table.productId)
	]
)

export const promotionBrands = pgTable(
	'promotion_brands',
	{
		promotionId: uuid('promotion_id')
			.notNull()
			.references(() => promotions.id, { onDelete: 'cascade' }),
		brandId: uuid('brand_id')
			.notNull()
			.references(() => brands.id, { onDelete: 'cascade' })
	},
	table => [
		primaryKey({ columns: [table.promotionId, table.brandId] }),
		index('promotion_brands_brand_id_idx').on(table.brandId)
	]
)

export const promotionCategories = pgTable(
	'promotion_categories',
	{
		promotionId: uuid('promotion_id')
			.notNull()
			.references(() => promotions.id, { onDelete: 'cascade' }),
		categoryId: uuid('category_id')
			.notNull()
			.references(() => categories.id, { onDelete: 'cascade' })
	},
	table => [
		primaryKey({ columns: [table.promotionId, table.categoryId] }),
		index('promotion_categories_category_id_idx').on(table.categoryId)
	]
)

/** Explicit exclusions (Task 1) - wins over any product/brand/category match, and over the "no scope = global" default too. */
export const promotionExcludedProducts = pgTable(
	'promotion_excluded_products',
	{
		promotionId: uuid('promotion_id')
			.notNull()
			.references(() => promotions.id, { onDelete: 'cascade' }),
		productId: uuid('product_id')
			.notNull()
			.references(() => products.id, { onDelete: 'cascade' })
	},
	table => [
		primaryKey({ columns: [table.promotionId, table.productId] }),
		index('promotion_excluded_products_product_id_idx').on(table.productId)
	]
)
