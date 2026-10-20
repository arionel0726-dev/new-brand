import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { inventory } from '../src/db/schema/inventory'
import { payments } from '../src/db/schema/payments'
import { createSessionAs, extractCookieHeader, requestJson, resetAuthTables, resetDatabase } from './helpers'

beforeEach(async () => {
	await resetDatabase()
	await resetAuthTables()
})

async function staffCookie() {
	const { cookie } = await createSessionAs('staff')
	return cookie
}

async function createSellableProduct(cookie: string, quantityOnHand = 10, price = 19999) {
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
		body: JSON.stringify({ price })
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

async function createPickupLocation(cookie: string, overrides: Record<string, unknown> = {}) {
	const suffix = crypto.randomUUID().slice(0, 8)
	const res = await requestJson('/api/v1/admin/pickup-locations', {
		method: 'POST',
		headers: { Cookie: cookie },
		body: JSON.stringify({
			code: `loc-${suffix}`,
			nameRu: 'Магазин',
			nameRo: 'Magazin',
			address: 'Str. Test 1, Chisinau',
			...overrides
		})
	})
	return res.body.data
}

async function createDeliveryZone(cookie: string, overrides: Record<string, unknown> = {}) {
	const suffix = crypto.randomUUID().slice(0, 8)
	const res = await requestJson('/api/v1/admin/delivery-zones', {
		method: 'POST',
		headers: { Cookie: cookie },
		body: JSON.stringify({
			code: `zone-${suffix}`,
			nameRu: 'Кишинёв',
			nameRo: 'Chisinau',
			feeAmount: 5000,
			...overrides
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

const COURIER_RECIPIENT = {
	recipientName: 'Ion Rece',
	recipientPhone: '069111222',
	city: 'Chisinau',
	street: 'Str. Stefan cel Mare',
	house: '10',
	apartment: '5',
	notes: 'Ring twice'
}

describe('public delivery options', () => {
	test('lists only active pickup locations and delivery zones', async () => {
		const staff = await staffCookie()
		const active = await createPickupLocation(staff)
		const inactive = await createPickupLocation(staff)
		await requestJson(`/api/v1/admin/pickup-locations/${inactive.id}`, {
			method: 'PATCH',
			headers: { Cookie: staff },
			body: JSON.stringify({ isActive: false })
		})

		const res = await requestJson('/api/v1/delivery/pickup-locations')
		expect(res.status).toBe(200)
		const ids = res.body.data.map((l: { id: string }) => l.id)
		expect(ids).toContain(active.id)
		expect(ids).not.toContain(inactive.id)
	})

	test('admin CRUD is restricted to staff/admin', async () => {
		const { cookie: customerCookie } = await createSessionAs('customer')
		const res = await requestJson('/api/v1/admin/delivery-zones', {
			method: 'POST',
			headers: { Cookie: customerCookie },
			body: JSON.stringify({ code: 'z', nameRu: 'a', nameRo: 'b', feeAmount: 100 })
		})
		expect(res.status).toBe(403)

		const unauth = await requestJson('/api/v1/admin/pickup-locations')
		expect(unauth.status).toBe(401)
	})
})

describe('shipping quote', () => {
	test('pickup is always free', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const pickup = await createPickupLocation(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 1)

		const res = await requestJson('/api/v1/checkout/shipping-quote', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ delivery: { method: 'pickup', pickupLocationId: pickup.id } })
		})

		expect(res.status).toBe(200)
		expect(res.body.data.shippingFee).toBe(0)
		expect(res.body.data.canCheckout).toBe(true)
		expect(res.body.data.total).toBe(res.body.data.subtotal)
	})

	test('courier charges the zone fee, computed server-side', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const zone = await createDeliveryZone(staff, { feeAmount: 3000 })
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 1)

		const res = await requestJson('/api/v1/checkout/shipping-quote', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ delivery: { method: 'courier', deliveryZoneId: zone.id, ...COURIER_RECIPIENT } })
		})

		expect(res.status).toBe(200)
		expect(res.body.data.shippingFee).toBe(3000)
		expect(res.body.data.total).toBe(19999 + 3000)
	})

	test('waives the fee once the subtotal reaches the free threshold', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff, 10, 10000)
		const zone = await createDeliveryZone(staff, { feeAmount: 3000, freeThresholdAmount: 15000 })
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 2) // subtotal 20000 >= 15000

		const res = await requestJson('/api/v1/checkout/shipping-quote', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ delivery: { method: 'courier', deliveryZoneId: zone.id, ...COURIER_RECIPIENT } })
		})

		expect(res.body.data.shippingFee).toBe(0)
	})

	test('rejects a subtotal below the zone minimum order amount', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff, 10, 1000)
		const zone = await createDeliveryZone(staff, { feeAmount: 3000, minOrderAmount: 5000 })
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 1) // subtotal 1000 < 5000

		const res = await requestJson('/api/v1/checkout/shipping-quote', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ delivery: { method: 'courier', deliveryZoneId: zone.id, ...COURIER_RECIPIENT } })
		})

		expect(res.body.data.canCheckout).toBe(false)
		expect(res.body.data.problems.some((p: { code: string }) => p.code === 'below_minimum_order')).toBe(true)
	})

	test('rejects a non-existent delivery zone and an inactive pickup location', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const inactivePickup = await createPickupLocation(staff)
		await requestJson(`/api/v1/admin/pickup-locations/${inactivePickup.id}`, {
			method: 'PATCH',
			headers: { Cookie: staff },
			body: JSON.stringify({ isActive: false })
		})
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id)

		const badZone = await requestJson('/api/v1/checkout/shipping-quote', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({
				delivery: {
					method: 'courier',
					deliveryZoneId: '00000000-0000-0000-0000-000000000000',
					...COURIER_RECIPIENT
				}
			})
		})
		expect(badZone.body.data.problems[0].code).toBe('delivery_zone_not_found')

		const badPickup = await requestJson('/api/v1/checkout/shipping-quote', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ delivery: { method: 'pickup', pickupLocationId: inactivePickup.id } })
		})
		expect(badPickup.body.data.problems[0].code).toBe('pickup_location_inactive')
	})
})

