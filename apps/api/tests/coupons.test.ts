import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { couponRedemptions } from '../src/db/schema/coupon-redemptions'
import { coupons } from '../src/db/schema/coupons'
import { orders } from '../src/db/schema/orders'
import { normalizeCouponCode } from '../src/coupons/normalize'
import { redeemCoupon } from '../src/coupons/redeem'
import { validateCoupon, type CouponLine } from '../src/coupons/validate'
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

async function createCoupon(cookie: string, overrides: Record<string, unknown> = {}) {
	const res = await requestJson('/api/v1/admin/coupons', {
		method: 'POST',
		headers: { Cookie: cookie },
		body: JSON.stringify({
			code: `SAVE-${crypto.randomUUID().slice(0, 6)}`,
			discountType: 'percentage',
			percentageValue: 10,
			...overrides
		})
	})
	expect(res.status).toBe(201)
	return res.body.data
}

describe('coupon code normalization', () => {
	test('trims, uppercases, and strips internal whitespace', () => {
		expect(normalizeCouponCode('  save 10 ')).toBe('SAVE10')
		expect(normalizeCouponCode('Save10')).toBe('SAVE10')
	})
})

describe('coupon validation (pure)', () => {
	async function lineFor(productId: string, netAmount: number): Promise<CouponLine[]> {
		return [{ variantId: crypto.randomUUID(), productId, netAmount }]
	}

	test('an unknown code is rejected', async () => {
		const result = await validateCoupon(db, 'NOPE', { subtotalAmount: 10000, lines: [], userId: null })
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.code).toBe('coupon_not_found')
	})

	test('an inactive coupon is rejected', async () => {
		const staff = await staffCookie()
		const { product } = await createSellableProduct(staff)
		const coupon = await createCoupon(staff, { isActive: false })

		const result = await validateCoupon(db, coupon.code, {
			subtotalAmount: 10000,
			lines: await lineFor(product.id, 10000),
			userId: null
		})
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.code).toBe('coupon_inactive')
	})

	test('a not-yet-started coupon is rejected', async () => {
		const staff = await staffCookie()
		const { product } = await createSellableProduct(staff)
		const coupon = await createCoupon(staff, { startsAt: new Date(Date.now() + 86400000).toISOString() })

		const result = await validateCoupon(db, coupon.code, {
			subtotalAmount: 10000,
			lines: await lineFor(product.id, 10000),
			userId: null
		})
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.code).toBe('coupon_not_started')
	})

	test('an expired coupon is rejected', async () => {
		const staff = await staffCookie()
		const { product } = await createSellableProduct(staff)
		const coupon = await createCoupon(staff, { endsAt: new Date(Date.now() - 86400000).toISOString() })

		const result = await validateCoupon(db, coupon.code, {
			subtotalAmount: 10000,
			lines: await lineFor(product.id, 10000),
			userId: null
		})
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.code).toBe('coupon_expired')
	})

	test('below the minimum order amount is rejected, surfacing the minimum', async () => {
		const staff = await staffCookie()
		const { product } = await createSellableProduct(staff)
		const coupon = await createCoupon(staff, { minOrderAmount: 50000 })

		const result = await validateCoupon(db, coupon.code, {
			subtotalAmount: 10000,
			lines: await lineFor(product.id, 10000),
			userId: null
		})
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.code).toBe('coupon_below_minimum_order')
			expect(result.minOrderAmount).toBe(50000)
		}
	})

	test('a coupon already at its global usage limit is rejected', async () => {
		const staff = await staffCookie()
		const { product } = await createSellableProduct(staff)
		const coupon = await createCoupon(staff, { maxTotalUses: 1 })
		await db.update(coupons).set({ usesCount: 1 }).where(eq(coupons.id, coupon.id))

		const result = await validateCoupon(db, coupon.code, {
			subtotalAmount: 10000,
			lines: await lineFor(product.id, 10000),
			userId: null
		})
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.code).toBe('coupon_usage_limit_reached')
	})

	test('a per-customer-limited coupon requires an authenticated account for a guest', async () => {
		const staff = await staffCookie()
		const { product } = await createSellableProduct(staff)
		const coupon = await createCoupon(staff, { maxUsesPerCustomer: 1 })

		const result = await validateCoupon(db, coupon.code, {
			subtotalAmount: 10000,
			lines: await lineFor(product.id, 10000),
			userId: null
		})
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.code).toBe('coupon_requires_account')
	})

	test('a per-customer-limited coupon rejects a customer who already used it up', async () => {
		const staff = await staffCookie()
		const { product } = await createSellableProduct(staff)
		const { userId } = await createSessionAs('customer')
		const coupon = await createCoupon(staff, { maxUsesPerCustomer: 1 })

		const [order] = await db
			.insert(orders)
			.values({
				orderNumber: `ORD-${crypto.randomUUID().slice(0, 8)}`,
				subtotalAmount: 10000,
				totalAmount: 10000,
				customerName: 'x',
				customerEmail: 'x@example.com',
				customerPhone: '069000000'
			})
			.returning()
		await db.insert(couponRedemptions).values({ couponId: coupon.id, orderId: order.id, userId, discountAmount: 1000 })

		const result = await validateCoupon(db, coupon.code, {
			subtotalAmount: 10000,
			lines: await lineFor(product.id, 10000),
			userId
		})
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.code).toBe('coupon_per_customer_limit_reached')
	})

	test('a coupon scoped to a different product is not applicable', async () => {
		const staff = await staffCookie()
		const { product: scopedProduct } = await createSellableProduct(staff)
		const { product: otherProduct } = await createSellableProduct(staff)
		const coupon = await createCoupon(staff, { scope: { productIds: [scopedProduct.id] } })

		const result = await validateCoupon(db, coupon.code, {
			subtotalAmount: 10000,
			lines: await lineFor(otherProduct.id, 10000),
			userId: null
		})
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.code).toBe('coupon_not_applicable')
	})

	test('only the eligible (scoped) lines count toward the discount base', async () => {
		const staff = await staffCookie()
		const { product: scopedProduct } = await createSellableProduct(staff)
		const { product: otherProduct } = await createSellableProduct(staff)
		const coupon = await createCoupon(staff, {
			discountType: 'percentage',
			percentageValue: 10,
			scope: { productIds: [scopedProduct.id] }
		})

		const result = await validateCoupon(db, coupon.code, {
			subtotalAmount: 30000,
			lines: [
				{ variantId: crypto.randomUUID(), productId: scopedProduct.id, netAmount: 10000 },
				{ variantId: crypto.randomUUID(), productId: otherProduct.id, netAmount: 20000 }
			],
			userId: null
		})
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.eligibleSubtotal).toBe(10000)
			expect(result.discountAmount).toBe(1000)
		}
	})

	test('a fixed-amount coupon never discounts below zero', async () => {
		const staff = await staffCookie()
		const { product } = await createSellableProduct(staff)
		const coupon = await createCoupon(staff, { discountType: 'fixed_amount', fixedAmount: 50000, percentageValue: undefined })

		const result = await validateCoupon(db, coupon.code, {
			subtotalAmount: 5000,
			lines: await lineFor(product.id, 5000),
			userId: null
		})
		expect(result.ok).toBe(true)
		if (result.ok) expect(result.discountAmount).toBe(5000)
	})
})

