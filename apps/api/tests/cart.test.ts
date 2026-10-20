import { beforeEach, describe, expect, test } from 'bun:test'
import {
	createSessionAs,
	extractCookieHeader,
	requestJson,
	resetAuthTables,
	resetDatabase
} from './helpers'

beforeEach(async () => {
	await resetDatabase()
	await resetAuthTables()
})

async function staffCookie() {
	const { cookie } = await createSessionAs('staff')
	return cookie
}

/** A product with one active, priced, in-stock variant - ready to add to a cart. */
async function createSellableProduct(cookie: string, quantityOnHand = 10) {
	const suffix = crypto.randomUUID().slice(0, 8)
	const brand = (
		await requestJson('/api/v1/admin/brands', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ slug: `brand-${suffix}`, nameRu: 'Бренд', nameRo: 'Brand' })
		})
	).body.data
	const category = (
		await requestJson('/api/v1/admin/categories', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ slug: `cat-${suffix}`, nameRu: 'Категория', nameRo: 'Categorie' })
		})
	).body.data
	const product = (
		await requestJson('/api/v1/admin/products', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({
				brandId: brand.id,
				slug: `prod-${suffix}`,
				nameRu: 'Крем',
				nameRo: 'Crema',
				categoryIds: [category.id]
			})
		})
	).body.data
	const variant = (
		await requestJson(`/api/v1/admin/products/${product.id}/variants`, {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ sku: `SKU-${suffix}` })
		})
	).body.data
	await requestJson(`/api/v1/admin/variants/${variant.id}/price`, {
		method: 'PUT',
		headers: { Cookie: cookie },
		body: JSON.stringify({ price: 19999 })
	})
	await requestJson(`/api/v1/admin/variants/${variant.id}/inventory`, {
		method: 'PUT',
		headers: { Cookie: cookie },
		body: JSON.stringify({ quantityOnHand })
	})
	await requestJson(`/api/v1/admin/products/${product.id}`, {
		method: 'PATCH',
		headers: { Cookie: cookie },
		body: JSON.stringify({ status: 'active' })
	})
	return { product, variant }
}

async function getGuestCookie(): Promise<string> {
	const res = await requestJson('/api/v1/cart')
	return extractCookieHeader(res.headers)
}

