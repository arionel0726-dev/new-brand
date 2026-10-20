import { Hono } from 'hono'
import { z } from 'zod'
import { getCollectionMembers } from '../../db/queries/admin-collections'
import { getActiveCollectionBySlug, listActiveCollections, type CollectionRow } from '../../db/queries/collections'
import {
	fetchCategoriesForProducts,
	fetchCoverImagesForProducts,
	listPublishableProductsByIds,
	type ProductListRow
} from '../../db/queries/products'
import { localeSchema, localize, type Locale } from '../../lib/locale'
import { buildPageMeta, paginationSchema } from '../../lib/pagination'
import { okWithMeta, ok } from '../../lib/respond'
import { validateQuery } from '../../lib/validate'
import { AppError } from '../../middleware/error-handler'

const listQuerySchema = z.object({ lang: localeSchema.default('ru') })
const detailQuerySchema = paginationSchema.extend({ lang: localeSchema.default('ru') })

function serializeCollectionSummary(collection: CollectionRow, lang: Locale) {
	return {
		id: collection.id,
		slug: collection.slug,
		title: localize(lang, collection.titleRu, collection.titleRo),
		description: localize(lang, collection.descriptionRu, collection.descriptionRo)
	}
}

// Identical shape to GET /api/v1/products (src/routes/v1/products.ts) - a
// collection is just a curated, differently-ordered view over the same
// Catalog API product rows, so a frontend can reuse one product-card
// component for both.
function serializeProductListItem(
	row: ProductListRow,
	lang: Locale,
	categoriesForRow: { id: string; slug: string; nameRu: string; nameRo: string }[],
	cover?: { id: string; url: string; altRu: string | null; altRo: string | null }
) {
	return {
		id: row.id,
		slug: row.slug,
		name: localize(lang, row.nameRu, row.nameRo),
		description: localize(lang, row.descriptionRu, row.descriptionRo),
		brand: row.brandId
			? { id: row.brandId, slug: row.brandSlug, name: localize(lang, row.brandNameRu, row.brandNameRo) }
			: null,
		categories: categoriesForRow.map(category => ({
			id: category.id,
			slug: category.slug,
			name: localize(lang, category.nameRu, category.nameRo)
		})),
		price: { from: row.minPrice, to: row.maxPrice, currency: row.currency },
		inStock: row.inStock,
		cover: cover ? { id: cover.id, url: cover.url, alt: localize(lang, cover.altRu, cover.altRo) } : null,
		createdAt: row.createdAt
	}
}

export const collectionsRoute = new Hono()
	.get('/', validateQuery(listQuerySchema), async c => {
		const { lang } = c.req.valid('query')
		const items = await listActiveCollections()
		return ok(
			c,
			items.map(item => serializeCollectionSummary(item, lang))
		)
	})
	.get('/:slug', validateQuery(detailQuerySchema), async c => {
		const slug = c.req.param('slug')
		const { lang, page, limit } = c.req.valid('query')

		const collection = await getActiveCollectionBySlug(slug)
		if (!collection) {
			throw new AppError('Collection not found', 404, 'collection_not_found')
		}

		// Curated membership + its order (Task 7) - then narrowed to only
		// what's actually publishable right now (reusing the exact same
		// "active status + published variant" rule the rest of the Catalog
		// API enforces), since a product can be archived or run out of its
		// last published variant without anyone updating the collection.
		const members = await getCollectionMembers(collection.id)
		const publishable = await listPublishableProductsByIds(members.map(member => member.productId))
		const publishableById = new Map(publishable.map(row => [row.id, row]))
		const orderedRows = members
			.map(member => publishableById.get(member.productId))
			.filter((row): row is ProductListRow => row !== undefined)

		const total = orderedRows.length
		const pageRows = orderedRows.slice((page - 1) * limit, (page - 1) * limit + limit)

		const productIds = pageRows.map(row => row.id)
		const [categoriesByProduct, coversByProduct] = await Promise.all([
			fetchCategoriesForProducts(productIds),
			fetchCoverImagesForProducts(productIds)
		])

		const data = pageRows.map(row =>
			serializeProductListItem(row, lang, categoriesByProduct.get(row.id) ?? [], coversByProduct.get(row.id))
		)

		return okWithMeta(c, { collection: serializeCollectionSummary(collection, lang), items: data }, buildPageMeta({ page, limit }, total))
	})

export type CollectionsRouteType = typeof collectionsRoute