describe('courier order creation', () => {
	test('persists the delivery address snapshot and charges the zone fee', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const zone = await createDeliveryZone(staff, { feeAmount: 2500 })
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 1)

		const res = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie),
			body: JSON.stringify({
				customerName: 'Maria Popescu',
				customerEmail: 'maria@example.com',
				customerPhone: '069123456',
				delivery: { method: 'courier', deliveryZoneId: zone.id, ...COURIER_RECIPIENT },
				paymentMethod: 'cash_on_delivery'
			})
		})

		expect(res.status).toBe(201)
		expect(res.body.data.shippingAmount).toBe(2500)
		expect(res.body.data.totalAmount).toBe(19999 + 2500)
		expect(res.body.data.delivery).toEqual({
			method: 'courier',
			deliveryZoneId: zone.id,
			recipientName: 'Ion Rece',
			recipientPhone: '+37369111222',
			city: 'Chisinau',
			street: 'Str. Stefan cel Mare',
			house: '10',
			apartment: '5',
			notes: 'Ring twice'
		})
	})

	test('rejects an incomplete delivery selection', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id)

		const res = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie),
			body: JSON.stringify({
				customerName: 'Maria Popescu',
				customerEmail: 'maria@example.com',
				customerPhone: '069123456',
				delivery: { method: 'courier' }, // missing zone id and recipient fields
				paymentMethod: 'cash_on_delivery'
			})
		})
		expect(res.status).toBe(400)
		expect(res.body.error.code).toBe('validation_error')
	})
})