describe('guest cart', () => {
	test('GET creates an empty cart and issues a guest cookie', async () => {
		const res = await requestJson('/api/v1/cart')
		expect(res.status).toBe(200)
		expect(res.body.data.items).toHaveLength(0)
		expect(res.body.data.subtotal).toBe(0)
		expect(extractCookieHeader(res.headers)).toContain('guest_cart_token=')
	})

	test('adds an item and computes the subtotal server-side', async () => {
		const cookie = await staffCookie()
		const { variant } = await createSellableProduct(cookie)

		const guestCookie = await getGuestCookie()
		const res = await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ variantId: variant.id, quantity: 2 })
		})

		expect(res.status).toBe(201)
		expect(res.body.data.items).toHaveLength(1)
		expect(res.body.data.items[0].quantity).toBe(2)
		expect(res.body.data.items[0].unitPrice).toBe(19999)
		expect(res.body.data.items[0].lineTotal).toBe(39998)
		expect(res.body.data.subtotal).toBe(39998)
	})

	test('re-adding the same variant increments quantity instead of duplicating the line', async () => {
		const cookie = await staffCookie()
		const { variant } = await createSellableProduct(cookie)
		const guestCookie = await getGuestCookie()

		await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ variantId: variant.id, quantity: 1 })
		})
		const second = await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ variantId: variant.id, quantity: 1 })
		})

		expect(second.body.data.items).toHaveLength(1)
		expect(second.body.data.items[0].quantity).toBe(2)
	})

	test('clamps quantity at the 99-unit maximum instead of erroring', async () => {
		const cookie = await staffCookie()
		const { variant } = await createSellableProduct(cookie, 500)
		const guestCookie = await getGuestCookie()

		await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ variantId: variant.id, quantity: 99 })
		})
		const res = await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ variantId: variant.id, quantity: 5 })
		})

		expect(res.body.data.items[0].quantity).toBe(99)
	})

	test('changes quantity via PATCH', async () => {
		const cookie = await staffCookie()
		const { variant } = await createSellableProduct(cookie)
		const guestCookie = await getGuestCookie()

		const added = await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ variantId: variant.id, quantity: 1 })
		})
		const itemId = added.body.data.items[0].id

		const res = await requestJson(`/api/v1/cart/items/${itemId}`, {
			method: 'PATCH',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ quantity: 5 })
		})

		expect(res.status).toBe(200)
		expect(res.body.data.items[0].quantity).toBe(5)
	})

	test('rejects a non-positive or non-integer quantity', async () => {
		const cookie = await staffCookie()
		const { variant } = await createSellableProduct(cookie)
		const guestCookie = await getGuestCookie()

		const res = await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ variantId: variant.id, quantity: 0 })
		})
		expect(res.status).toBe(400)
		expect(res.body.error.code).toBe('validation_error')
	})

	test('removes a single line', async () => {
		const cookie = await staffCookie()
		const { variant } = await createSellableProduct(cookie)
		const guestCookie = await getGuestCookie()

		const added = await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ variantId: variant.id, quantity: 1 })
		})
		const itemId = added.body.data.items[0].id

		const res = await requestJson(`/api/v1/cart/items/${itemId}`, {
			method: 'DELETE',
			headers: { Cookie: guestCookie }
		})

		expect(res.status).toBe(200)
		expect(res.body.data.items).toHaveLength(0)
	})

	test('clears the whole cart', async () => {
		const cookie = await staffCookie()
		const a = await createSellableProduct(cookie)
		const b = await createSellableProduct(cookie)
		const guestCookie = await getGuestCookie()

		await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ variantId: a.variant.id })
		})
		await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ variantId: b.variant.id })
		})

		const res = await requestJson('/api/v1/cart', { method: 'DELETE', headers: { Cookie: guestCookie } })
		expect(res.status).toBe(200)
		expect(res.body.data.items).toHaveLength(0)
	})

	test('clearing a cart that was never created does not error', async () => {
		const res = await requestJson('/api/v1/cart', { method: 'DELETE' })
		expect(res.status).toBe(200)
		expect(res.body.data.items).toHaveLength(0)
	})

	test('404s on a PATCH/DELETE for an item id that is not in this guest\'s cart', async () => {
		const guestCookie = await getGuestCookie()
		const res = await requestJson(
			'/api/v1/cart/items/00000000-0000-0000-0000-000000000000',
			{ method: 'PATCH', headers: { Cookie: guestCookie }, body: JSON.stringify({ quantity: 1 }) }
		)
		expect(res.status).toBe(404)
		expect(res.body.error.code).toBe('cart_item_not_found')
	})

	test('404s for a non-existent variant', async () => {
		const guestCookie = await getGuestCookie()
		const res = await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ variantId: '00000000-0000-0000-0000-000000000000' })
		})
		expect(res.status).toBe(404)
		expect(res.body.error.code).toBe('variant_not_found')
	})

	test('rejects adding a variant that is not currently active', async () => {
		const cookie = await staffCookie()
		const { variant } = await createSellableProduct(cookie)
		await requestJson(`/api/v1/admin/variants/${variant.id}`, {
			method: 'PATCH',
			headers: { Cookie: cookie },
			body: JSON.stringify({ isActive: false })
		})
		const guestCookie = await getGuestCookie()

		const res = await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ variantId: variant.id })
		})

		expect(res.status).toBe(422)
		expect(res.body.error.code).toBe('variant_not_available')
	})

	test('an item already in the cart becomes "unavailable" once its variant is disabled, and drops out of the subtotal', async () => {
		const cookie = await staffCookie()
		const { variant } = await createSellableProduct(cookie)
		const guestCookie = await getGuestCookie()

		await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ variantId: variant.id, quantity: 2 })
		})

		await requestJson(`/api/v1/admin/variants/${variant.id}`, {
			method: 'PATCH',
			headers: { Cookie: cookie },
			body: JSON.stringify({ isActive: false })
		})

		const res = await requestJson('/api/v1/cart', { headers: { Cookie: guestCookie } })
		expect(res.body.data.items[0].status).toBe('unavailable')
		expect(res.body.data.items[0].unitPrice).toBeNull()
		expect(res.body.data.items[0].lineTotal).toBeNull()
		expect(res.body.data.subtotal).toBe(0)
		// The item is never auto-removed - still visible for the shopper to decide.
		expect(res.body.data.items).toHaveLength(1)
	})

	test('reflects a live price change, not the price at the time the item was added', async () => {
		const cookie = await staffCookie()
		const { variant } = await createSellableProduct(cookie)
		const guestCookie = await getGuestCookie()

		await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ variantId: variant.id, quantity: 1 })
		})

		await requestJson(`/api/v1/admin/variants/${variant.id}/price`, {
			method: 'PUT',
			headers: { Cookie: cookie },
			body: JSON.stringify({ price: 5000 })
		})

		const res = await requestJson('/api/v1/cart', { headers: { Cookie: guestCookie } })
		expect(res.body.data.items[0].unitPrice).toBe(5000)
		expect(res.body.data.subtotal).toBe(5000)
	})

	test('marks a line out_of_stock when inventory drops below the requested quantity, but still prices it', async () => {
		const cookie = await staffCookie()
		const { variant } = await createSellableProduct(cookie, 10)
		const guestCookie = await getGuestCookie()

		await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ variantId: variant.id, quantity: 3 })
		})

		await requestJson(`/api/v1/admin/variants/${variant.id}/inventory`, {
			method: 'PUT',
			headers: { Cookie: cookie },
			body: JSON.stringify({ quantityOnHand: 0 })
		})

		const res = await requestJson('/api/v1/cart', { headers: { Cookie: guestCookie } })
		expect(res.body.data.items[0].status).toBe('out_of_stock')
		expect(res.body.data.items[0].availableQuantity).toBe(0)
		expect(res.body.data.items[0].lineTotal).toBe(19999 * 3)
	})

	test('two different guests never see each other\'s cart', async () => {
		const cookie = await staffCookie()
		const { variant } = await createSellableProduct(cookie)

		const guestA = await getGuestCookie()
		const guestB = await getGuestCookie()
		expect(guestA).not.toBe(guestB)

		await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: guestA },
			body: JSON.stringify({ variantId: variant.id })
		})

		const cartA = await requestJson('/api/v1/cart', { headers: { Cookie: guestA } })
		const cartB = await requestJson('/api/v1/cart', { headers: { Cookie: guestB } })

		expect(cartA.body.data.items).toHaveLength(1)
		expect(cartB.body.data.items).toHaveLength(0)
		expect(cartA.body.data.id).not.toBe(cartB.body.data.id)
	})

	test('concurrent add-to-cart requests for the same variant sum correctly instead of losing an update', async () => {
		const cookie = await staffCookie()
		const { variant } = await createSellableProduct(cookie, 500)
		const guestCookie = await getGuestCookie()

		await Promise.all(
			Array.from({ length: 5 }, () =>
				requestJson('/api/v1/cart/items', {
					method: 'POST',
					headers: { Cookie: guestCookie },
					body: JSON.stringify({ variantId: variant.id, quantity: 1 })
				})
			)
		)

		const res = await requestJson('/api/v1/cart', { headers: { Cookie: guestCookie } })
		expect(res.body.data.items).toHaveLength(1)
		expect(res.body.data.items[0].quantity).toBe(5)
	})
})

