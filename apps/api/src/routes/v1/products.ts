import { Hono } from 'hono'
import { z } from 'zod'
import {
	collectDescendantIds,
	fetchAllCategories
} from '../../db/queries/categories'
import {
	fetchCategoriesForProducts,
	fetchCoverImagesForProducts,
	getProductBySlug,
	listProducts,
	type ProductListRow
} from '../../db/queries/products'
import { localeSchema, localize, type Locale } from '../../lib/locale'
import { buildPageMeta, paginationSchema } from '../../lib/pagination'
import { okWithMeta, ok } from '../../lib/respond'
import { validateQuery } from '../../lib/validate'
import { AppError } from '../../middleware/error-handler'

const productsQuerySchema = paginationSchema
	.extend({
		lang: localeSchema.default('ru'),
		sort: z.enum(['price_asc', 'price_desc', 'newest', 'name_asc', 'name_desc']).default('newest'),
		brand: z.string().min(1).optional(),
		category: z.string().min(1).optional(),
		minPrice: z.coerce.number().int().min(0).optional(),
		maxPrice: z.coerce.number().int().min(0).optional(),
		inStock: z
			.enum(['true', 'false'])
			.transform(value => value === 'true')
			.optional()
	})
	.refine(data => data.minPrice === undefined || data.maxPrice === undefined || data.minPrice <= data.maxPrice, {
		message: 'minPrice must be less than or equal to maxPrice',
		path: ['minPrice']
	})

const productQuerySchema = z.object({ lang: localeSchema.default('ru') })

function serializeListItem(row: ProductListRow, lang: Locale, categoriesForRow: { id: string; slug: string; nameRu: string; nameRo: string }[], cover?: { id: string; url: string; altRu: string | null; altRo: string | null }) {
	return {
		id: row.id,
		slug: row.slug,
		name: localize(lang, row.nameRu, row.nameRo),
		description: localize(lang, row.descriptionRu, row.descriptionRo),
		brand: row.brandId
			? {
					id: row.brandId,
					slug: row.brandSlug,
					name: localize(lang, row.brandNameRu, row.brandNameRo)
				}
			: null,
		categories: categoriesForRow.map(category => ({
			id: category.id,
			slug: category.slug,
			name: localize(lang, category.nameRu, category.nameRo)
		})),
		price: {
			from: row.minPrice,
			to: row.maxPrice,
			currency: row.currency
		},
		inStock: row.inStock,
		cover: cover ? { id: cover.id, url: cover.url, alt: localize(lang, cover.altRu, cover.altRo) } : null,
		createdAt: row.createdAt
	}
}

export const productsRoute = new Hono()
	.get('/', validateQuery(productsQuerySchema), async c => {
		const query = c.req.valid('query')

		let categoryIds: string[] | undefined
		if (query.category) {
			const allCategories = await fetchAllCategories()
			const match = allCategories.find(category => category.slug === query.category)
			if (!match) {
				return okWithMeta(c, [], buildPageMeta({ page: query.page, limit: query.limit }, 0))
			}
			categoryIds = collectDescendantIds(allCategories, match.id)
		}

		const { items, total } = await listProducts(
			{ page: query.page, limit: query.limit },
			query.sort,
			query.lang,
			{
				brandSlug: query.brand,
				categoryIds,
				minPrice: query.minPrice,
				maxPrice: query.maxPrice,
				inStock: query.inStock
			}
		)

		const productIds = items.map(item => item.id)
		const [categoriesByProduct, coversByProduct] = await Promise.all([
			fetchCategoriesForProducts(productIds),
			fetchCoverImagesForProducts(productIds)
		])

		const data = items.map(item =>
			serializeListItem(
				item,
				query.lang,
				categoriesByProduct.get(item.id) ?? [],
				coversByProduct.get(item.id)
			)
		)

		return okWithMeta(c, data, buildPageMeta({ page: query.page, limit: query.limit }, total))
	})
	.get('/:slug', validateQuery(productQuerySchema), async c => {
		const slug = c.req.param('slug')
		const { lang } = c.req.valid('query')

		const result = await getProductBySlug(slug)
		if (!result) {
			throw new AppError('Product not found', 404, 'product_not_found')
		}

		const { product, categories, variants, images } = result

		return ok(c, {
			id: product.id,
			slug: product.slug,
			name: localize(lang, product.nameRu, product.nameRo),
			description: localize(lang, product.descriptionRu, product.descriptionRo),
			brand: product.brandId
				? {
						id: product.brandId,
						slug: product.brandSlug,
						name: localize(lang, product.brandNameRu, product.brandNameRo)
					}
				: null,
			categories: categories.map(category => ({
				id: category.id,
				slug: category.slug,
				name: localize(lang, category.nameRu, category.nameRo)
			})),
			variants: variants.map(variant => ({
				id: variant.id,
				sku: variant.sku,
				name: localize(lang, variant.nameRu, variant.nameRo),
				price: variant.price,
				compareAtPrice: variant.compareAtPrice,
				currency: variant.currency,
				quantity: variant.quantity,
				inStock: variant.quantity > 0
			})),
			images: images.map(image => ({
				id: image.id,
				url: image.url,
				alt: localize(lang, image.altRu, image.altRo),
				variantId: image.variantId
			})),
			createdAt: product.createdAt,
			updatedAt: product.updatedAt
		})
	})

export type ProductsRouteType = typeof productsRoute
