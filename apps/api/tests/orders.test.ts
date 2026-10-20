import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { inventory } from '../src/db/schema/inventory'
import { orderIdempotencyKeys, orderStatusHistory } from '../src/db/schema/orders'
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

async function createPickupLocation(cookie: string) {
	const suffix = crypto.randomUUID().slice(0, 8)
	const res = await requestJson('/api/v1/admin/pickup-locations', {
		method: 'POST',
		headers: { Cookie: cookie },
		body: JSON.stringify({
			code: `loc-${suffix}`,
			nameRu: 'Магазин',
			nameRo: 'Magazin',
			address: 'Str. Test 1, Chisinau'
		})
	})
	return res.body.data
}

async function getGuestCookie(): Promise<string> {
	const res = await requestJson('/api/v1/cart')
	return extractCookieHeader(res.headers)
}

async function addToCart(cookie: string, variantId: string, quantity = 1) {
	await requestJson('/api/v1/cart/items', {
		method: 'POST',
		headers: { Cookie: cookie },
		body: JSON.stringify({ variantId, quantity })
	})
}

async function getInventory(variantId: string) {
	const [row] = await db.select().from(inventory).where(eq(inventory.variantId, variantId)).limit(1)
	return row
}

function orderHeaders(cookie: string, idempotencyKey = crypto.randomUUID()) {
	return { Cookie: cookie, 'Idempotency-Key': idempotencyKey }
}

/** A pending order always needs a real, active pickup location to reference. */
function customerPayload(pickupLocationId: string, overrides: Record<string, unknown> = {}) {
	return {
		customerName: 'Maria Popescu',
		customerEmail: 'maria@example.com',
		customerPhone: '069123456',
		customerNote: 'Leave at the door',
		delivery: { method: 'pickup', pickupLocationId },
		paymentMethod: 'cash_on_delivery',
		...overrides
	}
}

