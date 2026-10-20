import { describe, expect, test } from 'bun:test'
import { auditLegacyCatalog } from '../src/import/audit/legacy-catalog-audit'
import { loadLegacyCatalogDump } from '../src/import/parsers/mysql-catalog'

/**
 * Synthetic fixtures only (Sprint 12 Task 9) - shaped like the real
 * vizaje_catalog_only.sql columns (confirmed against
 * docs/legacy-reference/vizaje_nica_local.sql's CREATE TABLE definitions)
 * but every value here is invented for the test, never copied from the
 * real dump.
 */
function buildFixture(overrides: {
	products?: string
	productsVariable?: string
	brands?: string
	categories?: string
	productCategories?: string
	productImgs?: string
	productVariableImgs?: string
	stores?: string
}): string {
	return [
		"INSERT INTO `products` (`id`, `GUID`, `SKU`, `titleRU`, `titleRO`, `descRU`, `descRO`, `textRU`, `textRO`, `uriRU`, `uriRO`, `price`, `discount_price`, `sale_mdl`, `sale_percent`, `volume`, `on_stock`, `stock`, `is_new`, `best_selling`, `category_id`, `brand_id`, `feature_type`, `reviews`, `variations`, `instructionRU`, `instructionRO`, `instructionEN`, `componentsRU`, `componentsRO`, `componentsEN`, `sex`, `search_teg`, `seoTitleRU`, `seoTitleRO`, `seoTitleEN`, `seoKeywordsRU`, `seoKeywordsRO`, `seoKeywordsEN`, `seoDescRU`, `seoDescRO`, `seoDescEN`, `order`, `sorder`, `isShown`, `updated_at`, `created_at`, `priceWH`, `barcode`, `on_stockWH`, `WarehouseName`, `youtube_video_id`, `titleEN`, `uriEN`, `textEN`) VALUES\n" +
			(overrides.products ?? ''),
		"INSERT INTO `products_variable` (`id`, `product_id`, `SKU`, `titleRU`, `titleRO`, `titleEN`, `colorRU`, `colorRO`, `color_data`, `colorHex`, `VolumeVar`, `color`, `dose`, `price`, `discount_price`, `qty`, `sorder`, `isShown`, `updated_at`, `created_at`, `colorEN`, `priceWH`, `barcode`, `qtyWH`, `WarehouseName`) VALUES\n" +
			(overrides.productsVariable ?? ''),
		"INSERT INTO `brands` (`id`, `GUID`, `title`, `h1RO`, `h1RU`, `breadcrumbTitleRO`, `breadcrumbTitleRU`, `uri`, `textRU`, `textRO`, `textEN`, `img`, `seoTitleRU`, `seoTitleRO`, `seoTitleEN`, `seoKeywordsRU`, `seoKeywordsRO`, `seoKeywordsEN`, `seoDescRU`, `seoDescRO`, `seoTextRO`, `seoTextRU`, `seoDescEN`, `sorder`, `top`, `isShown`, `updated_at`, `created_at`) VALUES\n" +
			(overrides.brands ?? ''),
		"INSERT INTO `categories` (`id`, `GUID`, `parent_id`, `feature_type`, `step`, `titleRU`, `h1RU`, `breadcrumbTitleRU`, `titleRO`, `h1RO`, `breadcrumbTitleRO`, `titleEN`, `uriRU`, `uriRO`, `uriEN`, `img`, `imgNav`, `imgNavHover`, `calculator`, `search_teg`, `seoTitleRU`, `seoTitleRO`, `seoTitleEN`, `descRU`, `descRO`, `descEN`, `seoKeywordsRU`, `seoKeywordsRO`, `seoKeywordsEN`, `seoDescRU`, `seoTextRU`, `seoDescRO`, `seoTextRO`, `seoDescEN`, `top_menu`, `footer_menu`, `sorder`, `wallpaper`, `isShown`, `isCustomMobile`, `updated_at`, `created_at`) VALUES\n" +
			(overrides.categories ?? ''),
		"INSERT INTO `product_categories` (`id`, `product_id`, `category_id`) VALUES\n" + (overrides.productCategories ?? ''),
		"INSERT INTO `products_img` (`id`, `product_id`, `img`, `sorder`, `isShown`) VALUES\n" + (overrides.productImgs ?? ''),
		"INSERT INTO `products_variable_img` (`id`, `product_id`, `variable_id`, `img`, `sorder`, `isShown`) VALUES\n" +
			(overrides.productVariableImgs ?? ''),
		"INSERT INTO `stores` (`id`, `titleRU`, `titleRO`, `titleEN`, `phone`, `coords`, `descRU`, `descRO`, `descEN`, `textRU`, `textRO`, `textEN`, `iframe_google`, `delivery`, `isShown`, `sorder`, `onBottom`) VALUES\n" +
			(overrides.stores ?? ''),
		"INSERT INTO `stores_img` (`id`, `stores_id`, `img`, `sorder`, `isShown`) VALUES\n(1,1,'x.jpg',0,1);",
		"INSERT INTO `products_more` (`product_id`, `related_id`) VALUES\n(1,2);"
	]
		.map(s => (s.endsWith(';') ? s : `${s};`))
		.join('\n')
}

