import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { products } from '../src/db/schema/products'
import { searchClient } from '../src/search/client'
import { getProductsIndex } from '../src/search/products-index'
import { createSessionAs, requestJson, resetAuthTables, resetDatabase } from './helpers'

const meiliAvailable = await searchClient.isHealthy().catch(() => false)

async function staffCookie() {
	const { cookie } = await createSessionAs('staff')
	return cookie
}

async function publishedProduct(cookie: string) {
	const brand = (
		await requestJson('/api/v1/admin/brands', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ slug: 'loreal', nameRu: "Л'Ореаль", nameRo: "L'Oreal" })
		})
	).body.data
	const category = (
		await requestJson('/api/v1/admin/categories', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ slug: 'skincare', nameRu: 'Уход', nameRo: 'Ingrijire' })
		})
	).body.data
	const product = (
		await requestJson('/api/v1/admin/products', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({
				brandId: brand.id,
				slug: 'revitalift-cream',
				nameRu: 'Крем Revitalift',
				nameRo: 'Crema Revitalift',
				categoryIds: [category.id]
			})
		})
	).body.data
	const variant = (
		await requestJson(`/api/v1/admin/products/${product.id}/variants`, {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ sku: 'REV-50' })
		})
	).body.data
	await requestJson(`/api/v1/admin/variants/${variant.id}/price`, {
		method: 'PUT',
		headers: { Cookie: cookie },
		body: JSON.stringify({ price: 15000 })
	})
	await requestJson(`/api/v1/admin/variants/${variant.id}/inventory`, {
		method: 'PUT',
		headers: { Cookie: cookie },
		body: JSON.stringify({ quantityOnHand: 10 })
	})
	await requestJson(`/api/v1/admin/products/${product.id}`, {
		method: 'PATCH',
		headers: { Cookie: cookie },
		body: JSON.stringify({ status: 'active' })
	})

	return { product, variant }
}

describe.skipIf(!meiliAvailable)('admin writes sync to Meilisearch (instance available)', () => {
	beforeEach(async () => {
		await resetDatabase()
		await resetAuthTables()
		await getProductsIndex().deleteAllDocuments().waitTask()
	})

	test('publishing a product makes it searchable', async () => {
		const cookie = await staffCookie()
		const { product } = await publishedProduct(cookie)

		const doc = await getProductsIndex().getDocument(product.id)
		expect(doc.slug).toBe('revitalift-cream')
		expect(doc.minPrice).toBe(15000)
		expect(doc.inStock).toBe(true)
	})

	test('a price/stock update is reflected in the index', async () => {
		const cookie = await staffCookie()
		const { variant, product } = await publishedProduct(cookie)

		await requestJson(`/api/v1/admin/variants/${variant.id}/price`, {
			method: 'PUT',
			headers: { Cookie: cookie },
			body: JSON.stringify({ price: 9999 })
		})
		await requestJson(`/api/v1/admin/variants/${variant.id}/inventory`, {
			method: 'PUT',
			headers: { Cookie: cookie },
			body: JSON.stringify({ quantityOnHand: 0 })
		})

		const doc = await getProductsIndex().getDocument(product.id)
		expect(doc.minPrice).toBe(9999)
		expect(doc.inStock).toBe(false)
	})

	test('archiving a product removes it from the index', async () => {
		const cookie = await staffCookie()
		const { product } = await publishedProduct(cookie)

		await getProductsIndex().getDocument(product.id) // present beforehand

		await requestJson(`/api/v1/admin/products/${product.id}`, {
			method: 'PATCH',
			headers: { Cookie: cookie },
			body: JSON.stringify({ status: 'archived' })
		})

		await expect(getProductsIndex().getDocument(product.id)).rejects.toThrow()
	})

	test('renaming a brand resyncs every product that references it (Sprint 9 Task 3)', async () => {
		const cookie = await staffCookie()
		const { product } = await publishedProduct(cookie)

		const brandId = product.brandId
		await requestJson(`/api/v1/admin/brands/${brandId}`, {
			method: 'PATCH',
			headers: { Cookie: cookie },
			body: JSON.stringify({ nameRu: 'Новое имя', nameRo: 'Nume nou' })
		})

		const doc = await getProductsIndex().getDocument(product.id)
		expect(doc.brandNameRu).toBe('Новое имя')
		expect(doc.brandNameRo).toBe('Nume nou')
	})

	test('renaming a category resyncs every product tagged with it (Sprint 9 Task 3)', async () => {
		const cookie = await staffCookie()
		const { product } = await publishedProduct(cookie)

		const categoryId = product.categoryIds[0]
		await requestJson(`/api/v1/admin/categories/${categoryId}`, {
			method: 'PATCH',
			headers: { Cookie: cookie },
			body: JSON.stringify({ nameRu: 'Новая категория', nameRo: 'Categorie noua' })
		})

		const doc = await getProductsIndex().getDocument(product.id)
		expect(doc.categoryNamesRu).toContain('Новая категория')
		expect(doc.categoryNamesRo).toContain('Categorie noua')
	})
})

describe.skipIf(meiliAvailable)(
	'admin writes when Meilisearch is unavailable (this sandbox has no reachable instance)',
	() => {
		beforeEach(async () => {
			await resetDatabase()
			await resetAuthTables()
		})

		test('the catalog write still succeeds and persists even though search sync fails', async () => {
			const cookie = await staffCookie()
			const { product } = await publishedProduct(cookie)

			// The publish committed in Postgres regardless of the search-side failure.
			const [row] = await db.select().from(products).where(eq(products.id, product.id))
			expect(row.status).toBe('active')

			const publicDetail = await requestJson(`/api/v1/products/${product.slug}`)
			expect(publicDetail.status).toBe(200)
		})
	}
)
