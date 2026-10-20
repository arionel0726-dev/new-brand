import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../client'
import type { Pagination } from '../../lib/pagination'
import { products } from '../schema/products'
import { wishlistItems } from '../schema/wishlist-items'
import { priceAggregate } from './products'

export type WishlistItemRow = typeof wishlistItems.$inferSelect

export type WishlistListRow = {
	id: string
	productId: string
	slug: string
	nameRu: string
	nameRo: string
	status: string
	minPrice: number | null
	maxPrice: number | null
	currency: string | null
	inStock: boolean | null
	createdAt: Date
}

function wishlistQuery(userId: string) {
	return db
		.select({
			id: wishlistItems.id,
			productId: products.id,
			slug: products.slug,
			nameRu: products.nameRu,
			nameRo: products.nameRo,
			status: products.status,
			minPrice: priceAggregate.minPrice,
			maxPrice: priceAggregate.maxPrice,
			currency: priceAggregate.currency,
			inStock: priceAggregate.inStock,
			createdAt: wishlistItems.createdAt
		})
		.from(wishlistItems)
		.innerJoin(products, eq(products.id, wishlistItems.productId))
		.leftJoin(priceAggregate, eq(priceAggregate.productId, products.id))
		.where(eq(wishlistItems.userId, userId))
}

/**
 * A user's own wishlist, status and all - unlike the public catalog, this
 * never hides an archived/draft product from its owner (it just gets
 * marked unavailable at the route layer). Still never reveals it to anyone
 * but that one user, since every query here is scoped by userId.
 */
export async function listWishlistForUser(
	userId: string,
	pagination: Pagination
): Promise<{ items: WishlistListRow[]; total: number }> {
	const [items, totalRows] = await Promise.all([
		wishlistQuery(userId)
			.orderBy(desc(wishlistItems.createdAt))
			.limit(pagination.limit)
			.offset((pagination.page - 1) * pagination.limit),
		db.select({ count: sql<number>`count(*)::int` }).from(wishlistItems).where(eq(wishlistItems.userId, userId))
	])
	return { items, total: totalRows[0]?.count ?? 0 }
}

/** Only ever true for a product that is currently publicly listable - callers must not let a client wishlist an id they merely guessed. */
export async function isProductPubliclyActive(productId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: products.id })
		.from(products)
		.where(and(eq(products.id, productId), eq(products.status, 'active')))
		.limit(1)
	return Boolean(row)
}

/** Idempotent: a repeat add for the same (userId, productId) is a no-op, never an error and never a duplicate row. */
export async function addWishlistItem(
	userId: string,
	productId: string
): Promise<{ item: WishlistItemRow; created: boolean }> {
	const [inserted] = await db
		.insert(wishlistItems)
		.values({ userId, productId })
		.onConflictDoNothing({ target: [wishlistItems.userId, wishlistItems.productId] })
		.returning()
	if (inserted) return { item: inserted, created: true }

	const [existing] = await db
		.select()
		.from(wishlistItems)
		.where(and(eq(wishlistItems.userId, userId), eq(wishlistItems.productId, productId)))
		.limit(1)
	return { item: existing, created: false }
}

/** Scoped to `userId` so a caller can only ever remove their own wishlist entry. */
export async function removeWishlistItem(userId: string, productId: string): Promise<boolean> {
	const result = await db
		.delete(wishlistItems)
		.where(and(eq(wishlistItems.userId, userId), eq(wishlistItems.productId, productId)))
		.returning({ id: wishlistItems.id })
	return result.length > 0
}
