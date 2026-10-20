import { asc, count, eq } from 'drizzle-orm'
import { db } from '../client'
import type { Tx } from '../tx'
import { couponBrands, couponCategories, couponProducts, coupons } from '../schema/coupons'
import { normalizeCouponCode } from '../../coupons/normalize'
import type { Pagination } from '../../lib/pagination'

export type CouponRow = typeof coupons.$inferSelect

export type CouponScopeInput = {
	productIds?: string[]
	brandIds?: string[]
	categoryIds?: string[]
}

export type CouponScopeRows = {
	productIds: string[]
	brandIds: string[]
	categoryIds: string[]
}

export type AdminCouponListFilters = {
	isActive?: boolean
}

export async function listAdminCoupons(pagination: Pagination, filters: AdminCouponListFilters) {
	const where = filters.isActive !== undefined ? eq(coupons.isActive, filters.isActive) : undefined

	const [items, totalRows] = await Promise.all([
		db
			.select()
			.from(coupons)
			.where(where)
			.orderBy(asc(coupons.createdAt), asc(coupons.id))
			.limit(pagination.limit)
			.offset((pagination.page - 1) * pagination.limit),
		db.select({ count: count() }).from(coupons).where(where)
	])

	return { items, total: totalRows[0]?.count ?? 0 }
}

export async function getAdminCouponById(id: string): Promise<CouponRow | null> {
	const [row] = await db.select().from(coupons).where(eq(coupons.id, id)).limit(1)
	return row ?? null
}

export async function getCouponScope(id: string): Promise<CouponScopeRows> {
	const [productRows, brandRows, categoryRows] = await Promise.all([
		db.select().from(couponProducts).where(eq(couponProducts.couponId, id)),
		db.select().from(couponBrands).where(eq(couponBrands.couponId, id)),
		db.select().from(couponCategories).where(eq(couponCategories.couponId, id))
	])
	return {
		productIds: productRows.map(row => row.productId),
		brandIds: brandRows.map(row => row.brandId),
		categoryIds: categoryRows.map(row => row.categoryId)
	}
}

/** Replace-all semantics: an omitted scope field is left untouched, an empty array clears it, a non-empty array replaces it wholesale. */
async function writeScope(tx: Tx, couponId: string, scope: CouponScopeInput): Promise<void> {
	if (scope.productIds !== undefined) {
		await tx.delete(couponProducts).where(eq(couponProducts.couponId, couponId))
		if (scope.productIds.length > 0) {
			await tx.insert(couponProducts).values(scope.productIds.map(productId => ({ couponId, productId })))
		}
	}
	if (scope.brandIds !== undefined) {
		await tx.delete(couponBrands).where(eq(couponBrands.couponId, couponId))
		if (scope.brandIds.length > 0) {
			await tx.insert(couponBrands).values(scope.brandIds.map(brandId => ({ couponId, brandId })))
		}
	}
	if (scope.categoryIds !== undefined) {
		await tx.delete(couponCategories).where(eq(couponCategories.couponId, couponId))
		if (scope.categoryIds.length > 0) {
			await tx.insert(couponCategories).values(scope.categoryIds.map(categoryId => ({ couponId, categoryId })))
		}
	}
}

export type CreateCouponInput = {
	code: string
	discountType: 'percentage' | 'fixed_amount'
	percentageValue?: number | null
	fixedAmount?: number | null
	isActive?: boolean
	startsAt?: Date | null
	endsAt?: Date | null
	minOrderAmount?: number | null
	maxTotalUses?: number | null
	maxUsesPerCustomer?: number | null
	scope?: CouponScopeInput
}

export async function createCoupon(input: CreateCouponInput): Promise<CouponRow> {
	const { scope, code, ...values } = input
	return db.transaction(async tx => {
		const [row] = await tx
			.insert(coupons)
			.values({ ...values, code: normalizeCouponCode(code) })
			.returning()
		if (scope) await writeScope(tx, row.id, scope)
		return row
	})
}

export type UpdateCouponInput = Partial<Omit<CreateCouponInput, 'scope'>> & { scope?: CouponScopeInput }

/**
 * There is no DELETE endpoint for coupons (Task 6) - only this, which can
 * deactivate (isActive: false) or edit any other field. usesCount is never
 * settable here; it only moves via redeemCoupon at order-creation time
 * (src/coupons/redeem.ts).
 */
export async function updateCoupon(id: string, input: UpdateCouponInput): Promise<CouponRow | null> {
	const { scope, code, ...values } = input
	return db.transaction(async tx => {
		const [row] = await tx
			.update(coupons)
			.set({ ...values, ...(code !== undefined ? { code: normalizeCouponCode(code) } : {}), updatedAt: new Date() })
			.where(eq(coupons.id, id))
			.returning()
		if (!row) return null
		if (scope) await writeScope(tx, id, scope)
		return row
	})
}
