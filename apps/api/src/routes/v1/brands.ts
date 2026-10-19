import { Hono } from 'hono'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { brands } from '../../db/schema/brands'
import { AppError } from '../../middleware/error-handler'
import { ok } from '../../lib/respond'

function serializeBrand(brand: typeof brands.$inferSelect) {
	return {
		id: brand.id,
		slug: brand.slug,
		nameRu: brand.nameRu,
		nameRo: brand.nameRo,
		descriptionRu: brand.descriptionRu,
		descriptionRo: brand.descriptionRo
	}
}

export const brandsRoute = new Hono()
	.get('/', async c => {
		const rows = await db
			.select()
			.from(brands)
			.where(eq(brands.isActive, true))
			.orderBy(asc(brands.sortOrder), asc(brands.nameRu))
		return ok(
			c,
			rows.map(serializeBrand)
		)
	})
	.get('/:slug', async c => {
		const slug = c.req.param('slug')
		const [brand] = await db
			.select()
			.from(brands)
			.where(and(eq(brands.slug, slug), eq(brands.isActive, true)))
			.limit(1)

		if (!brand) {
			throw new AppError('Brand not found', 404, 'brand_not_found')
		}

		return ok(c, serializeBrand(brand))
	})

export type BrandsRouteType = typeof brandsRoute
