/**
 * Sprint 12B.6 Requirement 1/2/3: build a small, internally-consistent
 * subset of a full `LegacyCatalogDump` for a controlled first integration
 * test, preserving the Brand -> Category -> Product -> Variant -> Barcode
 * dependency chain.
 *
 * `buildCatalogSlice` is the one FK-closure primitive every selection mode
 * goes through: given a set of legacy `products.id` values, it pulls in
 * every row the importer would actually need to process those products
 * (variables, images, category links, brand/category rows including the
 * category parent chain) - never a dangling reference. It is generic over
 * any real `LegacyCatalogDump` (no synthetic-only assumptions); only the
 * fixtures used to exercise it in tests are synthetic.
 *
 * Requirement 3: every id placed into the returned dump is copied verbatim
 * from the input dump - this module only ever filters rows, it never
 * constructs or substitutes an identifier.
 */
import type { LegacyCatalogDump } from './parsers/mysql-catalog'

export class UnknownLegacyProductIdError extends Error {
	constructor(missingIds: number[]) {
		super(
			`Cannot build catalog slice: legacy product id(s) ${missingIds.join(', ')} were requested but do not exist in the supplied dump. Refusing to silently drop them from the slice.`
		)
	}
}

export type SliceCriteria =
	| { kind: 'legacyProductIds'; legacyProductIds: readonly number[] }
	| { kind: 'brandIds'; brandIds: readonly number[] }
	| { kind: 'legacyCategoryIds'; legacyCategoryIds: readonly number[] }

/**
 * Resolves a selection criterion down to the concrete legacy `products.id`
 * values it covers, against the real dump - so "this brand id" or "this
 * legacy category id" (Requirement 1's required selection modes) are both
 * just different ways of arriving at the same `buildCatalogSlice` input.
 */
export function resolveLegacyProductIds(dump: LegacyCatalogDump, criteria: SliceCriteria): number[] {
	switch (criteria.kind) {
		case 'legacyProductIds':
			return [...new Set(criteria.legacyProductIds)]
		case 'brandIds': {
			const brandIds = new Set(criteria.brandIds)
			return dump.products.filter(p => p.brandId !== null && brandIds.has(p.brandId)).map(p => p.id)
		}
		case 'legacyCategoryIds': {
			const categoryIds = new Set(criteria.legacyCategoryIds)
			const directProductIds = new Set(
				dump.products.filter(p => p.categoryId !== null && categoryIds.has(p.categoryId)).map(p => p.id)
			)
			for (const link of dump.productCategories) {
				if (categoryIds.has(link.categoryId)) directProductIds.add(link.productId)
			}
			return [...directProductIds]
		}
	}
}

/** Walks a category's `parentId` chain to its root, so a sliced category is never left pointing at a parent that isn't included. */
function categoryAncestorClosure(dump: LegacyCatalogDump, startIds: Iterable<number>): Set<number> {
	const byId = new Map(dump.categories.map(c => [c.id, c]))
	const closure = new Set<number>()
	const stack = [...startIds]
	while (stack.length > 0) {
		const id = stack.pop()!
		if (closure.has(id)) continue
		closure.add(id)
		const category = byId.get(id)
		if (category?.parentId !== null && category?.parentId !== undefined && !closure.has(category.parentId)) {
			stack.push(category.parentId)
		}
	}
	return closure
}

/**
 * Requirement 1: given a full dump and a set of legacy product ids, returns
 * a reduced `LegacyCatalogDump` that is internally consistent - every
 * variable, image, category link, brand and category row the selected
 * products actually reference is included, and nothing is included that
 * isn't reachable from the selection. Fails closed (throws) rather than
 * silently shrinking the slice if a requested id doesn't exist in the dump.
 */
export function buildCatalogSlice(dump: LegacyCatalogDump, legacyProductIds: readonly number[]): LegacyCatalogDump {
	const requested = new Set(legacyProductIds)
	const dumpProductIds = new Set(dump.products.map(p => p.id))
	const missing = [...requested].filter(id => !dumpProductIds.has(id))
	if (missing.length > 0) throw new UnknownLegacyProductIdError(missing)

	const products = dump.products.filter(p => requested.has(p.id))
	const productVariables = dump.productVariables.filter(v => requested.has(v.productId))
	const variableIds = new Set(productVariables.map(v => v.id))

	const productImgs = dump.productImgs.filter(img => requested.has(img.productId))
	const productVariableImgs = dump.productVariableImgs.filter(
		img => requested.has(img.productId) || variableIds.has(img.variableId)
	)
	const productCategories = dump.productCategories.filter(pc => requested.has(pc.productId))
	const productsMore = dump.productsMore.filter(pm => requested.has(pm.productId))

	const directCategoryIds = new Set<number>()
	for (const p of products) if (p.categoryId !== null) directCategoryIds.add(p.categoryId)
	for (const pc of productCategories) directCategoryIds.add(pc.categoryId)
	const categoryClosure = categoryAncestorClosure(dump, directCategoryIds)
	const categories = dump.categories.filter(c => categoryClosure.has(c.id))

	const brandIds = new Set(products.filter(p => p.brandId !== null).map(p => p.brandId!))
	const brands = dump.brands.filter(b => brandIds.has(b.id))

	return {
		products,
		productVariables,
		brands,
		categories,
		productCategories,
		productImgs,
		productVariableImgs,
		// Stores are a separate physical-location concept, not reachable from
		// any product FK - never part of a product-scoped slice.
		stores: [],
		storeImgs: [],
		productsMore
	}
}

/** Convenience: resolve a criterion and build its slice in one call. */
export function buildCatalogSliceFor(dump: LegacyCatalogDump, criteria: SliceCriteria): LegacyCatalogDump {
	return buildCatalogSlice(dump, resolveLegacyProductIds(dump, criteria))
}
