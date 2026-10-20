import { describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { products } from '../src/db/schema/products'
import { productVariants } from '../src/db/schema/product-variants'
import { externalEntityMappings } from '../src/db/schema/external-entity-mappings'
import { resolveOrCreateMapping } from '../src/import/mappings'
import { runLegacyCatalogDryRun } from '../src/import/dry-run-catalog'
import { resetDatabase } from './helpers'

function minimalCatalogSql(productRows: string): string {
	return [
		"INSERT INTO `products` (`id`, `GUID`, `SKU`, `titleRU`, `titleRO`, `descRU`, `descRO`, `textRU`, `textRO`, `uriRU`, `uriRO`, `price`, `discount_price`, `sale_mdl`, `sale_percent`, `volume`, `on_stock`, `stock`, `is_new`, `best_selling`, `category_id`, `brand_id`, `feature_type`, `reviews`, `variations`, `instructionRU`, `instructionRO`, `instructionEN`, `componentsRU`, `componentsRO`, `componentsEN`, `sex`, `search_teg`, `seoTitleRU`, `seoTitleRO`, `seoTitleEN`, `seoKeywordsRU`, `seoKeywordsRO`, `seoKeywordsEN`, `seoDescRU`, `seoDescRO`, `seoDescEN`, `order`, `sorder`, `isShown`, `updated_at`, `created_at`, `priceWH`, `barcode`, `on_stockWH`, `WarehouseName`, `youtube_video_id`, `titleEN`, `uriEN`, `textEN`) VALUES\n" +
			productRows +
			';',
		"INSERT INTO `products_variable` (`id`, `product_id`, `SKU`, `titleRU`, `titleRO`, `titleEN`, `colorRU`, `colorRO`, `color_data`, `colorHex`, `VolumeVar`, `color`, `dose`, `price`, `discount_price`, `qty`, `sorder`, `isShown`, `updated_at`, `created_at`, `colorEN`, `priceWH`, `barcode`, `qtyWH`, `WarehouseName`) VALUES\n(1, 999999, 'x', 'x', 'x', 'x', '', '', NULL, NULL, '', NULL, NULL, 1, '0', 0, 0, 1, NULL, '2024-01-01', '', 1, NULL, 0, NULL);",
		"INSERT INTO `brands` (`id`, `GUID`, `title`, `h1RO`, `h1RU`, `breadcrumbTitleRO`, `breadcrumbTitleRU`, `uri`, `textRU`, `textRO`, `textEN`, `img`, `seoTitleRU`, `seoTitleRO`, `seoTitleEN`, `seoKeywordsRU`, `seoKeywordsRO`, `seoKeywordsEN`, `seoDescRU`, `seoDescRO`, `seoTextRO`, `seoTextRU`, `seoDescEN`, `sorder`, `top`, `isShown`, `updated_at`, `created_at`) VALUES\n(1, 'g', 'B', NULL, NULL, NULL, NULL, 'b', 't', 't', 't', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 1, NULL, '2024-01-01');",
		"INSERT INTO `categories` (`id`, `GUID`, `parent_id`, `feature_type`, `step`, `titleRU`, `h1RU`, `breadcrumbTitleRU`, `titleRO`, `h1RO`, `breadcrumbTitleRO`, `titleEN`, `uriRU`, `uriRO`, `uriEN`, `img`, `imgNav`, `imgNavHover`, `calculator`, `search_teg`, `seoTitleRU`, `seoTitleRO`, `seoTitleEN`, `descRU`, `descRO`, `descEN`, `seoKeywordsRU`, `seoKeywordsRO`, `seoKeywordsEN`, `seoDescRU`, `seoTextRU`, `seoDescRO`, `seoTextRO`, `seoDescEN`, `top_menu`, `footer_menu`, `sorder`, `wallpaper`, `isShown`, `isCustomMobile`, `updated_at`, `created_at`) VALUES\n(1, 'g', 0, 0, 0, 'C', NULL, NULL, 'C', NULL, NULL, NULL, 'c', NULL, NULL, '', '', 0, '', NULL, NULL, NULL, 'd', 'd', 'd', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, 1, 0, NULL, '2024-01-01');",
		"INSERT INTO `product_categories` (`id`, `product_id`, `category_id`) VALUES\n(1, 1, 1);",
		"INSERT INTO `products_img` (`id`, `product_id`, `img`, `sorder`, `isShown`) VALUES\n(1, 1, 'a.jpg', 0, 1);",
		"INSERT INTO `products_variable_img` (`id`, `product_id`, `variable_id`, `img`, `sorder`, `isShown`) VALUES\n(1, 1, 1, 'a.jpg', 0, 1);",
		"INSERT INTO `stores` (`id`, `titleRU`, `titleRO`, `titleEN`, `phone`, `coords`, `descRU`, `descRO`, `descEN`, `textRU`, `textRO`, `textEN`, `iframe_google`, `delivery`, `isShown`, `sorder`, `onBottom`) VALUES\n(1, 'S', 'S', 'S', NULL, NULL, 'd', 'd', 'd', NULL, NULL, NULL, NULL, 0, 1, 0, 0);"
	].join('\n')
}

function productRow(id: number, guid: string, uriRu: string | null = null): string {
	const uri = uriRu === null ? 'NULL' : `'${uriRu}'`
	return `(${id}, '${guid}', '${guid}', 'Title', 'Titlu', 'd', 'd', 't', 't', ${uri}, NULL, 100, 0, 0, 0, '', 1, 0, 0, 0, 1, 1, 0, '', '', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 1, 1, NULL, '2024-01-01', 0, NULL, 0, NULL, NULL, 'en', 'en', 'en')`
}

/** Full-control product row builder for Sprint 12A.2's finer-grained quarantine tests. */
function productRowFull(opts: {
	id: number
	guid: string
	sku?: string | null
	categoryId?: number
	brandId?: number
	barcode?: string | null
}): string {
	const sku = opts.sku === undefined ? opts.guid : opts.sku
	const skuSql = sku === null ? 'NULL' : `'${sku}'`
	const barcodeSql = opts.barcode == null ? 'NULL' : `'${opts.barcode}'`
	return `(${opts.id}, '${opts.guid}', ${skuSql}, 'Title', 'Titlu', 'd', 'd', 't', 't', NULL, NULL, 100, 0, 0, 0, '', 1, 0, 0, 0, ${opts.categoryId ?? 1}, ${opts.brandId ?? 1}, 0, '', '', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 1, 1, NULL, '2024-01-01', 0, ${barcodeSql}, 0, NULL, NULL, 'en', 'en', 'en')`
}

/** products_variable row builder - no default orphan row baked in, unlike minimalCatalogSql. */
function variantRow(opts: { id: number; productId: number; sku?: string | null; barcode?: string | null }): string {
	const skuSql = opts.sku == null ? 'NULL' : `'${opts.sku}'`
	const barcodeSql = opts.barcode == null ? 'NULL' : `'${opts.barcode}'`
	return `(${opts.id}, ${opts.productId}, ${skuSql}, 'x', 'x', 'x', '', '', NULL, NULL, '', NULL, NULL, 1, '0', 0, 0, 1, NULL, '2024-01-01', '', 1, ${barcodeSql}, 0, NULL)`
}

function categoryRow(id: number): string {
	return `(${id}, 'g${id}', 0, 0, 0, 'C${id}', NULL, NULL, 'C${id}', NULL, NULL, NULL, 'c${id}', NULL, NULL, '', '', 0, '', NULL, NULL, NULL, 'd', 'd', 'd', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, 1, 0, NULL, '2024-01-01')`
}

/**
 * A from-scratch catalog SQL builder for the fine-grained Sprint 12A.2
 * quarantine tests - unlike minimalCatalogSql, callers control every
 * products_variable and product_categories row explicitly (no implicit
 * orphan variant baked in), so each test exercises exactly one condition.
 */
function customCatalogSql(opts: {
	productRows: string
	variantRows?: string[]
	categoryRows?: string[]
	productCategoryRows?: string[]
}): string {
	const statements = [
		"INSERT INTO `products` (`id`, `GUID`, `SKU`, `titleRU`, `titleRO`, `descRU`, `descRO`, `textRU`, `textRO`, `uriRU`, `uriRO`, `price`, `discount_price`, `sale_mdl`, `sale_percent`, `volume`, `on_stock`, `stock`, `is_new`, `best_selling`, `category_id`, `brand_id`, `feature_type`, `reviews`, `variations`, `instructionRU`, `instructionRO`, `instructionEN`, `componentsRU`, `componentsRO`, `componentsEN`, `sex`, `search_teg`, `seoTitleRU`, `seoTitleRO`, `seoTitleEN`, `seoKeywordsRU`, `seoKeywordsRO`, `seoKeywordsEN`, `seoDescRU`, `seoDescRO`, `seoDescEN`, `order`, `sorder`, `isShown`, `updated_at`, `created_at`, `priceWH`, `barcode`, `on_stockWH`, `WarehouseName`, `youtube_video_id`, `titleEN`, `uriEN`, `textEN`) VALUES\n" +
			opts.productRows +
			';',
		"INSERT INTO `brands` (`id`, `GUID`, `title`, `h1RO`, `h1RU`, `breadcrumbTitleRO`, `breadcrumbTitleRU`, `uri`, `textRU`, `textRO`, `textEN`, `img`, `seoTitleRU`, `seoTitleRO`, `seoTitleEN`, `seoKeywordsRU`, `seoKeywordsRO`, `seoKeywordsEN`, `seoDescRU`, `seoDescRO`, `seoTextRO`, `seoTextRU`, `seoDescEN`, `sorder`, `top`, `isShown`, `updated_at`, `created_at`) VALUES\n(1, 'g', 'B', NULL, NULL, NULL, NULL, 'b', 't', 't', 't', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 1, NULL, '2024-01-01');"
	]
	if (opts.variantRows && opts.variantRows.length > 0) {
		statements.push(
			"INSERT INTO `products_variable` (`id`, `product_id`, `SKU`, `titleRU`, `titleRO`, `titleEN`, `colorRU`, `colorRO`, `color_data`, `colorHex`, `VolumeVar`, `color`, `dose`, `price`, `discount_price`, `qty`, `sorder`, `isShown`, `updated_at`, `created_at`, `colorEN`, `priceWH`, `barcode`, `qtyWH`, `WarehouseName`) VALUES\n" +
				opts.variantRows.join(',\n') +
				';'
		)
	}
	if (opts.categoryRows && opts.categoryRows.length > 0) {
		statements.push(
			"INSERT INTO `categories` (`id`, `GUID`, `parent_id`, `feature_type`, `step`, `titleRU`, `h1RU`, `breadcrumbTitleRU`, `titleRO`, `h1RO`, `breadcrumbTitleRO`, `titleEN`, `uriRU`, `uriRO`, `uriEN`, `img`, `imgNav`, `imgNavHover`, `calculator`, `search_teg`, `seoTitleRU`, `seoTitleRO`, `seoTitleEN`, `descRU`, `descRO`, `descEN`, `seoKeywordsRU`, `seoKeywordsRO`, `seoKeywordsEN`, `seoDescRU`, `seoTextRU`, `seoDescRO`, `seoTextRO`, `seoDescEN`, `top_menu`, `footer_menu`, `sorder`, `wallpaper`, `isShown`, `isCustomMobile`, `updated_at`, `created_at`) VALUES\n" +
				opts.categoryRows.join(',\n') +
				';'
		)
	}
	if (opts.productCategoryRows && opts.productCategoryRows.length > 0) {
		statements.push("INSERT INTO `product_categories` (`id`, `product_id`, `category_id`) VALUES\n" + opts.productCategoryRows.join(',\n') + ';')
	}
	return statements.join('\n')
}

describe('runLegacyCatalogDryRun: zero-write guarantee (Sprint 12 Task 7/9)', () => {
	test('does not insert any row into products or product_variants, with or without a database connection', async () => {
		await resetDatabase()
		const sql = minimalCatalogSql(productRow(1, 'G1'))

		await runLegacyCatalogDryRun(sql, db)
		await runLegacyCatalogDryRun(sql)

		const productRows = await db.select().from(products)
		const variantRows = await db.select().from(productVariants)
		expect(productRows).toHaveLength(0)
		expect(variantRows).toHaveLength(0)
	})

	test('never writes to external_entity_mappings either - it only reads via findMapping', async () => {
		await resetDatabase()
		const sql = minimalCatalogSql(productRow(1, 'G1'))
		await runLegacyCatalogDryRun(sql, db)
		const mappings = await db.select().from(externalEntityMappings)
		expect(mappings).toHaveLength(0)
	})
})

describe('runLegacyCatalogDryRun: create/update classification (Sprint 12 Task 7/9)', () => {
	test('a GUID with no existing legacy_mysql/product mapping is reported as "create"', async () => {
		await resetDatabase()
		const sql = minimalCatalogSql(productRow(1, 'G1'))
		const result = await runLegacyCatalogDryRun(sql, db)
		expect(result.summary.wouldCreate).toBe(1)
		expect(result.summary.wouldUpdate).toBe(0)
		expect(result.products[0].action).toBe('create')
	})

	test('a GUID with an existing legacy_mysql/product mapping is reported as "update"', async () => {
		await resetDatabase()
		await db.transaction(tx => resolveOrCreateMapping(tx, { sourceSystem: 'legacy_mysql', entityType: 'product', externalId: 'G1', internalId: crypto.randomUUID() }))
		const sql = minimalCatalogSql(productRow(1, 'G1'))
		const result = await runLegacyCatalogDryRun(sql, db)
		expect(result.summary.wouldUpdate).toBe(1)
		expect(result.summary.wouldCreate).toBe(0)
	})

	test('running twice back to back with no intervening mapping writes produces identical create/update counts (idempotent dry-run)', async () => {
		await resetDatabase()
		const sql = minimalCatalogSql(productRow(1, 'G1'))
		const first = await runLegacyCatalogDryRun(sql, db)
		const second = await runLegacyCatalogDryRun(sql, db)
		expect(second.summary.wouldCreate).toBe(first.summary.wouldCreate)
		expect(second.summary.wouldUpdate).toBe(first.summary.wouldUpdate)
	})
})

describe('runLegacyCatalogDryRun: external ID collisions and SEO slug collisions (Sprint 12 Task 6/7/9)', () => {
	test('two products sharing the same GUID are both reported as externalIdCollisions and quarantined', async () => {
		const sql = minimalCatalogSql([productRow(1, 'DUP'), productRow(2, 'DUP')].join(',\n'))
		const result = await runLegacyCatalogDryRun(sql)
		expect(result.summary.externalIdCollisions).toEqual([{ externalId: 'DUP', legacyProductIds: [1, 2] }])
		expect(result.summary.quarantine.totalProductsQuarantined).toBe(2)
		expect(result.products.every(p => p.action === 'quarantine')).toBe(true)
		expect(result.products.every(p => p.quarantineReasonCodes.includes('duplicate_guid'))).toBe(true)
	})

	test('two products sharing the same non-numeric uriRU slug are reported as an SEO slug collision', async () => {
		const sql = minimalCatalogSql([productRow(1, 'G1', 'shared-slug'), productRow(2, 'G2', 'shared-slug')].join(',\n'))
		const result = await runLegacyCatalogDryRun(sql)
		expect(result.summary.seoSlugCollisions).toEqual([{ slug: 'shared-slug', legacyProductIds: [1, 2] }])
	})

	test('a numeric-only uriRU (the legacy id-as-slug fallback) is counted as "not set", never as a real slug or a collision', async () => {
		const sql = minimalCatalogSql([productRow(1, 'G1', '1'), productRow(2, 'G2', '2')].join(',\n'))
		const result = await runLegacyCatalogDryRun(sql)
		expect(result.summary.seoSlugsNotSet).toBe(2)
		expect(result.summary.seoSlugCollisions).toEqual([])
	})
})

describe('runLegacyCatalogDryRun: quarantine reason codes (Sprint 12A.2 Task 6)', () => {
	test('a product with an invalid category_id but a valid secondary category_id (via product_categories) is "resolvable_via_secondary", not "unresolvable"', async () => {
		const sql = customCatalogSql({
			productRows: productRowFull({ id: 1, guid: 'G1', categoryId: 999 /* does not exist */ }),
			categoryRows: [categoryRow(5)],
			productCategoryRows: ['(1, 1, 5)']
		})
		const result = await runLegacyCatalogDryRun(sql)
		expect(result.products[0].action).toBe('quarantine')
		expect(result.products[0].quarantineReasonCodes).toEqual(['invalid_category_reference_resolvable_via_secondary'])
		expect(result.summary.quarantine.byReasonCode.invalid_category_reference_resolvable_via_secondary).toBe(1)
		expect(result.summary.quarantine.byReasonCode.invalid_category_reference_unresolvable).toBe(0)
	})

	test('a product with an invalid category_id and no valid secondary category anywhere is "unresolvable"', async () => {
		const sql = customCatalogSql({
			productRows: productRowFull({ id: 1, guid: 'G1', categoryId: 999 })
			// no categoryRows, no productCategoryRows - genuinely nowhere to resolve to
		})
		const result = await runLegacyCatalogDryRun(sql)
		expect(result.products[0].quarantineReasonCodes).toEqual(['invalid_category_reference_unresolvable'])
		expect(result.summary.quarantine.byReasonCode.invalid_category_reference_unresolvable).toBe(1)
	})

	test('a product whose products.category_id is valid is never quarantined for category reasons, regardless of product_categories', async () => {
		const sql = customCatalogSql({
			productRows: productRowFull({ id: 1, guid: 'G1', categoryId: 5 }),
			categoryRows: [categoryRow(5)]
		})
		const result = await runLegacyCatalogDryRun(sql)
		expect(result.products[0].action).toBe('create')
		expect(result.products[0].quarantineReasonCodes).toEqual([])
	})

	test('an invalid brand_id quarantines a product under invalid_brand_reference', async () => {
		const sql = customCatalogSql({
			productRows: productRowFull({ id: 1, guid: 'G1', brandId: 999, categoryId: 1 }),
			categoryRows: [categoryRow(1)]
		})
		const result = await runLegacyCatalogDryRun(sql)
		expect(result.products[0].quarantineReasonCodes).toEqual(['invalid_brand_reference'])
	})

	test('products sharing a duplicate SKU are quarantined under duplicate_sku and excluded from wouldCreate', async () => {
		const sql = customCatalogSql({
			productRows: [
				productRowFull({ id: 1, guid: 'G1', sku: 'SHARED', categoryId: 1 }),
				productRowFull({ id: 2, guid: 'G2', sku: 'SHARED', categoryId: 1 })
			].join(',\n'),
			categoryRows: [categoryRow(1)]
		})
		const result = await runLegacyCatalogDryRun(sql)
		expect(result.products.every(p => p.quarantineReasonCodes.includes('duplicate_sku'))).toBe(true)
		expect(result.summary.wouldCreate).toBe(0)
		expect(result.summary.quarantine.totalProductsQuarantined).toBe(2)
		expect(result.summary.quarantine.byReasonCode.duplicate_sku).toBe(2)
	})

	test('a product can carry more than one quarantine reason code at once (duplicate GUID and duplicate SKU)', async () => {
		const sql = customCatalogSql({
			productRows: [
				productRowFull({ id: 1, guid: 'DUP', sku: 'DUP', categoryId: 1 }),
				productRowFull({ id: 2, guid: 'DUP', sku: 'DUP', categoryId: 1 })
			].join(',\n'),
			categoryRows: [categoryRow(1)]
		})
		const result = await runLegacyCatalogDryRun(sql)
		expect(result.products[0].quarantineReasonCodes.sort()).toEqual(['duplicate_guid', 'duplicate_sku'])
	})

	test('quarantine summary caps illustrative examples at a small fixed number per reason code', async () => {
		const ids = [1, 2, 3, 4, 5]
		const sql = customCatalogSql({
			productRows: ids.map(id => productRowFull({ id, guid: `G${id}`, sku: 'SHARED', categoryId: 1 })).join(',\n'),
			categoryRows: [categoryRow(1)]
		})
		const result = await runLegacyCatalogDryRun(sql)
		expect(result.summary.quarantine.byReasonCode.duplicate_sku).toBe(5)
		expect(result.summary.quarantine.examples.duplicate_sku.length).toBeLessThanOrEqual(3)
	})
})

describe('runLegacyCatalogDryRun: orphan variant quarantine (Sprint 12A.2 Task 4/6)', () => {
	test('a products_variable row whose product_id does not exist is quarantined separately from the product list, never silently dropped', async () => {
		const sql = customCatalogSql({
			productRows: productRowFull({ id: 1, guid: 'G1', categoryId: 1 }),
			categoryRows: [categoryRow(1)],
			variantRows: [variantRow({ id: 10, productId: 999999 /* does not exist */ })]
		})
		const result = await runLegacyCatalogDryRun(sql)
		expect(result.quarantinedVariants).toHaveLength(1)
		expect(result.quarantinedVariants[0]).toMatchObject({ variantId: 10, missingProductId: 999999, reasonCode: 'orphan_variant' })
		expect(result.summary.quarantine.totalVariantsQuarantined).toBe(1)
		expect(result.summary.quarantine.byReasonCode.orphan_variant).toBe(1)
	})

	test('an orphan variant whose barcode uniquely matches a real product surfaces that product as a possible reattachment, without applying it', async () => {
		const sql = customCatalogSql({
			productRows: productRowFull({ id: 1, guid: 'G1', categoryId: 1, barcode: 'BC123' }),
			categoryRows: [categoryRow(1)],
			variantRows: [variantRow({ id: 10, productId: 999999, barcode: 'BC123' })]
		})
		const result = await runLegacyCatalogDryRun(sql)
		expect(result.quarantinedVariants[0].possibleReattachProductId).toBe(1)
		expect(result.quarantinedVariants[0].possibleReattachMatchedOn).toBe('barcode')
		// Still only a suggestion - the variant must not have been attached to any V2 product in this dry-run.
		expect(result.quarantinedVariants[0].missingProductId).toBe(999999)
	})

	test('an orphan variant whose barcode matches more than one product is left unmatched - ambiguity is never silently resolved', async () => {
		const sql = customCatalogSql({
			productRows: [
				productRowFull({ id: 1, guid: 'G1', categoryId: 1, barcode: 'BC123' }),
				productRowFull({ id: 2, guid: 'G2', categoryId: 1, barcode: 'BC123' })
			].join(',\n'),
			categoryRows: [categoryRow(1)],
			variantRows: [variantRow({ id: 10, productId: 999999, barcode: 'BC123' })]
		})
		const result = await runLegacyCatalogDryRun(sql)
		expect(result.quarantinedVariants[0].possibleReattachProductId).toBeUndefined()
	})

	test('an orphan variant with no matching barcode or SKU anywhere gets no reattachment suggestion', async () => {
		const sql = customCatalogSql({
			productRows: productRowFull({ id: 1, guid: 'G1', categoryId: 1 }),
			categoryRows: [categoryRow(1)],
			variantRows: [variantRow({ id: 10, productId: 999999, barcode: 'NO-MATCH', sku: 'NO-MATCH-EITHER' })]
		})
		const result = await runLegacyCatalogDryRun(sql)
		expect(result.quarantinedVariants[0].possibleReattachProductId).toBeUndefined()
	})

	test('zero-write guarantee still holds when orphan variants are present', async () => {
		await resetDatabase()
		const sql = customCatalogSql({
			productRows: productRowFull({ id: 1, guid: 'G1', categoryId: 1 }),
			categoryRows: [categoryRow(1)],
			variantRows: [variantRow({ id: 10, productId: 999999 })]
		})
		await runLegacyCatalogDryRun(sql, db)
		const productRows = await db.select().from(products)
		const variantRows = await db.select().from(productVariants)
		expect(productRows).toHaveLength(0)
		expect(variantRows).toHaveLength(0)
	})
})
