import {
	fetchCategoriesForProducts,
	fetchSkusForProducts,
	listAllActiveProductsForIndexing,
	type ProductListRow
} from '../db/queries/products'
import { queryClient } from '../db/client'
import {
	configureProductsIndex,
	fetchAllIndexedProductIds,
	indexProducts,
	removeProductsFromIndex,
	type ProductSearchDocument
} from './products-index'

function toSearchDocument(
	row: ProductListRow,
	categories: { id: string; slug: string; nameRu: string; nameRo: string }[],
	skus: string[]
): ProductSearchDocument {
	return {
		id: row.id,
		slug: row.slug,
		nameRu: row.nameRu,
		nameRo: row.nameRo,
		descriptionRu: row.descriptionRu,
		descriptionRo: row.descriptionRo,
		brandId: row.brandId,
		brandSlug: row.brandSlug,
		brandNameRu: row.brandNameRu,
		brandNameRo: row.brandNameRo,
		categoryIds: categories.map(category => category.id),
		categorySlugs: categories.map(category => category.slug),
		categoryNamesRu: categories.map(category => category.nameRu),
		categoryNamesRo: categories.map(category => category.nameRo),
		skus,
		minPrice: row.minPrice,
		maxPrice: row.maxPrice,
		currency: row.currency,
		inStock: row.inStock,
		createdAtTimestamp: new Date(row.createdAt).getTime()
	}
}

/**
 * Full catalog reindex: PostgreSQL is the source of truth, Meilisearch only
 * ever derives from it. Safe to rerun at any time (addDocuments upserts by
 * id, and any document no longer active/sellable is removed at the end).
 */
export async function reindexProducts() {
	await configureProductsIndex()

	const rows = await listAllActiveProductsForIndexing()
	const productIds = rows.map(row => row.id)

	const [categoriesByProduct, skusByProduct] = await Promise.all([
		fetchCategoriesForProducts(productIds),
		fetchSkusForProducts(productIds)
	])

	const documents = rows.map(row =>
		toSearchDocument(row, categoriesByProduct.get(row.id) ?? [], skusByProduct.get(row.id) ?? [])
	)

	await indexProducts(documents)

	const indexedIds = await fetchAllIndexedProductIds()
	const activeIds = new Set(productIds)
	const staleIds = indexedIds.filter(id => !activeIds.has(id))
	await removeProductsFromIndex(staleIds)

	return { indexed: documents.length, removed: staleIds.length }
}

if (import.meta.main) {
	reindexProducts()
		.then(result => {
			console.log(`Reindexed ${result.indexed} products, removed ${result.removed} stale documents`)
			return queryClient.end()
		})
		.then(() => process.exit(0))
		.catch(error => {
			console.error('Reindex failed:', error)
			process.exit(1)
		})
}