describe('POST /api/v1/checkout/apply-coupon', () => {
	test('a valid coupon returns a discount preview without reserving or redeeming anything', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff, 10, 20000)
		const coupon = await createCoupon(staff, { discountType: 'percentage', percentageValue: 10 })

		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 1)

		const res = await requestJson('/api/v1/checkout/apply-coupon', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ code: coupon.code.toLowerCase() })
		})

		expect(res.status).toBe(200)
		expect(res.body.data.couponDiscountAmount).toBe(2000)
		expect(res.body.data.discountedSubtotal).toBe(18000)
		// Never leaks admin-only coupon configuration.
		expect(res.body.data.maxTotalUses).toBeUndefined()
		expect(res.body.data.usesCount).toBeUndefined()

		const [row] = await db.select().from(coupons).where(eq(coupons.id, coupon.id)).limit(1)
		expect(row.usesCount).toBe(0)
	})

	test('an unknown coupon code produces a clear error code', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff)
		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 1)

		const res = await requestJson('/api/v1/checkout/apply-coupon', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ code: 'DOES-NOT-EXIST' })
		})
		expect(res.status).toBe(422)
		expect(res.body.error.code).toBe('coupon_not_found')
	})

	test('an empty cart is rejected before any coupon lookup', async () => {
		const guestCookie = await getGuestCookie()
		const res = await requestJson('/api/v1/checkout/apply-coupon', {
			method: 'POST',
			headers: { Cookie: guestCookie },
			body: JSON.stringify({ code: 'ANY' })
		})
		expect(res.status).toBe(422)
		expect(res.body.error.code).toBe('cart_empty')
	})
})

