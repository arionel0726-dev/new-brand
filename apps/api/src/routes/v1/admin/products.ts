import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthVariables } from '../../../auth/middleware'
import {
	createVariantForProduct,
	listVariantsForProduct,
	type VariantWithStock
} from '../../../db/queries/admin-variants'
import {
	createProduct,
	getAdminProductById,
	listAdminProducts,
	updateProduct,
	type ProductRow
} from '../../../db/queries/admin-products'
import { fetchCategoriesForProducts } from '../../../db/queries/products'
import { buildPageMeta, paginationSchema } from '../../../lib/pagination'
import { okWithMeta, ok } from '../../../lib/respond'
import { idParamSchema, validateJson, validateParam, validateQuery } from '../../../lib/validate'
import { AppError } from '../../../middleware/error-handler'
import { syncProductToIndex } from '../../../search/sync'

const slugSchema = z
	.string()
	.min(1)
	.max(200)
	.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug must be lowercase, numbers and single hyphens only')

const createProductSchema = z.object({
	brandId: z.uuid().nullable().optional(),
	slug: slugSchema,
	nameRu: z.string().min(1),
	nameRo: z.string().min(1),
	descriptionRu: z.string().nullable().optional(),
	descriptionRo: z.string().nullable().optional(),
	categoryIds: z.array(z.uuid()).optional()
})

const updateProductSchema = createProductSchema.partial().extend({
	status: z.enum(['draft', 'active', 'archived']).optional()
})

const listQuerySchema = paginationSchema.extend({
	status: z.enum(['draft', 'active', 'archived']).optional(),
	brandId: z.uuid().optional()
})

const createVariantSchema = z.object({
	sku: z.string().min(1).max(100),
	barcode: z.string().min(1).max(100).nullable().optional(),
	nameRu: z.string().nullable().optional(),
	nameRo: z.string().nullable().optional(),
	isActive: z.boolean().optional(),
	sortOrder: z.number().int().optional()
})

function serializeProduct(product: ProductRow, categoryIds: string[]) {
	return {
		id: product.id,
		brandId: product.brandId,
		slug: product.slug,
		nameRu: product.nameRu,
		nameRo: product.nameRo,
		descriptionRu: product.descriptionRu,
		descriptionRo: product.descriptionRo,
		status: product.status,
		categoryIds,
		createdAt: product.createdAt,
		updatedAt: product.updatedAt
	}
}

function serializeVariant(variant: VariantWithStock) {
	return {
		id: variant.id,
		productId: variant.productId,
		sku: variant.sku,
		barcode: variant.barcode,
		nameRu: variant.nameRu,
		nameRo: variant.nameRo,
		isActive: variant.isActive,
		sortOrder: variant.sortOrder,
		price: variant.price,
		compareAtPrice: variant.compareAtPrice,
		currency: variant.currency,
		quantityOnHand: variant.quantityOnHand,
		quantityReserved: variant.quantityReserved,
		createdAt: variant.createdAt,
		updatedAt: variant.updatedAt
	}
}

/**
 * Best-effort Meilisearch sync after a write that can change what the public
 * API/search would show for this product (publish, archive, rename, ...).
 * Never blocks or fails the request - see src/search/sync.ts for why.
 */
async function syncAfterWrite(productId: string) {
	const outcome = await syncProductToIndex(productId)
	if (outcome.status === 'error') {
		console.error(`[admin] search sync failed for product ${productId}:`, outcome.message)
	}
}

export const adminProductsRoute = new Hono<{ Variables: AuthVariables }>()
	.get('/', validateQuery(listQuerySchema), async c => {
		const query = c.req.valid('query')
		const { items, total } = await listAdminProducts(
			{ page: query.page, limit: query.limit },
			{ status: query.status, brandId: query.brandId }
		)
		const categoriesByProduct = await fetchCategoriesForProducts(items.map(item => item.id))
		return okWithMeta(
			c,
			items.map(product =>
				serializeProduct(
					product,
					(categoriesByProduct.get(product.id) ?? []).map(category => category.id)
				)
			),
			buildPageMeta({ page: query.page, limit: query.limit }, total)
		)
	})
	.get('/:id', validateParam(idParamSchema), async c => {
		const { id } = c.req.valid('param')
		const result = await getAdminProductById(id)
		if (!result) throw new AppError('Product not found', 404, 'product_not_found')
		return ok(c, serializeProduct(result.product, result.categoryIds))
	})
	.post('/', validateJson(createProductSchema), async c => {
		const body = c.req.valid('json')
		const { product, categoryIds } = await createProduct(body)
		return ok(c, serializeProduct(product, categoryIds), 201)
	})
	.patch('/:id', validateParam(idParamSchema), validateJson(updateProductSchema), async c => {
		const { id } = c.req.valid('param')
		const body = c.req.valid('json')

		const result = await updateProduct(id, body)
		if (!result) throw new AppError('Product not found', 404, 'product_not_found')

		await syncAfterWrite(id)

		return ok(c, serializeProduct(result.product, result.categoryIds))
	})
	.get('/:id/variants', validateParam(idParamSchema), async c => {
		const { id } = c.req.valid('param')
		const product = await getAdminProductById(id)
		if (!product) throw new AppError('Product not found', 404, 'product_not_found')

		const variants = await listVariantsForProduct(id)
		return ok(c, variants.map(serializeVariant))
	})
	.post(
		'/:id/variants',
		validateParam(idParamSchema),
		validateJson(createVariantSchema),
		async c => {
			const { id } = c.req.valid('param')
			const body = c.req.valid('json')

			const product = await getAdminProductById(id)
			if (!product) throw new AppError('Product not found', 404, 'product_not_found')

			const variant = await createVariantForProduct(id, body)
			await syncAfterWrite(id)

			return ok(
				c,
				serializeVariant({
					...variant,
					price: null,
					compareAtPrice: null,
					currency: null,
					quantityOnHand: null,
					quantityReserved: null
				}),
				201
			)
		}
	)

export type AdminProductsRouteType = typeof adminProductsRoute
