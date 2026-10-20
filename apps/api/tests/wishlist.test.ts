import { beforeEach, describe, expect, test } from 'bun:test'
import { createSessionAs, requestJson, resetAuthTables, resetDatabase } from './helpers'

beforeEach(async () => {
	await resetDatabase()
	await resetAuthTables()
})

async function staffCookie() {
	const { cookie } = await createSessionAs('staff')
	return cookie
}

async function createActiveProduct(cookie: string) {
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
		body: JSON.stringify({ price: 29999 })
	})
	await requestJson(`/api/v1/admin/products/${product.id}`, {
		method: 'PATCH',
		headers: { Cookie: cookie },
		body: JSON.stringify({ status: 'active' })
	})
	return product
}

describe('wishlist', () => {
	test('rejects an unauthenticated request', async () => {
		const res = await requestJson('/api/v1/wishlist')
		expect(res.status).toBe(401)
	})

	test('adds a product and lists it with public data', async () => {
		const staff = await staffCookie()
		const product = await createActiveProduct(staff)
		const { cookie } = await createSessionAs('customer')

		const added = await requestJson('/api/v1/wishlist', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ productId: product.id })
		})
		expect(added.status).toBe(201)

		const list = await requestJson('/api/v1/wishlist', { headers: { Cookie: cookie } })
		expect(list.status).toBe(200)
		expect(list.body.data).toHaveLength(1)
		expect(list.body.data[0].productId).toBe(product.id)
		expect(list.body.data[0].slug).toBe(product.slug)
		expect(list.body.data[0].available).toBe(true)
		expect(list.body.data[0].price).toEqual({ from: 29999, to: 29999, currency: 'MDL' })
	})

	test('adding the same product twice is idempotent, not a duplicate', async () => {
		const staff = await staffCookie()
		const product = await createActiveProduct(staff)
		const { cookie } = await createSessionAs('customer')

		const first = await requestJson('/api/v1/wishlist', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ productId: product.id })
		})
		const second = await requestJson('/api/v1/wishlist', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ productId: product.id })
		})

		expect(first.status).toBe(201)
		expect(second.status).toBe(200)

		const list = await requestJson('/api/v1/wishlist', { headers: { Cookie: cookie } })
		expect(list.body.data).toHaveLength(1)
	})

	test('404s when adding a product that does not exist or is not public', async () => {
		const staff = await staffCookie()
		const draftProduct = (
			await requestJson('/api/v1/admin/products', {
				method: 'POST',
				headers: { Cookie: staff },
				body: JSON.stringify({ slug: 'still-draft', nameRu: 'Черновик', nameRo: 'Ciorna' })
			})
		).body.data
		const { cookie } = await createSessionAs('customer')

		const resDraft = await requestJson('/api/v1/wishlist', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ productId: draftProduct.id })
		})
		expect(resDraft.status).toBe(404)

		const resMissing = await requestJson('/api/v1/wishlist', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ productId: '00000000-0000-0000-0000-000000000000' })
		})
		expect(resMissing.status).toBe(404)
		expect(resMissing.body.error.code).toBe('product_not_found')
	})

	test('removes a product from the wishlist', async () => {
		const staff = await staffCookie()
		const product = await createActiveProduct(staff)
		const { cookie } = await createSessionAs('customer')

		await requestJson('/api/v1/wishlist', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ productId: product.id })
		})

		const removed = await requestJson(`/api/v1/wishlist/${product.id}`, {
			method: 'DELETE',
			headers: { Cookie: cookie }
		})
		expect(removed.status).toBe(200)

		const list = await requestJson('/api/v1/wishlist', { headers: { Cookie: cookie } })
		expect(list.body.data).toHaveLength(0)

		const removeAgain = await requestJson(`/api/v1/wishlist/${product.id}`, {
			method: 'DELETE',
			headers: { Cookie: cookie }
		})
		expect(removeAgain.status).toBe(404)
	})

	test('one customer can never see or modify another customer\'s wishlist', async () => {
		const staff = await staffCookie()
		const product = await createActiveProduct(staff)
		const { cookie: cookieA } = await createSessionAs('customer')
		const { cookie: cookieB } = await createSessionAs('customer')

		await requestJson('/api/v1/wishlist', {
			method: 'POST',
			headers: { Cookie: cookieA },
			body: JSON.stringify({ productId: product.id })
		})

		const listB = await requestJson('/api/v1/wishlist', { headers: { Cookie: cookieB } })
		expect(listB.body.data).toHaveLength(0)

		// B "guessing" A's wishlisted product id can't delete it from A's list.
		const deleteAttempt = await requestJson(`/api/v1/wishlist/${product.id}`, {
			method: 'DELETE',
			headers: { Cookie: cookieB }
		})
		expect(deleteAttempt.status).toBe(404)

		const listAStillHasIt = await requestJson('/api/v1/wishlist', { headers: { Cookie: cookieA } })
		expect(listAStillHasIt.body.data).toHaveLength(1)
	})

	test('marks a wishlisted product unavailable (without removing it) once archived', async () => {
		const staff = await staffCookie()
		const product = await createActiveProduct(staff)
		const { cookie } = await createSessionAs('customer')

		await requestJson('/api/v1/wishlist', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ productId: product.id })
		})

		await requestJson(`/api/v1/admin/products/${product.id}`, {
			method: 'PATCH',
			headers: { Cookie: staff },
			body: JSON.stringify({ status: 'archived' })
		})

		const list = await requestJson('/api/v1/wishlist', { headers: { Cookie: cookie } })
		expect(list.body.data).toHaveLength(1)
		expect(list.body.data[0].available).toBe(false)
		expect(list.body.data[0].price).toBeNull()
	})
})