describe('checkout preview', () => {
	test('an empty cart previews as not checkout-able', async () => {
		const guestCookie = await getGuestCookie()
		const res = await requestJson('/api/v1/checkout/preview', {
			method: 'POST',
			headers: { Cookie: guestCookie }
		})

		expect(res.status).toBe(200)
		expect(res.body.data.items).toHaveLength(0)
		expect(res.body.data.canCheckout).toBe(false)
		expect(res.body.data.subtotal).toBe(0)
		expect(res.body.data.shippingNote).toBeTruthy()
	})

	test('a normal cart previews with a server-computed subtotal', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 2)

		const res = await requestJson('/api/v1/checkout/preview', {
			method: 'POST',
			headers: { Cookie: guestCookie }
		})

		expect(res.body.data.canCheckout).toBe(true)
		expect(res.body.data.subtotal).toBe(19999 * 2)
		expect(res.body.data.problems).toHaveLength(0)
	})

	test('recomputes the price even if it changed after the item was added to the cart', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 1)

		await requestJson(`/api/v1/admin/variants/${variant.id}/price`, {
			method: 'PUT',
			headers: { Cookie: staff },
			body: JSON.stringify({ price: 777 })
		})

		const res = await requestJson('/api/v1/checkout/preview', {
			method: 'POST',
			headers: { Cookie: guestCookie }
		})
		expect(res.body.data.items[0].unitPrice).toBe(777)
		expect(res.body.data.subtotal).toBe(777)
	})

	test('flags an archived product as unavailable and blocks checkout', async () => {
		const staff = await staffCookie()
		const { product, variant } = await createSellableProduct(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 1)

		await requestJson(`/api/v1/admin/products/${product.id}`, {
			method: 'PATCH',
			headers: { Cookie: staff },
			body: JSON.stringify({ status: 'archived' })
		})

		const res = await requestJson('/api/v1/checkout/preview', {
			method: 'POST',
			headers: { Cookie: guestCookie }
		})
		expect(res.body.data.canCheckout).toBe(false)
		expect(res.body.data.problems[0].code).toBe('product_unavailable')
	})

	test('flags a disabled variant as unavailable', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 1)

		await requestJson(`/api/v1/admin/variants/${variant.id}`, {
			method: 'PATCH',
			headers: { Cookie: staff },
			body: JSON.stringify({ isActive: false })
		})

		const res = await requestJson('/api/v1/checkout/preview', {
			method: 'POST',
			headers: { Cookie: guestCookie }
		})
		expect(res.body.data.canCheckout).toBe(false)
		expect(res.body.data.problems[0].code).toBe('variant_inactive')
	})

	test('flags a missing price as unavailable', async () => {
		const staff = await staffCookie()
		const suffix = crypto.randomUUID().slice(0, 8)
		const brand = (
			await requestJson('/api/v1/admin/brands', {
				method: 'POST',
				headers: { Cookie: staff },
				body: JSON.stringify({ slug: `brand-${suffix}`, nameRu: 'Б', nameRo: 'B' })
			})
		).body.data
		const category = (
			await requestJson('/api/v1/admin/categories', {
				method: 'POST',
				headers: { Cookie: staff },
				body: JSON.stringify({ slug: `cat-${suffix}`, nameRu: 'К', nameRo: 'C' })
			})
		).body.data
		const product = (
			await requestJson('/api/v1/admin/products', {
				method: 'POST',
				headers: { Cookie: staff },
				body: JSON.stringify({
					brandId: brand.id,
					slug: `prod-${suffix}`,
					nameRu: 'Т',
					nameRo: 'P',
					categoryIds: [category.id]
				})
			})
		).body.data
		const variant = (
			await requestJson(`/api/v1/admin/products/${product.id}/variants`, {
				method: 'POST',
				headers: { Cookie: staff },
				body: JSON.stringify({ sku: `SKU-${suffix}` })
			})
		).body.data
		const guestCookie = await getGuestCookie()
		const addRes = await requestJson('/api/v1/cart/items', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ variantId: variant.id })
		})
		expect(addRes.status).toBe(422)
		expect(addRes.body.error.code).toBe('variant_not_available')
	})

	test('flags insufficient stock and blocks checkout', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff, 2)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 5)

		const res = await requestJson('/api/v1/checkout/preview', {
			method: 'POST',
			headers: { Cookie: guestCookie }
		})
		expect(res.body.data.canCheckout).toBe(false)
		expect(res.body.data.problems[0].code).toBe('insufficient_stock')
		expect(res.body.data.problems[0].availableQuantity).toBe(2)
	})
})

