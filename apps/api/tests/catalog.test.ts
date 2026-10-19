import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { brands } from '../src/db/schema/brands'
import { categories } from '../src/db/schema/categories'
import { inventory } from '../src/db/schema/inventory'
import { productCategories } from '../src/db/schema/product-categories'
import { productPrices } from '../src/db/schema/product-prices'
import { productVariants } from '../src/db/schema/product-variants'
import { products } from '../src/db/schema/products'
import { resetDatabase, toPromise } from './helpers'

beforeEach(async () => {
	await resetDatabase()
})

async function createBrand() {
	const [brand] = await db
		.insert(brands)
		.values({
			slug: 'test-brand',
			nameRu: 'Тестовый бренд',
			nameRo: 'Brand de test'
		})
		.returning()
	return brand
}

async function createProduct(brandId: string) {
	const [product] = await db
		.insert(products)
		.values({
			brandId,
			slug: 'test-product',
			nameRu: 'Тестовый товар',
			nameRo: 'Produs de test'
		})
		.returning()
	return product
}

describe('products with variants', () => {
	test('creates a product with several variants, each with its own price and stock', async () => {
		const brand = await createBrand()
		const product = await createProduct(brand.id)

		const variantRows = await db
			.insert(productVariants)
			.values([
				{ productId: product.id, sku: 'SKU-001', nameRu: '50 мл', nameRo: '50 ml' },
				{ productId: product.id, sku: 'SKU-002', nameRu: '100 мл', nameRo: '100 ml' }
			])
			.returning()

		expect(variantRows).toHaveLength(2)

		for (const [index, variant] of variantRows.entries()) {
			await db.insert(productPrices).values({
				variantId: variant.id,
				price: 10000 + index * 5000,
				compareAtPrice: 15000 + index * 5000
			})
			await db.insert(inventory).values({ variantId: variant.id, quantity: 20 + index })
		}

		const storedVariants = await db
			.select()
			.from(productVariants)
			.where(eq(productVariants.productId, product.id))
		expect(storedVariants).toHaveLength(2)

		const prices = await db.select().from(productPrices)
		const stock = await db.select().from(inventory)
		expect(prices).toHaveLength(2)
		expect(stock).toHaveLength(2)
	})
})

describe('product categories', () => {
	test('links one product to several categories', async () => {
		const brand = await createBrand()
		const product = await createProduct(brand.id)

		const categoryRows = await db
			.insert(categories)
			.values([
				{ slug: 'skincare', nameRu: 'Уход за кожей', nameRo: 'Îngrijirea pielii' },
				{ slug: 'makeup', nameRu: 'Макияж', nameRo: 'Machiaj' }
			])
			.returning()

		await db.insert(productCategories).values(
			categoryRows.map(category => ({
				productId: product.id,
				categoryId: category.id
			}))
		)

		const links = await db
			.select()
			.from(productCategories)
			.where(eq(productCategories.productId, product.id))

		expect(links).toHaveLength(2)
	})

	test('supports nested categories via parent_id', async () => {
		const [parent] = await db
			.insert(categories)
			.values({ slug: 'parent-category', nameRu: 'Родитель', nameRo: 'Părinte' })
			.returning()

		const [child] = await db
			.insert(categories)
			.values({
				slug: 'child-category',
				parentId: parent.id,
				nameRu: 'Ребёнок',
				nameRo: 'Copil'
			})
			.returning()

		expect(child.parentId).toBe(parent.id)
	})
})

describe('uniqueness constraints', () => {
	test('rejects duplicate variant SKUs', async () => {
		const brand = await createBrand()
		const product = await createProduct(brand.id)

		await db.insert(productVariants).values({ productId: product.id, sku: 'DUPLICATE-SKU' })

		await expect(
			toPromise(db.insert(productVariants).values({ productId: product.id, sku: 'DUPLICATE-SKU' }))
		).rejects.toThrow()
	})

	test('rejects duplicate product slugs', async () => {
		const brand = await createBrand()
		await createProduct(brand.id)

		await expect(
			toPromise(
				db.insert(products).values({
					brandId: brand.id,
					slug: 'test-product',
					nameRu: 'Другой товар',
					nameRo: 'Alt produs'
				})
			)
		).rejects.toThrow()
	})
})