describe('order creation with coupons', () => {
	test('the order stores the coupon snapshot and the redemption is recorded', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff, 10, 20000)
		const coupon = await createCoupon(staff, { discountType: 'percentage', percentageValue: 10 })
		const pickup = await createPickupLocation(staff)

		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 1)

		const res = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie),
			body: JSON.stringify(customerPayload(pickup.id, { couponCode: coupon.code }))
		})

		expect(res.status).toBe(201)
		expect(res.body.data.couponDiscountAmount).toBe(2000)
		expect(res.body.data.couponCode).toBe(coupon.code)
		expect(res.body.data.totalAmount).toBe(20000 - 2000)

		const [row] = await db.select().from(coupons).where(eq(coupons.id, coupon.id)).limit(1)
		expect(row.usesCount).toBe(1)

		const redemptions = await db
			.select()
			.from(couponRedemptions)
			.where(eq(couponRedemptions.couponId, coupon.id))
		expect(redemptions).toHaveLength(1)
		expect(redemptions[0].orderId).toBe(res.body.data.id)
	})

	test('an idempotent retry never redeems the coupon twice', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff, 10, 20000)
		const coupon = await createCoupon(staff, { discountType: 'percentage', percentageValue: 10 })
		const pickup = await createPickupLocation(staff)

		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 1)

		const headers = orderHeaders(guestCookie)
		const payload = JSON.stringify(customerPayload(pickup.id, { couponCode: coupon.code }))

		const first = await requestJson('/api/v1/orders', { method: 'POST', headers, body: payload })
		const second = await requestJson('/api/v1/orders', { method: 'POST', headers, body: payload })

		expect(first.body.data.id).toBe(second.body.data.id)
		expect(second.body.data.replayed).toBe(true)

		const [row] = await db.select().from(coupons).where(eq(coupons.id, coupon.id)).limit(1)
		expect(row.usesCount).toBe(1)
	})

	test('an invalid coupon at checkout blocks order creation with a clear error code', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff, 10, 20000)
		const pickup = await createPickupLocation(staff)

		const guestCookie = await getGuestCookie()
		await addToCart(guestCookie, variant.id, 1)

		const res = await requestJson('/api/v1/orders', {
			method: 'POST',
			headers: orderHeaders(guestCookie),
			body: JSON.stringify(customerPayload(pickup.id, { couponCode: 'NOPE' }))
		})
		expect(res.status).toBe(422)
		expect(res.body.error.code).toBe('coupon_not_found')
	})

	test('concurrent checkouts racing for the last global use: exactly one redeems it', async () => {
		const staff = await staffCookie()
		const { variant } = await createSellableProduct(staff, 10, 20000)
		const coupon = await createCoupon(staff, { discountType: 'percentage', percentageValue: 10, maxTotalUses: 1 })
		const pickup = await createPickupLocation(staff)

		const guestA = await getGuestCookie()
		const guestB = await getGuestCookie()
		await addToCart(guestA, variant.id, 1)
		await addToCart(guestB, variant.id, 1)

		const payload = JSON.stringify(customerPayload(pickup.id, { couponCode: coupon.code }))
		const [resA, resB] = await Promise.all([
			requestJson('/api/v1/orders', { method: 'POST', headers: orderHeaders(guestA), body: payload }),
			requestJson('/api/v1/orders', { method: 'POST', headers: orderHeaders(guestB), body: payload })
		])

		const statuses = [resA.status, resB.status].sort()
		expect(statuses).toEqual([201, 422])
		const failed = resA.status === 422 ? resA : resB
		expect(failed.body.error.code).toBe('coupon_usage_limit_reached')

		const [row] = await db.select().from(coupons).where(eq(coupons.id, coupon.id)).limit(1)
		expect(row.usesCount).toBe(1)

		const redemptions = await db
			.select()
			.from(couponRedemptions)
			.where(eq(couponRedemptions.couponId, coupon.id))
		expect(redemptions).toHaveLength(1)
	})
})

describe('redeemCoupon concurrency (direct, real Postgres transactions)', () => {
	test('a per-customer limit of 1 is enforced even when two redemptions race for the same user', async () => {
		const staff = await staffCookie()
		const { userId } = await createSessionAs('customer')
		const coupon = await createCoupon(staff, { maxUsesPerCustomer: 1 })

		async function makeOrder() {
			const [order] = await db
				.insert(orders)
				.values({
					orderNumber: `ORD-${crypto.randomUUID().slice(0, 8)}`,
					subtotalAmount: 10000,
					totalAmount: 10000,
					customerName: 'x',
					customerEmail: 'x@example.com',
					customerPhone: '069000000'
				})
				.returning()
			return order
		}

		const [orderA, orderB] = await Promise.all([makeOrder(), makeOrder()])

		const [resultA, resultB] = await Promise.all([
			db.transaction(tx => redeemCoupon(tx, coupon.id, userId, orderA.id, 1000)),
			db.transaction(tx => redeemCoupon(tx, coupon.id, userId, orderB.id, 1000))
		])

		const outcomes = [resultA.ok, resultB.ok].sort()
		expect(outcomes).toEqual([false, true])

		const redemptions = await db
			.select()
			.from(couponRedemptions)
			.where(eq(couponRedemptions.couponId, coupon.id))
		expect(redemptions).toHaveLength(1)
	})
})

describe('admin coupons API', () => {
	test('a customer cannot reach the admin coupons API', async () => {
		const { cookie } = await createSessionAs('customer')
		const res = await requestJson('/api/v1/admin/coupons', { headers: { Cookie: cookie } })
		expect(res.status).toBe(403)
	})

	test('create, patch and deactivate a coupon; usesCount is never client-settable', async () => {
		const staff = await staffCookie()
		const created = await createCoupon(staff, { usesCount: 999 } as Record<string, unknown>)
		expect(created.usesCount).toBe(0)

		const patched = await requestJson(`/api/v1/admin/coupons/${created.id}`, {
			method: 'PATCH',
			headers: { Cookie: staff },
			body: JSON.stringify({ minOrderAmount: 5000 })
		})
		expect(patched.body.data.minOrderAmount).toBe(5000)

		const deactivated = await requestJson(`/api/v1/admin/coupons/${created.id}/deactivate`, {
			method: 'POST',
			headers: { Cookie: staff }
		})
		expect(deactivated.body.data.isActive).toBe(false)
	})
})
