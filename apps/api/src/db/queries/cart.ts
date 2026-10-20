import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '../client'
import { MAX_CART_ITEM_QUANTITY } from '../../cart/constants'
import { cartItems, carts } from '../schema/carts'
import { inventory } from '../schema/inventory'
import { productPrices } from '../schema/product-prices'
import { productVariants } from '../schema/product-variants'
import { products } from '../schema/products'

export type CartRow = typeof carts.$inferSelect
export type CartItemRow = typeof cartItems.$inferSelect

export type VariantSellability = {
	variantId: string
	productId: string
	productStatus: string
	variantIsActive: boolean
	hasPrice: boolean
}

/** Everything /cart/items needs to decide whether a variant can be added - never trust that a variant id alone means it's purchasable. */
export async function getVariantSellability(variantId: string): Promise<VariantSellability | null> {
	const [row] = await db
		.select({
			variantId: productVariants.id,
			productId: productVariants.productId,
			productStatus: products.status,
			variantIsActive: productVariants.isActive,
			hasPrice: sql<boolean>`${productPrices.id} is not null`
		})
		.from(productVariants)
		.innerJoin(products, eq(products.id, productVariants.productId))
		.leftJoin(productPrices, eq(productPrices.variantId, productVariants.id))
		.where(eq(productVariants.id, variantId))
		.limit(1)
	return row ?? null
}

export function isSellable(variant: VariantSellability): boolean {
	return variant.productStatus === 'active' && variant.variantIsActive && variant.hasPrice
}

export async function getActiveCartByUserId(userId: string): Promise<CartRow | null> {
	const [row] = await db.select().from(carts).where(eq(carts.userId, userId)).limit(1)
	return row ?? null
}

/** Race-safe get-or-create: a unique constraint on carts.userId backs this, so two concurrent first requests for the same user can't create two cart rows. */
export async function getOrCreateUserCart(userId: string): Promise<CartRow> {
	const existing = await getActiveCartByUserId(userId)
	if (existing) return existing

	const [inserted] = await db
		.insert(carts)
		.values({ userId })
		.onConflictDoNothing({ target: carts.userId })
		.returning()
	if (inserted) return inserted

	// Lost the race to a concurrent request creating this user's cart.
	const row = await getActiveCartByUserId(userId)
	if (!row) throw new Error('Failed to get or create user cart')
	return row
}

export async function getCartByGuestTokenHash(guestTokenHash: string): Promise<CartRow | null> {
	const [row] = await db
		.select()
		.from(carts)
		.where(and(eq(carts.guestTokenHash, guestTokenHash), eq(carts.status, 'active')))
		.limit(1)
	return row ?? null
}

export async function createGuestCart(guestTokenHash: string): Promise<CartRow> {
	const [row] = await db.insert(carts).values({ guestTokenHash }).returning()
	return row
}

export async function getCartItemById(cartId: string, itemId: string): Promise<CartItemRow | null> {
	const [row] = await db
		.select()
		.from(cartItems)
		.where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cartId)))
		.limit(1)
	return row ?? null
}

/**
 * Adds `quantity` units of a variant to a cart, or increments the existing
 * line if it's already there - atomically, via ON CONFLICT, so two
 * concurrent "add to cart" requests for the same variant can't race each
 * other into inconsistent quantities. Always clamped to
 * MAX_CART_ITEM_QUANTITY, never silently dropped.
 */
export async function addOrIncrementCartItem(
	cartId: string,
	variantId: string,
	quantity: number
): Promise<CartItemRow> {
	const [row] = await db
		.insert(cartItems)
		.values({ cartId, variantId, quantity: Math.min(quantity, MAX_CART_ITEM_QUANTITY) })
		.onConflictDoUpdate({
			target: [cartItems.cartId, cartItems.variantId],
			set: {
				quantity: sql`least(${cartItems.quantity} + ${quantity}, ${MAX_CART_ITEM_QUANTITY})`,
				updatedAt: new Date()
			}
		})
		.returning()
	return row
}

/** Absolute set (not an increment) - used by PATCH. Scoped to `cartId` so it can never touch another cart's item. */
export async function setCartItemQuantity(
	cartId: string,
	itemId: string,
	quantity: number
): Promise<CartItemRow | null> {
	const [row] = await db
		.update(cartItems)
		.set({ quantity, updatedAt: new Date() })
		.where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cartId)))
		.returning()
	return row ?? null
}