describe('payment isolation from order status', () => {
	test('an order can be completed while its payment is still pending', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff, 10)
		const pickup = await createPickupLocation(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 1)

		const created = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie),
			body: JSON.stringify({
				customerName: 'Maria Popescu',
				customerEmail: 'maria@example.com',
				customerPhone: '069123456',
				delivery: { method: 'pickup', pickupLocationId: pickup.id },
				paymentMethod: 'cash_on_delivery'
			})
		})
		const orderId = created.body.data.id
		expect(created.body.data.payments[0].status).toBe('pending')

		await requestJson(`/api/v1/admin/orders/${orderId}/transition`, {
			method: 'POST',
			headers: { Cookie: staff },
			body: JSON.stringify({ toStatus: 'confirmed' })
		})
		await requestJson(`/api/v1/admin/orders/${orderId}/transition`, {
			method: 'POST',
			headers: { Cookie: staff },
			body: JSON.stringify({ toStatus: 'processing' })
		})
		const completed = await requestJson(`/api/v1/admin/orders/${orderId}/complete`, {
			method: 'POST',
			headers: { Cookie: staff },
			body: JSON.stringify({})
		})

		expect(completed.status).toBe(200)
		expect(completed.body.data.status).toBe('completed')
		// Payment status is untouched by the order's own lifecycle.
		expect(completed.body.data.payments[0].status).toBe('pending')
	})

	test('staff can mark an offline payment as paid independently, with audit history', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const pickup = await createPickupLocation(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id)
		const created = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie),
			body: JSON.stringify({
				customerName: 'Maria Popescu',
				customerEmail: 'maria@example.com',
				customerPhone: '069123456',
				delivery: { method: 'pickup', pickupLocationId: pickup.id },
				paymentMethod: 'cash_on_delivery'
			})
		})
		const orderId = created.body.data.id
		const paymentId = created.body.data.payments[0].id

		const res = await requestJson(`/api/v1/admin/orders/${orderId}/payments/${paymentId}/transition`, {
			method: 'POST',
			headers: { Cookie: staff },
			body: JSON.stringify({ toStatus: 'paid', reason: 'Collected cash on delivery' })
		})

		expect(res.status).toBe(200)
		expect(res.body.data.payments[0].status).toBe('paid')
		// The order's own status is unaffected by this.
		expect(res.body.data.status).toBe('pending')

		const row = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1)
		expect(row[0].status).toBe('paid')
	})

	test('rejects an invalid payment status transition', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const pickup = await createPickupLocation(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id)
		const created = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie),
			body: JSON.stringify({
				customerName: 'Maria Popescu',
				customerEmail: 'maria@example.com',
				customerPhone: '069123456',
				delivery: { method: 'pickup', pickupLocationId: pickup.id },
				paymentMethod: 'cash_on_delivery'
			})
		})
		const orderId = created.body.data.id
		const paymentId = created.body.data.payments[0].id

		// pending -> refunded is not a legal direct transition (must be paid first).
		const res = await requestJson(`/api/v1/admin/orders/${orderId}/payments/${paymentId}/transition`, {
			method: 'POST',
			headers: { Cookie: staff },
			body: JSON.stringify({ toStatus: 'refunded', reason: 'test' })
		})
		expect(res.status).toBe(409)
		expect(res.body.error.code).toBe('invalid_payment_status_transition')
	})
})

