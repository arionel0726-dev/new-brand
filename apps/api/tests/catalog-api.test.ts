import { beforeEach, describe, expect, test } from 'bun:test'
import { getJson, resetDatabase } from './helpers'
import { seedCatalog } from './fixtures'

beforeEach(async () => {
	await resetDatabase()
})

describe('brands', () => {
	test('lists brands', async () => {
		await seedCatalog()
		const { status, body } = await getJson('/api/v1/brands')

		expect(status).toBe(200)
		expect(body.success).toBe(true)
		expect(body.data).toHaveLength(2)
		expect(body.data.map((b: { slug: string }) => b.slug).sort()).toEqual(['loreal', 'nivea'])
	})

	test('returns brand details by slug', async () => {
		await seedCatalog()
		const { status, body } = await getJson('/api/v1/brands/loreal')

		expect(status).toBe(200)
		expect(body.data.slug).toBe('loreal')
	})

	test('404s for an unknown brand slug', async () => {
		await seedCatalog()
		const { status, body } = await getJson('/api/v1/brands/does-not-exist')

		expect(status).toBe(404)
		expect(body.success).toBe(false)
		expect(body.error.code).toBe('brand_not_found')
	})
})

describe('categories', () => {
	test('returns a nested category tree', async () => {
		const { categories } = await seedCatalog()
		const { status, body } = await getJson('/api/v1/categories')

		expect(status).toBe(200)
		const skincareNode = body.data.find((c: { id: string }) => c.id === categories.skincare.id)
		expect(skincareNode).toBeDefined()
		expect(skincareNode.children).toHaveLength(1)
		expect(skincareNode.children[0].id).toBe(categories.face.id)

		const makeupNode = body.data.find((c: { id: string }) => c.id === categories.makeup.id)
		expect(makeupNode.children).toHaveLength(0)
	})

	test('returns a category with its direct children by slug', async () => {
		await seedCatalog()
		const { status, body } = await getJson('/api/v1/categories/skincare')

		expect(status).toBe(200)
		expect(body.data.slug).toBe('skincare')
		expect(body.data.children).toHaveLength(1)
		expect(body.data.children[0].slug).toBe('face')
	})

	test('404s for an unknown category slug', async () => {
		await seedCatalog()
		const { status } = await getJson('/api/v1/categories/does-not-exist')
		expect(status).toBe(404)
	})
})

