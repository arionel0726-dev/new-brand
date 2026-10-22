import { beforeEach, describe, expect, test } from 'bun:test'
import { db } from '../src/db/client'
import { runCatalogImport, type CatalogImportInput } from '../src/import/catalog-importer'
import type { LegacyCatalogDump, LegacyProduct, LegacyProductVariable } from '../src/import/parsers/mysql-catalog'
import { parseProductsFeed, type ProductsFeedRecord } from '../src/import/parsers/products-feed'
import { classifyIdNomDuplicates } from '../src/import/reconcile/duplicate-id-nom'
import { reconcileFamilies } from '../src/import/reconcile/family-reconciliation'
import { reconcileSqlWith1c } from '../src/import/reconcile/sql-1c-reconciliation'
import { getJson, resetDatabase } from './helpers'

/**
 * Sprint 12B.8 Task 4: the real confirmed Mac run (Sprint 12B.6.1/12B.7)
 * left legacy product 661 (hidden, isShown=false) as `status: draft` and
 * legacy family 374 quarantined (never written at all). This test proves,
 * end to end through the REAL public Catalog API routes (not just a direct
 * DB query), that a structurally-identical synthetic analog of each case
 * never leaks: the hidden product must not appear in GET /products or be
 * reachable by GET /products/:slug, and a quarantined family must never
 * have been written in the first place, so by construction it cannot
 * appear either. Every id below is synthetic, per the standing Sprint 12
 * discipline.
 */

function makeLegacyProduct(overrides: Partial<LegacyProduct> & { id: number }): LegacyProduct {
	return {
		guid: null,
		sku: null,
		titleRu: null,
		titleRo: null,
		descRu: null,
		descRo: null,
		textRu: null,
		textRo: null,
		uriRu: null,
		uriRo: null,
		price: null,
		discountPrice: null,
		priceWh: null,
		volume: null,
		onStock: null,
		stock: null,
		isNew: false,
		categoryId: null,
		brandId: null,
		instructionRu: null,
		instructionRo: null,
		componentsRu: null,
		componentsRo: null,
		sex: null,
		seoTitleRu: null,
		seoTitleRo: null,
		seoDescRu: null,
		seoDescRo: null,
		barcode: null,
		warehouseName: null,
		isShown: true,
		createdAt: null,
		updatedAt: null,
		...overrides
	}
}

function makeVariable(overrides: Partial<LegacyProductVariable> & { id: number; productId: number }): LegacyProductVariable {
	return {
		sku: null,
		titleRu: null,
		titleRo: null,
		colorRu: null,
		colorRo: null,
		colorHex: null,
		volumeVar: null,
		dose: null,
		price: null,
		discountPrice: null,
		qty: null,
		qtyWh: null,
		priceWh: null,
		barcode: null,
		warehouseName: null,
		isShown: true,
		sortOrder: null,
		...overrides
	}
}

function makeDump(partial: Partial<LegacyCatalogDump> & { products: LegacyProduct[] }): LegacyCatalogDump {
	return {
		products: partial.products,
		productVariables: partial.productVariables ?? [],
		brands: partial.brands ?? [],
		categories: partial.categories ?? [],
		productCategories: partial.productCategories ?? [],
		productImgs: partial.productImgs ?? [],
		productVariableImgs: partial.productVariableImgs ?? [],
		stores: partial.stores ?? [],
		storeImgs: partial.storeImgs ?? [],
		productsMore: partial.productsMore ?? []
	}
}

function makeOneCRaw(overrides: Record<string, unknown> & { ID_nom: string | number }): Record<string, unknown> {
	return { Brand: 'TestBrand', Sex: 'Женский', ...overrides }
}

function parseOneC(raw: Record<string, unknown>[]): ProductsFeedRecord[] {
	return parseProductsFeed(raw).validRecords
}