describe('order creation', () => {
	test('requires an Idempotency-Key header', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const pickup = await createPickupLocation(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id)

		const res = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify(customerPayload(pickup.id))
		})
		expect(res.status).toBe(400)
		expect(res.body.error.code).toBe('idempotency_key_required')
	})

	test('creates a guest order and reserves stock without touching quantity_on_hand', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff, 10)
		const pickup = await createPickupLocation(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 3)

		const res = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie),
			body: JSON.stringify(customerPayload(pickup.id))
		})

		expect(res.status).toBe(201)
		expect(res.body.data.status).toBe('pending')
		expect(res.body.data.totalAmount).toBe(19999 * 3)
		expect(res.body.data.orderNumber).toMatch(/^ORD-/)
		expect(res.body.data.accessToken).toBeTruthy()
		expect(res.body.data.customerPhone).toBe('+37369123456')
		expect(res.body.data.delivery).toEqual({ method: 'pickup', pickupLocationId: pickup.id })
		expect(res.body.data.payments).toHaveLength(1)
		expect(res.body.data.payments[0].status).toBe('pending')
		expect(res.body.data.payments[0].amount).toBe(19999 * 3)

		const inv = await getInventory(variant.id)
		expect(inv.quantityOnHand).toBe(10)
		expect(inv.quantityReserved).toBe(3)

		// The cart was spent - a fresh GET /cart is empty.
		const cart = await requestJson('/api/v1/cart', { headers: { Cookie: guestCookie } })
		expect(cart.body.data.items).toHaveLength(0)
	})

	test('creates an authenticated order tied to the customer\'s account, no access token issued', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const pickup = await createPickupLocation(staff)
		const { cookie: customerCookie } = await createSessionAs('customer')
		await addToCart(customerCookie, variant.id, 1)

		const res = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(customerCookie),
			body: JSON.stringify(customerPayload(pickup.id))
		})

		expect(res.status).toBe(201)
		expect(res.body.data.accessToken).toBeNull()

		const listRes = await requestJson('/api/v1/orders', { headers: { Cookie: customerCookie } })
		expect(listRes.body.data).toHaveLength(1)
		expect(listRes.body.data[0].id).toBe(res.body.data.id)
	})

	test('rejects an invalid phone number', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const pickup = await createPickupLocation(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id)

		const res = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie),
			body: JSON.stringify(customerPayload(pickup.id, { customerPhone: '123' }))
		})
		expect(res.status).toBe(400)
		expect(res.body.error.code).toBe('invalid_phone')
	})

	test('rejects an empty cart', async () => {
		const staff = await staffCookie()
		const pickup = await createPickupLocation(staff)
		const guestCookie = await getGuestCookie()
		const res = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie),
			body: JSON.stringify(customerPayload(pickup.id))
		})
		expect(res.status).toBe(422)
		expect(res.body.error.code).toBe('cart_empty')
	})

	test('rejects an inactive pickup location', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const pickup = await createPickupLocation(staff)
		await requestJson(`/api/v1/admin/pickup-locations/${pickup.id}`, {
			method: 'PATCH',
			headers: { Cookie: staff },
			body: JSON.stringify({ isActive: false })
		})
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id)

		const res = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie),
			body: JSON.stringify(customerPayload(pickup.id))
		})
		expect(res.status).toBe(422)
		expect(res.body.error.code).toBe('pickup_location_inactive')
	})

	test('rejects online payment while no provider is configured', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const pickup = await createPickupLocation(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id)

		const res = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie),
			body: JSON.stringify(customerPayload(pickup.id, { paymentMethod: 'online' }))
		})
		expect(res.status).toBe(422)
		expect(res.body.error.code).toBe('online_payment_unavailable')
	})

	test('writes a correct order_items snapshot, independent of later catalog changes', async () => {
		const staff = await staffCookie()
		const { product, variant } = await createSellableProduct(staff)
		const pickup = await createPickupLocation(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 2)

		const created = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie),
			body: JSON.stringify(customerPayload(pickup.id))
		})
		const orderId = created.body.data.id
		const accessToken = created.body.data.accessToken

		await requestJson(`/api/v1/admin/products/${product.id}`, {
			method: 'PATCH',
			headers: { Cookie: staff },
			body: JSON.stringify({ nameRu: 'Другое имя', nameRo: 'Alt nume' })
		})
		await requestJson(`/api/v1/admin/variants/${variant.id}/price`, {
			method: 'PUT',
			headers: { Cookie: staff },
			body: JSON.stringify({ price: 1 })
		})

		const res = await requestJson(`/api/v1/orders/${orderId}`, {
			headers: { 'X-Order-Access-Token': accessToken }
		})
		expect(res.status).toBe(200)
		expect(res.body.data.items[0].unitPrice).toBe(19999)
		expect(res.body.data.items[0].productName).toBe('Крем')
		expect(res.body.data.totalAmount).toBe(19999 * 2)
	})

	test('rolls back entirely when reservation fails - no order, no partial items', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff, 1)
		const pickup = await createPickupLocation(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 1)

		// Drain the stock to zero after adding to cart but before checkout.
		await requestJson(`/api/v1/admin/variants/${variant.id}/inventory`, {
			method: 'PUT',
			headers: { Cookie: staff },
			body: JSON.stringify({ quantityOnHand: 0 })
		})

		const res = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie),
			body: JSON.stringify(customerPayload(pickup.id))
		})
		expect(res.status).toBe(409)
		expect(res.body.error.code).toBe('insufficient_stock')

		const inv = await getInventory(variant.id)
		expect(inv.quantityReserved).toBe(0)

		// The cart must still be there (and still have its item) - nothing
		// was spent by a failed attempt.
		const cart = await requestJson('/api/v1/cart', { headers: { Cookie: guestCookie } })
		expect(cart.body.data.items).toHaveLength(1)
	})

	test('records the initial status history row on creation', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const pickup = await createPickupLocation(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id)

		const created = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie),
			body: JSON.stringify(customerPayload(pickup.id))
		})

		const history = await db
			.select()
			.from(orderStatusHistory)
			.where(eq(orderStatusHistory.orderId, created.body.data.id))
		expect(history).toHaveLength(1)
		expect(history[0].fromStatus).toBeNull()
		expect(history[0].toStatus).toBe('pending')
	})
})

