import type { Context } from 'hono'
import {
	createGuestCart,
	getActiveCartByUserId,
	getCartByGuestTokenHash,
	getOrCreateUserCart,
	type CartRow
} from '../db/queries/cart'
import { generateGuestToken, hashGuestToken, resolveIdentity, setGuestCartCookie } from './identity'

/**
 * Resolves the caller's cart without creating one. Null means "no cart
 * exists yet" - routes that only read or mutate an existing item should
 * 404 on that, not conjure a cart just to find nothing in it.
 */
export async function resolveExistingCart(c: Context): Promise<CartRow | null> {
	const identity = await resolveIdentity(c)
	if (identity.type === 'user') {
		return getActiveCartByUserId(identity.userId)
	}
	if (!identity.token) return null
	return getCartByGuestTokenHash(hashGuestToken(identity.token))
}

/**
 * Resolves the caller's cart, creating one if none exists yet. For a
 * first-time guest (no cookie, or one that doesn't match any active cart)
 * this also issues and sets a fresh guest cookie - self-healing a
 * missing/stale one rather than erroring.
 */
export async function resolveOrCreateCart(c: Context): Promise<CartRow> {
	const identity = await resolveIdentity(c)
	if (identity.type === 'user') {
		return getOrCreateUserCart(identity.userId)
	}

	if (identity.token) {
		const existing = await getCartByGuestTokenHash(hashGuestToken(identity.token))
		if (existing) return existing
	}

	const token = generateGuestToken()
	const cart = await createGuestCart(hashGuestToken(token))
	setGuestCartCookie(c, token)
	return cart
}
