import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { inventory } from '../src/db/schema/inventory'
import { productPrices } from '../src/db/schema/product-prices'
import { productVariants } from '../src/db/schema/product-variants'
import { seedCatalog } from './fixtures'
import { getJson, resetDatabase } from './helpers'

beforeEach(async () => {
	await resetDatabase()
})

describe('product_variants.is_active', () => {
	test('defaults to true when not specified', async () => {
		const { products } = await seedCatalog()
		const [variant] = await db
			.insert(productVariants)
			.values({ productId: products.cream.id, sku: 'DEFAULT-ACTIVE-CHECK' })
			.returning()

		expect(variant.isActive).toBe(true)
	})

	test('an active, priced variant is purchasable and visible in the public API', async () => {
		await seedCatalog()
		const { status, body } = await getJson('/api/v1/products/revitalift-cream')

		expect(status).toBe(200)
		const v50 = body.data.variants.find((v: { sku: string }) => v.sku === 'REV-50')
		expect(v50).toBeDefined()
		expect(v50.price).toBe(15000)
	})

	test('an inactive variant never appears in the public API, even if priced and in stock', async () => {
		const { variants } = await seedCatalog()
		expect(variants.vInactive.isActive).toBe(false)

		const detail = await getJson('/api/v1/products/revitalift-cream')
		const skus = detail.body.data.variants.map((v: { sku: string }) => v.sku)
		expect(skus).not.toContain('REV-DISCONTINUED')

		// It must not pull the product's displayed price range down either.
		const list = await getJson('/api/v1/products?limit=50')
		const cream = list.body.data.find((p: { slug: string }) => p.slug === 'revitalift-cream')
		expect(cream.price.from).toBe(15000) // not the inactive variant's 12000
	})

	test('a variant without a price is not treated as inactive at the data level, but stays unpurchasable', async () => {
		const { variants } = await seedCatalog()

		// The model itself does not force isActive=false just because there is no price.
		expect(variants.vNoPrice.isActive).toBe(true)

		// Yet the public API still can't surface it - there's nothing to charge.
		const detail = await getJson('/api/v1/products/revitalift-cream')
		const skus = detail.body.data.variants.map((v: { sku: string }) => v.sku)
		expect(skus).not.toContain('REV-NOPRICE')
	})

	test('zero stock does not imply the variant is disabled', async () => {
		const { variants } = await seedCatalog()
		expect(variants.v100.isActive).toBe(true)

		const detail = await getJson('/api/v1/products/revitalift-cream')
		const v100 = detail.body.data.variants.find((v: { sku: string }) => v.sku === 'REV-100')

		expect(v100).toBeDefined()
		expect(v100.quantity).toBe(0)
		expect(v100.inStock).toBe(false)
	})

	test('toggling a variant to inactive removes it from the public API without touching price/stock rows', async () => {
		const { variants } = await seedCatalog()

		let detail = await getJson('/api/v1/products/revitalift-cream')
		expect(detail.body.data.variants.map((v: { sku: string }) => v.sku)).toContain('REV-100')

		await db
			.update(productVariants)
			.set({ isActive: false })
			.where(eq(productVariants.id, variants.v100.id))

		detail = await getJson('/api/v1/products/revitalift-cream')
		expect(detail.body.data.variants.map((v: { sku: string }) => v.sku)).not.toContain('REV-100')

		// Underlying price/stock rows are untouched by the toggle.
		const [price] = await db
			.select()
			.from(productPrices)
			.where(eq(productPrices.variantId, variants.v100.id))
		const [stock] = await db
			.select()
			.from(inventory)
			.where(eq(inventory.variantId, variants.v100.id))
		expect(price.price).toBe(25000)
		expect(stock.quantity).toBe(0)
	})

	test('a product with only inactive/unpriced variants disappears from the public catalog', async () => {
		const { products, variants } = await seedCatalog()

		await db
			.update(productVariants)
			.set({ isActive: false })
			.where(eq(productVariants.id, variants.v50.id))
		await db
			.update(productVariants)
			.set({ isActive: false })
			.where(eq(productVariants.id, variants.v100.id))
		// vInactive was already isActive=false, vNoPrice has no price - cream
		// now has zero published variants.

		const detailStatus = (await getJson('/api/v1/products/revitalift-cream')).status
		expect(detailStatus).toBe(404)

		const list = await getJson('/api/v1/products?limit=50')
		expect(list.body.data.map((p: { slug: string }) => p.slug)).not.toContain('revitalift-cream')
		void products
	})
})
