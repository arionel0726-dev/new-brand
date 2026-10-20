import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthVariables } from '../../auth/middleware'
import { requireAuth } from '../../auth/middleware'
import { fetchCoverImagesForProducts } from '../../db/queries/products'
import {
	addWishlistItem,
	isProductPubliclyActive,
	listWishlistForUser,
	removeWishlistItem,
	type WishlistListRow
} from '../../db/queries/wishlist'
import { localeSchema, localize, type Locale } from '../../lib/locale'
import { buildPageMeta, paginationSchema } from '../../lib/pagination'
import { okWithMeta, ok } from '../../lib/respond'
import { validateJson, validateParam, validateQuery } from '../../lib/validate'
import { AppError } from '../../middleware/error-handler'

const listQuerySchema = paginationSchema.extend({ lang: localeSchema.default('ru') })
const addItemSchema = z.object({ productId: z.uuid() })
const productParamSchema = z.object({ productId: z.uuid() })

function serializeItem(
	row: WishlistListRow,
	lang: Locale,
	cover?: { id: string; url: string; altRu: string | null; altRo: string | null }
) {
	// A product that was wishlisted while public and has since gone
	// draft/archived, or lost every sellable variant, stays in the list -
	// just marked unavailable, never silently dropped or hidden from its
	// own owner.
	const available = row.status === 'active' && row.minPrice !== null

	return {
		id: row.id,
		productId: row.productId,
		slug: row.slug,
		name: localize(lang, row.nameRu, row.nameRo),
		available,
		price: available ? { from: row.minPrice, to: row.maxPrice, currency: row.currency } : null,
		inStock: available ? row.inStock : null,
		cover: cover ? { id: cover.id, url: cover.url, alt: localize(lang, cover.altRu, cover.altRo) } : null,
		createdAt: row.createdAt
	}
}

export const wishlistRoute = new Hono<{ Variables: AuthVariables }>()
	.use('*', requireAuth)
	.get('/', validateQuery(listQuerySchema), async c => {
		const query = c.req.valid('query')
		const user = c.get('user')

		const { items, total } = await listWishlistForUser(user.id, { page: query.page, limit: query.limit })
		const coversByProduct = await fetchCoverImagesForProducts(items.map(item => item.productId))

		const data = items.map(item => serializeItem(item, query.lang, coversByProduct.get(item.productId)))
		return okWithMeta(c, data, buildPageMeta({ page: query.page, limit: query.limit }, total))
	})
	.post('/', validateJson(addItemSchema), async c => {
		const { productId } = c.req.valid('json')
		const user = c.get('user')

		// Same 404 whether the id doesn't exist at all or belongs to a
		// draft/archived product - never lets a client distinguish "no such
		// product" from "that product isn't public yet".
		if (!(await isProductPubliclyActive(productId))) {
			throw new AppError('Product not found', 404, 'product_not_found')
		}

		const { created } = await addWishlistItem(user.id, productId)
		return ok(c, { productId }, created ? 201 : 200)
	})
	.delete('/:productId', validateParam(productParamSchema), async c => {
		const { productId } = c.req.valid('param')
		const user = c.get('user')

		const removed = await removeWishlistItem(user.id, productId)
		if (!removed) {
			throw new AppError('Wishlist item not found', 404, 'wishlist_item_not_found')
		}

		return ok(c, { productId })
	})

export type WishlistRouteType = typeof wishlistRoute
