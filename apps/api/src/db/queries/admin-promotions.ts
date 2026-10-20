import { asc, count, eq } from 'drizzle-orm'
import { db } from '../client'
import type { Tx } from '../tx'
import {
	promotionBrands,
	promotionCategories,
	promotionExcludedProducts,
	promotionProducts,
	promotions
} from '../schema/promotions'
import type { Pagination } from '../../lib/pagination'

export type PromotionRow = typeof promotions.$inferSelect

export type PromotionScopeInput = {
	productIds?: string[]
	brandIds?: string[]
	categoryIds?: string[]
	excludedProductIds?: string[]
}

export type PromotionScopeRows = {
	productIds: string[]
	brandIds: string[]
	categoryIds: string[]
	excludedProductIds: string[]
}

export type AdminPromotionListFilters = {
	isActive?: boolean
}

export async function listAdminPromotions(pagination: Pagination, filters: AdminPromotionListFilters) {
	const where = filters.isActive !== undefined ? eq(promotions.isActive, filters.isActive) : undefined

	const [items, totalRows] = await Promise.all([
		db
			.select()
			.from(promotions)
			.where(where)
			.orderBy(asc(promotions.createdAt), asc(promotions.id))
			.limit(pagination.limit)
			.offset((pagination.page - 1) * pagination.limit),
		db.select({ count: count() }).from(promotions).where(where)
	])

	return { items, total: totalRows[0]?.count ?? 0 }
}

export async function getAdminPromotionById(id: string): Promise<PromotionRow | null> {
	const [row] = await db.select().from(promotions).where(eq(promotions.id, id)).limit(1)
	return row ?? null
}

export async function getPromotionScope(id: string): Promise<PromotionScopeRows> {
	const [productRows, brandRows, categoryRows, excludedRows] = await Promise.all([
		db.select().from(promotionProducts).where(eq(promotionProducts.promotionId, id)),
		db.select().from(promotionBrands).where(eq(promotionBrands.promotionId, id)),
		db.select().from(promotionCategories).where(eq(promotionCategories.promotionId, id)),
		db.select().from(promotionExcludedProducts).where(eq(promotionExcludedProducts.promotionId, id))
	])
	return {
		productIds: productRows.map(row => row.productId),
		brandIds: brandRows.map(row => row.brandId),
		categoryIds: categoryRows.map(row => row.categoryId),
		excludedProductIds: excludedRows.map(row => row.productId)
	}
}

/** Replace-all semantics: an omitted scope field is left untouched, an empty array clears it, a non-empty array replaces it wholesale. */
async function writeScope(tx: Tx, promotionId: string, scope: PromotionScopeInput): Promise<void> {
	if (scope.productIds !== undefined) {
		await tx.delete(promotionProducts).where(eq(promotionProducts.promotionId, promotionId))
		if (scope.productIds.length > 0) {
			await tx.insert(promotionProducts).values(scope.productIds.map(productId => ({ promotionId, productId })))
		}
	}
	if (scope.brandIds !== undefined) {
		await tx.delete(promotionBrands).where(eq(promotionBrands.promotionId, promotionId))
		if (scope.brandIds.length > 0) {
			await tx.insert(promotionBrands).values(scope.brandIds.map(brandId => ({ promotionId, brandId })))
		}
	}
	if (scope.categoryIds !== undefined) {
		await tx.delete(promotionCategories).where(eq(promotionCategories.promotionId, promotionId))
		if (scope.categoryIds.length > 0) {
			await tx.insert(promotionCategories).values(scope.categoryIds.map(categoryId => ({ promotionId, categoryId })))
		}
	}
	if (scope.excludedProductIds !== undefined) {
		await tx.delete(promotionExcludedProducts).where(eq(promotionExcludedProducts.promotionId, promotionId))
		if (scope.excludedProductIds.length > 0) {
			await tx
				.insert(promotionExcludedProducts)
				.values(scope.excludedProductIds.map(productId => ({ promotionId, productId })))
		}
	}
}

export type CreatePromotionInput = {
	name: string
	nameRu?: string | null
	nameRo?: string | null
	discountType: 'percentage' | 'fixed_amount'
	percentageValue?: number | null
	fixedAmount?: number | null
	maxDiscountAmount?: number | null
	isActive?: boolean
	startsAt?: Date | null
	endsAt?: Date | null
	priority?: number
	maxTotalRedemptions?: number | null
	scope?: PromotionScopeInput
}

export async function createPromotion(input: CreatePromotionInput): Promise<PromotionRow> {
	const { scope, ...values } = input
	return db.transaction(async tx => {
		const [row] = await tx.insert(promotions).values(values).returning()
		if (scope) await writeScope(tx, row.id, scope)
		return row
	})
}

export type UpdatePromotionInput = Partial<Omit<CreatePromotionInput, 'scope'>> & { scope?: PromotionScopeInput }

/**
 * There is no DELETE endpoint for promotions (Task 6) - only this, which can
 * deactivate (isActive: false) or edit any other field. redemptionCount is
 * never settable here; it only moves via incrementPromotionRedemption at
 * order-creation time (src/promotions/pricing.ts).
 */
export async function updatePromotion(id: string, input: UpdatePromotionInput): Promise<PromotionRow | null> {
	const { scope, ...values } = input
	return db.transaction(async tx => {
		const [row] = await tx
			.update(promotions)
			.set({ ...values, updatedAt: new Date() })
			.where(eq(promotions.id, id))
			.returning()
		if (!row) return null
		if (scope) await writeScope(tx, id, scope)
		return row
	})
}
