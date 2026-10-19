import {
	fetchCategoriesForProducts,
	fetchSkusForProducts,
	listAllActiveProductsForIndexing
} from '../db/queries/products'
import { queryClient } from '../db/client'
import {
	configureProductsIndex,
	fetchAllIndexedProductIds,
	indexProducts,
	removeProductsFromIndex,
	toSearchDocument
} from './products-index'

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
