/**
 * Sprint 12B.1 - migration/schema integrity tests for the additive changes
 * (docs/vizaje-identity-architecture.md §C): product_variant_barcodes,
 * product_slug_aliases, products.short_description_ru/ro +
 * ingredients_ru/ro + instructions_ru/ro, inventory_locations,
 * variant_inventory_by_location. These exercise the real applied schema
 * against the isolated beauty_store_test database (migration
 * drizzle/0013_strong_johnny_storm.sql), not just "the migration ran
 * without error" - each test inserts/rejects a row to prove the actual
 * constraint shape, and a dedicated information_schema test proves the
 * new products columns exist and are nullable.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { db } from '../src/db/client'
import { brands } from '../src/db/schema/brands'
import { inventoryLocations } from '../src/db/schema/inventory-locations'
import { productSlugAliases } from '../src/db/schema/product-slug-aliases'
import { productVariantBarcodes } from '../src/db/schema/product-variant-barcodes'
import { productVariants } from '../src/db/schema/product-variants'
import { products } from '../src/db/schema/products'
import { variantInventoryByLocation } from '../src/db/schema/variant-inventory-by-location'
import { resetDatabase, toPromise } from './helpers'

beforeEach(async () => {
	await resetDatabase()
})

async function createBrand() {
	const [brand] = await db
		.insert(brands)
		.values({ slug: `test-brand-${crypto.randomUUID()}`, nameRu: 'Тестовый бренд', nameRo: 'Brand de test' })
		.returning()
	return brand
}

async function createProductAndVariant() {
	const brand = await createBrand()
	const [product] = await db
		.insert(products)
		.values({ brandId: brand.id, slug: `test-product-${crypto.randomUUID()}`, nameRu: 'Тестовый товар', nameRo: 'Produs de test' })
		.returning()
	const [variant] = await db
		.insert(productVariants)
		.values({ productId: product.id, sku: `TEST-${crypto.randomUUID()}` })
		.returning()
	return { product, variant }
}

describe('products: new Sprint 12B.1 columns exist, nullable, additive', () => {
	test('information_schema confirms all six new columns, each nullable', async () => {
		const rows = await db.execute<{ column_name: string; is_nullable: string }>(sql`
			select column_name, is_nullable
			from information_schema.columns
			where table_name = 'products'
				and column_name in (
					'short_description_ru', 'short_description_ro',
					'ingredients_ru', 'ingredients_ro',
					'instructions_ru', 'instructions_ro'
				)
			order by column_name
		`)
		expect(rows.length).toBe(6)
		for (const row of rows) expect(row.is_nullable).toBe('YES')
	})

	test('a product insert omitting the new columns still succeeds unmodified (backward compatibility)', async () => {
		const brand = await createBrand()
		const [product] = await db
			.insert(products)
			.values({ brandId: brand.id, slug: 'legacy-shaped-insert', nameRu: 'Товар', nameRo: 'Produs' })
			.returning()
		expect(product.shortDescriptionRu).toBeNull()
		expect(product.ingredientsRu).toBeNull()
		expect(product.instructionsRu).toBeNull()
	})

	test('the new columns accept real values when provided', async () => {
		const brand = await createBrand()
		const [product] = await db
			.insert(products)
			.values({
				brandId: brand.id,
				slug: 'with-content',
				nameRu: 'Товар',
				nameRo: 'Produs',
				shortDescriptionRu: 'Краткое описание',
				ingredientsRu: 'Aqua, Glycerin',
				instructionsRu: 'Нанести на кожу'
			})
			.returning()
		expect(product.shortDescriptionRu).toBe('Краткое описание')
		expect(product.ingredientsRu).toBe('Aqua, Glycerin')
		expect(product.instructionsRu).toBe('Нанести на кожу')
	})
})

describe('product_variant_barcodes: one variant, many barcodes', () => {
	test('a single variant can have more than one barcode row', async () => {
		const { variant } = await createProductAndVariant()
		await db.insert(productVariantBarcodes).values([
			{ variantId: variant.id, barcode: '1111111111111', isPrimary: true, source: 'legacy_mysql' },
			{ variantId: variant.id, barcode: '2222222222222', isPrimary: false, source: '1c_products_json' }
		])
		const rows = await db.select().from(productVariantBarcodes).where(sql`variant_id = ${variant.id}`)
		expect(rows).toHaveLength(2)
	})

	test('the same barcode value cannot be recorded twice for the same variant', async () => {
		const { variant } = await createProductAndVariant()
		await db.insert(productVariantBarcodes).values({ variantId: variant.id, barcode: '1111111111111' })
		await expect(
			toPromise(db.insert(productVariantBarcodes).values({ variantId: variant.id, barcode: '1111111111111' }))
		).rejects.toThrow()
	})

	test('two different variants cannot both claim the same barcode as primary (global primary uniqueness)', async () => {
		const { variant: variantA } = await createProductAndVariant()
		const { product: productB } = await createProductAndVariant()
		const [variantB] = await db
			.insert(productVariants)
			.values({ productId: productB.id, sku: `TEST-${crypto.randomUUID()}` })
			.returning()
		await db.insert(productVariantBarcodes).values({ variantId: variantA.id, barcode: '9999999999999', isPrimary: true })
		await expect(
			toPromise(
				db.insert(productVariantBarcodes).values({ variantId: variantB.id, barcode: '9999999999999', isPrimary: true })
			)
		).rejects.toThrow()
	})

	test('two different variants CAN share a barcode value as long as at most one marks it primary', async () => {
		const { variant: variantA } = await createProductAndVariant()
		const { product: productB } = await createProductAndVariant()
		const [variantB] = await db
			.insert(productVariants)
			.values({ productId: productB.id, sku: `TEST-${crypto.randomUUID()}` })
			.returning()
		await db.insert(productVariantBarcodes).values({ variantId: variantA.id, barcode: '5555555555555', isPrimary: true })
		// non-primary duplicate on a different variant is allowed (e.g. a repackaging history row)
		await expect(
			toPromise(
				db.insert(productVariantBarcodes).values({ variantId: variantB.id, barcode: '5555555555555', isPrimary: false })
			)
		).resolves.toBeDefined()
	})

	test('deleting the owning variant cascades to its barcode rows', async () => {
		const { variant } = await createProductAndVariant()
		await db.insert(productVariantBarcodes).values({ variantId: variant.id, barcode: '3333333333333' })
		await db.delete(productVariants).where(sql`id = ${variant.id}`)
		const rows = await db.select().from(productVariantBarcodes).where(sql`variant_id = ${variant.id}`)
		expect(rows).toHaveLength(0)
	})
})

describe('product_variant_barcodes: identity constraints deliberately NOT applied (Sprint 12B.1 Task 9)', () => {
	test('product_variants.sku keeps its existing DB-level uniqueness (a V2-internal identifier, not a raw unverified legacy one)', async () => {
		const { product } = await createProductAndVariant()
		await db.insert(productVariants).values({ productId: product.id, sku: 'DUPLICATE-SKU' })
		await expect(
			toPromise(db.insert(productVariants).values({ productId: product.id, sku: 'DUPLICATE-SKU' }))
		).rejects.toThrow()
	})
})

describe('product_slug_aliases', () => {
	test('a product can have more than one slug alias, across locales', async () => {
		const { product } = await createProductAndVariant()
		await db.insert(productSlugAliases).values([
			{ productId: product.id, locale: 'ru', slug: '10568', source: 'legacy_numeric_uri' },
			{ productId: product.id, locale: 'ru', slug: 'novaya-pomada-10568', source: 'legacy_title_sku_uri', isCanonical: true },
			{ productId: product.id, locale: 'ro', slug: '10568', source: 'legacy_numeric_uri' }
		])
		const rows = await db.select().from(productSlugAliases).where(sql`product_id = ${product.id}`)
		expect(rows).toHaveLength(3)
	})

	test('the same slug cannot resolve to two different products within the same locale', async () => {
		const { product: productA } = await createProductAndVariant()
		const { product: productB } = await createProductAndVariant()
		await db.insert(productSlugAliases).values({ productId: productA.id, locale: 'ru', slug: 'shared-slug' })
		await expect(
			toPromise(db.insert(productSlugAliases).values({ productId: productB.id, locale: 'ru', slug: 'shared-slug' }))
		).rejects.toThrow()
	})

	test('the same slug text CAN be reused across two different locales (locale is part of the key)', async () => {
		const { product } = await createProductAndVariant()
		await db.insert(productSlugAliases).values({ productId: product.id, locale: 'ru', slug: 'cross-locale-slug' })
		await expect(
			toPromise(db.insert(productSlugAliases).values({ productId: product.id, locale: 'ro', slug: 'cross-locale-slug' }))
		).resolves.toBeDefined()
	})

	test('an unrecognized locale is rejected by the check constraint', async () => {
		const { product } = await createProductAndVariant()
		await expect(
			toPromise(
				db.insert(productSlugAliases).values({ productId: product.id, locale: 'en' as 'ru', slug: 'english-slug' })
			)
		).rejects.toThrow()
	})
})

describe('inventory_locations + variant_inventory_by_location: raw per-location stock, no aggregation', () => {
	test('one variant can have a raw quantity recorded at several distinct locations', async () => {
		const { variant } = await createProductAndVariant()
		const [locationA] = await db.insert(inventoryLocations).values({ code: 'atrium', nameRu: 'Атриум' }).returning()
		const [locationB] = await db.insert(inventoryLocations).values({ code: 'mall', nameRu: 'Молл' }).returning()
		await db.insert(variantInventoryByLocation).values([
			{ variantId: variant.id, locationId: locationA.id, quantity: 3 },
			{ variantId: variant.id, locationId: locationB.id, quantity: 7 }
		])
		const rows = await db.select().from(variantInventoryByLocation).where(sql`variant_id = ${variant.id}`)
		expect(rows).toHaveLength(2)
		// Deliberately no assertion here that these sum to a single "available
		// quantity" - that aggregation rule is an explicit open question
		// (docs/vizaje-identity-architecture.md §D.5-D.6), not implemented.
	})

	test('a negative quantity is rejected by the non-negative check constraint', async () => {
		const { variant } = await createProductAndVariant()
		const [location] = await db.insert(inventoryLocations).values({ code: 'g3' }).returning()
		await expect(
			toPromise(
				db.insert(variantInventoryByLocation).values({ variantId: variant.id, locationId: location.id, quantity: -1 })
			)
		).rejects.toThrow()
	})

	test('a variant cannot have two rows for the same location (unique per variant+location)', async () => {
		const { variant } = await createProductAndVariant()
		const [location] = await db.insert(inventoryLocations).values({ code: 'elat' }).returning()
		await db.insert(variantInventoryByLocation).values({ variantId: variant.id, locationId: location.id, quantity: 1 })
		await expect(
			toPromise(
				db.insert(variantInventoryByLocation).values({ variantId: variant.id, locationId: location.id, quantity: 2 })
			)
		).rejects.toThrow()
	})

	test('deleting a location that still has recorded stock rows is rejected (RESTRICT, never a silent orphan)', async () => {
		const { variant } = await createProductAndVariant()
		const [location] = await db.insert(inventoryLocations).values({ code: 'sc1' }).returning()
		await db.insert(variantInventoryByLocation).values({ variantId: variant.id, locationId: location.id, quantity: 1 })
		await expect(toPromise(db.delete(inventoryLocations).where(sql`id = ${location.id}`))).rejects.toThrow()
	})
})

describe('Sprint 12B.1 compatibility: existing product_variants.barcode scalar column is untouched', () => {
	test('the single-barcode column still accepts a value directly, independent of product_variant_barcodes', async () => {
		const { product } = await createProductAndVariant()
		const [variant] = await db
			.insert(productVariants)
			.values({ productId: product.id, sku: `TEST-${crypto.randomUUID()}`, barcode: '4051761201249' })
			.returning()
		expect(variant.barcode).toBe('4051761201249')
	})
})
