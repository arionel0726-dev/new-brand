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

async function createSellableProduct(cookie: string, overrides: Record<string, unknown> = {}) {
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
				nameRu: `Товар ${suffix}`,
				nameRo: `Produs ${suffix}`,
				categoryIds: [category.id],
				...overrides
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
		body: JSON.stringify({ price: 10000 })
	})
	await requestJson(`/api/v1/admin/products/${product.id}`, {
		method: 'PATCH',
		headers: { Cookie: cookie },
		body: JSON.stringify({ status: 'active' })
	})
	return product
}

async function createDraftProduct(cookie: string) {
	const suffix = crypto.randomUUID().slice(0, 8)
	return (
		await requestJson('/api/v1/admin/products', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ slug: `draft-${suffix}`, nameRu: 'Черновик', nameRo: 'Ciorna' })
		})
	).body.data
}

async function createCollection(cookie: string, overrides: Record<string, unknown> = {}) {
	const suffix = crypto.randomUUID().slice(0, 6)
	const res = await requestJson('/api/v1/admin/collections', {
		method: 'POST',
		headers: { Cookie: cookie },
		body: JSON.stringify({
			slug: `coll-${suffix}`,
			titleRu: 'Новинки',
			titleRo: 'Noutati',
			...overrides
		})
	})
	expect(res.status).toBe(201)
	return res.body.data
}

describe('admin collections API', () => {
	test('a customer cannot reach the admin collections API', async () => {
		const { cookie } = await createSessionAs('customer')
		const res = await requestJson('/api/v1/admin/collections', { headers: { Cookie: cookie } })
		expect(res.status).toBe(403)
	})

	test('create with curated membership, list, patch (replacing membership), and delete', async () => {
		const staff = await staffCookie()
		const productA = await createSellableProduct(staff)
		const productB = await createSellableProduct(staff)

		const created = await createCollection(staff, {
			products: [
				{ productId: productB.id, sortOrder: 0 },
				{ productId: productA.id, sortOrder: 1 }
			]
		})
		expect(created.products.map((p: { productId: string }) => p.productId)).toEqual([productB.id, productA.id])

		const list = await requestJson('/api/v1/admin/collections', { headers: { Cookie: staff } })
		expect(list.body.data.some((c: { id: string }) => c.id === created.id)).toBe(true)

		const patched = await requestJson(`/api/v1/admin/collections/${created.id}`, {
			method: 'PATCH',
			headers: { Cookie: staff },
			body: JSON.stringify({ products: [{ productId: productA.id, sortOrder: 0 }] })
		})
		expect(patched.body.data.products.map((p: { productId: string }) => p.productId)).toEqual([productA.id])

		const deleted = await requestJson(`/api/v1/admin/collections/${created.id}`, {
			method: 'DELETE',
			headers: { Cookie: staff }
		})
		expect(deleted.status).toBe(200)

		const getAfterDelete = await requestJson(`/api/v1/admin/collections/${created.id}`, {
			headers: { Cookie: staff }
		})
		expect(getAfterDelete.status).toBe(404)
	})
})

describe('public collections API', () => {
	test('only active collections are listed, with localized titles', async () => {
		const staff = await staffCookie()
		await createCollection(staff, { titleRu: 'Хиты', titleRo: 'Hituri', isActive: true })
		await createCollection(staff, { titleRu: 'Скрытая', titleRo: 'Ascunsa', isActive: false })

		const ru = await requestJson('/api/v1/collections?lang=ru')
		expect(ru.body.data).toHaveLength(1)
		expect(ru.body.data[0].title).toBe('Хиты')

		const ro = await requestJson('/api/v1/collections?lang=ro')
		expect(ro.body.data[0].title).toBe('Hituri')
	})

	test('an inactive collection is not reachable by slug', async () => {
		const staff = await staffCookie()
		const collection = await createCollection(staff, { isActive: false })
		const res = await requestJson(`/api/v1/collections/${collection.slug}`)
		expect(res.status).toBe(404)
	})

	test('a collection detail only surfaces publishable products, in curated order', async () => {
		const staff = await staffCookie()
		const productA = await createSellableProduct(staff)
		const productB = await createSellableProduct(staff)
		const draft = await createDraftProduct(staff)

		const collection = await createCollection(staff, {
			products: [
				{ productId: productB.id, sortOrder: 0 },
				{ productId: draft.id, sortOrder: 1 },
				{ productId: productA.id, sortOrder: 2 }
			]
		})

		const res = await requestJson(`/api/v1/collections/${collection.slug}`)
		expect(res.status).toBe(200)
		expect(res.body.data.collection.slug).toBe(collection.slug)
		expect(res.body.data.items.map((item: { id: string }) => item.id)).toEqual([productB.id, productA.id])
		expect(res.body.meta.total).toBe(2)
	})
})