describe('authenticated customer cart', () => {
	test('two different customers never see each other\'s cart', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)

		const customerA = (await createSessionAs('customer')).cookie
		const customerB = (await createSessionAs('customer')).cookie

		await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: customerA },
			body: JSON.stringify({ variantId: variant.id })
		})

		const cartA = await requestJson('/api/v1/cart', { headers: { Cookie: customerA } })
		const cartB = await requestJson('/api/v1/cart', { headers: { Cookie: customerB } })

		expect(cartA.body.data.items).toHaveLength(1)
		expect(cartB.body.data.items).toHaveLength(0)
	})

	test('a logged-in request is never treated as a guest, even with a stray guest cookie present', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)

		const guestCookie = await getGuestCookie()
		await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ variantId: variant.id })
		})

		const customer = (await createSessionAs('customer')).cookie
		const combined = `${guestCookie}; ${customer}`

		const res = await requestJson('/api/v1/cart', { headers: { Cookie: combined } })
		// Session wins - this is the customer's own (empty) cart, not the guest's.
		expect(res.body.data.items).toHaveLength(0)
	})
})

describe('guest cart merge', () => {
	test('merges guest items into the customer\'s cart and invalidates the guest token', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)

		const guestCookie = await getGuestCookie()
		await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ variantId: variant.id, quantity: 2 })
		})

		const { cookie: customerCookie } = await createSessionAs('customer')
		const combined = `${guestCookie}; ${customerCookie}`

		const mergeRes = await requestJson('/api/v1/cart/merge', {
			method: 'POST',
			headers: { Cookie: combined }
		})

		expect(mergeRes.status).toBe(200)
		expect(mergeRes.body.data.merged).toBe(true)
		expect(mergeRes.body.data.mergedItemCount).toBe(1)
		expect(mergeRes.body.data.cart.items).toHaveLength(1)
		expect(mergeRes.body.data.cart.items[0].quantity).toBe(2)

		// Guest token cleared in the response.
		const setCookie = mergeRes.headers.getSetCookie().join(';')
		expect(setCookie).toContain('guest_cart_token=;')

		// The now-dead guest cart no longer resolves to anything.
		const guestCartAfter = await requestJson('/api/v1/cart', { headers: { Cookie: guestCookie } })
		expect(guestCartAfter.body.data.items).toHaveLength(0)
	})

	test('combines quantities for a variant already in both carts, clamped at 99', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff, 500)

		const { cookie: customerCookie } = await createSessionAs('customer')
		await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: customerCookie },
			body: JSON.stringify({ variantId: variant.id, quantity: 3 })
		})

		const guestCookie = await getGuestCookie()
		await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ variantId: variant.id, quantity: 4 })
		})

		const combined = `${guestCookie}; ${customerCookie}`
		const res = await requestJson('/api/v1/cart/merge', { method: 'POST', headers: { Cookie: combined } })

		expect(res.body.data.cart.items).toHaveLength(1)
		expect(res.body.data.cart.items[0].quantity).toBe(7)
	})

	test('a repeated merge call with the same stale guest cookie is a no-op, not a double-apply', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)

		const guestCookie = await getGuestCookie()
		await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ variantId: variant.id, quantity: 2 })
		})

		const { cookie: customerCookie } = await createSessionAs('customer')
		const combined = `${guestCookie}; ${customerCookie}`

		await requestJson('/api/v1/cart/merge', { method: 'POST', headers: { Cookie: combined } })
		// Client didn't update its cookie jar and retries with the same (now
		// stale) guest cookie.
		const retry = await requestJson('/api/v1/cart/merge', { method: 'POST', headers: { Cookie: combined } })

		expect(retry.body.data.merged).toBe(false)
		expect(retry.body.data.mergedItemCount).toBe(0)
		expect(retry.body.data.cart.items[0].quantity).toBe(2)
	})

	test('merging with no guest cookie at all is a harmless no-op', async () => {
		const { cookie: customerCookie } = await createSessionAs('customer')
		const res = await requestJson('/api/v1/cart/merge', { method: 'POST', headers: { Cookie: customerCookie } })

		expect(res.status).toBe(200)
		expect(res.body.data.merged).toBe(false)
		expect(res.body.data.cart.items).toHaveLength(0)
	})

	test('rejects an unauthenticated merge attempt', async () => {
		const guestCookie = await getGuestCookie()
		const res = await requestJson('/api/v1/cart/merge', { method: 'POST', headers: { Cookie: guestCookie } })
		expect(res.status).toBe(401)
	})
})

describe('public catalog API after cart activity', () => {
	test('product list and detail endpoints are unaffected', async () => {
		const staff = await staffCookie()
		const { product, variant } = await createSellableProduct(staff)
		const guestCookie = await getGuestCookie()
		await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ variantId: variant.id })
		})

		const list = await requestJson('/api/v1/products')
		expect(list.status).toBe(200)
		expect(Array.isArray(list.body.data)).toBe(true)

		const detail = await requestJson(`/api/v1/products/${product.slug}`)
		expect(detail.status).toBe(200)
		expect(detail.body.data.variants).toHaveLength(1)
		expect(detail.body.data.variants[0].price).toBe(19999)
	})
})
