import { and, asc, eq } from 'drizzle-orm'
import { db } from '../client'
import { collections } from '../schema/collections'

export type CollectionRow = typeof collections.$inferSelect

/** Public-facing: every active collection, in curated display order. */
export async function listActiveCollections(): Promise<CollectionRow[]> {
	return db
		.select()
		.from(collections)
		.where(eq(collections.isActive, true))
		.orderBy(asc(collections.sortOrder), asc(collections.titleRu))
}

/** Public-facing: a single active collection by slug, or null if missing/inactive - an inactive collection is never reachable by direct slug lookup either (Task 7). */
export async function getActiveCollectionBySlug(slug: string): Promise<CollectionRow | null> {
	const [row] = await db
		.select()
		.from(collections)
		.where(and(eq(collections.slug, slug), eq(collections.isActive, true)))
		.limit(1)
	return row ?? null
}
