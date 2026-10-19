import { and, asc, desc, eq, exists, gte, inArray, lte, sql, type SQL } from 'drizzle-orm'
import { db } from '../client'
import { brands } from '../schema/brands'
import { categories } from '../schema/categories'
import { inventory } from '../schema/inventory'
import { productCategories } from '../schema/product-categories'
import { productImages } from '../schema/product-images'
import { productPrices } from '../schema/product-prices'
import { productVariants } from '../schema/product-variants'
import { products } from '../schema/products'
import type { Locale } from '../../lib/locale'
import type { Pagination } from '../../lib/pagination'

export type ProductSort = 'price_asc' | 'price_desc' | 'newest' | 'name_asc' | 'name_desc'

export type ProductListFilters = {
	productId?: string
	brandSlug?: string
	categoryIds?: string[]
	minPrice?: number
	maxPrice?: number
	inStock?: boolean
}

// A variant only counts as sellable/"published" once it is active AND has a
// price row - without a price there is nothing to charge, so it should not
// surface (or drive price/stock aggregates) in the public catalog. isActive
// and having a price are independent: a priced variant can still be switched
// off, and a newly created active variant may not be priced yet.
const PUBLISHED_VARIANT_CONDITION = eq(productVariants.isActive, true)

const priceAggregate = db
	.select({
		productId: productVariants.productId,
		minPrice: sql<number>`min(${productPrices.price})`.as('min_price'),
		maxPrice: sql<number>`max(${productPrices.price})`.as('max_price'),
		currency: sql<string>`min(${productPrices.currency})`.as('currency'),
		inStock: sql<boolean>`bool_or(coalesce(${inventory.quantity}, 0) > 0)`.as('in_stock')
	})
	.from(productVariants)
	.innerJoin(productPrices, eq(productPrices.variantId, productVariants.id))
	.leftJoin(inventory, eq(inventory.variantId, productVariants.id))
	.where(PUBLISHED_VARIANT_CONDITION)
	.groupBy(productVariants.productId)
	.as('price_aggregate')

function buildFilters(filters: ProductListFilters): SQL[] {
	const conditions: SQL[] = [eq(products.status, 'active')]

	if (filters.productId) {
		conditions.push(eq(products.id, filters.productId))
	}

	if (filters.brandSlug) {
		conditions.push(eq(brands.slug, filters.brandSlug))
	}

	if (filters.categoryIds && filters.categoryIds.length > 0) {
		conditions.push(
			exists(
				db
					.select({ one: sql`1` })
					.from(productCategories)
					.where(
						and(
							eq(productCategories.productId, products.id),
							inArray(productCategories.categoryId, filters.categoryIds)
						)
					)
			)
		)
	}

	if (filters.minPrice !== undefined) {
		conditions.push(gte(priceAggregate.maxPrice, filters.minPrice))
	}

	if (filters.maxPrice !== undefined) {
		conditions.push(lte(priceAggregate.minPrice, filters.maxPrice))
	}

	if (filters.inStock !== undefined) {
		conditions.push(eq(priceAggregate.inStock, filters.inStock))
	}

	return conditions
}

function baseListQuery(filters: ProductListFilters) {
	return db
		.select({
			id: products.id,
			slug: products.slug,
			nameRu: products.nameRu,
			nameRo: products.nameRo,
			descriptionRu: products.descriptionRu,
			descriptionRo: products.descriptionRo,
			createdAt: products.createdAt,
			brandId: brands.id,
			brandSlug: brands.slug,
			brandNameRu: brands.nameRu,
			brandNameRo: brands.nameRo,
			minPrice: priceAggregate.minPrice,
			maxPrice: priceAggregate.maxPrice,
			currency: priceAggregate.currency,
			inStock: priceAggregate.inStock
		})
		.from(products)
		.innerJoin(priceAggregate, eq(priceAggregate.productId, products.id))
		.leftJoin(brands, eq(brands.id, products.brandId))
		.where(and(...buildFilters(filters)))
}

function orderFor(sort: ProductSort, lang: Locale) {
	const nameColumn = lang === 'ro' ? products.nameRo : products.nameRu
	switch (sort) {
		case 'price_asc':
			return asc(priceAggregate.minPrice)
		case 'price_desc':
			return desc(priceAggregate.minPrice)
		case 'name_asc':
			return asc(nameColumn)
		case 'name_desc':
			return desc(nameColumn)
		case 'newest':
		default:
			return desc(products.createdAt)
	}
}

export type ProductListRow = Awaited<ReturnType<typeof baseListQuery>>[number]

export async function listProducts(
	pagination: Pagination,
	sort: ProductSort,
	lang: Locale,
	filters: ProductListFilters
): Promise<{ items: ProductListRow[]; total: number }> {
	const [items, totalRows] = await Promise.all([
		baseListQuery(filters)
			.orderBy(orderFor(sort, lang), asc(products.id))
			.limit(pagination.limit)
			.offset((pagination.page - 1) * pagination.limit),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(products)
			.innerJoin(priceAggregate, eq(priceAggregate.productId, products.id))
			.leftJoin(brands, eq(brands.id, products.brandId))
			.where(and(...buildFilters(filters)))
	])

	return { items, total: totalRows[0]?.count ?? 0 }
}

/** Every active, sellable product, for a full Meilisearch reindex. No pagination: a dedicated reindex command, not a request handler. */
export async function listAllActiveProductsForIndexing(): Promise<ProductListRow[]> {
	return baseListQuery({}).orderBy(asc(products.id))
}

