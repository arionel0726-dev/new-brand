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

async function createBrand(cookie: string) {
	const res = await requestJson('/api/v1/admin/brands', {
		method: 'POST',
		headers: { Cookie: cookie },
		body: JSON.stringify({ slug: 'loreal', nameRu: "Л'Ореаль", nameRo: "L'Oreal" })
	})
	return res.body.data
}

async function createCategory(cookie: string) {
	const res = await requestJson('/api/v1/admin/categories', {
		method: 'POST',
		headers: { Cookie: cookie },
		body: JSON.stringify({ slug: 'skincare', nameRu: 'Уход', nameRo: 'Ingrijire' })
	})
	return res.body.data
}

async function createDraftProduct(cookie: string, brandId: string, categoryId: string) {
	const res = await requestJson('/api/v1/admin/products', {
		method: 'POST',
		headers: { Cookie: cookie },
		body: JSON.stringify({
			brandId,
			slug: 'revitalift-cream',
			nameRu: 'Крем Revitalift',
			nameRo: 'Crema Revitalift',
			categoryIds: [categoryId]
		})
	})
	return res
}

describe('admin products: creation', () => {
	test('a new product always starts as draft, even if a different status is sent', async () => {
		const cookie = await staffCookie()
		const brand = await createBrand(cookie)
		const category = await createCategory(cookie)

		const res = await requestJson('/api/v1/admin/products', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({
				brandId: brand.id,
				slug: 'sneaky-active',
				nameRu: 'Товар',
				nameRo: 'Produs',
				categoryIds: [category.id],
				status: 'active' // not part of the create schema - must be ignored
			})
		})

		expect(res.status).toBe(201)
		expect(res.body.data.status).toBe('draft')
	})

	test('a draft product does not appear in the public catalog', async () => {
		const cookie = await staffCookie()
		const brand = await createBrand(cookie)
		const category = await createCategory(cookie)
		const created = await createDraftProduct(cookie, brand.id, category.id)

		expect(created.status).toBe(201)
		expect(created.body.data.status).toBe('draft')

		const publicDetail = await requestJson(`/api/v1/products/${created.body.data.slug}`)
		expect(publicDetail.status).toBe(404)
	})
})

describe('admin products: publish readiness', () => {
	test('refuses to publish a product with no variants', async () => {
		const cookie = await staffCookie()
		const brand = await createBrand(cookie)
		const category = await createCategory(cookie)
		const product = (await createDraftProduct(cookie, brand.id, category.id)).body.data

		const res = await requestJson(`/api/v1/admin/products/${product.id}`, {
			method: 'PATCH',
			headers: { Cookie: cookie },
			body: JSON.stringify({ status: 'active' })
		})

		expect(res.status).toBe(422)
		expect(res.body.error.code).toBe('publish_not_ready')
		expect(res.body.error.details.blockers).toContain('missing_sellable_variant')

		// The rejected transition must not have partially applied.
		const reloaded = await requestJson(`/api/v1/admin/products/${product.id}`, {
			headers: { Cookie: cookie }
		})
		expect(reloaded.body.data.status).toBe('draft')
	})

	test('refuses to publish a variant with no price yet', async () => {
		const cookie = await staffCookie()
		const brand = await createBrand(cookie)
		const category = await createCategory(cookie)
		const product = (await createDraftProduct(cookie, brand.id, category.id)).body.data

		await requestJson(`/api/v1/admin/products/${product.id}/variants`, {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ sku: 'REV-50' })
		})

		const res = await requestJson(`/api/v1/admin/products/${product.id}`, {
			method: 'PATCH',
			headers: { Cookie: cookie },
			body: JSON.stringify({ status: 'active' })
		})

		expect(res.status).toBe(422)
		expect(res.body.error.details.blockers).toContain('missing_sellable_variant')
	})

	test('refuses to publish a product without categories', async () => {
		const cookie = await staffCookie()
		const brand = await createBrand(cookie)
		const productRes = await requestJson('/api/v1/admin/products', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({
				brandId: brand.id,
				slug: 'no-category',
				nameRu: 'Без категории',
				nameRo: 'Fara categorie'
			})
		})
		const product = productRes.body.data

		const variantRes = await requestJson(`/api/v1/admin/products/${product.id}/variants`, {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ sku: 'NC-1' })
		})
		await requestJson(`/api/v1/admin/variants/${variantRes.body.data.id}/price`, {
			method: 'PUT',
			headers: { Cookie: cookie },
			body: JSON.stringify({ price: 10000 })
		})

		const res = await requestJson(`/api/v1/admin/products/${product.id}`, {
			method: 'PATCH',
			headers: { Cookie: cookie },
			body: JSON.stringify({ status: 'active' })
		})

		expect(res.status).toBe(422)
		expect(res.body.error.details.blockers).toContain('missing_categories')
	})

	test('publishes successfully once a priced, active variant and a category exist', async () => {
		const cookie = await staffCookie()
		const brand = await createBrand(cookie)
		const category = await createCategory(cookie)
		const product = (await createDraftProduct(cookie, brand.id, category.id)).body.data

		const variantRes = await requestJson(`/api/v1/admin/products/${product.id}/variants`, {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ sku: 'REV-50' })
		})
		await requestJson(`/api/v1/admin/variants/${variantRes.body.data.id}/price`, {
			method: 'PUT',
			headers: { Cookie: cookie },
			body: JSON.stringify({ price: 15000, compareAtPrice: 18000 })
		})

		const publishRes = await requestJson(`/api/v1/admin/products/${product.id}`, {
			method: 'PATCH',
			headers: { Cookie: cookie },
			body: JSON.stringify({ status: 'active' })
		})

		expect(publishRes.status).toBe(200)
		expect(publishRes.body.data.status).toBe('active')

		const publicDetail = await requestJson(`/api/v1/products/${product.slug}`)
		expect(publicDetail.status).toBe(200)
		expect(publicDetail.body.data.variants).toHaveLength(1)
	})

	test('bundling field changes with an unready publish rolls back the whole update', async () => {
		const cookie = await staffCookie()
		const brand = await createBrand(cookie)
		const category = await createCategory(cookie)
		const product = (await createDraftProduct(cookie, brand.id, category.id)).body.data

		const res = await requestJson(`/api/v1/admin/products/${product.id}`, {
			method: 'PATCH',
			headers: { Cookie: cookie },
			body: JSON.stringify({ nameRu: 'Новое имя', status: 'active' })
		})

		expect(res.status).toBe(422)

		const reloaded = await requestJson(`/api/v1/admin/products/${product.id}`, {
			headers: { Cookie: cookie }
		})
		// The name change must not have survived the rolled-back transaction.
		expect(reloaded.body.data.nameRu).toBe('Крем Revitalift')
	})
})

