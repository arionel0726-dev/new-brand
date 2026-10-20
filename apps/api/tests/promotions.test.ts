import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { orderItems, orders } from '../src/db/schema/orders'
import { promotions } from '../src/db/schema/promotions'
import { computePromotionDiscounts } from '../src/promotions/pricing'
import { createSessionAs, extractCookieHeader, requestJson, resetAuthTables, resetDatabase } from './helpers'

beforeEach(async () => {
	await resetDatabase()
	await resetAuthTables()
})

async function staffCookie() {
	const { cookie } = await createSessionAs('staff')
	return cookie
}

async function createSellableProduct(cookie: string, quantityOnHand = 10, price = 20000) {
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
	return { product, brand, category, variant }
}

async function createPickupLocation(cookie: string) {
	const suffix = crypto.randomUUID().slice(0, 8)
	const res = await requestJson('/api/v1/admin/pickup-locations', {
		method: 'POST',
		headers: { Cookie: cookie },
		body: JSON.stringify({ code: `loc-${suffix}`, nameRu: 'Магазин', nameRo: 'Magazin', address: 'Str. Test 1' })
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

function orderHeaders(cookie: string, idempotencyKey = crypto.randomUUID()) {
	return { Cookie: cookie, 'Idempotency-Key': idempotencyKey }
}

function customerPayload(pickupLocationId: string, overrides: Record<string, unknown> = {}) {
	return {
		customerName: 'Maria Popescu',
		customerEmail: 'maria@example.com',
		customerPhone: '069123456',
		delivery: { method: 'pickup', pickupLocationId },
		paymentMethod: 'cash_on_delivery',
		...overrides
	}
}

async function createPromotion(cookie: string, overrides: Record<string, unknown> = {}) {
	const res = await requestJson('/api/v1/admin/promotions', {
		method: 'POST',
		headers: { Cookie: cookie },
		body: JSON.stringify({
			name: 'Test promotion',
			discountType: 'percentage',
			percentageValue: 10,
			...overrides
		})
	})
	expect(res.status).toBe(201)
	return res.body.data
}

describe('promotion calculation (pure)', () => {
	test('percentage discount rounds half up to the nearest bano', async () => {
		const staff = await staffCookie()
		await createPromotion(staff, { discountType: 'percentage', percentageValue: 15 })

		const variantId = crypto.randomUUID()
		const discounts = await computePromotionDiscounts(db, [
			{ variantId, productId: crypto.randomUUID(), unitPrice: 333, quantity: 1 }
		])
		// 333 * 15 / 100 = 49.95 -> rounds to 50
		expect(discounts.get(variantId)?.discountAmount).toBe(50)
	})

	test('fixed-amount discount never reduces a line below zero', async () => {
		const staff = await staffCookie()
		await createPromotion(staff, { discountType: 'fixed_amount', fixedAmount: 100000, percentageValue: undefined })

		const variantId = crypto.randomUUID()
		const discounts = await computePromotionDiscounts(db, [
			{ variantId, productId: crypto.randomUUID(), unitPrice: 5000, quantity: 1 }
		])
		expect(discounts.get(variantId)?.discountAmount).toBe(5000)
	})

	test('maxDiscountAmount caps a percentage discount', async () => {
		const staff = await staffCookie()
		await createPromotion(staff, { discountType: 'percentage', percentageValue: 50, maxDiscountAmount: 1000 })

		const variantId = crypto.randomUUID()
		const discounts = await computePromotionDiscounts(db, [
			{ variantId, productId: crypto.randomUUID(), unitPrice: 10000, quantity: 1 }
		])
		expect(discounts.get(variantId)?.discountAmount).toBe(1000)
	})

	test('a zero-price line gets zero discount, never negative', async () => {
		const staff = await staffCookie()
		await createPromotion(staff, { discountType: 'percentage', percentageValue: 50 })

		const variantId = crypto.randomUUID()
		const discounts = await computePromotionDiscounts(db, [
			{ variantId, productId: crypto.randomUUID(), unitPrice: 0, quantity: 1 }
		])
		expect(discounts.get(variantId)?.discountAmount).toBe(0)
	})

	test('expired, not-yet-started, and inactive promotions never apply', async () => {
		const staff = await staffCookie()
		const past = new Date(Date.now() - 86400000).toISOString()
		const future = new Date(Date.now() + 86400000).toISOString()

		await createPromotion(staff, { endsAt: past })
		await createPromotion(staff, { startsAt: future })
		await createPromotion(staff, { isActive: false })

		const variantId = crypto.randomUUID()
		const discounts = await computePromotionDiscounts(db, [
			{ variantId, productId: crypto.randomUUID(), unitPrice: 10000, quantity: 1 }
		])
		expect(discounts.get(variantId)?.discountAmount).toBe(0)
	})

	test('overlapping promotions: higher priority wins, never stacked', async () => {
		const staff = await staffCookie()
		await createPromotion(staff, { discountType: 'percentage', percentageValue: 10, priority: 1 })
		const winner = await createPromotion(staff, { discountType: 'percentage', percentageValue: 20, priority: 5 })

		const variantId = crypto.randomUUID()
		const discounts = await computePromotionDiscounts(db, [
			{ variantId, productId: crypto.randomUUID(), unitPrice: 10000, quantity: 1 }
		])
		const result = discounts.get(variantId)
		expect(result?.promotionId).toBe(winner.id)
		expect(result?.discountAmount).toBe(2000)
	})

	test('a product-scoped promotion only applies to its listed product', async () => {
		const staff = await staffCookie()
		const { product: productA } = await createSellableProduct(staff)
		const { product: productB } = await createSellableProduct(staff)
		await createPromotion(staff, { scope: { productIds: [productA.id] } })

		const discounts = await computePromotionDiscounts(db, [
			{ variantId: 'vA', productId: productA.id, unitPrice: 10000, quantity: 1 },
			{ variantId: 'vB', productId: productB.id, unitPrice: 10000, quantity: 1 }
		])
		expect(discounts.get('vA')?.discountAmount).toBeGreaterThan(0)
		expect(discounts.get('vB')?.discountAmount).toBe(0)
	})

	test('a brand-scoped promotion applies to every product of that brand', async () => {
		const staff = await staffCookie()
		const { product, brand } = await createSellableProduct(staff)
		await createPromotion(staff, { scope: { brandIds: [brand.id] } })

		const discounts = await computePromotionDiscounts(db, [
			{ variantId: 'v1', productId: product.id, unitPrice: 10000, quantity: 1 }
		])
		expect(discounts.get('v1')?.discountAmount).toBeGreaterThan(0)
	})

	test('a category-scoped promotion applies to every product in that category', async () => {
		const staff = await staffCookie()
		const { product, category } = await createSellableProduct(staff)
		await createPromotion(staff, { scope: { categoryIds: [category.id] } })

		const discounts = await computePromotionDiscounts(db, [
			{ variantId: 'v1', productId: product.id, unitPrice: 10000, quantity: 1 }
		])
		expect(discounts.get('v1')?.discountAmount).toBeGreaterThan(0)
	})

	test('an explicit exclusion wins even for an otherwise-global promotion', async () => {
		const staff = await staffCookie()
		const { product } = await createSellableProduct(staff)
		await createPromotion(staff, { scope: { excludedProductIds: [product.id] } })

		const discounts = await computePromotionDiscounts(db, [
			{ variantId: 'v1', productId: product.id, unitPrice: 10000, quantity: 1 }
		])
		expect(discounts.get('v1')?.discountAmount).toBe(0)
	})
})

describe('checkout preview with promotions', () => {
	test('preview reflects the promotion discount and a reduced discountedSubtotal', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff, 10, 20000)
		await createPromotion(staff, { discountType: 'percentage', percentageValue: 10 })

		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 2)

		const res = await requestJson('/api/v1/checkout/preview', {
			method: 'POST',
			headers: { Cookie: guestCookie }
		})

		expect(res.body.data.subtotal).toBe(40000)
		expect(res.body.data.promotionDiscountTotal).toBe(4000)
		expect(res.body.data.discountedSubtotal).toBe(36000)
		expect(res.body.data.items[0].promotionDiscountAmount).toBe(4000)
		expect(res.body.data.items[0].netLineTotal).toBe(36000)
	})
})

