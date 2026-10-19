import { Hono } from 'hono'
import { AppError } from '../../middleware/error-handler'
import { localeSchema } from '../../lib/locale'
import { ok } from '../../lib/respond'
import { validateQuery } from '../../lib/validate'
import {
	buildCategoryTree,
	fetchAllCategories,
	findChildren
} from '../../db/queries/categories'
import { z } from 'zod'

const listQuerySchema = z.object({ lang: localeSchema.default('ru') })

function serializeCategory(category: {
	id: string
	slug: string
	nameRu: string
	nameRo: string
	descriptionRu: string | null
	descriptionRo: string | null
	parentId: string | null
}) {
	return {
		id: category.id,
		slug: category.slug,
		nameRu: category.nameRu,
		nameRo: category.nameRo,
		descriptionRu: category.descriptionRu,
		descriptionRo: category.descriptionRo,
		parentId: category.parentId
	}
}

function serializeTree(nodes: ReturnType<typeof buildCategoryTree>): unknown[] {
	return nodes.map(node => ({
		...serializeCategory(node),
		children: serializeTree(node.children)
	}))
}

export const categoriesRoute = new Hono()
	.get('/', validateQuery(listQuerySchema), async c => {
		const rows = await fetchAllCategories()
		const tree = buildCategoryTree(rows)
		return ok(c, serializeTree(tree))
	})
	.get('/:slug', async c => {
		const slug = c.req.param('slug')
		const rows = await fetchAllCategories()
		const category = rows.find(row => row.slug === slug)

		if (!category) {
			throw new AppError('Category not found', 404, 'category_not_found')
		}

		const children = findChildren(rows, category.id)

		return ok(c, {
			...serializeCategory(category),
			children: children.map(serializeCategory)
		})
	})

export type CategoriesRouteType = typeof categoriesRoute
