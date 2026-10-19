import { searchClient } from './client'

export const PRODUCTS_INDEX = 'products'

export type ProductSearchDocument = {
	id: string
	slug: string
	nameRu: string
	nameRo: string
	descriptionRu: string | null
	descriptionRo: string | null
	brandId: string | null
	brandSlug: string | null
	brandNameRu: string | null
	brandNameRo: string | null
	categoryIds: string[]
	categorySlugs: string[]
	categoryNamesRu: string[]
	categoryNamesRo: string[]
	skus: string[]
	minPrice: number | null
	maxPrice: number | null
	currency: string | null
	inStock: boolean
	createdAtTimestamp: number
}

export function getProductsIndex() {
	return searchClient.index<ProductSearchDocument>(PRODUCTS_INDEX)
}

/** Idempotent: safe to call on every reindex run and on server startup. */
export async function configureProductsIndex() {
	const index = getProductsIndex()
	await index
		.updateSettings({
			searchableAttributes: [
				'nameRu',
				'nameRo',
				'descriptionRu',
				'descriptionRo',
				'brandNameRu',
				'brandNameRo',
				'categoryNamesRu',
				'categoryNamesRo',
				'skus',
				'slug'
			],
			filterableAttributes: [
				'brandId',
				'brandSlug',
				'categoryIds',
				'categorySlugs',
				'minPrice',
				'maxPrice',
				'inStock'
			],
			sortableAttributes: ['minPrice', 'maxPrice', 'createdAtTimestamp', 'nameRu', 'nameRo']
		})
		.waitTask()
	return index
}

export async function indexProducts(documents: ProductSearchDocument[]) {
	if (documents.length === 0) return
	await getProductsIndex().addDocuments(documents, { primaryKey: 'id' }).waitTask()
}

export async function removeProductsFromIndex(productIds: string[]) {
	if (productIds.length === 0) return
	await getProductsIndex().deleteDocuments(productIds).waitTask()
}

/** All document ids currently stored in the index, paginated internally. */
export async function fetchAllIndexedProductIds(): Promise<string[]> {
	const index = getProductsIndex()
	const ids: string[] = []
	const pageSize = 1000
	let offset = 0

	while (true) {
		const page = await index.getDocuments<{ id: string }>({
			fields: ['id'],
			limit: pageSize,
			offset
		})
		ids.push(...page.results.map(doc => doc.id))
		if (page.results.length < pageSize) break
		offset += pageSize
	}

	return ids
}
