import { db } from '../src/db/client'
import { brands } from '../src/db/schema/brands'
import { categories } from '../src/db/schema/categories'
import { inventory } from '../src/db/schema/inventory'
import { productCategories } from '../src/db/schema/product-categories'
import { productImages } from '../src/db/schema/product-images'
import { productPrices } from '../src/db/schema/product-prices'
import { productVariants } from '../src/db/schema/product-variants'
import { products } from '../src/db/schema/products'

/**
 * A small, realistic catalog used across Sprint 2 API tests:
 * - 2 brands (one with only unpublished products, to test exclusion)
 * - 3 categories, nested (skincare > face), plus an unrelated one (makeup)
 * - 1 active product with 2 sellable variants, 1 unpriced variant, and 1
 *   priced+stocked but explicitly isActive=false variant
 * - 1 draft and 1 archived product, which must never surface publicly
 */
export async function seedCatalog() {
	const [brandA] = await db
		.insert(brands)
		.values({ slug: 'loreal', nameRu: "Л'Ореаль", nameRo: "L'Oreal" })
		.returning()
	const [brandB] = await db
		.insert(brands)
		.values({ slug: 'nivea', nameRu: 'Нивея', nameRo: 'Nivea' })
		.returning()

	const [skincare] = await db
		.insert(categories)
		.values({ slug: 'skincare', nameRu: 'Уход за кожей', nameRo: 'Ingrijirea pielii' })
		.returning()
	const [face] = await db
		.insert(categories)
		.values({ slug: 'face', parentId: skincare.id, nameRu: 'Лицо', nameRo: 'Fata' })
		.returning()
	const [makeup] = await db
		.insert(categories)
		.values({ slug: 'makeup', nameRu: 'Макияж', nameRo: 'Machiaj' })
		.returning()

	const [cream] = await db
		.insert(products)
		.values({
			brandId: brandA.id,
			slug: 'revitalift-cream',
			status: 'active',
			nameRu: 'Крем Revitalift',
			nameRo: 'Crema Revitalift',
			descriptionRu: 'Увлажняющий крем',
			descriptionRo: 'Crema hidratanta'
		})
		.returning()

	const [serum] = await db
		.insert(products)
		.values({
			brandId: brandA.id,
			slug: 'vitamin-serum',
			status: 'active',
			nameRu: 'Сыворотка с витамином C',
			nameRo: 'Ser cu vitamina C'
		})
		.returning()

	const [draftProduct] = await db
		.insert(products)
		.values({
			brandId: brandB.id,
			slug: 'draft-product',
			status: 'draft',
			nameRu: 'Черновик',
			nameRo: 'Ciorna'
		})
		.returning()

	const [archivedProduct] = await db
		.insert(products)
		.values({
			brandId: brandB.id,
			slug: 'archived-product',
			status: 'archived',
			nameRu: 'Архив',
			nameRo: 'Arhiva'
		})
		.returning()

	await db.insert(productCategories).values([
		{ productId: cream.id, categoryId: face.id },
		{ productId: cream.id, categoryId: skincare.id },
		{ productId: serum.id, categoryId: skincare.id }
	])

	const [v50] = await db
		.insert(productVariants)
		.values({ productId: cream.id, sku: 'REV-50', nameRu: '50 мл', nameRo: '50 ml' })
		.returning()
	const [v100] = await db
		.insert(productVariants)
		.values({ productId: cream.id, sku: 'REV-100', nameRu: '100 мл', nameRo: '100 ml' })
		.returning()
	const [vNoPrice] = await db
		.insert(productVariants)
		.values({ productId: cream.id, sku: 'REV-NOPRICE' })
		.returning()

	// Priced AND stocked, but explicitly switched off - must never surface
	// publicly even though pricing/stock alone would make it sellable.
	const [vInactive] = await db
		.insert(productVariants)
		.values({ productId: cream.id, sku: 'REV-DISCONTINUED', isActive: false })
		.returning()

	const [serumVariant] = await db
		.insert(productVariants)
		.values({ productId: serum.id, sku: 'SER-30' })
		.returning()

	await db.insert(productPrices).values([
		{ variantId: v50.id, price: 15000, compareAtPrice: 18000 },
		{ variantId: v100.id, price: 25000 },
		{ variantId: vInactive.id, price: 12000 },
		{ variantId: serumVariant.id, price: 40000 }
	])

	await db.insert(inventory).values([
		{ variantId: v50.id, quantity: 10 },
		{ variantId: v100.id, quantity: 0 },
		{ variantId: vInactive.id, quantity: 50 },
		{ variantId: serumVariant.id, quantity: 5 }
	])

	await db.insert(productImages).values([
		{ productId: cream.id, url: 'https://example.com/cream-main.jpg', sortOrder: 0 },
		{ productId: cream.id, variantId: v50.id, url: 'https://example.com/cream-50.jpg', sortOrder: 1 },
		{ productId: serum.id, url: 'https://example.com/serum-main.jpg', sortOrder: 0 }
	])

	return {
		brands: { brandA, brandB },
		categories: { skincare, face, makeup },
		products: { cream, serum, draftProduct, archivedProduct },
		variants: { v50, v100, vNoPrice, vInactive, serumVariant }
	}
}