/**
 * A single product's publishable row (active status + at least one published
 * variant), or null when it is missing, draft/archived, or has no published
 * variant left - the three cases the search sync service must treat as
 * "remove from the index" rather than "index this".
 */
export async function getPublishableProductRowById(
	productId: string
): Promise<ProductListRow | null> {
	const [row] = await baseListQuery({ productId }).limit(1)
	return row ?? null
}

/** Batch-fetch published (active + priced) variant SKUs for a set of product ids in a single query (no N+1). */
export async function fetchSkusForProducts(productIds: string[]) {
	if (productIds.length === 0) return new Map<string, string[]>()

	const rows = await db
		.select({ productId: productVariants.productId, sku: productVariants.sku })
		.from(productVariants)
		.innerJoin(productPrices, eq(productPrices.variantId, productVariants.id))
		.where(and(inArray(productVariants.productId, productIds), PUBLISHED_VARIANT_CONDITION))

	const map = new Map<string, string[]>()
	for (const row of rows) {
		const list = map.get(row.productId) ?? []
		list.push(row.sku)
		map.set(row.productId, list)
	}
	return map
}

/** Batch-fetch categories for a set of product ids in a single query (no N+1). */
export async function fetchCategoriesForProducts(productIds: string[]) {
	if (productIds.length === 0) return new Map<string, { id: string; slug: string; nameRu: string; nameRo: string }[]>()

	const rows = await db
		.select({
			productId: productCategories.productId,
			id: categories.id,
			slug: categories.slug,
			nameRu: categories.nameRu,
			nameRo: categories.nameRo
		})
		.from(productCategories)
		.innerJoin(categories, eq(categories.id, productCategories.categoryId))
		.where(inArray(productCategories.productId, productIds))

	const map = new Map<string, { id: string; slug: string; nameRu: string; nameRo: string }[]>()
	for (const row of rows) {
		const list = map.get(row.productId) ?? []
		list.push({ id: row.id, slug: row.slug, nameRu: row.nameRu, nameRo: row.nameRo })
		map.set(row.productId, list)
	}
	return map
}

/** Batch-fetch the cover image (lowest sortOrder, product-level) for a set of product ids. */
export async function fetchCoverImagesForProducts(productIds: string[]) {
	if (productIds.length === 0) return new Map<string, { id: string; url: string; altRu: string | null; altRo: string | null }>()

	const rows = await db
		.select({
			productId: productImages.productId,
			id: productImages.id,
			url: productImages.url,
			altRu: productImages.altRu,
			altRo: productImages.altRo,
			sortOrder: productImages.sortOrder
		})
		.from(productImages)
		.where(inArray(productImages.productId, productIds))
		.orderBy(asc(productImages.sortOrder))

	const map = new Map<string, { id: string; url: string; altRu: string | null; altRo: string | null }>()
	for (const row of rows) {
		if (!map.has(row.productId)) {
			map.set(row.productId, { id: row.id, url: row.url, altRu: row.altRu, altRo: row.altRo })
		}
	}
	return map
}

export async function getProductBySlug(slug: string) {
	const [product] = await db
		.select({
			id: products.id,
			slug: products.slug,
			nameRu: products.nameRu,
			nameRo: products.nameRo,
			descriptionRu: products.descriptionRu,
			descriptionRo: products.descriptionRo,
			createdAt: products.createdAt,
			updatedAt: products.updatedAt,
			brandId: brands.id,
			brandSlug: brands.slug,
			brandNameRu: brands.nameRu,
			brandNameRo: brands.nameRo
		})
		.from(products)
		.leftJoin(brands, eq(brands.id, products.brandId))
		.where(and(eq(products.slug, slug), eq(products.status, 'active')))
		.limit(1)

	if (!product) return null

	const [categoryRows, variantRows, imageRows] = await Promise.all([
		db
			.select({
				id: categories.id,
				slug: categories.slug,
				nameRu: categories.nameRu,
				nameRo: categories.nameRo
			})
			.from(productCategories)
			.innerJoin(categories, eq(categories.id, productCategories.categoryId))
			.where(eq(productCategories.productId, product.id)),
		db
			.select({
				id: productVariants.id,
				sku: productVariants.sku,
				nameRu: productVariants.nameRu,
				nameRo: productVariants.nameRo,
				price: productPrices.price,
				compareAtPrice: productPrices.compareAtPrice,
				currency: productPrices.currency,
				quantity: sql<number>`coalesce(${inventory.quantity}, 0)`
			})
			.from(productVariants)
			.innerJoin(productPrices, eq(productPrices.variantId, productVariants.id))
			.leftJoin(inventory, eq(inventory.variantId, productVariants.id))
			.where(and(eq(productVariants.productId, product.id), PUBLISHED_VARIANT_CONDITION)),
		db
			.select({
				id: productImages.id,
				url: productImages.url,
				altRu: productImages.altRu,
				altRo: productImages.altRo,
				variantId: productImages.variantId,
				sortOrder: productImages.sortOrder
			})
			.from(productImages)
			.where(eq(productImages.productId, product.id))
			.orderBy(asc(productImages.sortOrder))
	])

	// Consistent with the list endpoint (INNER JOINed on priceAggregate): a
	// product with no published variant has nothing to sell and must not be
	// publicly reachable either, even by direct slug lookup.
	if (variantRows.length === 0) return null

	return { product, categories: categoryRows, variants: variantRows, images: imageRows }
}
