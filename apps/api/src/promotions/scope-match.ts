/** Shared by promotion and coupon scope matching - identical semantics for both (Task 1 and Task 3): no scope rows at all means "every product qualifies"; otherwise a product qualifies if it matches any one of product/brand/category scope. */
export type ScopeSets = {
	productIds: Set<string>
	brandIds: Set<string>
	categoryIds: Set<string>
}

export function matchesScope(scope: ScopeSets, productId: string, brandId: string | null, categoryIds: string[]): boolean {
	const isGlobal = scope.productIds.size === 0 && scope.brandIds.size === 0 && scope.categoryIds.size === 0
	if (isGlobal) return true

	if (scope.productIds.has(productId)) return true
	if (brandId && scope.brandIds.has(brandId)) return true
	return categoryIds.some(categoryId => scope.categoryIds.has(categoryId))
}
