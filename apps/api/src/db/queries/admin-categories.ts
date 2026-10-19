import { and, asc, count, eq, ilike, isNull } from 'drizzle-orm'
import { db } from '../client'
import { categories } from '../schema/categories'
import type { Pagination } from '../../lib/pagination'

export type CategoryRow = typeof categories.$inferSelect

export type AdminCategoryListFilters = {
	isActive?: boolean
	parentId?: string | null
	search?: string
}

function buildFilters(filters: AdminCategoryListFilters) {
	const conditions = []
	if (filters.isActive !== undefined) conditions.push(eq(categories.isActive, filters.isActive))
	if (filters.parentId !== undefined) {
		conditions.push(
			filters.parentId === null
				? isNull(categories.parentId)
				: eq(categories.parentId, filters.parentId)
		)
	}
	if (filters.search) conditions.push(ilike(categories.nameRu, `%${filters.search}%`))
	return conditions.length > 0 ? and(...conditions) : undefined
}

export async function listAdminCategories(
	pagination: Pagination,
	filters: AdminCategoryListFilters
) {
	const where = buildFilters(filters)

	const [items, totalRows] = await Promise.all([
		db
			.select()
			.from(categories)
			.where(where)
			.orderBy(asc(categories.sortOrder), asc(categories.nameRu))
			.limit(pagination.limit)
			.offset((pagination.page - 1) * pagination.limit),
		db.select({ count: count() }).from(categories).where(where)
	])

	return { items, total: totalRows[0]?.count ?? 0 }
}

export async function getAdminCategoryById(id: string): Promise<CategoryRow | null> {
	const [row] = await db.select().from(categories).where(eq(categories.id, id)).limit(1)
	return row ?? null
}

export type CreateCategoryInput = {
	slug: string
	parentId?: string | null
	nameRu: string
	nameRo: string
	descriptionRu?: string | null
	descriptionRo?: string | null
	isActive?: boolean
	sortOrder?: number
}

export async function createCategory(input: CreateCategoryInput): Promise<CategoryRow> {
	const [row] = await db.insert(categories).values(input).returning()
	return row
}

export type UpdateCategoryInput = Partial<CreateCategoryInput>

export async function updateCategory(
	id: string,
	input: UpdateCategoryInput
): Promise<CategoryRow | null> {
	const [row] = await db
		.update(categories)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(categories.id, id))
		.returning()
	return row ?? null
}

/**
 * Walks the parent chain starting at `newParentId` looking for `categoryId`.
 * Used before an update that changes parentId, since the FK alone can't
 * express "no cycles" - only existence and ON DELETE RESTRICT.
 */
export async function wouldCreateCycle(
	categoryId: string,
	newParentId: string | null | undefined
): Promise<boolean> {
	if (!newParentId) return false
	if (newParentId === categoryId) return true

	const rows = await db.select({ id: categories.id, parentId: categories.parentId }).from(categories)
	const parentById = new Map(rows.map(row => [row.id, row.parentId]))

	let current: string | null = newParentId
	const visited = new Set<string>()
	while (current) {
		if (current === categoryId) return true
		if (visited.has(current)) break // defensive: FKs should prevent this
		visited.add(current)
		current = parentById.get(current) ?? null
	}
	return false
}
