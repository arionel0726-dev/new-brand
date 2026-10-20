/**
 * Real-data audit of the legacy MySQL catalog dump (Sprint 12 Task 1).
 * Every number here is computed from the actually-parsed rows passed in -
 * nothing is estimated, sampled, or extrapolated. Never includes full row
 * contents in its output; findings are counts, id lists, and short
 * non-sensitive excerpts only (Sprint 12 restriction: no confidential rows
 * in reports).
 */
import type { LegacyCatalogDump } from '../parsers/mysql-catalog'

export type DuplicateGroup = { value: string; count: number; ids: number[] }

export type LegacyCatalogAuditReport = {
	counts: {
		products: number
		productVariables: number
		brands: number
		categories: number
		productCategories: number
		productImgs: number
		productVariableImgs: number
		stores: number
		storeImgs: number
		productsMore: number
	}
	products: {
		published: number
		hidden: number
		withVariants: number
		withoutVariants: number
		withRuTitle: number
		withRoTitle: number
		withBothRuRo: number
		withNeitherRuRo: number
		multiCategory: number
		withoutBrand: number
		withoutCategory: number
		withoutImages: number
		withInvalidOrMissingPrice: number
		withZeroPrice: number
		invalidBrandReferences: { productId: number; brandId: number }[]
		invalidCategoryReferences: { productId: number; categoryId: number }[]
		duplicateGuids: DuplicateGroup[]
		duplicateSkus: DuplicateGroup[]
		duplicateRuSlugs: DuplicateGroup[]
		duplicateRoSlugs: DuplicateGroup[]
	}
	variants: {
		orphanVariants: { variantId: number; productId: number }[]
		duplicateSkus: DuplicateGroup[]
		withInvalidOrMissingPrice: number
	}
	categories: {
		maxDepth: number
		rootCount: number
		brokenParentRefs: { categoryId: number; parentId: number }[]
		duplicateGuids: DuplicateGroup[]
	}
	media: {
		orphanProductImages: { imageId: number; productId: number }[]
		orphanVariantImages: { imageId: number; productId: number; variantId: number }[]
	}
}

function groupDuplicates(values: { id: number; value: string | null }[]): DuplicateGroup[] {
	const groups = new Map<string, number[]>()
	for (const { id, value } of values) {
		if (value === null) continue
		const list = groups.get(value) ?? []
		list.push(id)
		groups.set(value, list)
	}
	return [...groups.entries()]
		.filter(([, ids]) => ids.length > 1)
		.map(([value, ids]) => ({ value, count: ids.length, ids }))
		.sort((a, b) => b.count - a.count)
}

function isInvalidOrMissingPrice(price: number | null): boolean {
	return price === null || !Number.isFinite(price) || price < 0
}