describe('order creation with promotions', () => {
	test('the order and order item store the promotion snapshot and redemptionCount increments', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff, 10, 20000)
		const promotion = await createPromotion(staff, { discountType: 'percentage', percentageValue: 10 })
		const pickup = await createPickupLocation(staff)

		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 1)

		const res = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie),
			body: JSON.stringify(customerPayload(pickup.id))
		})

		expect(res.status).toBe(201)
		expect(res.body.data.promotionDiscountAmount).toBe(2000)
		expect(res.body.data.totalAmount).toBe(20000 - 2000)

		const [orderRow] = await db.select().from(orders).where(eq(orders.id, res.body.data.id)).limit(1)
		const [itemRow] = await db.select().from(orderItems).where(eq(orderItems.orderId, orderRow.id)).limit(1)
		expect(itemRow.promotionId).toBe(promotion.id)
		expect(itemRow.discountAmount).toBe(2000)

		const [promoRow] = await db.select().from(promotions).where(eq(promotions.id, promotion.id)).limit(1)
		expect(promoRow.redemptionCount).toBe(1)
	})

	test('a promotion exhausted mid-race drops its discount on the losing order but still lets checkout succeed', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff, 10, 20000)
		const promotion = await createPromotion(staff, {
			discountType: 'percentage',
			percentageValue: 10,
			maxTotalRedemptions: 1
		})
		const pickup = await createPickupLocation(staff)

		const guestA = await getGuestCookie()
		const guestB = await getGuestCookie()
		await addToCart(guestA, variant.id, 1)
		await addToCart(guestB, variant.id, 1)

		const [resA, resB] = await Promise.all([
			requestJson('/api/v1/orders', {
				method: 'POST',
				headers: orderHeaders(guestA),
				body: JSON.stringify(customerPayload(pickup.id))
			}),
			requestJson('/api/v1/orders', {
				method: 'POST',
				headers: orderHeaders(guestB),
				body: JSON.stringify(customerPayload(pickup.id))
			})
		])

		// Both checkouts succeed - a promotion exhausting mid-race is never a
		// reason to fail an order (documented policy).
		expect(resA.status).toBe(201)
		expect(resB.status).toBe(201)

		const discounts = [resA.body.data.promotionDiscountAmount, resB.body.data.promotionDiscountAmount].sort(
			(a, b) => a - b
		)
		expect(discounts).toEqual([0, 2000])

		const [promoRow] = await db.select().from(promotions).where(eq(promotions.id, promotion.id)).limit(1)
		expect(promoRow.redemptionCount).toBe(1)
	})
})

describe('admin promotions API', () => {
	test('a customer cannot reach the admin promotions API', async () => {
		const { cookie } = await createSessionAs('customer')
		const res = await requestJson('/api/v1/admin/promotions', { headers: { Cookie: cookie } })
		expect(res.status).toBe(403)
	})

	test('create, list, patch and deactivate a promotion; redemptionCount is never client-settable', async () => {
		const staff = await staffCookie()
		const created = await createPromotion(staff, { redemptionCount: 999 } as Record<string, unknown>)
		expect(created.redemptionCount).toBe(0)

		const list = await requestJson('/api/v1/admin/promotions', { headers: { Cookie: staff } })
		expect(list.body.data.some((p: { id: string }) => p.id === created.id)).toBe(true)

		const patched = await requestJson(`/api/v1/admin/promotions/${created.id}`, {
			method: 'PATCH',
			headers: { Cookie: staff },
			body: JSON.stringify({ priority: 7 })
		})
		expect(patched.body.data.priority).toBe(7)

		const deactivated = await requestJson(`/api/v1/admin/promotions/${created.id}/deactivate`, {
			method: 'POST',
			headers: { Cookie: staff }
		})
		expect(deactivated.body.data.isActive).toBe(false)
	})
})
