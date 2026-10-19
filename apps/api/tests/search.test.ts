import { beforeEach, describe, expect, test } from 'bun:test'
import { searchClient } from '../src/search/client'
import { getProductsIndex } from '../src/search/products-index'
import { reindexProducts } from '../src/search/reindex'
import { getJson, resetDatabase } from './helpers'
import { seedCatalog } from './fixtures'

// These tests exercise the real Meilisearch protocol and are skipped when no
// instance is reachable (e.g. this sandbox has no Docker daemon to run the
// docker-compose Meilisearch service). They run normally against a real
// `docker compose up meilisearch`.
const meiliAvailable = await searchClient.isHealthy().catch(() => false)

describe.skipIf(!meiliAvailable)('meilisearch indexing and search', () => {
	beforeEach(async () => {
		await resetDatabase()
		await getProductsIndex()
			.deleteAllDocuments()
			.waitTask()
	})

	test('reindex is safe to run repeatedly and only indexes published products', async () => {
		await seedCatalog()

		const first = await reindexProducts()
		expect(first.indexed).toBe(2) // cream + serum; draft/archived excluded

		const second = await reindexProducts()
		expect(second.indexed).toBe(2)
		expect(second.removed).toBe(0)
	})

	test('GET /api/v1/search finds a product by RU name', async () => {
		await seedCatalog()
		await reindexProducts()

		const { status, body } = await getJson('/api/v1/search?q=Revitalift')
		expect(status).toBe(200)
		expect(body.data.map((hit: { slug: string }) => hit.slug)).toContain('revitalift-cream')
	})

	test('GET /api/v1/search finds a product by SKU', async () => {
		await seedCatalog()
		await reindexProducts()

		const { body } = await getJson('/api/v1/search?q=SER-30')
		expect(body.data.map((hit: { slug: string }) => hit.slug)).toContain('vitamin-serum')
	})

	test('search respects the inStock filter', async () => {
		await seedCatalog()
		await reindexProducts()

		const { body } = await getJson('/api/v1/search?q=crema&lang=ro&inStock=true')
		expect(body.data.every((hit: { inStock: boolean }) => hit.inStock)).toBe(true)
	})

	test('removes a product from the index once it is archived', async () => {
		const { products } = await seedCatalog()
		await reindexProducts()

		const { db } = await import('../src/db/client')
		const { products: productsTable } = await import('../src/db/schema/products')
		const { eq } = await import('drizzle-orm')
		await db
			.update(productsTable)
			.set({ status: 'archived' })
			.where(eq(productsTable.id, products.serum.id))

		const result = await reindexProducts()
		expect(result.removed).toBe(1)

		const { body } = await getJson('/api/v1/search?q=vitamina')
		expect(body.data.map((hit: { slug: string }) => hit.slug)).not.toContain('vitamin-serum')
	})
})

describe('GET /api/v1/search validation', () => {
	test('requires a non-empty q parameter', async () => {
		const { status, body } = await getJson('/api/v1/search')
		expect(status).toBe(400)
		expect(body.error.code).toBe('validation_error')
	})
})