describe('idempotency', () => {
	test('a repeated request with the same key returns the same order, without reserving twice', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff, 10)
		const pickup = await createPickupLocation(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 2)

		const key = crypto.randomUUID()
		const payload = customerPayload(pickup.id)
		const first = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie, key),
			body: JSON.stringify(payload)
		})
		expect(first.status).toBe(201)

		// Re-send with the same cookie and key - as if the client retried
		// after losing the response. Even though the cart is now empty
		// (spent by the first call), the idempotency row still resolves to
		// the earlier order rather than failing with cart_empty.
		const second = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie, key),
			body: JSON.stringify(payload)
		})

		expect(second.status).toBe(200)
		expect(second.body.data.id).toBe(first.body.data.id)
		expect(second.body.data.replayed).toBe(true)

		const inv = await getInventory(variant.id)
		expect(inv.quantityReserved).toBe(2)

		const rows = await db.select().from(orderIdempotencyKeys)
		expect(rows).toHaveLength(1)
	})

	test('the same key with a different payload is a conflict', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const pickup = await createPickupLocation(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id)

		const key = crypto.randomUUID()
		await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie, key),
			body: JSON.stringify(customerPayload(pickup.id))
		})

		const second = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie, key),
			body: JSON.stringify(customerPayload(pickup.id, { customerName: 'Different Person' }))
		})

		expect(second.status).toBe(409)
		expect(second.body.error.code).toBe('idempotency_key_conflict')
	})

	test('the same key with a different payment method is a conflict', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const pickup = await createPickupLocation(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id)

		const key = crypto.randomUUID()
		await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie, key),
			body: JSON.stringify(customerPayload(pickup.id, { paymentMethod: 'cash_on_delivery' }))
		})

		const second = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie, key),
			body: JSON.stringify(customerPayload(pickup.id, { paymentMethod: 'card_on_delivery' }))
		})

		expect(second.status).toBe(409)
		expect(second.body.error.code).toBe('idempotency_key_conflict')
	})

	test('concurrent requests with the same key create exactly one order', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff, 50)
		const pickup = await createPickupLocation(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 2)

		const key = crypto.randomUUID()
		const payload = customerPayload(pickup.id)
		const results = await Promise.all(
			Array.from({ length: 5 }, () =>
				requestJson('/api/v1/orders', {
					method: 'POST',
					headers: orderHeaders(guestCookie, key),
					body: JSON.stringify(payload)
				})
			)
		)

		const orderIds = new Set(results.map(r => r.body.data.id))
		expect(orderIds.size).toBe(1)
		expect(results.every(r => r.status === 200 || r.status === 201)).toBe(true)

		const inv = await getInventory(variant.id)
		expect(inv.quantityReserved).toBe(2)
	})
})