/** Scoped to `cartId` so it can never delete another cart's item. Returns the deleted row, or null if it wasn't there (or belonged to a different cart). */
export async function removeCartItem(cartId: string, itemId: string): Promise<CartItemRow | null> {
	const [row] = await db
		.delete(cartItems)
		.where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cartId)))
		.returning()
	return row ?? null
}

export async function clearCartItems(cartId: string): Promise<void> {
	await db.delete(cartItems).where(eq(cartItems.cartId, cartId))
}

export type CartItemDetailRow = {
	id: string
	variantId: string
	quantity: number
	createdAt: Date
	productId: string
	productSlug: string
	productNameRu: string
	productNameRo: string
	productStatus: string
	variantSku: string
	variantNameRu: string | null
	variantNameRo: string | null
	variantIsActive: boolean
	price: number | null
	compareAtPrice: number | null
	currency: string | null
	quantityOnHand: number | null
	quantityReserved: number | null
}

/**
 * Everything needed to render a cart line with *live* price/stock - never
 * from anything stored on cart_items itself, which only ever holds
 * (variantId, quantity). Left-joins price/inventory because an item can
 * legitimately have neither any more (price deleted, variant disabled).
 */
export async function getCartItemDetails(cartId: string): Promise<CartItemDetailRow[]> {
	return db
		.select({
			id: cartItems.id,
			variantId: cartItems.variantId,
			quantity: cartItems.quantity,
			createdAt: cartItems.createdAt,
			productId: products.id,
			productSlug: products.slug,
			productNameRu: products.nameRu,
			productNameRo: products.nameRo,
			productStatus: products.status,
			variantSku: productVariants.sku,
			variantNameRu: productVariants.nameRu,
			variantNameRo: productVariants.nameRo,
			variantIsActive: productVariants.isActive,
			price: productPrices.price,
			compareAtPrice: productPrices.compareAtPrice,
			currency: productPrices.currency,
			quantityOnHand: inventory.quantityOnHand,
			quantityReserved: inventory.quantityReserved
		})
		.from(cartItems)
		.innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
		.innerJoin(products, eq(products.id, productVariants.productId))
		.leftJoin(productPrices, eq(productPrices.variantId, productVariants.id))
		.leftJoin(inventory, eq(inventory.variantId, productVariants.id))
		.where(eq(cartItems.cartId, cartId))
		.orderBy(asc(cartItems.createdAt))
}

export type MergeResult = { merged: boolean; mergedItemCount: number }

/**
 * Moves every item from the guest cart identified by `guestTokenHash` into
 * `userId`'s cart, then deletes the guest cart outright. That deletion is
 * what makes a retried merge call with the same (now-stale) token a no-op:
 * the second call simply finds nothing to merge. Row locks on both carts
 * keep two concurrent merge attempts for the same guest cart from double-
 * applying.
 */
export async function mergeGuestCartIntoUserCart(
	userId: string,
	guestTokenHash: string
): Promise<MergeResult> {
	return db.transaction(async tx => {
		const [guestCart] = await tx
			.select()
			.from(carts)
			.where(and(eq(carts.guestTokenHash, guestTokenHash), eq(carts.status, 'active')))
			.for('update')
			.limit(1)

		if (!guestCart) {
			return { merged: false, mergedItemCount: 0 }
		}

		let [userCart] = await tx.select().from(carts).where(eq(carts.userId, userId)).for('update').limit(1)
		if (!userCart) {
			const [inserted] = await tx.insert(carts).values({ userId }).returning()
			userCart = inserted
		}

		const guestItems = await tx.select().from(cartItems).where(eq(cartItems.cartId, guestCart.id))

		for (const item of guestItems) {
			await tx
				.insert(cartItems)
				.values({ cartId: userCart.id, variantId: item.variantId, quantity: item.quantity })
				.onConflictDoUpdate({
					target: [cartItems.cartId, cartItems.variantId],
					set: {
						quantity: sql`least(${cartItems.quantity} + ${item.quantity}, ${MAX_CART_ITEM_QUANTITY})`,
						updatedAt: new Date()
					}
				})
		}

		// Cascades to the guest cart's (now-empty) cart_items rows too.
		await tx.delete(carts).where(eq(carts.id, guestCart.id))

		return { merged: true, mergedItemCount: guestItems.length }
	})
}
