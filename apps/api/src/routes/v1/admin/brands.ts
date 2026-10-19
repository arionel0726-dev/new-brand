import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthVariables } from '../../../auth/middleware'
import {
	createBrand,
	getAdminBrandById,
	listAdminBrands,
	updateBrand,
	type BrandRow
} from '../../../db/queries/admin-brands'
import { buildPageMeta, paginationSchema } from '../../../lib/pagination'
import { okWithMeta, ok } from '../../../lib/respond'
import { idParamSchema, validateJson, validateParam, validateQuery } from '../../../lib/validate'
import { AppError } from '../../../middleware/error-handler'

const slugSchema = z
	.string()
	.min(1)
	.max(200)
	.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug must be lowercase, numbers and single hyphens only')

const createBrandSchema = z.object({
	slug: slugSchema,
	nameRu: z.string().min(1),
	nameRo: z.string().min(1),
	descriptionRu: z.string().nullable().optional(),
	descriptionRo: z.string().nullable().optional(),
	isActive: z.boolean().optional(),
	sortOrder: z.number().int().optional()
})

const updateBrandSchema = createBrandSchema.partial()

const listQuerySchema = paginationSchema.extend({
	isActive: z
		.enum(['true', 'false'])
		.transform(value => value === 'true')
		.optional(),
	search: z.string().min(1).optional()
})

function serializeBrand(brand: BrandRow) {
	return {
		id: brand.id,
		slug: brand.slug,
		nameRu: brand.nameRu,
		nameRo: brand.nameRo,
		descriptionRu: brand.descriptionRu,
		descriptionRo: brand.descriptionRo,
		isActive: brand.isActive,
		sortOrder: brand.sortOrder,
		createdAt: brand.createdAt,
		updatedAt: brand.updatedAt
	}
}

export const adminBrandsRoute = new Hono<{ Variables: AuthVariables }>()
	.get('/', validateQuery(listQuerySchema), async c => {
		const query = c.req.valid('query')
		const { items, total } = await listAdminBrands(
			{ page: query.page, limit: query.limit },
			{ isActive: query.isActive, search: query.search }
		)
		return okWithMeta(
			c,
			items.map(serializeBrand),
			buildPageMeta({ page: query.page, limit: query.limit }, total)
		)
	})
	.get('/:id', validateParam(idParamSchema), async c => {
		const { id } = c.req.valid('param')
		const brand = await getAdminBrandById(id)
		if (!brand) throw new AppError('Brand not found', 404, 'brand_not_found')
		return ok(c, serializeBrand(brand))
	})
	.post('/', validateJson(createBrandSchema), async c => {
		const body = c.req.valid('json')
		const brand = await createBrand(body)
		return ok(c, serializeBrand(brand), 201)
	})
	.patch('/:id', validateParam(idParamSchema), validateJson(updateBrandSchema), async c => {
		const { id } = c.req.valid('param')
		const body = c.req.valid('json')
		const brand = await updateBrand(id, body)
		if (!brand) throw new AppError('Brand not found', 404, 'brand_not_found')
		return ok(c, serializeBrand(brand))
	})

export type AdminBrandsRouteType = typeof adminBrandsRoute