describe('price and inventory constraints', () => {
	test('rejects a negative price', async () => {
		const brand = await createBrand()
		const product = await createProduct(brand.id)
		const [variant] = await db
			.insert(productVariants)
			.values({ productId: product.id, sku: 'SKU-NEG-PRICE' })
			.returning()

		await expect(
			toPromise(db.insert(productPrices).values({ variantId: variant.id, price: -100 }))
		).rejects.toThrow()
	})

	test('rejects a compare-at price that is not above the price', async () => {
		const brand = await createBrand()
		const product = await createProduct(brand.id)
		const [variant] = await db
			.insert(productVariants)
			.values({ productId: product.id, sku: 'SKU-BAD-COMPARE' })
			.returning()

		await expect(
			toPromise(
				db.insert(productPrices).values({
					variantId: variant.id,
					price: 10000,
					compareAtPrice: 9000
				})
			)
		).rejects.toThrow()
	})

	test('rejects negative stock quantity', async () => {
		const brand = await createBrand()
		const product = await createProduct(brand.id)
		const [variant] = await db
			.insert(productVariants)
			.values({ productId: product.id, sku: 'SKU-NEG-STOCK' })
			.returning()

		await expect(
			toPromise(db.insert(inventory).values({ variantId: variant.id, quantity: -1 }))
		).rejects.toThrow()
	})
})

describe('foreign key behavior', () => {
	test('deleting a product cascades to its variants', async () => {
		const brand = await createBrand()
		const product = await createProduct(brand.id)
		const [variant] = await db
			.insert(productVariants)
			.values({ productId: product.id, sku: 'SKU-CASCADE' })
			.returning()

		await db.delete(products).where(eq(products.id, product.id))

		const remaining = await db
			.select()
			.from(productVariants)
			.where(eq(productVariants.id, variant.id))

		expect(remaining).toHaveLength(0)
	})

	test('cannot delete a brand that still has products', async () => {
		const brand = await createBrand()
		await createProduct(brand.id)

		await expect(
			toPromise(db.delete(brands).where(eq(brands.id, brand.id)))
		).rejects.toThrow()
	})

	test('cannot delete a parent category while it still has children (RESTRICT)', async () => {
		const [parent] = await db
			.insert(categories)
			.values({ slug: 'parent-2', nameRu: 'Родитель 2', nameRo: 'Părinte 2' })
			.returning()

		await db
			.insert(categories)
			.values({ slug: 'child-2', parentId: parent.id, nameRu: 'Ребёнок 2', nameRo: 'Copil 2' })
			.returning()

		await expect(
			toPromise(db.delete(categories).where(eq(categories.id, parent.id)))
		).rejects.toThrow()
	})

	test('every image must belong to a product', async () => {
		const { productImages } = await import('../src/db/schema/product-images')

		await expect(
			toPromise(
				db.insert(productImages).values({ url: 'https://example.com/image.jpg' } as never)
			)
		).rejects.toThrow()
	})

	test('an image cannot reference a variant belonging to a different product', async () => {
		const { productImages } = await import('../src/db/schema/product-images')

		const brand = await createBrand()
		const productA = await createProduct(brand.id)
		const [productB] = await db
			.insert(products)
			.values({
				brandId: brand.id,
				slug: 'test-product-b',
				nameRu: 'Товар Б',
				nameRo: 'Produs B'
			})
			.returning()

		const [variantOfA] = await db
			.insert(productVariants)
			.values({ productId: productA.id, sku: 'SKU-CROSS-CHECK' })
			.returning()

		await expect(
			toPromise(
				db.insert(productImages).values({
					productId: productB.id,
					variantId: variantOfA.id,
					url: 'https://example.com/cross.jpg'
				})
			)
		).rejects.toThrow()
	})
})