describe('products listing', () => {
	test('excludes draft and archived products', async () => {
		await seedCatalog()
		const { body } = await getJson('/api/v1/products?limit=50')

		const slugs = body.data.map((p: { slug: string }) => p.slug)
		expect(slugs).toContain('revitalift-cream')
		expect(slugs).toContain('vitamin-serum')
		expect(slugs).not.toContain('draft-product')
		expect(slugs).not.toContain('archived-product')
	})

	test('returns variant-aware price range and stock status', async () => {
		await seedCatalog()
		const { body } = await getJson('/api/v1/products?limit=50')

		const cream = body.data.find((p: { slug: string }) => p.slug === 'revitalift-cream')
		// min/max come from the two priced variants (15000/25000); the
		// unpriced third variant must not affect the range or appear anywhere.
		expect(cream.price).toEqual({ from: 15000, to: 25000, currency: 'MDL' })
		expect(cream.inStock).toBe(true) // the 50ml variant has stock even though 100ml doesn't
	})

	test('supports pagination', async () => {
		await seedCatalog()
		const page1 = await getJson('/api/v1/products?limit=1&page=1')
		const page2 = await getJson('/api/v1/products?limit=1&page=2')

		expect(page1.body.data).toHaveLength(1)
		expect(page2.body.data).toHaveLength(1)
		expect(page1.body.data[0].id).not.toBe(page2.body.data[0].id)
		expect(page1.body.meta).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 })
	})

	test('rejects a limit above the maximum', async () => {
		await seedCatalog()
		const { status, body } = await getJson('/api/v1/products?limit=1000')
		expect(status).toBe(400)
		expect(body.error.code).toBe('validation_error')
	})

	test('sorts by price ascending and descending', async () => {
		await seedCatalog()
		const asc = await getJson('/api/v1/products?sort=price_asc&limit=50')
		const desc = await getJson('/api/v1/products?sort=price_desc&limit=50')

		expect(asc.body.data[0].slug).toBe('revitalift-cream') // min price 15000
		expect(desc.body.data[0].slug).toBe('vitamin-serum') // min price 40000
	})

	test('filters by brand', async () => {
		const { brands } = await seedCatalog()
		void brands
		const { body } = await getJson('/api/v1/products?brand=loreal&limit=50')
		expect(body.data).toHaveLength(2)

		const nivea = await getJson('/api/v1/products?brand=nivea&limit=50')
		expect(nivea.body.data).toHaveLength(0) // nivea only has draft/archived products
	})

	test('filters by category, including descendants', async () => {
		await seedCatalog()
		const faceResult = await getJson('/api/v1/products?category=face&limit=50')
		expect(faceResult.body.data.map((p: { slug: string }) => p.slug)).toEqual([
			'revitalift-cream'
		])

		// skincare is the parent of face: filtering by it must include products
		// tagged on the parent AND products tagged only on the child.
		const skincareResult = await getJson('/api/v1/products?category=skincare&limit=50')
		const slugs = skincareResult.body.data.map((p: { slug: string }) => p.slug).sort()
		expect(slugs).toEqual(['revitalift-cream', 'vitamin-serum'])

		const makeupResult = await getJson('/api/v1/products?category=makeup&limit=50')
		expect(makeupResult.body.data).toHaveLength(0)
	})

	test('filters by price range', async () => {
		await seedCatalog()
		const { body } = await getJson('/api/v1/products?minPrice=30000&limit=50')
		expect(body.data.map((p: { slug: string }) => p.slug)).toEqual(['vitamin-serum'])
	})

	test('rejects an inverted price range', async () => {
		await seedCatalog()
		const { status } = await getJson('/api/v1/products?minPrice=100&maxPrice=50')
		expect(status).toBe(400)
	})

	test('filters by stock availability', async () => {
		await seedCatalog()
		const { body } = await getJson('/api/v1/products?inStock=true&limit=50')
		const slugs = body.data.map((p: { slug: string }) => p.slug).sort()
		expect(slugs).toEqual(['revitalift-cream', 'vitamin-serum'])
	})

	test('localizes product names and descriptions via lang', async () => {
		await seedCatalog()
		const ru = await getJson('/api/v1/products?limit=50')
		const ro = await getJson('/api/v1/products?lang=ro&limit=50')

		const creamRu = ru.body.data.find((p: { slug: string }) => p.slug === 'revitalift-cream')
		const creamRo = ro.body.data.find((p: { slug: string }) => p.slug === 'revitalift-cream')

		expect(creamRu.name).toBe('Крем Revitalift')
		expect(creamRo.name).toBe('Crema Revitalift')
		expect(creamRo.brand.name).toBe("L'Oreal")
	})
})

describe('product detail', () => {
	test('returns variants, prices and images, excluding unpriced variants', async () => {
		await seedCatalog()
		const { status, body } = await getJson('/api/v1/products/revitalift-cream')

		expect(status).toBe(200)
		expect(body.data.variants).toHaveLength(2)
		expect(body.data.variants.map((v: { sku: string }) => v.sku).sort()).toEqual([
			'REV-100',
			'REV-50'
		])
		expect(body.data.images).toHaveLength(2)

		const v50 = body.data.variants.find((v: { sku: string }) => v.sku === 'REV-50')
		expect(v50.price).toBe(15000)
		expect(v50.compareAtPrice).toBe(18000)
		expect(v50.inStock).toBe(true)

		const v100 = body.data.variants.find((v: { sku: string }) => v.sku === 'REV-100')
		expect(v100.inStock).toBe(false)
	})

	test('404s for a draft product', async () => {
		await seedCatalog()
		const { status, body } = await getJson('/api/v1/products/draft-product')
		expect(status).toBe(404)
		expect(body.error.code).toBe('product_not_found')
	})

	test('404s for an archived product', async () => {
		await seedCatalog()
		const { status } = await getJson('/api/v1/products/archived-product')
		expect(status).toBe(404)
	})

	test('404s for an unknown slug', async () => {
		await seedCatalog()
		const { status } = await getJson('/api/v1/products/does-not-exist')
		expect(status).toBe(404)
	})
})
