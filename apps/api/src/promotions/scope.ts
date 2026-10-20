import { inArray } from 'drizzle-orm'
import type { DbOrTx } from '../db/tx'
import { productCategories } from '../db/schema/product-categories'
import { products } from '../db/schema/products'

export type ProductScope = { brandId: string | null; categoryIds: string[] }

/** Batch-fetch (no N+1) the brand + categories of every product a cart/order touches - the raw material src/promotions/pricing.ts matches promotion/coupon scope rules against. */
export async function getProductScopeInfo(
	dbOrTx: DbOrTx,
	productIds: string[]
): Promise<Map<string, ProductScope>> {
	const map = new Map<string, ProductScope>()
	if (productIds.length === 0) return map

	const uniqueIds = [...new Set(productIds)]
	for (const id of uniqueIds) {
		map.set(id, { brandId: null, categoryIds: [] })
	}

	const productRows = await dbOrTx
		.select({ id: products.id, brandId: products.brandId })
		.from(products)
		.where(inArray(products.id, uniqueIds))
	for (const row of productRows) {
		map.set(row.id, { brandId: row.brandId, categoryIds: map.get(row.id)?.categoryIds ?? [] })
	}

	const categoryRows = await dbOrTx
		.select({ productId: productCategories.productId, categoryId: productCategories.categoryId })
		.from(productCategories)
		.where(inArray(productCategories.productId, uniqueIds))
	for (const row of categoryRows) {
		map.get(row.productId)?.categoryIds.push(row.categoryId)
	}

	return map
}