describe('admin variants', () => {
	test('creates and edits a variant', async () => {
		const cookie = await staffCookie()
		const brand = await createBrand(cookie)
		const category = await createCategory(cookie)
		const product = (await createDraftProduct(cookie, brand.id, category.id)).body.data

		const created = await requestJson(`/api/v1/admin/products/${product.id}/variants`, {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ sku: 'REV-50', nameRu: '50 мл', nameRo: '50 ml' })
		})
		expect(created.status).toBe(201)

		const edited = await requestJson(`/api/v1/admin/variants/${created.body.data.id}`, {
			method: 'PATCH',
			headers: { Cookie: cookie },
			body: JSON.stringify({ isActive: false, sortOrder: 2, barcode: '0123456789012' })
		})

		expect(edited.status).toBe(200)
		expect(edited.body.data.isActive).toBe(false)
		expect(edited.body.data.sortOrder).toBe(2)
		expect(edited.body.data.barcode).toBe('0123456789012')
		expect(edited.body.data.sku).toBe('REV-50') // untouched by the partial update
	})

	test('enforces SKU uniqueness across the whole catalog, not just within a product', async () => {
		const cookie = await staffCookie()
		const brand = await createBrand(cookie)
		const category = await createCategory(cookie)
		const productA = (await createDraftProduct(cookie, brand.id, category.id)).body.data
		const productB = (
			await requestJson('/api/v1/admin/products', {
				method: 'POST',
				headers: { Cookie: cookie },
				body: JSON.stringify({
					brandId: brand.id,
					slug: 'other-product',
					nameRu: 'Другой',
					nameRo: 'Altul',
					categoryIds: [category.id]
				})
			})
		).body.data

		await requestJson(`/api/v1/admin/products/${productA.id}/variants`, {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ sku: 'SHARED-SKU' })
		})

		const res = await requestJson(`/api/v1/admin/products/${productB.id}/variants`, {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ sku: 'SHARED-SKU' })
		})

		expect(res.status).toBe(409)
		expect(res.body.error.code).toBe('conflict')
	})

	test('404s when creating a variant for a non-existent product', async () => {
		const cookie = await staffCookie()
		const res = await requestJson(
			'/api/v1/admin/products/00000000-0000-0000-0000-000000000000/variants',
			{
				method: 'POST',
				headers: { Cookie: cookie },
				body: JSON.stringify({ sku: 'X' })
			}
		)
		expect(res.status).toBe(404)
	})
})