function productRow(opts: {
	id: number
	guid: string
	sku?: string
	titleRu?: string | null
	titleRo?: string | null
	price?: number | null
	isShown?: 0 | 1
	brandId?: number
	categoryId?: number | null
	uriRu?: string | null
}): string {
	const t = (v: string | null | undefined) => (v === null || v === undefined ? 'NULL' : `'${v}'`)
	const titleRu = 'titleRu' in opts ? opts.titleRu : `Title ${opts.id}`
	const titleRo = 'titleRo' in opts ? opts.titleRo : `Titlu ${opts.id}`
	return `(${opts.id}, '${opts.guid}', '${opts.sku ?? opts.guid}', ${t(titleRu)}, ${t(titleRo)}, 'd', 'd', 't', 't', ${t(opts.uriRu ?? null)}, NULL, ${opts.price ?? 100}, 0, 0, 0, '', 1, 0, 0, 0, ${opts.categoryId ?? 'NULL'}, ${opts.brandId ?? 0}, 0, '', '', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 1, ${opts.isShown ?? 1}, NULL, '2024-01-01', 0, NULL, 0, NULL, NULL, 'en', 'en', 'en')`
}

describe('auditLegacyCatalog (Sprint 12 Task 9: synthetic regression fixtures)', () => {
	test('counts published vs hidden correctly', () => {
		const sql = buildFixture({
			products: [productRow({ id: 1, guid: '1001', isShown: 1 }), productRow({ id: 2, guid: '1002', isShown: 0 })].join(',\n')
		})
		const audit = auditLegacyCatalog(loadLegacyCatalogDump(sql))
		expect(audit.products.published).toBe(1)
		expect(audit.products.hidden).toBe(1)
	})

	test('detects a product with no matching variants as withoutVariants, and one with variants as withVariants', () => {
		const sql = buildFixture({
			products: [productRow({ id: 1, guid: '1001' }), productRow({ id: 2, guid: '1002' })].join(',\n'),
			productsVariable: "(1, 1, 'v1', 'A', 'A', 'A', '', '', NULL, NULL, '50ml', NULL, NULL, 100, '0', 5, 0, 1, NULL, '2024-01-01', '', 100, NULL, 0, NULL)"
		})
		const audit = auditLegacyCatalog(loadLegacyCatalogDump(sql))
		expect(audit.products.withVariants).toBe(1)
		expect(audit.products.withoutVariants).toBe(1)
	})

	test('flags a variant whose product_id matches no product as an orphan variant', () => {
		const sql = buildFixture({
			products: productRow({ id: 1, guid: '1001' }),
			productsVariable: "(1, 999, 'v1', 'A', 'A', 'A', '', '', NULL, NULL, '', NULL, NULL, 100, '0', 1, 0, 1, NULL, '2024-01-01', '', 100, NULL, 0, NULL)"
		})
		const audit = auditLegacyCatalog(loadLegacyCatalogDump(sql))
		expect(audit.variants.orphanVariants).toEqual([{ variantId: 1, productId: 999 }])
	})

	test('detects duplicate GUIDs across distinct product rows', () => {
		const sql = buildFixture({
			products: [productRow({ id: 1, guid: 'DUP' }), productRow({ id: 2, guid: 'DUP' }), productRow({ id: 3, guid: 'UNIQUE' })].join(',\n')
		})
		const audit = auditLegacyCatalog(loadLegacyCatalogDump(sql))
		expect(audit.products.duplicateGuids).toEqual([{ value: 'DUP', count: 2, ids: [1, 2] }])
	})

	test('detects duplicate SKUs across distinct variant rows', () => {
		const sql = buildFixture({
			products: [productRow({ id: 1, guid: '1' }), productRow({ id: 2, guid: '2' })].join(',\n'),
			productsVariable: [
				"(1, 1, 'SAMESKU', 'A', 'A', 'A', '', '', NULL, NULL, '', NULL, NULL, 100, '0', 1, 0, 1, NULL, '2024-01-01', '', 100, NULL, 0, NULL)",
				"(2, 2, 'SAMESKU', 'B', 'B', 'B', '', '', NULL, NULL, '', NULL, NULL, 100, '0', 1, 0, 1, NULL, '2024-01-01', '', 100, NULL, 0, NULL)"
			].join(',\n')
		})
		const audit = auditLegacyCatalog(loadLegacyCatalogDump(sql))
		expect(audit.variants.duplicateSkus).toEqual([{ value: 'SAMESKU', count: 2, ids: [1, 2] }])
	})

	test('a product referencing a brand_id that does not exist among the brands rows is reported invalid', () => {
		const sql = buildFixture({
			products: productRow({ id: 1, guid: '1', brandId: 999 }),
			brands: "(1, 'g', 'Real Brand', NULL, NULL, NULL, NULL, 'real-brand', 't', 't', 't', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 1, NULL, '2024-01-01')"
		})
		const audit = auditLegacyCatalog(loadLegacyCatalogDump(sql))
		expect(audit.products.invalidBrandReferences).toEqual([{ productId: 1, brandId: 999 }])
	})

	test('brand_id=0 (the legacy default) counts as "without brand", not as an invalid reference', () => {
		const sql = buildFixture({ products: productRow({ id: 1, guid: '1', brandId: 0 }) })
		const audit = auditLegacyCatalog(loadLegacyCatalogDump(sql))
		expect(audit.products.withoutBrand).toBe(1)
		expect(audit.products.invalidBrandReferences).toEqual([])
	})

	test('computes category hierarchy depth from a real parent chain (root -> child -> grandchild)', () => {
		const sql = buildFixture({
			categories: [
				"(1, 'g1', 0, 0, 0, 'Root', NULL, NULL, 'Root', NULL, NULL, NULL, 'root', NULL, NULL, NULL, '', '', 0, '', NULL, NULL, NULL, 'd', 'd', 'd', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, 1, 0, NULL, '2024-01-01')",
				"(2, 'g2', 1, 0, 0, 'Child', NULL, NULL, 'Child', NULL, NULL, NULL, 'child', NULL, NULL, NULL, '', '', 0, '', NULL, NULL, NULL, 'd', 'd', 'd', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, 1, 0, NULL, '2024-01-01')",
				"(3, 'g3', 2, 0, 0, 'Grandchild', NULL, NULL, 'Grandchild', NULL, NULL, NULL, 'grandchild', NULL, NULL, NULL, '', '', 0, '', NULL, NULL, NULL, 'd', 'd', 'd', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, 1, 0, NULL, '2024-01-01')"
			].join(',\n')
		})
		const audit = auditLegacyCatalog(loadLegacyCatalogDump(sql))
		expect(audit.categories.maxDepth).toBe(2)
		expect(audit.categories.rootCount).toBe(1)
	})

	test('a category whose parent_id points nowhere is reported as a broken parent reference, not counted toward depth', () => {
		const sql = buildFixture({
			categories:
				"(5, 'g5', 999, 0, 0, 'Lost', NULL, NULL, 'Lost', NULL, NULL, NULL, 'lost', NULL, NULL, NULL, '', '', 0, '', NULL, NULL, NULL, 'd', 'd', 'd', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, 1, 0, NULL, '2024-01-01')"
		})
		const audit = auditLegacyCatalog(loadLegacyCatalogDump(sql))
		expect(audit.categories.brokenParentRefs).toEqual([{ categoryId: 5, parentId: 999 }])
	})

	test('RU/RO title availability is counted independently', () => {
		const sql = buildFixture({
			products: [
				productRow({ id: 1, guid: '1', titleRu: 'Есть', titleRo: 'Exista' }),
				productRow({ id: 2, guid: '2', titleRu: null, titleRo: 'Doar RO' })
			].join(',\n')
		})
		const audit = auditLegacyCatalog(loadLegacyCatalogDump(sql))
		expect(audit.products.withRuTitle).toBe(1)
		expect(audit.products.withRoTitle).toBe(2)
		expect(audit.products.withBothRuRo).toBe(1)
	})

	test('a missing/negative price is flagged distinctly from a legitimate zero price', () => {
		const sql = buildFixture({
			products: [productRow({ id: 1, guid: '1', price: 0 }), productRow({ id: 2, guid: '2', price: -5 })].join(',\n')
		})
		const audit = auditLegacyCatalog(loadLegacyCatalogDump(sql))
		expect(audit.products.withZeroPrice).toBe(1)
		expect(audit.products.withInvalidOrMissingPrice).toBe(1)
	})

	test('a products_img row referencing a nonexistent product is an orphan product image', () => {
		const sql = buildFixture({
			products: productRow({ id: 1, guid: '1' }),
			productImgs: "(1, 999, 'a.jpg', 0, 1)"
		})
		const audit = auditLegacyCatalog(loadLegacyCatalogDump(sql))
		expect(audit.media.orphanProductImages).toEqual([{ imageId: 1, productId: 999 }])
	})

	test('a products_variable_img row whose variable_id does not exist is an orphan variant image, regardless of media ordering', () => {
		const sql = buildFixture({
			products: productRow({ id: 1, guid: '1' }),
			productsVariable:
				"(1, 1, 'v1', 'A', 'A', 'A', '', '', NULL, NULL, '', NULL, NULL, 100, '0', 1, 0, 1, NULL, '2024-01-01', '', 100, NULL, 0, NULL)",
			productVariableImgs: "(1, 1, 1, 'first.jpg', 2, 1), (2, 1, 999, 'second.jpg', 1, 1)"
		})
		const audit = auditLegacyCatalog(loadLegacyCatalogDump(sql))
		expect(audit.media.orphanVariantImages).toEqual([{ imageId: 2, productId: 1, variantId: 999 }])
	})

	test('computed stats are deterministic across repeated runs on the same input (idempotent analysis)', () => {
		const sql = buildFixture({
			products: [productRow({ id: 1, guid: '1' }), productRow({ id: 2, guid: '2', isShown: 0 })].join(',\n')
		})
		const first = auditLegacyCatalog(loadLegacyCatalogDump(sql))
		const second = auditLegacyCatalog(loadLegacyCatalogDump(sql))
		expect(second).toEqual(first)
	})
})
