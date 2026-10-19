import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthVariables } from '../../../auth/middleware'
import {
	createCategory,
	getAdminCategoryById,
	listAdminCategories,
	updateCategory,
	wouldCreateCycle,
	type CategoryRow
} from '../../../db/queries/admin-categories'
import { buildPageMeta, paginationSchema } from '../../../lib/pagination'
import { okWithMeta, ok } from '../../../lib/respond'
import { idParamSchema, validateJson, validateParam, validateQuery } from '../../../lib/validate'
import { AppError } from '../../../middleware/error-handler'

const slugSchema = z
	.string()
	.min(1)
	.max(200)
	.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug must be lowercase, numbers and single hyphens only')

const createCategorySchema = z.object({
	slug: slugSchema,
	parentId: z.uuid().nullable().optional(),
	nameRu: z.string().min(1),
	nameRo: z.string().min(1),
	descriptionRu: z.string().nullable().optional(),
	descriptionRo: z.string().nullable().optional(),
	isActive: z.boolean().optional(),
	sortOrder: z.number().int().optional()
})

const updateCategorySchema = createCategorySchema.partial()

const listQuerySchema = paginationSchema.extend({
	isActive: z
		.enum(['true', 'false'])
		.transform(value => value === 'true')
		.optional(),
	parentId: z.union([z.uuid(), z.literal('null')]).optional(),
	search: z.string().min(1).optional()
})

function serializeCategory(category: CategoryRow) {
	return {
		id: category.id,
		slug: category.slug,
		parentId: category.parentId,
		nameRu: category.nameRu,
		nameRo: category.nameRo,
		descriptionRu: category.descriptionRu,
		descriptionRo: category.descriptionRo,
		isActive: category.isActive,
		sortOrder: category.sortOrder,
		createdAt: category.createdAt,
		updatedAt: category.updatedAt
	}
}

export const adminCategoriesRoute = new Hono<{ Variables: AuthVariables }>()
	.get('/', validateQuery(listQuerySchema), async c => {
		const query = c.req.valid('query')
		const { items, total } = await listAdminCategories(
			{ page: query.page, limit: query.limit },
			{
				isActive: query.isActive,
				parentId: query.parentId === undefined ? undefined : query.parentId === 'null' ? null : query.parentId,
				search: query.search
			}
		)
		return okWithMeta(
			c,
			items.map(serializeCategory),
			buildPageMeta({ page: query.page, limit: query.limit }, total)
		)
	})
	.get('/:id', validateParam(idParamSchema), async c => {
		const { id } = c.req.valid('param')
		const category = await getAdminCategoryById(id)
		if (!category) throw new AppError('Category not found', 404, 'category_not_found')
		return ok(c, serializeCategory(category))
	})
	.post('/', validateJson(createCategorySchema), async c => {
		const body = c.req.valid('json')
		const category = await createCategory(body)
		return ok(c, serializeCategory(category), 201)
	})
	.patch('/:id', validateParam(idParamSchema), validateJson(updateCategorySchema), async c => {
		const { id } = c.req.valid('param')
		const body = c.req.valid('json')

		if ('parentId' in body) {
			if (body.parentId === id) {
				throw new AppError('A category cannot be its own parent', 400, 'invalid_parent')
			}
			if (await wouldCreateCycle(id, body.parentId)) {
				throw new AppError(
					'This would create a cyclic category hierarchy',
					400,
					'cyclic_category_hierarchy'
				)
			}
		}

		const category = await updateCategory(id, body)
		if (!category) throw new AppError('Category not found', 404, 'category_not_found')
		return ok(c, serializeCategory(category))
	})

export type AdminCategoriesRouteType = typeof adminCategoriesRoute