describe('admin prices', () => {
	test('creates a price and then updates it via the same upsert endpoint', async () => {
		const cookie = await staffCookie()
		const brand = await createBrand(cookie)
		const category = await createCategory(cookie)
		const product = (await createDraftProduct(cookie, brand.id, category.id)).body.data
		const variant = (
			await requestJson(`/api/v1/admin/products/${product.id}/variants`, {
				method: 'POST',
				headers: { Cookie: cookie },
				body: JSON.stringify({ sku: 'REV-50' })
			})
		).body.data

		const first = await requestJson(`/api/v1/admin/variants/${variant.id}/price`, {
			method: 'PUT',
			headers: { Cookie: cookie },
			body: JSON.stringify({ price: 24999 })
		})
		expect(first.status).toBe(200)
		expect(first.body.data.price).toBe(24999)

		const second = await requestJson(`/api/v1/admin/variants/${variant.id}/price`, {
			method: 'PUT',
			headers: { Cookie: cookie },
			body: JSON.stringify({ price: 19999, compareAtPrice: 24999 })
		})
		expect(second.status).toBe(200)
		expect(second.body.data.price).toBe(19999)
		expect(second.body.data.compareAtPrice).toBe(24999)
	})

	test('rejects a compareAtPrice that is not above price', async () => {
		const cookie = await staffCookie()
		const brand = await createBrand(cookie)
		const category = await createCategory(cookie)
		const product = (await createDraftProduct(cookie, brand.id, category.id)).body.data
		const variant = (
			await requestJson(`/api/v1/admin/products/${product.id}/variants`, {
				method: 'POST',
				headers: { Cookie: cookie },
				body: JSON.stringify({ sku: 'REV-50' })
			})
		).body.data

		const res = await requestJson(`/api/v1/admin/variants/${variant.id}/price`, {
			method: 'PUT',
			headers: { Cookie: cookie },
			body: JSON.stringify({ price: 10000, compareAtPrice: 5000 })
		})

		expect(res.status).toBe(400)
		expect(res.body.error.code).toBe('validation_error')
	})

	test('404s for a non-existent variant', async () => {
		const cookie = await staffCookie()
		const res = await requestJson(
			'/api/v1/admin/variants/00000000-0000-0000-0000-000000000000/price',
			{ method: 'PUT', headers: { Cookie: cookie }, body: JSON.stringify({ price: 1000 }) }
		)
		expect(res.status).toBe(404)
	})
})

describe('admin inventory', () => {
	async function setupVariant(cookie: string) {
		const brand = await createBrand(cookie)
		const category = await createCategory(cookie)
		const product = (await createDraftProduct(cookie, brand.id, category.id)).body.data
		const variant = (
			await requestJson(`/api/v1/admin/products/${product.id}/variants`, {
				method: 'POST',
				headers: { Cookie: cookie },
				body: JSON.stringify({ sku: 'REV-50' })
			})
		).body.data
		return variant.id as string
	}

	test('sets the physical stock level', async () => {
		const cookie = await staffCookie()
		const variantId = await setupVariant(cookie)

		const res = await requestJson(`/api/v1/admin/variants/${variantId}/inventory`, {
			method: 'PUT',
			headers: { Cookie: cookie },
			body: JSON.stringify({ quantityOnHand: 25 })
		})

		expect(res.status).toBe(200)
		expect(res.body.data.quantityOnHand).toBe(25)
		expect(res.body.data.quantityReserved).toBe(0)
	})

	test('rejects a negative quantity', async () => {
		const cookie = await staffCookie()
		const variantId = await setupVariant(cookie)

		const res = await requestJson(`/api/v1/admin/variants/${variantId}/inventory`, {
			method: 'PUT',
			headers: { Cookie: cookie },
			body: JSON.stringify({ quantityOnHand: -5 })
		})

		expect(res.status).toBe(400)
		expect(res.body.error.code).toBe('validation_error')
	})

	test('does not accept a client-supplied quantityReserved', async () => {
		const cookie = await staffCookie()
		const variantId = await setupVariant(cookie)

		const res = await requestJson(`/api/v1/admin/variants/${variantId}/inventory`, {
			method: 'PUT',
			headers: { Cookie: cookie },
			// quantityReserved isn't in the schema at all - it must be silently dropped, not applied.
			body: JSON.stringify({ quantityOnHand: 10, quantityReserved: 999 })
		})

		expect(res.status).toBe(200)
		expect(res.body.data.quantityReserved).toBe(0)
	})

	test('refuses to drop quantityOnHand below what is already reserved', async () => {
		const cookie = await staffCookie()
		const variantId = await setupVariant(cookie)

		await requestJson(`/api/v1/admin/variants/${variantId}/inventory`, {
			method: 'PUT',
			headers: { Cookie: cookie },
			body: JSON.stringify({ quantityOnHand: 10 })
		})

		// Simulate a reservation directly (no order system yet to create one through).
		const { db } = await import('../src/db/client')
		const { inventory } = await import('../src/db/schema/inventory')
		const { eq } = await import('drizzle-orm')
		await db
			.update(inventory)
			.set({ quantityReserved: 7 })
			.where(eq(inventory.variantId, variantId))

		const res = await requestJson(`/api/v1/admin/variants/${variantId}/inventory`, {
			method: 'PUT',
			headers: { Cookie: cookie },
			body: JSON.stringify({ quantityOnHand: 3 })
		})

		expect(res.status).toBe(400)
		expect(res.body.error.code).toBe('validation_error')
	})
})
