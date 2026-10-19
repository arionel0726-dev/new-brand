import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { productVariants } from '../src/db/schema/product-variants'
import { products } from '../src/db/schema/products'
import { searchClient } from '../src/search/client'
import { getProductsIndex } from '../src/search/products-index'
import { reindexProducts } from '../src/search/reindex'
import { removeProductFromIndex, syncProductToIndex } from '../src/search/sync'
import { resetDatabase } from './helpers'
import { seedCatalog } from './fixtures'

// Same policy as tests/search.test.ts: these exercise the real Meilisearch
// protocol and only run when an instance is reachable.
const meiliAvailable = await searchClient.isHealthy().catch(() => false)

describe.skipIf(!meiliAvailable)('search sync service (Meilisearch available)', () => {
	beforeEach(async () => {
		await resetDatabase()
		await getProductsIndex().deleteAllDocuments().waitTask()
	})

	test('indexes a single product by id', async () => {
		const { products: seeded } = await seedCatalog()

		const outcome = await syncProductToIndex(seeded.cream.id)
		expect(outcome.status).toBe('indexed')

		const doc = await getProductsIndex().getDocument(seeded.cream.id)
		expect(doc.slug).toBe('revitalift-cream')
		expect(doc.skus.sort()).toEqual(['REV-100', 'REV-50'])
	})

	test('removes a single document from the index', async () => {
		const { products: seeded } = await seedCatalog()
		await syncProductToIndex(seeded.cream.id)
		await getProductsIndex().getDocument(seeded.cream.id) // present beforehand

		const outcome = await removeProductFromIndex(seeded.cream.id)
		expect(outcome.status).toBe('removed')

		await expect(getProductsIndex().getDocument(seeded.cream.id)).rejects.toThrow()
	})

	test('treats a missing/archived/unpublished product id as a removal, not an error', async () => {
		const { products: seeded } = await seedCatalog()
		await syncProductToIndex(seeded.cream.id)

		// Archive it, then sync again: must be pulled out of the index.
		await db.update(products).set({ status: 'archived' }).where(eq(products.id, seeded.cream.id))
		const archivedOutcome = await syncProductToIndex(seeded.cream.id)
		expect(archivedOutcome).toEqual({ status: 'removed', productId: seeded.cream.id, reason: 'unpublished' })
		await expect(getProductsIndex().getDocument(seeded.cream.id)).rejects.toThrow()

		// A product id that never existed at all behaves the same way.
		const missingOutcome = await syncProductToIndex('00000000-0000-0000-0000-000000000000')
		expect(missingOutcome.status).toBe('removed')
	})

	test('reindexing twice does not create duplicate documents', async () => {
		await seedCatalog()

		const first = await reindexProducts()
		const second = await reindexProducts()

		expect(first.indexed).toBe(2)
		expect(second.indexed).toBe(2)

		const allDocs = await getProductsIndex().getDocuments({ limit: 100 })
		const ids = allDocs.results.map(doc => doc.id)
		expect(new Set(ids).size).toBe(ids.length) // no duplicate ids
		expect(ids).toHaveLength(2)
	})

	test('a price and stock change is reflected after re-syncing the product', async () => {
		const { products: seeded, variants } = await seedCatalog()

		await syncProductToIndex(seeded.cream.id)
		const before = await getProductsIndex().getDocument(seeded.cream.id)
		expect(before.minPrice).toBe(15000)
		expect(before.inStock).toBe(true)

		const { productPrices } = await import('../src/db/schema/product-prices')
		const { inventory } = await import('../src/db/schema/inventory')
		await db
			.update(productPrices)
			.set({ price: 5000 })
			.where(eq(productPrices.variantId, variants.v50.id))
		await db
			.update(inventory)
			.set({ quantityOnHand: 0 })
			.where(eq(inventory.variantId, variants.v50.id))
		await db
			.update(inventory)
			.set({ quantityOnHand: 0 })
			.where(eq(inventory.variantId, variants.v100.id))

		await syncProductToIndex(seeded.cream.id)
		const after = await getProductsIndex().getDocument(seeded.cream.id)
		expect(after.minPrice).toBe(5000)
		expect(after.inStock).toBe(false)
	})
})

describe.skipIf(meiliAvailable)(
	'search sync service (Meilisearch unavailable) - this sandbox has no reachable instance',
	() => {
		beforeEach(async () => {
			await resetDatabase()
		})

		test('syncProductToIndex reports an error outcome instead of throwing, and never touches Postgres', async () => {
			const { products: seeded, variants } = await seedCatalog()

			const outcome = await syncProductToIndex(seeded.cream.id)
			expect(outcome.status).toBe('error')
			if (outcome.status === 'error') {
				expect(outcome.operation).toBe('index')
				expect(outcome.message.length).toBeGreaterThan(0)
			}

			// The catalog row is completely unaffected by the search failure.
			const [productRow] = await db.select().from(products).where(eq(products.id, seeded.cream.id))
			expect(productRow.status).toBe('active')
			const [variantRow] = await db
				.select()
				.from(productVariants)
				.where(eq(productVariants.id, variants.v50.id))
			expect(variantRow.isActive).toBe(true)
		})

		test('removeProductFromIndex reports an error outcome instead of throwing', async () => {
			const { products: seeded } = await seedCatalog()
			const outcome = await removeProductFromIndex(seeded.cream.id)
			expect(outcome.status).toBe('error')
		})

		test('a manual full reindex also fails gracefully (no uncaught rejection)', async () => {
			await seedCatalog()
			await expect(reindexProducts()).rejects.toThrow()
		})
	}
)
