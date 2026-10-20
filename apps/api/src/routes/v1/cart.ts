import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { z } from 'zod'
import type { AuthVariables } from '../../auth/middleware'
import { requireAuth } from '../../auth/middleware'
import { MAX_CART_ITEM_QUANTITY } from '../../cart/constants'
import { GUEST_CART_COOKIE, clearGuestCartCookie, hashGuestToken } from '../../cart/identity'
import { resolveExistingCart, resolveOrCreateCart } from '../../cart/resolve'
import { emptyCartView, serializeCart } from '../../cart/serialize'
import {
	addOrIncrementCartItem,
	clearCartItems,
	getOrCreateUserCart,
	getVariantSellability,
	isSellable,
	mergeGuestCartIntoUserCart,
	removeCartItem,
	setCartItemQuantity
} from '../../db/queries/cart'
import { localeSchema } from '../../lib/locale'
import { ok } from '../../lib/respond'
import { validateJson, validateParam, validateQuery } from '../../lib/validate'
import { AppError } from '../../middleware/error-handler'

const cartQuerySchema = z.object({ lang: localeSchema.default('ru') })

const addItemSchema = z.object({
	variantId: z.uuid(),
	quantity: z.number().int().min(1).max(MAX_CART_ITEM_QUANTITY).default(1)
})

const updateItemSchema = z.object({
	quantity: z.number().int().min(1).max(MAX_CART_ITEM_QUANTITY)
})

const itemParamSchema = z.object({ id: z.uuid() })

export const cartRoute = new Hono<{ Variables: AuthVariables }>()
	.get('/', validateQuery(cartQuerySchema), async c => {
		const { lang } = c.req.valid('query')
		const cart = await resolveOrCreateCart(c)
		return ok(c, await serializeCart(cart, lang))
	})
	.post('/items', validateQuery(cartQuerySchema), validateJson(addItemSchema), async c => {
		const { lang } = c.req.valid('query')
		const { variantId, quantity } = c.req.valid('json')

		const variant = await getVariantSellability(variantId)
		if (!variant) {
			throw new AppError('Variant not found', 404, 'variant_not_found')
		}
		if (!isSellable(variant)) {
			throw new AppError(
				'This variant is not currently available for purchase',
				422,
				'variant_not_available'
			)
		}

		const cart = await resolveOrCreateCart(c)
		await addOrIncrementCartItem(cart.id, variantId, quantity)

		return ok(c, await serializeCart(cart, lang), 201)
	})
	.patch(
		'/items/:id',
		validateParam(itemParamSchema),
		validateQuery(cartQuerySchema),
		validateJson(updateItemSchema),
		async c => {
			const { id } = c.req.valid('param')
			const { lang } = c.req.valid('query')
			const { quantity } = c.req.valid('json')

			// resolveExistingCart only ever resolves to *this caller's own* cart
			// (by session user id or by the hash of their own guest cookie) -
			// there is no code path that lets a client reach someone else's cart.
			const cart = await resolveExistingCart(c)
			if (!cart) {
				throw new AppError('Cart item not found', 404, 'cart_item_not_found')
			}

			const updated = await setCartItemQuantity(cart.id, id, quantity)
			if (!updated) {
				throw new AppError('Cart item not found', 404, 'cart_item_not_found')
			}

			return ok(c, await serializeCart(cart, lang))
		}
	)
	.delete('/items/:id', validateParam(itemParamSchema), validateQuery(cartQuerySchema), async c => {
		const { id } = c.req.valid('param')
		const { lang } = c.req.valid('query')

		const cart = await resolveExistingCart(c)
		if (!cart) {
			throw new AppError('Cart item not found', 404, 'cart_item_not_found')
		}

		const removed = await removeCartItem(cart.id, id)
		if (!removed) {
			throw new AppError('Cart item not found', 404, 'cart_item_not_found')
		}

		return ok(c, await serializeCart(cart, lang))
	})
	.delete('/', validateQuery(cartQuerySchema), async c => {
		const { lang } = c.req.valid('query')

		const cart = await resolveExistingCart(c)
		if (!cart) {
			return ok(c, emptyCartView())
		}

		await clearCartItems(cart.id)
		return ok(c, await serializeCart(cart, lang))
	})
	.post('/merge', validateQuery(cartQuerySchema), requireAuth, async c => {
		const { lang } = c.req.valid('query')
		const user = c.get('user')

		// The only source of the cart to merge is the caller's own guest
		// cookie - never a client-supplied cart or user id. Read directly
		// (not via resolveIdentity, which always prefers the now-authenticated
		// session and would never report a guest token here).
		const guestToken = getCookie(c, GUEST_CART_COOKIE) ?? null

		let mergeOutcome = { merged: false, mergedItemCount: 0 }
		if (guestToken) {
			mergeOutcome = await mergeGuestCartIntoUserCart(user.id, hashGuestToken(guestToken))
			// Whether or not there was anything left to merge, this token is
			// spent: a retry can't double-apply because the guest cart it
			// pointed at either never matched or was already deleted.
			clearGuestCartCookie(c)
		}

		const cart = await getOrCreateUserCart(user.id)
		return ok(c, {
			merged: mergeOutcome.merged,
			mergedItemCount: mergeOutcome.mergedItemCount,
			cart: await serializeCart(cart, lang)
		})
	})

export type CartRouteType = typeof cartRoute