describe('concurrent checkout under limited stock', () => {
	test('two different shoppers racing for the last unit: exactly one order wins, no overselling', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff, 1)
		const pickup = await createPickupLocation(staff)

		const guestA = await getGuestCookie()
		const guestB = await getGuestCookie()
		await addToCart(guestA, variant.id, 1)
		await addToCart(guestB, variant.id, 1)

		const payload = customerPayload(pickup.id)
		const [resA, resB] = await Promise.all([
			requestJson('/api/v1/orders', {
				method: 'POST',
				headers: orderHeaders(guestA),
				body: JSON.stringify(payload)
			}),
			requestJson('/api/v1/orders', {
				method: 'POST',
				headers: orderHeaders(guestB),
				body: JSON.stringify(payload)
			})
		])

		const statuses = [resA.status, resB.status].sort()
		expect(statuses).toEqual([201, 409])

		const failed = resA.status === 409 ? resA : resB
		expect(failed.body.error.code).toBe('insufficient_stock')

		const inv = await getInventory(variant.id)
		expect(inv.quantityReserved).toBe(1)
		expect(inv.quantityReserved).toBeLessThanOrEqual(inv.quantityOnHand)
	})
})

describe('order access control', () => {
	test('one customer cannot fetch another customer\'s order', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const pickup = await createPickupLocation(staff)
		const { cookie: ownerCookie } = await createSessionAs('customer')
		await addToCart(ownerCookie, variant.id)
		const created = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(ownerCookie),
			body: JSON.stringify(customerPayload(pickup.id))
		})

		const { cookie: strangerCookie } = await createSessionAs('customer')
		const res = await requestJson(`/api/v1/orders/${created.body.data.id}`, {
			headers: { Cookie: strangerCookie }
		})
		expect(res.status).toBe(404)
	})

	test('a guest order is only reachable with its own access token', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const pickup = await createPickupLocation(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id)
		const created = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie),
			body: JSON.stringify(customerPayload(pickup.id))
		})
		const orderId = created.body.data.id
		const accessToken = created.body.data.accessToken

		const noToken = await requestJson(`/api/v1/orders/${orderId}`)
		expect(noToken.status).toBe(404)

		const wrongToken = await requestJson(`/api/v1/orders/${orderId}`, {
			headers: { 'X-Order-Access-Token': 'not-the-right-token' }
		})
		expect(wrongToken.status).toBe(404)

		const withToken = await requestJson(`/api/v1/orders/${orderId}`, {
			headers: { 'X-Order-Access-Token': accessToken }
		})
		expect(withToken.status).toBe(200)
		expect(withToken.body.data.id).toBe(orderId)
	})
})