describe('admin fulfillment', () => {
	async function createPendingOrder(staff: string, quantityOnHand = 10, quantity = 2) {
		const { variant, product } = await createSellableProduct(staff, quantityOnHand)
		const pickup = await createPickupLocation(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, quantity)
		const created = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie),
			body: JSON.stringify({
				customerName: 'Maria Popescu',
				customerEmail: 'maria@example.com',
				customerPhone: '069123456',
				delivery: { method: 'pickup', pickupLocationId: pickup.id },
				paymentMethod: 'cash_on_delivery'
			})
		})
		return { orderId: created.body.data.id, variant, product }
	}

	test('customers and unauthenticated clients cannot reach the admin order endpoints', async () => {
		const staff = await staffCookie()
		const { orderId } = await createPendingOrder(staff)
		const { cookie: customerCookie } = await createSessionAs('customer')

		const asCustomer = await requestJson(`/api/v1/admin/orders/${orderId}`, { headers: { Cookie: customerCookie } })
		expect(asCustomer.status).toBe(403)

		const unauthenticated = await requestJson(`/api/v1/admin/orders/${orderId}`)
		expect(unauthenticated.status).toBe(401)
	})

	test('valid transitions move the order through its lifecycle', async () => {
		const staff = await staffCookie()
		const { orderId } = await createPendingOrder(staff)

		const toConfirmed = await requestJson(`/api/v1/admin/orders/${orderId}/transition`, {
			method: 'POST',
			headers: { Cookie: staff },
			body: JSON.stringify({ toStatus: 'confirmed' })
		})
		expect(toConfirmed.status).toBe(200)
		expect(toConfirmed.body.data.status).toBe('confirmed')

		const toProcessing = await requestJson(`/api/v1/admin/orders/${orderId}/transition`, {
			method: 'POST',
			headers: { Cookie: staff },
			body: JSON.stringify({ toStatus: 'processing' })
		})
		expect(toProcessing.status).toBe(200)
		expect(toProcessing.body.data.status).toBe('processing')
		expect(toProcessing.body.data.statusHistory).toHaveLength(3)
	})

	test('rejects an invalid transition (pending straight to processing)', async () => {
		const staff = await staffCookie()
		const { orderId } = await createPendingOrder(staff)

		const res = await requestJson(`/api/v1/admin/orders/${orderId}/transition`, {
			method: 'POST',
			headers: { Cookie: staff },
			body: JSON.stringify({ toStatus: 'processing' })
		})
		expect(res.status).toBe(409)
		expect(res.body.error.code).toBe('invalid_order_status_transition')
	})

	test('admin cancel releases the reservation and a repeat cancel is rejected', async () => {
		const staff = await staffCookie()
		const { orderId, variant } = await createPendingOrder(staff, 10, 4)

		await requestJson(`/api/v1/admin/orders/${orderId}/transition`, {
			method: 'POST',
			headers: { Cookie: staff },
			body: JSON.stringify({ toStatus: 'confirmed' })
		})

		const cancelled = await requestJson(`/api/v1/admin/orders/${orderId}/cancel`, {
			method: 'POST',
			headers: { Cookie: staff },
			body: JSON.stringify({ reason: 'Out of stock elsewhere' })
		})
		expect(cancelled.status).toBe(200)
		expect(cancelled.body.data.status).toBe('cancelled')

		const inv = await getInventory(variant.id)
		expect(inv.quantityReserved).toBe(0)
		expect(inv.quantityOnHand).toBe(10)

		const again = await requestJson(`/api/v1/admin/orders/${orderId}/cancel`, {
			method: 'POST',
			headers: { Cookie: staff },
			body: JSON.stringify({})
		})
		expect(again.status).toBe(409)

		// Reservation was released exactly once, not twice.
		const invAfter = await getInventory(variant.id)
		expect(invAfter.quantityReserved).toBe(0)
	})

	test('completing fulfillment commits inventory exactly once', async () => {
		const staff = await staffCookie()
		const { orderId, variant } = await createPendingOrder(staff, 10, 3)

		await requestJson(`/api/v1/admin/orders/${orderId}/transition`, {
			method: 'POST',
			headers: { Cookie: staff },
			body: JSON.stringify({ toStatus: 'confirmed' })
		})
		await requestJson(`/api/v1/admin/orders/${orderId}/transition`, {
			method: 'POST',
			headers: { Cookie: staff },
			body: JSON.stringify({ toStatus: 'processing' })
		})

		let inv = await getInventory(variant.id)
		expect(inv.quantityOnHand).toBe(10)
		expect(inv.quantityReserved).toBe(3)

		const completed = await requestJson(`/api/v1/admin/orders/${orderId}/complete`, {
			method: 'POST',
			headers: { Cookie: staff },
			body: JSON.stringify({})
		})
		expect(completed.status).toBe(200)
		expect(completed.body.data.status).toBe('completed')

		inv = await getInventory(variant.id)
		expect(inv.quantityOnHand).toBe(7)
		expect(inv.quantityReserved).toBe(0)

		// Duplicate completion attempt must not commit a second time.
		const again = await requestJson(`/api/v1/admin/orders/${orderId}/complete`, {
			method: 'POST',
			headers: { Cookie: staff },
			body: JSON.stringify({})
		})
		expect(again.status).toBe(409)

		const invAfter = await getInventory(variant.id)
		expect(invAfter.quantityOnHand).toBe(7)
		expect(invAfter.quantityReserved).toBe(0)
	})

	test('concurrent cancel and complete attempts: exactly one side effect applies', async () => {
		const staff = await staffCookie()
		const { orderId, variant } = await createPendingOrder(staff, 10, 2)
		await requestJson(`/api/v1/admin/orders/${orderId}/transition`, {
			method: 'POST',
			headers: { Cookie: staff },
			body: JSON.stringify({ toStatus: 'confirmed' })
		})
		await requestJson(`/api/v1/admin/orders/${orderId}/transition`, {
			method: 'POST',
			headers: { Cookie: staff },
			body: JSON.stringify({ toStatus: 'processing' })
		})

		const [cancelRes, completeRes] = await Promise.all([
			requestJson(`/api/v1/admin/orders/${orderId}/cancel`, {
				method: 'POST',
				headers: { Cookie: staff },
				body: JSON.stringify({})
			}),
			requestJson(`/api/v1/admin/orders/${orderId}/complete`, {
				method: 'POST',
				headers: { Cookie: staff },
				body: JSON.stringify({})
			})
		])

		const statuses = [cancelRes.status, completeRes.status].sort()
		expect(statuses).toEqual([200, 409])

		const inv = await getInventory(variant.id)
		// Either released back to 10/0 (cancel won) or committed to 8/0
		// (complete won) - never both, never neither, never negative.
		const releasedWon = inv.quantityOnHand === 10 && inv.quantityReserved === 0
		const completedWon = inv.quantityOnHand === 8 && inv.quantityReserved === 0
		expect(releasedWon || completedWon).toBe(true)
	})

	test('lists and filters orders by status', async () => {
		const staff = await staffCookie()
		const { orderId } = await createPendingOrder(staff)
		await requestJson(`/api/v1/admin/orders/${orderId}/transition`, {
			method: 'POST',
			headers: { Cookie: staff },
			body: JSON.stringify({ toStatus: 'confirmed' })
		})
		await createPendingOrder(staff)

		const confirmedOnly = await requestJson('/api/v1/admin/orders?status=confirmed', {
			headers: { Cookie: staff }
		})
		expect(confirmedOnly.body.data).toHaveLength(1)
		expect(confirmedOnly.body.data[0].id).toBe(orderId)

		const all = await requestJson('/api/v1/admin/orders', { headers: { Cookie: staff } })
		expect(all.body.meta.total).toBe(2)
	})
})

describe('regression: existing APIs after Sprint 7 changes', () => {
	test('Catalog, Cart and Wishlist APIs still work', async () => {
		const staff = await staffCookie()
		const { product, variant } = await createSellableProduct(staff)

		const catalog = await requestJson(`/api/v1/products/${product.slug}`)
		expect(catalog.status).toBe(200)

		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 1)
		const cart = await requestJson('/api/v1/cart', { headers: { Cookie: guestCookie } })
		expect(cart.body.data.items).toHaveLength(1)

		const { cookie: customerCookie } = await createSessionAs('customer')
		const wishlistAdd = await requestJson('/api/v1/wishlist', {
			method: 'POST',
			headers: { Cookie: customerCookie },
			body: JSON.stringify({ productId: product.id })
		})
		expect(wishlistAdd.status).toBe(201)
	})
})
