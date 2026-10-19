import { and, asc, count, eq, ilike } from 'drizzle-orm'
import { db } from '../client'
import { brands } from '../schema/brands'
import type { Pagination } from '../../lib/pagination'

export type BrandRow = typeof brands.$inferSelect

export type AdminBrandListFilters = {
	isActive?: boolean
	search?: string
}

function buildFilters(filters: AdminBrandListFilters) {
	const conditions = []
	if (filters.isActive !== undefined) conditions.push(eq(brands.isActive, filters.isActive))
	if (filters.search) conditions.push(ilike(brands.nameRu, `%${filters.search}%`))
	return conditions.length > 0 ? and(...conditions) : undefined
}

export async function listAdminBrands(pagination: Pagination, filters: AdminBrandListFilters) {
	const where = buildFilters(filters)

	const [items, totalRows] = await Promise.all([
		db
			.select()
			.from(brands)
			.where(where)
			.orderBy(asc(brands.sortOrder), asc(brands.nameRu))
			.limit(pagination.limit)
			.offset((pagination.page - 1) * pagination.limit),
		db.select({ count: count() }).from(brands).where(where)
	])

	return { items, total: totalRows[0]?.count ?? 0 }
}

export async function getAdminBrandById(id: string): Promise<BrandRow | null> {
	const [row] = await db.select().from(brands).where(eq(brands.id, id)).limit(1)
	return row ?? null
}

export type CreateBrandInput = {
	slug: string
	nameRu: string
	nameRo: string
	descriptionRu?: string | null
	descriptionRo?: string | null
	isActive?: boolean
	sortOrder?: number
}

export async function createBrand(input: CreateBrandInput): Promise<BrandRow> {
	const [row] = await db.insert(brands).values(input).returning()
	return row
}

export type UpdateBrandInput = Partial<CreateBrandInput>

export async function updateBrand(id: string, input: UpdateBrandInput): Promise<BrandRow | null> {
	const [row] = await db
		.update(brands)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(brands.id, id))
		.returning()
	return row ?? null
}
