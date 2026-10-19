import { Hono } from 'hono'
import { z } from 'zod'
import { localeSchema, localize, type Locale } from '../../lib/locale'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../lib/pagination'
import { okWithMeta } from '../../lib/respond'
import { validateQuery } from '../../lib/validate'
import { AppError } from '../../middleware/error-handler'
import { getProductsIndex, type ProductSearchDocument } from '../../search/products-index'

const searchQuerySchema = z.object({
	q: z.string().trim().min(1, 'q is required'),
	lang: localeSchema.default('ru'),
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
	brand: z.string().min(1).optional(),
	category: z.string().min(1).optional(),
	minPrice: z.coerce.number().int().min(0).optional(),
	maxPrice: z.coerce.number().int().min(0).optional(),
	inStock: z
		.enum(['true', 'false'])
		.transform(value => value === 'true')
		.optional()
})

function escapeFilterValue(value: string) {
	return value.replace(/"/g, '\\"')
}

function buildFilter(query: z.infer<typeof searchQuerySchema>): string[] {
	const filters: string[] = []

	if (query.brand) {
		filters.push(`brandSlug = "${escapeFilterValue(query.brand)}"`)
	}
	if (query.category) {
		filters.push(`categorySlugs = "${escapeFilterValue(query.category)}"`)
	}
	if (query.minPrice !== undefined) {
		filters.push(`maxPrice >= ${query.minPrice}`)
	}
	if (query.maxPrice !== undefined) {
		filters.push(`minPrice <= ${query.maxPrice}`)
	}
	if (query.inStock !== undefined) {
		filters.push(`inStock = ${query.inStock}`)
	}

	return filters
}

function serializeHit(hit: ProductSearchDocument, lang: Locale) {
	const categories = hit.categoryIds.map((id, index) => ({
		id,
		slug: hit.categorySlugs[index],
		name: localize(lang, hit.categoryNamesRu[index], hit.categoryNamesRo[index])
	}))

	return {
		id: hit.id,
		slug: hit.slug,
		name: localize(lang, hit.nameRu, hit.nameRo),
		description: localize(lang, hit.descriptionRu, hit.descriptionRo),
		brand: hit.brandId
			? { id: hit.brandId, slug: hit.brandSlug, name: localize(lang, hit.brandNameRu, hit.brandNameRo) }
			: null,
		categories,
		price: { from: hit.minPrice, to: hit.maxPrice, currency: hit.currency },
		inStock: hit.inStock
	}
}

export const searchRoute = new Hono().get('/', validateQuery(searchQuerySchema), async c => {
	const query = c.req.valid('query')
	const filters = buildFilter(query)

	const result = await getProductsIndex()
		.search(query.q, {
			filter: filters.length > 0 ? filters.join(' AND ') : undefined,
			page: query.page,
			hitsPerPage: query.limit,
			sort: ['createdAtTimestamp:desc']
		})
		.catch(error => {
			throw new AppError('Search is temporarily unavailable', 503, 'search_unavailable', {
				cause: error instanceof Error ? error.message : String(error)
			})
		})

	const hits = 'hits' in result ? result.hits : []
	const totalHits = 'totalHits' in result ? result.totalHits : hits.length
	const totalPages = 'totalPages' in result ? result.totalPages : 1

	return okWithMeta(
		c,
		hits.map(hit => serializeHit(hit, query.lang)),
		{ page: query.page, limit: query.limit, total: totalHits, totalPages }
	)
})

export type SearchRouteType = typeof searchRoute
