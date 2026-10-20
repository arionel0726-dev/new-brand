import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthVariables } from '../../../auth/middleware'
import {
	createCollection,
	deleteCollection,
	getAdminCollectionById,
	getCollectionMembers,
	listAdminCollections,
	updateCollection,
	type CollectionRow
} from '../../../db/queries/admin-collections'
import { buildPageMeta, paginationSchema } from '../../../lib/pagination'
import { okWithMeta, ok } from '../../../lib/respond'
import { idParamSchema, validateJson, validateParam, validateQuery } from '../../../lib/validate'
import { AppError } from '../../../middleware/error-handler'

const slugSchema = z
	.string()
	.min(1)
	.max(200)
	.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug must be lowercase, numbers and single hyphens only')

const memberSchema = z.object({
	productId: z.string().uuid(),
	sortOrder: z.number().int().optional()
})

const createCollectionSchema = z.object({
	slug: slugSchema,
	titleRu: z.string().trim().min(1),
	titleRo: z.string().trim().min(1),
	descriptionRu: z.string().nullable().optional(),
	descriptionRo: z.string().nullable().optional(),
	isActive: z.boolean().optional(),
	sortOrder: z.number().int().optional(),
	products: z.array(memberSchema).optional()
})

const updateCollectionSchema = createCollectionSchema.partial()

const listQuerySchema = paginationSchema.extend({
	isActive: z
		.enum(['true', 'false'])
		.transform(value => value === 'true')
		.optional(),
	search: z.string().min(1).optional()
})

async function serializeCollection(collection: CollectionRow) {
	const members = await getCollectionMembers(collection.id)
	return {
		id: collection.id,
		slug: collection.slug,
		titleRu: collection.titleRu,
		titleRo: collection.titleRo,
		descriptionRu: collection.descriptionRu,
		descriptionRo: collection.descriptionRo,
		isActive: collection.isActive,
		sortOrder: collection.sortOrder,
		products: members,
		createdAt: collection.createdAt,
		updatedAt: collection.updatedAt
	}
}

export const adminCollectionsRoute = new Hono<{ Variables: AuthVariables }>()
	.get('/', validateQuery(listQuerySchema), async c => {
		const query = c.req.valid('query')
		const { items, total } = await listAdminCollections(
			{ page: query.page, limit: query.limit },
			{ isActive: query.isActive, search: query.search }
		)
		const data = await Promise.all(items.map(serializeCollection))
		return okWithMeta(c, data, buildPageMeta({ page: query.page, limit: query.limit }, total))
	})
	.get('/:id', validateParam(idParamSchema), async c => {
		const { id } = c.req.valid('param')
		const collection = await getAdminCollectionById(id)
		if (!collection) throw new AppError('Collection not found', 404, 'collection_not_found')
		return ok(c, await serializeCollection(collection))
	})
	.post('/', validateJson(createCollectionSchema), async c => {
		const body = c.req.valid('json')
		const collection = await createCollection(body)
		return ok(c, await serializeCollection(collection), 201)
	})
	.patch('/:id', validateParam(idParamSchema), validateJson(updateCollectionSchema), async c => {
		const { id } = c.req.valid('param')
		const body = c.req.valid('json')
		const collection = await updateCollection(id, body)
		if (!collection) throw new AppError('Collection not found', 404, 'collection_not_found')
		return ok(c, await serializeCollection(collection))
	})
	.delete('/:id', validateParam(idParamSchema), async c => {
		const { id } = c.req.valid('param')
		const deleted = await deleteCollection(id)
		if (!deleted) throw new AppError('Collection not found', 404, 'collection_not_found')
		return ok(c, { id })
	})

export type AdminCollectionsRouteType = typeof adminCollectionsRoute