export function auditLegacyCatalog(dump: LegacyCatalogDump): LegacyCatalogAuditReport {
	const { products, productVariables, brands, categories, productCategories, productImgs, productVariableImgs, stores, storeImgs, productsMore } = dump

	const brandIds = new Set(brands.map(b => b.id))
	const categoryIds = new Set(categories.map(c => c.id))
	const productIds = new Set(products.map(p => p.id))
	const variantIds = new Set(productVariables.map(v => v.id))

	const variantCountByProduct = new Map<number, number>()
	for (const v of productVariables) {
		variantCountByProduct.set(v.productId, (variantCountByProduct.get(v.productId) ?? 0) + 1)
	}

	const categoryCountByProduct = new Map<number, number>()
	for (const pc of productCategories) {
		categoryCountByProduct.set(pc.productId, (categoryCountByProduct.get(pc.productId) ?? 0) + 1)
	}

	const imageCountByProduct = new Map<number, number>()
	for (const img of productImgs) {
		imageCountByProduct.set(img.productId, (imageCountByProduct.get(img.productId) ?? 0) + 1)
	}
	// Variant-level images also count toward "has at least one image" for the
	// parent product, since a variant-only product may carry all its imagery
	// there rather than in products_img.
	for (const img of productVariableImgs) {
		imageCountByProduct.set(img.productId, (imageCountByProduct.get(img.productId) ?? 0) + 1)
	}

	let published = 0
	let hidden = 0
	let withVariants = 0
	let withoutVariants = 0
	let withRuTitle = 0
	let withRoTitle = 0
	let withBothRuRo = 0
	let withNeitherRuRo = 0
	let multiCategory = 0
	let withoutBrand = 0
	let withoutCategory = 0
	let withoutImages = 0
	let withInvalidOrMissingPrice = 0
	let withZeroPrice = 0
	const invalidBrandReferences: { productId: number; brandId: number }[] = []
	const invalidCategoryReferences: { productId: number; categoryId: number }[] = []

	for (const p of products) {
		if (p.isShown) published++
		else hidden++

		const variantCount = variantCountByProduct.get(p.id) ?? 0
		if (variantCount > 0) withVariants++
		else withoutVariants++

		const hasRu = p.titleRu !== null
		const hasRo = p.titleRo !== null
		if (hasRu) withRuTitle++
		if (hasRo) withRoTitle++
		if (hasRu && hasRo) withBothRuRo++
		if (!hasRu && !hasRo) withNeitherRuRo++

		const categoryCount = categoryCountByProduct.get(p.id) ?? 0
		if (categoryCount > 1) multiCategory++

		// brand_id defaults to 0 in the legacy schema (DEFAULT 0, not NULL) -
		// 0 is never a real brand id, so it means "no brand assigned".
		if (p.brandId === null || p.brandId === 0) {
			withoutBrand++
		} else if (!brandIds.has(p.brandId)) {
			invalidBrandReferences.push({ productId: p.id, brandId: p.brandId })
		}

		if (categoryCount === 0 && (p.categoryId === null || p.categoryId === 0)) {
			withoutCategory++
		}
		if (p.categoryId !== null && p.categoryId !== 0 && !categoryIds.has(p.categoryId)) {
			invalidCategoryReferences.push({ productId: p.id, categoryId: p.categoryId })
		}

		if ((imageCountByProduct.get(p.id) ?? 0) === 0) withoutImages++

		if (isInvalidOrMissingPrice(p.price)) withInvalidOrMissingPrice++
		else if (p.price === 0) withZeroPrice++
	}

	// product_categories rows that reference a category not present in the
	// categories table are an additional, distinct kind of invalid reference.
	for (const pc of productCategories) {
		if (!categoryIds.has(pc.categoryId) && !invalidCategoryReferences.some(r => r.productId === pc.productId && r.categoryId === pc.categoryId)) {
			invalidCategoryReferences.push({ productId: pc.productId, categoryId: pc.categoryId })
		}
	}

	const orphanVariants: { variantId: number; productId: number }[] = []
	let variantInvalidPriceCount = 0
	for (const v of productVariables) {
		if (!productIds.has(v.productId)) orphanVariants.push({ variantId: v.id, productId: v.productId })
		if (isInvalidOrMissingPrice(v.price)) variantInvalidPriceCount++
	}

	const orphanProductImages: { imageId: number; productId: number }[] = []
	for (const img of productImgs) {
		if (!productIds.has(img.productId)) orphanProductImages.push({ imageId: img.id, productId: img.productId })
	}

	const orphanVariantImages: { imageId: number; productId: number; variantId: number }[] = []
	for (const img of productVariableImgs) {
		if (!variantIds.has(img.variableId) || !productIds.has(img.productId)) {
			orphanVariantImages.push({ imageId: img.id, productId: img.productId, variantId: img.variableId })
		}
	}

	// Category hierarchy depth: parent_id = 0 means root (confirmed DEFAULT 0
	// in the schema, not NULL). A cycle would make this loop forever, so it's
	// bounded defensively and any unresolved chain is reported as broken
	// rather than looped on.
	const categoryById = new Map(categories.map(c => [c.id, c]))
	const brokenParentRefs: { categoryId: number; parentId: number }[] = []
	let maxDepth = 0
	let rootCount = 0
	for (const c of categories) {
		if (c.parentId === null || c.parentId === 0) {
			rootCount++
			continue
		}
		if (!categoryById.has(c.parentId)) {
			brokenParentRefs.push({ categoryId: c.id, parentId: c.parentId })
			continue
		}
		let depth = 0
		let current: typeof c | undefined = c
		const seen = new Set<number>()
		while (current && current.parentId !== null && current.parentId !== 0 && depth < 50) {
			if (seen.has(current.id)) break // cycle guard
			seen.add(current.id)
			current = categoryById.get(current.parentId)
			depth++
		}
		maxDepth = Math.max(maxDepth, depth)
	}

	return {
		counts: {
			products: products.length,
			productVariables: productVariables.length,
			brands: brands.length,
			categories: categories.length,
			productCategories: productCategories.length,
			productImgs: productImgs.length,
			productVariableImgs: productVariableImgs.length,
			stores: stores.length,
			storeImgs: storeImgs.length,
			productsMore: productsMore.length
		},
		products: {
			published,
			hidden,
			withVariants,
			withoutVariants,
			withRuTitle,
			withRoTitle,
			withBothRuRo,
			withNeitherRuRo,
			multiCategory,
			withoutBrand,
			withoutCategory,
			withoutImages,
			withInvalidOrMissingPrice,
			withZeroPrice,
			invalidBrandReferences,
			invalidCategoryReferences,
			duplicateGuids: groupDuplicates(products.map(p => ({ id: p.id, value: p.guid }))),
			duplicateSkus: groupDuplicates(products.map(p => ({ id: p.id, value: p.sku }))),
			duplicateRuSlugs: groupDuplicates(products.map(p => ({ id: p.id, value: p.uriRu }))),
			duplicateRoSlugs: groupDuplicates(products.map(p => ({ id: p.id, value: p.uriRo })))
		},
		variants: {
			orphanVariants,
			duplicateSkus: groupDuplicates(productVariables.map(v => ({ id: v.id, value: v.sku }))),
			withInvalidOrMissingPrice: variantInvalidPriceCount
		},
		categories: {
			maxDepth,
			rootCount,
			brokenParentRefs,
			duplicateGuids: groupDuplicates(categories.map(c => ({ id: c.id, value: c.guid })))
		},
		media: {
			orphanProductImages,
			orphanVariantImages
		}
	}
}