async function buildInput(dump: LegacyCatalogDump, oneCRaw: Record<string, unknown>[]): Promise<CatalogImportInput> {
	const oneCRecords = parseOneC(oneCRaw)
	const positions = reconcileSqlWith1c(dump, oneCRecords)
	const families = reconcileFamilies(dump, oneCRecords)
	const idNomDuplicates = classifyIdNomDuplicates(oneCRaw, 'ID_nom')
	return { dump, oneCRecords, families, positions, idNomDuplicates }
}

beforeEach(async () => {
	await resetDatabase()
})

describe('Sprint 12B.8: public Catalog API never leaks a hidden or quarantined legacy import outcome', () => {
	test('a standalone product analog of legacy 661 (isShown=false) is imported as draft and is absent from GET /products and GET /products/:slug', async () => {
		// `ID_nom`/GUID must be purely numeric - `externalIdSchema` (parsers/shared.ts)
		// drops any non-numeric ID_nom during parseProductsFeed, same gotcha
		// documented in legacy-variant-family-reconciliation.test.ts.
		const hiddenProduct = makeLegacyProduct({ id: 90661, guid: '900661001', titleRu: 'Hidden Analog', uriRu: 'hidden-analog-661', isShown: false })
		const dump = makeDump({ products: [hiddenProduct] })
		const oneCRaw = [makeOneCRaw({ ID_nom: '900661001', Price: 1000 })]
		const input = await buildInput(dump, oneCRaw)

		const result = await db.transaction(async tx => runCatalogImport(tx, input, 'write'))
		const unit = result.units.find(u => u.kind === 'standalone' && u.action === 'created')!
		expect(unit).toBeDefined()

		const { body: listBody } = await getJson('/api/v1/products?limit=100')
		const slugs = listBody.data.map((p: { slug: string }) => p.slug)
		expect(slugs).not.toContain('hidden-analog-661')

		const { status: slugStatus } = await getJson('/api/v1/products/hidden-analog-661')
		expect(slugStatus).toBe(404)
	})

	test('a quarantined family analog of legacy 374 is never written at all, so by construction it cannot leak', async () => {
		const parent = makeLegacyProduct({ id: 90374, titleRu: 'Quarantined Family Analog' })
		const variables = [
			makeVariable({ id: 900101, productId: 90374, sku: '900374001' }),
			makeVariable({ id: 900102, productId: 90374, sku: '900374002' })
		]
		const dump = makeDump({ products: [parent], productVariables: variables })
		const oneCRaw = [makeOneCRaw({ ID_nom: '900374001' }), makeOneCRaw({ ID_nom: '900374002' })]
		const oneCRecords = parseOneC(oneCRaw)
		// Pass 0's quarantine is driven by `priorQuarantineReasonCodes` carried
		// on the matching MysqlReconciliationResult, re-derived by
		// `runCatalogImport` from `input.positions.mysqlResults` - so the prior
		// quarantine has to be threaded into `reconcileSqlWith1c` itself, same
		// as the existing "parent already quarantined" unit test does for
		// `reconcileLegacyVariantFamilies` directly.
		const priorQuarantine = new Map([[90374, ['duplicate_guid' as const]]])
		const positions = reconcileSqlWith1c(dump, oneCRecords, priorQuarantine)
		const families = reconcileFamilies(dump, oneCRecords)
		const idNomDuplicates = classifyIdNomDuplicates(oneCRaw, 'ID_nom')
		const input: CatalogImportInput = { dump, oneCRecords, families, positions, idNomDuplicates }

		const result = await db.transaction(async tx => runCatalogImport(tx, input, 'write'))
		const unit = result.units.find(u => u.key.includes('90374'))!
		expect(unit.action).toBe('skipped')
		expect(unit.skipReason).toBe('quarantine')
		expect(unit.productId).toBeUndefined()

		const { body: listBody } = await getJson('/api/v1/products?limit=100')
		const names = listBody.data.map((p: { name: string }) => p.name)
		expect(names).not.toContain('Quarantined Family Analog')
	})
})
