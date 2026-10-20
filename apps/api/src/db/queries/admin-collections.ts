import { and, asc, count, eq, ilike } from 'drizzle-orm'
import { db } from '../client'
import type { Tx } from '../tx'
import { collectionProducts, collections } from '../schema/collections'
import type { Pagination } from '../../lib/pagination'

export type CollectionRow = typeof collections.$inferSelect

export type CollectionMemberInput = { productId: string; sortOrder?: number }

export type AdminCollectionListFilters = {
	isActive?: boolean
	search?: string
}

export async function listAdminCollections(pagination: Pagination, filters: AdminCollectionListFilters) {
	const conditions = []
	if (filters.isActive !== undefined) conditions.push(eq(collections.isActive, filters.isActive))
	if (filters.search) conditions.push(ilike(collections.titleRu, `%${filters.search}%`))
	const where = conditions.length > 0 ? and(...conditions) : undefined

	const [items, totalRows] = await Promise.all([
		db
			.select()
			.from(collections)
			.where(where)
			.orderBy(asc(collections.sortOrder), asc(collections.titleRu))
			.limit(pagination.limit)
			.offset((pagination.page - 1) * pagination.limit),
		db.select({ count: count() }).from(collections).where(where)
	])

	return { items, total: totalRows[0]?.count ?? 0 }
}

export async function getAdminCollectionById(id: string): Promise<CollectionRow | null> {
	const [row] = await db.select().from(collections).where(eq(collections.id, id)).limit(1)
	return row ?? null
}

/** Ordered by the collection's own curated sortOrder, then productId as a stable tiebreak. */
export async function getCollectionMembers(collectionId: string): Promise<{ productId: string; sortOrder: number }[]> {
	return db
		.select({ productId: collectionProducts.productId, sortOrder: collectionProducts.sortOrder })
		.from(collectionProducts)
		.where(eq(collectionProducts.collectionId, collectionId))
		.orderBy(asc(collectionProducts.sortOrder), asc(collectionProducts.productId))
}

async function writeMembers(tx: Tx, collectionId: string, members: CollectionMemberInput[]): Promise<void> {
	await tx.delete(collectionProducts).where(eq(collectionProducts.collectionId, collectionId))
	if (members.length > 0) {
		await tx.insert(collectionProducts).values(
			members.map(member => ({ collectionId, productId: member.productId, sortOrder: member.sortOrder ?? 0 }))
		)
	}
}

export type CreateCollectionInput = {
	slug: string
	titleRu: string
	titleRo: string
	descriptionRu?: string | null
	descriptionRo?: string | null
	isActive?: boolean
	sortOrder?: number
	products?: CollectionMemberInput[]
}

export async function createCollection(input: CreateCollectionInput): Promise<CollectionRow> {
	const { products, ...values } = input
	return db.transaction(async tx => {
		const [row] = await tx.insert(collections).values(values).returning()
		if (products) await writeMembers(tx, row.id, products)
		return row
	})
}

export type UpdateCollectionInput = Partial<Omit<CreateCollectionInput, 'products'>> & {
	products?: CollectionMemberInput[]
}

export async function updateCollection(id: string, input: UpdateCollectionInput): Promise<CollectionRow | null> {
	const { products, ...values } = input
	return db.transaction(async tx => {
		const [row] = await tx
			.update(collections)
			.set({ ...values, updatedAt: new Date() })
			.where(eq(collections.id, id))
			.returning()
		if (!row) return null
		if (products) await writeMembers(tx, id, products)
		return row
	})
}

/** A pure merchandising list - never referenced by a financial record - so, unlike promotions/coupons, physical deletion is fine. */
export async function deleteCollection(id: string): Promise<boolean> {
	const [row] = await db.delete(collections).where(eq(collections.id, id)).returning({ id: collections.id })
	return row !== undefined
}

export async function getAdminCollectionBySlug(slug: string): Promise<CollectionRow | null> {
	const [row] = await db.select().from(collections).where(eq(collections.slug, slug)).limit(1)
	return row ?? null
}