describe('cancellation', () => {
	test('cancels a pending order and releases the reservation', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff, 10)
		const pickup = await createPickupLocation(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 4)
		const created = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie),
			body: JSON.stringify(customerPayload(pickup.id))
		})
		const orderId = created.body.data.id
		const accessToken = created.body.data.accessToken

		let inv = await getInventory(variant.id)
		expect(inv.quantityReserved).toBe(4)

		const res = await requestJson(`/api/v1/orders/${orderId}/cancel`, {
			method: 'POST',
			headers: { 'X-Order-Access-Token': accessToken },
			body: JSON.stringify({})
		})
		expect(res.status).toBe(200)
		expect(res.body.data.status).toBe('cancelled')

		inv = await getInventory(variant.id)
		expect(inv.quantityReserved).toBe(0)
		expect(inv.quantityOnHand).toBe(10)
	})

	test('a second cancellation does not release the reservation again (409, no negative stock)', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff, 10)
		const pickup = await createPickupLocation(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 3)
		const created = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie),
			body: JSON.stringify(customerPayload(pickup.id))
		})
		const orderId = created.body.data.id
		const accessToken = created.body.data.accessToken

		const first = await requestJson(`/api/v1/orders/${orderId}/cancel`, {
			method: 'POST',
			headers: { 'X-Order-Access-Token': accessToken },
			body: JSON.stringify({})
		})
		expect(first.status).toBe(200)

		const second = await requestJson(`/api/v1/orders/${orderId}/cancel`, {
			method: 'POST',
			headers: { 'X-Order-Access-Token': accessToken },
			body: JSON.stringify({})
		})
		expect(second.status).toBe(409)
		expect(second.body.error.code).toBe('order_not_cancellable')

		const inv = await getInventory(variant.id)
		expect(inv.quantityReserved).toBe(0)
		expect(inv.quantityReserved).toBeGreaterThanOrEqual(0)
	})

	test('records a status history row for the cancellation', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const pickup = await createPickupLocation(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id)
		const created = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie),
			body: JSON.stringify(customerPayload(pickup.id))
		})
		const accessToken = created.body.data.accessToken

		await requestJson(`/api/v1/orders/${created.body.data.id}/cancel`, {
			method: 'POST',
			headers: { 'X-Order-Access-Token': accessToken },
			body: JSON.stringify({})
		})

		const history = await db
			.select()
			.from(orderStatusHistory)
			.where(eq(orderStatusHistory.orderId, created.body.data.id))
		expect(history).toHaveLength(2)
		expect(history[1].fromStatus).toBe('pending')
		expect(history[1].toStatus).toBe('cancelled')
	})

	test('a stranger cannot cancel someone else\'s order', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const pickup = await createPickupLocation(staff)
		const { cookie: ownerCookie } = await createSessionAs('customer')
		await addToCart(ownerCookie, variant.id)
		const created = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(ownerCookie),
			body: JSON.stringify(customerPayload(pickup.id))
		})

		const { cookie: strangerCookie } = await createSessionAs('customer')
		const res = await requestJson(`/api/v1/orders/${created.body.data.id}/cancel`, {
			method: 'POST',
			headers: { Cookie: strangerCookie },
			body: JSON.stringify({})
		})
		expect(res.status).toBe(404)
	})
})

describe('order list pagination', () => {
	test('paginates a customer\'s own orders, newest first', async () => {
		const staff = await staffCookie()
		const pickup = await createPickupLocation(staff)
		const { cookie: customerCookie } = await createSessionAs('customer')

		for (let i = 0; i < 3; i++) {
			const { variant } = await createSellableProduct(staff)
			await addToCart(customerCookie, variant.id)
			await requestJson('/api/v1/orders', {
				method: 'POST',
				headers: orderHeaders(customerCookie),
				body: JSON.stringify(customerPayload(pickup.id))
			})
		}

		const page1 = await requestJson('/api/v1/orders?page=1&limit=2', { headers: { Cookie: customerCookie } })
		expect(page1.body.data).toHaveLength(2)
		expect(page1.body.meta.total).toBe(3)
		expect(page1.body.meta.totalPages).toBe(2)

		const page2 = await requestJson('/api/v1/orders?page=2&limit=2', { headers: { Cookie: customerCookie } })
		expect(page2.body.data).toHaveLength(1)

		const allIds = [...page1.body.data, ...page2.body.data].map((o: { id: string }) => o.id)
		expect(new Set(allIds).size).toBe(3)
	})

	test('rejects an unauthenticated order list request', async () => {
		const res = await requestJson('/api/v1/orders')
		expect(res.status).toBe(401)
	})
})

describe('compatibility', () => {
	test('Sprint 5 cart API keeps working after order activity', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 2)

		const cartRes = await requestJson('/api/v1/cart', { headers: { Cookie: guestCookie } })
		expect(cartRes.status).toBe(200)
		expect(cartRes.body.data.items).toHaveLength(1)
		expect(cartRes.body.data.subtotal).toBe(19999 * 2)
	})

	test('public Catalog API is unaffected', async () => {
		const staff = await staffCookie()
		const { product } = await createSellableProduct(staff)

		const list = await requestJson('/api/v1/products')
		expect(list.status).toBe(200)

		const detail = await requestJson(`/api/v1/products/${product.slug}`)
		expect(detail.status).toBe(200)
		expect(detail.body.data.variants).toHaveLength(1)
	})
})
