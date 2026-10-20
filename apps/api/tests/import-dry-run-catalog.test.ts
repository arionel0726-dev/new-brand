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
	test('two products sharing the same GUID are both reported as conflicts under externalIdCollisions', async () => {
		const sql = minimalCatalogSql([productRow(1, 'DUP'), productRow(2, 'DUP')].join(',\n'))
		const result = await runLegacyCatalogDryRun(sql)
		expect(result.summary.externalIdCollisions).toEqual([{ externalId: 'DUP', legacyProductIds: [1, 2] }])
		expect(result.summary.conflicts).toBe(2)
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
