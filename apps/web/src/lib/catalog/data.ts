import type { Brand, CatalogFilters, Product, ProductCategoryGroup, Store } from '@/types/catalog'
import { mockBrands, findBrandBySlug, findBrandById } from '@/data/mock/brands'
import { mockCategories, categoryGroupToRootId } from '@/data/mock/categories'
import { mockProducts } from '@/data/mock/products'
import { mockStores } from '@/data/mock/stores'
import { heroSlides, featuredCategoryGroups, freeDeliveryThresholdBani } from '@/data/mock/home'

/**
 * Thin, fixture-backed data access layer (Sprint 11 Task 15). Every
 * function here is async even though the current implementation is
 * synchronous in-memory filtering, so UI components never need to change
 * when this is later swapped for real apps/api calls.
 */

function lowestPriceBani(product: Product): number {
	return Math.min(...product.variants.map(v => v.priceBani))
}

function isInStock(product: Product): boolean {
	return product.variants.some(v => v.quantityOnHand > 0)
}

export async function getBrands(): Promise<Brand[]> {
	return mockBrands
}

export async function getBrandBySlug(slug: string): Promise<Brand | undefined> {
	return findBrandBySlug(slug)
}

export async function getBrandProducts(brandId: string): Promise<Product[]> {
	return mockProducts.filter(p => p.brandId === brandId)
}

export async function getStores(): Promise<Store[]> {
	return mockStores
}

export async function getProductBySlug(locale: 'ru' | 'ro', slug: string): Promise<Product | undefined> {
	return mockProducts.find(p => p.slug[locale] === slug || p.slug.ru === slug)
}

export type CatalogResult = {
	products: Product[]
	total: number
	page: number
	pageSize: number
}

export async function getCatalogProducts(filters: CatalogFilters = {}): Promise<CatalogResult> {
	const page = filters.page ?? 1
	const pageSize = filters.pageSize ?? 12

	let results = [...mockProducts]

	if (filters.categoryGroup) {
		results = results.filter(p => p.categoryGroup === filters.categoryGroup)
	}
	if (filters.brandSlug) {
		const brand = findBrandBySlug(filters.brandSlug)
		results = brand ? results.filter(p => p.brandId === brand.id) : []
	}
	if (filters.minPriceBani !== undefined) {
		const min = filters.minPriceBani
		results = results.filter(p => lowestPriceBani(p) >= min)
	}
	if (filters.maxPriceBani !== undefined) {
		const max = filters.maxPriceBani
		results = results.filter(p => lowestPriceBani(p) <= max)
	}
	if (filters.inStockOnly) {
		results = results.filter(isInStock)
	}

	switch (filters.sort) {
		case 'price-asc':
			results.sort((a, b) => lowestPriceBani(a) - lowestPriceBani(b))
			break
		case 'price-desc':
			results.sort((a, b) => lowestPriceBani(b) - lowestPriceBani(a))
			break
		case 'name-asc':
			results.sort((a, b) => a.name.ru.localeCompare(b.name.ru, 'ru'))
			break
		case 'newest':
		default:
			results.sort((a, b) => Number(b.isNew) - Number(a.isNew))
			break
	}

	const total = results.length
	const start = (page - 1) * pageSize
	const paged = results.slice(start, start + pageSize)

	return { products: paged, total, page, pageSize }
}

export function priceBounds(): { min: number; max: number } {
	const prices = mockProducts.flatMap(p => p.variants.map(v => v.priceBani))
	return { min: Math.min(...prices), max: Math.max(...prices) }
}

export async function searchProducts(query: string): Promise<Product[]> {
	const q = query.trim().toLowerCase()
	if (!q) return []

	return mockProducts.filter(product => {
		const brand = findBrandById(product.brandId)
		const haystack = [
			product.name.ru,
			product.name.ro ?? '',
			brand?.name ?? '',
			product.categoryGroup,
			...product.variants.map(v => v.sku),
			...product.variants.map(v => v.idNom ?? '')
		]
			.join(' ')
			.toLowerCase()
		return haystack.includes(q)
	})
}

export type HomeData = {
	hero: typeof heroSlides
	featuredCategoryGroups: ProductCategoryGroup[]
	discounted: Product[]
	bestsellers: Product[]
	newArrivals: Product[]
	featuredBrands: Brand[]
	freeDeliveryThresholdBani: number
}

export async function getHomeData(): Promise<HomeData> {
	return {
		hero: heroSlides,
		featuredCategoryGroups,
		discounted: mockProducts.filter(p => p.variants.some(v => v.compareAtPriceBani !== null)).slice(0, 8),
		bestsellers: mockProducts.filter(p => p.isHit).slice(0, 8),
		newArrivals: mockProducts.filter(p => p.isNew).slice(0, 8),
		featuredBrands: mockBrands.slice(0, 6),
		freeDeliveryThresholdBani
	}
}

export { mockCategories, categoryGroupToRootId, findBrandById }
