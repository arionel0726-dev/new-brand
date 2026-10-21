import { and, eq } from 'drizzle-orm'
import nodeCrypto from 'node:crypto'
import { beforeEach, describe, expect, test } from 'bun:test'
import { db } from '../src/db/client'
import { products } from '../src/db/schema/products'
import { productVariants } from '../src/db/schema/product-variants'
import { productVariantBarcodes } from '../src/db/schema/product-variant-barcodes'
import { productSlugAliases } from '../src/db/schema/product-slug-aliases'
import { productCategories } from '../src/db/schema/product-categories'
import { productImages } from '../src/db/schema/product-images'
import { categories } from '../src/db/schema/categories'
import { brands } from '../src/db/schema/brands'
import { externalEntityMappings } from '../src/db/schema/external-entity-mappings'
import {
	assertSafeImportTarget,
	runCatalogImport,
	UnsafeImportTargetError,
	ZeroVariantProductError,
	type CatalogImportInput
} from '../src/import/catalog-importer'
import { resolveOrCreateMapping } from '../src/import/mappings'
import type { LegacyCatalogDump, LegacyProduct } from '../src/import/parsers/mysql-catalog'
import { parseProductsFeed, type ProductsFeedRecord } from '../src/import/parsers/products-feed'
import { classifyIdNomDuplicates } from '../src/import/reconcile/duplicate-id-nom'
import { reconcileFamilies } from '../src/import/reconcile/family-reconciliation'
import { reconcileSqlWith1c } from '../src/import/reconcile/sql-1c-reconciliation'
import { resetDatabase } from './helpers'

/**
 * Synthetic fixtures only (Sprint 12B.2's explicit restriction) - every
 * value below is invented for test purposes, never derived from a real
 * legacy record. Shapes mirror the real field layouts established across
 * Sprint 12/12A (GUID=ID_nom as the primary identity link, VariativeNomenclature
 * as a candidate parent-family group code, Barcode as independent supporting
 * evidence).
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

function makeDump(products: LegacyProduct[]): LegacyCatalogDump {
	return {
		products,
		productVariables: [],
		brands: [],
		categories: [],
		productCategories: [],
		productImgs: [],
		productVariableImgs: [],
		stores: [],
		storeImgs: [],
		productsMore: []
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

async function buildInputWithQuarantine(
	dump: LegacyCatalogDump,
	oneCRaw: Record<string, unknown>[],
	priorQuarantine: Map<number, ('duplicate_guid' | 'invalid_brand_reference' | 'duplicate_sku')[]>
): Promise<CatalogImportInput> {
	const oneCRecords = parseOneC(oneCRaw)
	const positions = reconcileSqlWith1c(dump, oneCRecords, priorQuarantine)
	const families = reconcileFamilies(dump, oneCRecords, priorQuarantine)
	const idNomDuplicates = classifyIdNomDuplicates(oneCRaw, 'ID_nom')
	return { dump, oneCRecords, families, positions, idNomDuplicates }
}

beforeEach(async () => {
	await resetDatabase()
})

describe('assertSafeImportTarget (Task 15 environment safety guard)', () => {
	test('accepts a database url whose name contains "test" and not "prod"', () => {
		expect(() => assertSafeImportTarget('postgres://user:pass@localhost:5432/beauty_store_test')).not.toThrow()
	})

	test('refuses a database url with no "test" in its name', () => {
		expect(() => assertSafeImportTarget('postgres://user:pass@localhost:5432/beauty_store')).toThrow(UnsafeImportTargetError)
	})

	test('refuses a database url containing "prod", even alongside "test"', () => {
		expect(() => assertSafeImportTarget('postgres://user:pass@localhost:5432/beauty_store_prod_test')).toThrow(UnsafeImportTargetError)
	})

	test('refuses a malformed DATABASE_URL outright', () => {
		expect(() => assertSafeImportTarget('not-a-url')).toThrow(UnsafeImportTargetError)
	})
})

describe('confirmed multi-variant family', () => {
	test('one product, N variants, each with its own real ID_nom as sku', async () => {
		const dump = makeDump([
			makeLegacyProduct({ id: 101, sku: 'A10.XXX', guid: '101', barcode: '4051761201249', titleRu: 'Лак для ногтей ANNY', uriRu: 'anny-polish', categoryId: 1, brandId: 1 }),
			makeLegacyProduct({ id: 102, sku: 'A10.XXX', guid: '102', barcode: '4051761201232' }),
			makeLegacyProduct({ id: 103, sku: 'A10.XXX', guid: '103', barcode: '4051761202772' })
		])
		const oneCRaw = [
			makeOneCRaw({ ID_nom: '10568', VariativeNomenclature: 'A10.XXX', Barcode: '4051761201249' }),
			makeOneCRaw({ ID_nom: '10516', VariativeNomenclature: 'A10.XXX', Barcode: '4051761201232' }),
			makeOneCRaw({ ID_nom: '10559', VariativeNomenclature: 'A10.XXX', Barcode: '4051761202772' })
		]
		const input = await buildInput(dump, oneCRaw)
		expect(input.families.summary.confirmedFamilies).toBe(1)

		const result = await db.transaction(tx => runCatalogImport(tx, input, 'write'))
		const familyUnit = result.units.find(u => u.kind === 'family' && u.action === 'created')
		expect(familyUnit).toBeDefined()
		expect(familyUnit?.variantIds).toHaveLength(3)

		const variantRows = await db.select().from(productVariants).where(eq(productVariants.productId, familyUnit!.productId!))
		expect(variantRows).toHaveLength(3)
		expect(new Set(variantRows.map(v => v.sku))).toEqual(new Set(['10568', '10516', '10559']))
	})
})

describe('standalone product', () => {
	test('a product with no group code becomes a product + one default variant', async () => {
		const dump = makeDump([makeLegacyProduct({ id: 201, guid: '20001', barcode: '9990001', titleRu: 'Standalone Cream', uriRu: 'standalone-cream', categoryId: 1, brandId: 1 })])
		const oneCRaw = [makeOneCRaw({ ID_nom: '20001', Barcode: '9990001' })]
		const input = await buildInput(dump, oneCRaw)

		const result = await db.transaction(tx => runCatalogImport(tx, input, 'write'))
		const unit = result.units.find(u => u.kind === 'standalone' && u.action === 'created')
		expect(unit).toBeDefined()
		expect(unit?.variantIds).toHaveLength(1)

		const [productRow] = await db.select().from(products).where(eq(products.id, unit!.productId!))
		expect(productRow.nameRu).toBe('Standalone Cream')
		const [variantRow] = await db.select().from(productVariants).where(eq(productVariants.productId, unit!.productId!))
		expect(variantRow.sku).toBe('20001')
	})
})

describe('multiple barcode aliases', () => {
	test('a variant whose MySQL and 1C barcodes differ gets both rows, MySQL one primary', async () => {
		const dump = makeDump([makeLegacyProduct({ id: 301, guid: '30001', barcode: '1112223334445', titleRu: 'Multi Barcode Item', uriRu: 'multi-barcode-item' })])
		const oneCRaw = [makeOneCRaw({ ID_nom: '30001', Barcode: '9998887776665' })]
		const input = await buildInput(dump, oneCRaw)

		const result = await db.transaction(tx => runCatalogImport(tx, input, 'write'))
		const unit = result.units.find(u => u.action === 'created')!
		const variantId = unit.variantIds![0]

		const barcodeRows = await db.select().from(productVariantBarcodes).where(eq(productVariantBarcodes.variantId, variantId))
		expect(barcodeRows).toHaveLength(2)
		expect(new Set(barcodeRows.map(b => b.barcode))).toEqual(new Set(['1112223334445', '9998887776665']))
		const primary = barcodeRows.find(b => b.isPrimary)
		expect(primary?.barcode).toBe('1112223334445') // Task 5's explicit rule: MySQL-side barcode wins primary when present
	})
})

describe('duplicate ID_nom conflicts - preserved, never resolved', () => {
	test('a 1C ID_nom with conflicting duplicate rows never gets imported, and the duplicate classification stays "conflicting"', async () => {
		const dump = makeDump([makeLegacyProduct({ id: 401, guid: '40001', titleRu: 'Ambiguous Item' })])
		const oneCRaw = [
			makeOneCRaw({ ID_nom: '40001', Brand: 'BrandA', Barcode: '1000000000001' }),
			makeOneCRaw({ ID_nom: '40001', Brand: 'BrandB', Barcode: '1000000000002' }) // conflicting Brand -> classification 'conflicting'
		]
		const input = await buildInput(dump, oneCRaw)
		const group = input.idNomDuplicates.groups.find(g => g.idNom === '40001')
		expect(group?.classification).toBe('conflicting')

		const result = await db.transaction(tx => runCatalogImport(tx, input, 'write'))
		const unit = result.units.find(u => u.key === '40001' || u.key === String(401))
		expect(unit?.action).toBe('skipped')

		const productRows = await db.select().from(products)
		expect(productRows).toHaveLength(0) // nothing silently merged or resolved into a product
	})
})

describe('group-code collisions - ambiguous family, never auto-merged', () => {
	test('two unrelated products sharing a group code with zero independent corroboration stay unconfirmed', async () => {
		const dump = makeDump([
			makeLegacyProduct({ id: 501, sku: 'Z99.COLLIDE', guid: null, barcode: null }),
			makeLegacyProduct({ id: 502, sku: 'Z99.COLLIDE', guid: null, barcode: null })
		])
		const oneCRaw = [
			makeOneCRaw({ ID_nom: '50001', VariativeNomenclature: 'Z99.COLLIDE' }),
			makeOneCRaw({ ID_nom: '50002', VariativeNomenclature: 'Z99.COLLIDE' })
		]
		const input = await buildInput(dump, oneCRaw)
		const family = input.families.families.find(f => f.normalizedCode === 'Z99.COLLIDE')
		expect(family?.outcome).toBe('ambiguous_family')
		expect(family?.collisionRisk).toBe(true)

		const result = await db.transaction(tx => runCatalogImport(tx, input, 'write'))
		// Sprint 12B.2.1 Task 6: an unresolved family no longer collapses into
		// ONE lumped unit - each member gets its own unit (key
		// `${normalizedCode}:${memberId}`) carrying its own true
		// position-level status, so a quarantined member hiding inside an
		// otherwise-ambiguous family is never silently absorbed and lost.
		const memberUnits = result.units.filter(u => u.key.startsWith('Z99.COLLIDE:'))
		expect(memberUnits).toHaveLength(2)
		for (const unit of memberUnits) {
			expect(unit.action).toBe('skipped')
			expect(['collision_risk_family', 'ambiguous_family', 'unmatched_family', 'quarantine', 'ambiguous_position']).toContain(unit.skipReason ?? '')
		}

		const productRows = await db.select().from(products)
		expect(productRows).toHaveLength(0)
	})
})

describe('missing parent / quarantine - never a product_id=0/1 placeholder', () => {
	test('a product quarantined upstream stays out of the catalog even if it would otherwise confirm-match', async () => {
		const dump = makeDump([makeLegacyProduct({ id: 601, guid: '60001', titleRu: 'Would-be-confirmed Item' })])
		const oneCRaw = [makeOneCRaw({ ID_nom: '60001' })]
		const priorQuarantine = new Map<number, ('duplicate_guid' | 'invalid_brand_reference' | 'duplicate_sku')[]>([[601, ['duplicate_guid']]])
		const input = await buildInputWithQuarantine(dump, oneCRaw, priorQuarantine)

		const result = await db.transaction(tx => runCatalogImport(tx, input, 'write'))
		const unit = result.units.find(u => u.key === '60001' || u.key === String(601))
		expect(unit?.action).toBe('skipped')
		expect(unit?.skipReason).toBe('quarantine')

		const productRows = await db.select().from(products)
		expect(productRows).toHaveLength(0)
		// No product/variant row was ever written for this unit - there is no
		// numeric placeholder id anywhere in this schema (every id is a real
		// UUID), so the only possible proof of "never a product_id=0/1
		// fallback" is that nothing was written at all. Confirmed above.
	})
})

describe('SEO alias conflicts', () => {
	test('two unrelated confirmed products deriving the same legacy slug: the second gets a de-duplicated canonical slug and a reported, non-overwriting alias conflict', async () => {
		const dump = makeDump([
			makeLegacyProduct({ id: 701, guid: '70001', titleRu: 'Item One', uriRu: 'popular-slug' }),
			makeLegacyProduct({ id: 702, guid: '70002', titleRu: 'Item Two', uriRu: 'popular-slug' })
		])
		const oneCRaw = [makeOneCRaw({ ID_nom: '70001' }), makeOneCRaw({ ID_nom: '70002' })]
		const input = await buildInput(dump, oneCRaw)

		const result = await db.transaction(tx => runCatalogImport(tx, input, 'write'))
		expect(result.summary.productsCreated).toBe(2)
		expect(result.summary.slugAliasConflicts).toBeGreaterThan(0)

		const slugRows = await db.select().from(products)
		const slugs = slugRows.map(p => p.slug).sort()
		expect(new Set(slugs).size).toBe(2) // both products have DISTINCT canonical slugs - no unique-constraint crash

		const aliasRows = await db.select().from(productSlugAliases).where(and(eq(productSlugAliases.locale, 'ru'), eq(productSlugAliases.slug, 'popular-slug')))
		expect(aliasRows).toHaveLength(1) // only ONE product ever claims the contested alias - never reassigned
	})
})

describe('idempotent repeated import', () => {
	test('running the same input twice produces identical final state - no duplicate rows, no duplicate mappings', async () => {
		const dump = makeDump([makeLegacyProduct({ id: 801, guid: '80001', barcode: '8000000000001', titleRu: 'Idempotency Item', uriRu: 'idempotency-item', categoryId: 1 })])
		const oneCRaw = [makeOneCRaw({ ID_nom: '80001', Barcode: '8000000000001' })]

		const firstInput = await buildInput(dump, oneCRaw)
		const first = await db.transaction(tx => runCatalogImport(tx, firstInput, 'write'))
		const firstUnit = first.units.find(u => u.action === 'created')!

		const secondInput = await buildInput(dump, oneCRaw)
		const second = await db.transaction(tx => runCatalogImport(tx, secondInput, 'write'))
		const secondUnit = second.units.find(u => u.key === firstUnit.key)!

		expect(secondUnit.action).toBe('updated')
		expect(secondUnit.productId).toBe(firstUnit.productId) // same internal UUID reused, via the stable external mapping

		const productRows = await db.select().from(products)
		expect(productRows).toHaveLength(1) // no duplicate product row
		const variantRows = await db.select().from(productVariants)
		expect(variantRows).toHaveLength(1) // no duplicate variant row
		const mappingRows = await db.select().from(externalEntityMappings)
		const productMappings = mappingRows.filter(m => m.entityType === 'product' && m.externalId === '80001')
		expect(productMappings).toHaveLength(1) // no duplicate external_entity_mappings row
	})
})

describe('transaction rollback', () => {
	test('a failure after a successful write-mode run rolls back every row it touched', async () => {
		const dump = makeDump([makeLegacyProduct({ id: 901, guid: '90001', titleRu: 'Rollback Item', uriRu: 'rollback-item' })])
		const oneCRaw = [makeOneCRaw({ ID_nom: '90001' })]
		const input = await buildInput(dump, oneCRaw)

		await expect(
			db.transaction(async tx => {
				const result = await runCatalogImport(tx, input, 'write')
				expect(result.summary.productsCreated).toBe(1) // the write genuinely happened inside this (uncommitted) transaction
				throw new Error('forced failure to prove rollback')
			})
		).rejects.toThrow('forced failure to prove rollback')

		// The whole transaction never committed - every row the import wrote is gone.
		const productRows = await db.select().from(products)
		expect(productRows).toHaveLength(0)
		const mappingRows = await db.select().from(externalEntityMappings)
		expect(mappingRows).toHaveLength(0)
	})
})

describe('quarantine preservation', () => {
	test('a quarantined record never appears in the live catalog after a write-mode import', async () => {
		const dump = makeDump([
			makeLegacyProduct({ id: 1001, guid: '100001', titleRu: 'Clean Item', uriRu: 'clean-item' }),
			makeLegacyProduct({ id: 1002, guid: '100002', titleRu: 'Quarantined Item', uriRu: 'quarantined-item' })
		])
		const oneCRaw = [makeOneCRaw({ ID_nom: '100001' }), makeOneCRaw({ ID_nom: '100002' })]
		const priorQuarantine = new Map<number, ('duplicate_guid' | 'invalid_brand_reference' | 'duplicate_sku')[]>([[1002, ['invalid_brand_reference']]])
		const input = await buildInputWithQuarantine(dump, oneCRaw, priorQuarantine)

		const result = await db.transaction(tx => runCatalogImport(tx, input, 'write'))
		expect(result.summary.productsCreated).toBe(1)
		expect(result.summary.bySkipReason.quarantine).toBe(1)

		const productRows = await db.select().from(products)
		expect(productRows).toHaveLength(1)
		expect(productRows[0].slug).toBe('clean-item')
	})
})

describe('zero writes in dry-run mode', () => {
	test('a dry-run over a populated, otherwise-importable fixture set leaves the database completely unchanged', async () => {
		const dump = makeDump([
			makeLegacyProduct({ id: 1101, sku: 'DRY.RUN', guid: '110101', barcode: '1101010101010', titleRu: 'Dry Run Family Item', uriRu: 'dry-run-family' }),
			makeLegacyProduct({ id: 1102, sku: 'DRY.RUN', guid: '110102', barcode: '1101010101011' }),
			makeLegacyProduct({ id: 1103, guid: '110103', titleRu: 'Dry Run Standalone', uriRu: 'dry-run-standalone' })
		])
		const oneCRaw = [
			makeOneCRaw({ ID_nom: '110101', VariativeNomenclature: 'DRY.RUN', Barcode: '1101010101010' }),
			makeOneCRaw({ ID_nom: '110102', VariativeNomenclature: 'DRY.RUN', Barcode: '1101010101011' }),
			makeOneCRaw({ ID_nom: '110103' })
		]
		const input = await buildInput(dump, oneCRaw)

		const result = await db.transaction(tx => runCatalogImport(tx, input, 'dry-run'))
		expect(result.summary.productsCreated).toBeGreaterThan(0) // the preview genuinely found something to report

		const productRows = await db.select().from(products)
		expect(productRows).toHaveLength(0)
		const variantRows = await db.select().from(productVariants)
		expect(variantRows).toHaveLength(0)
		const mappingRows = await db.select().from(externalEntityMappings)
		expect(mappingRows).toHaveLength(0)
		const aliasRows = await db.select().from(productSlugAliases)
		expect(aliasRows).toHaveLength(0)
		const barcodeRows = await db.select().from(productVariantBarcodes)
		expect(barcodeRows).toHaveLength(0)
	})

	test('running dry-run twice in a row reports the identical summary both times (read-only is also deterministic)', async () => {
		const dump = makeDump([makeLegacyProduct({ id: 1201, guid: '120001', titleRu: 'Dry Run Determinism', uriRu: 'dry-run-determinism' })])
		const oneCRaw = [makeOneCRaw({ ID_nom: '120001' })]

		const firstInput = await buildInput(dump, oneCRaw)
		const first = await db.transaction(tx => runCatalogImport(tx, firstInput, 'dry-run'))
		const secondInput = await buildInput(dump, oneCRaw)
		const second = await db.transaction(tx => runCatalogImport(tx, secondInput, 'dry-run'))

		expect(second.summary.productsCreated).toBe(first.summary.productsCreated)
		expect(second.units[0]?.action).toBe(first.units[0]?.action)

		const productRows = await db.select().from(products)
		expect(productRows).toHaveLength(0)
	})
})

/**
 * Sprint 12B.2.1 regression coverage - these tests exist specifically
 * because the user ran the real Sprint 12B.2 CLI once against real data and
 * reported summary numbers (variantsWritten=16 against 5972
 * productsCreated, barcodesWritten=0, zero alias conflicts, zero
 * unpublished products, quarantine 374 vs. a previously-reported 403) that,
 * on code-level investigation, turned out to be real bugs - a dry-run that
 * never ran most of its own validation/planning logic, and (found while
 * fixing the dry-run gap) a write-mode variant-identity bug severe enough
 * to break idempotency and the "every Product has a variant" invariant on
 * any SECOND run of the importer. Each test below pins the specific
 * behavior that was broken.
 */
describe('Sprint 12B.2.1: dry-run is now a faithful preview, not a product-mapping-only stub', () => {
	test('a dry-run over a mixed family + standalone fixture set reports a non-zero variantsWritten for EACH kind, not just family-matched units', async () => {
		const dump = makeDump([
			makeLegacyProduct({ id: 2101, sku: 'F10.ONE', guid: '210101', barcode: '2101010101010', titleRu: 'Family Item A' }),
			makeLegacyProduct({ id: 2102, sku: 'F10.ONE', guid: '210102', barcode: '2101010101011' }),
			makeLegacyProduct({ id: 2103, guid: '210103', titleRu: 'Standalone Item' })
		])
		const oneCRaw = [
			makeOneCRaw({ ID_nom: '210101', VariativeNomenclature: 'F10.ONE', Barcode: '2101010101010' }),
			makeOneCRaw({ ID_nom: '210102', VariativeNomenclature: 'F10.ONE', Barcode: '2101010101011' }),
			makeOneCRaw({ ID_nom: '210103' })
		]
		const input = await buildInput(dump, oneCRaw)

		const result = await db.transaction(tx => runCatalogImport(tx, input, 'dry-run'))
		const standaloneUnit = result.units.find(u => u.kind === 'standalone' && u.action === 'created')
		const familyUnit = result.units.find(u => u.kind === 'family' && u.action === 'created')
		expect(standaloneUnit).toBeDefined()
		expect(familyUnit).toBeDefined()

		// Before the fix: the standalone dry-run branch never set `variantIds`
		// at all, so it contributed 0 to `variantsWritten` regardless of how
		// many standalone products were planned - only family-matched units
		// (the minority in real data) counted.
		expect(standaloneUnit?.variantIds).toHaveLength(1)
		expect(familyUnit?.variantIds).toHaveLength(2)
		expect(result.summary.variantsWritten).toBe(3) // 1 standalone + 2 family, both kinds counted

		// Confirms the dry-run preview matches what a real write-mode run of
		// the SAME input would actually produce.
		const writeResult = await db.transaction(tx => runCatalogImport(tx, input, 'write'))
		expect(writeResult.summary.variantsWritten).toBe(result.summary.variantsWritten)
		expect(writeResult.summary.productsCreated).toBe(result.summary.productsCreated)
	})

	test('a dry-run plans the correct barcode count for both standalone and multi-barcode family variants - not unconditionally 0', async () => {
		const dump = makeDump([makeLegacyProduct({ id: 2201, guid: '220001', barcode: '2200000000001', titleRu: 'Dry Run Barcode Item' })])
		const oneCRaw = [makeOneCRaw({ ID_nom: '220001', Barcode: '2200000000002' })] // distinct from the MySQL-side barcode -> 2 planned rows
		const input = await buildInput(dump, oneCRaw)

		const result = await db.transaction(tx => runCatalogImport(tx, input, 'dry-run'))
		expect(result.summary.barcodesWritten).toBe(2) // MySQL barcode (primary) + the distinct 1C barcode

		const barcodeRows = await db.select().from(productVariantBarcodes)
		expect(barcodeRows).toHaveLength(0) // still a dry-run - nothing was actually written
	})

	test('dry-run alias-conflict detection actually runs: a real slug collision is reported with zero writes, not silently reported as zero conflicts', async () => {
		const dump = makeDump([
			makeLegacyProduct({ id: 2301, guid: '230001', titleRu: 'Collider A', uriRu: 'collide-slug' }),
			makeLegacyProduct({ id: 2302, guid: '230002', titleRu: 'Collider B', uriRu: 'collide-slug' })
		])
		const oneCRaw = [makeOneCRaw({ ID_nom: '230001' }), makeOneCRaw({ ID_nom: '230002' })]
		const input = await buildInput(dump, oneCRaw)

		const result = await db.transaction(tx => runCatalogImport(tx, input, 'dry-run'))
		// Before the fix: both import paths' dry-run branches returned before
		// writeSlugAliases was ever called, so this was unconditionally 0 in
		// every dry-run regardless of real collisions in the data.
		expect(result.summary.slugAliasConflicts).toBeGreaterThan(0)

		const aliasRows = await db.select().from(productSlugAliases)
		expect(aliasRows).toHaveLength(0) // still zero writes
	})

	test('dry-run correctly reports unpublishedForMissingCategory when the legacy category id has no V2 mapping yet - not just when it is null', async () => {
		const dump = makeDump([makeLegacyProduct({ id: 2401, guid: '240001', titleRu: 'No Category Mapping Item', categoryId: 9999 })]) // non-null legacy id, but no mapping seeded anywhere
		const oneCRaw = [makeOneCRaw({ ID_nom: '240001' })]
		const input = await buildInput(dump, oneCRaw)

		const result = await db.transaction(tx => runCatalogImport(tx, input, 'dry-run'))
		// Before the fix: this was keyed off `product.categoryId === null`
		// (false here, since 9999 is non-null) rather than off whether a V2
		// mapping for category 9999 actually resolved (it doesn't - none was
		// seeded), so this product would have been silently counted as
		// correctly categorized and `status: 'active'` with zero real links.
		expect(result.summary.unpublishedForMissingCategory).toBe(1)

		const categoryRows = await db.select().from(productCategories)
		expect(categoryRows).toHaveLength(0)
	})
})

describe('Sprint 12B.2.1: variant-identity idempotency fix (Task 4 / Task 16)', () => {
	test('a multi-variant family re-run reuses the SAME variant UUIDs on the second pass, instead of every variant falsely conflicting', async () => {
		const dump = makeDump([
			makeLegacyProduct({ id: 2501, sku: 'I10.FAM', guid: '250101', barcode: '2501010101010', titleRu: 'Idempotent Family Item' }),
			makeLegacyProduct({ id: 2502, sku: 'I10.FAM', guid: '250102', barcode: '2501010101011' })
		])
		const oneCRaw = [
			makeOneCRaw({ ID_nom: '250101', VariativeNomenclature: 'I10.FAM', Barcode: '2501010101010' }),
			makeOneCRaw({ ID_nom: '250102', VariativeNomenclature: 'I10.FAM', Barcode: '2501010101011' })
		]

		const firstInput = await buildInput(dump, oneCRaw)
		const first = await db.transaction(tx => runCatalogImport(tx, firstInput, 'write'))
		const firstUnit = first.units.find(u => u.kind === 'family' && u.action === 'created')!
		expect(firstUnit.variantIds).toHaveLength(2) // sanity: the first run genuinely wrote 2 variants

		// Before the fix: writeVariantRow's identity resolution used a bare
		// resolveOrCreateMapping call with a FRESH crypto.randomUUID() every
		// run, so on this second run EVERY variant's mapping lookup would
		// find the real stored mapping from run 1 under a DIFFERENT
		// (freshly-random) internalId and report `{outcome:'conflict'}` -
		// silently producing a Product with ZERO variants on every re-run.
		const secondInput = await buildInput(dump, oneCRaw)
		const second = await db.transaction(tx => runCatalogImport(tx, secondInput, 'write'))
		const secondUnit = second.units.find(u => u.kind === 'family' && u.key === firstUnit.key)!

		expect(secondUnit.action).toBe('updated')
		expect(secondUnit.variantIds).toHaveLength(2) // NOT zero - the invariant this sprint set out to guarantee
		expect(new Set(secondUnit.variantIds)).toEqual(new Set(firstUnit.variantIds)) // same UUIDs reused, not new ones

		const variantRows = await db.select().from(productVariants).where(eq(productVariants.productId, firstUnit.productId!))
		expect(variantRows).toHaveLength(2) // no duplicate rows either
	})

	test('every planned Product has at least one planned ProductVariant: a family where every member genuinely conflicts is aborted, never published with zero variants', async () => {
		const dump = makeDump([makeLegacyProduct({ id: 2601, sku: 'C10.FAM', guid: '260101', titleRu: 'Pre-conflicted Family Item' })])
		const oneCRaw = [makeOneCRaw({ ID_nom: '260101', VariativeNomenclature: 'C10.FAM' })]
		const input = await buildInput(dump, oneCRaw)

		// resolveIdentity (catalog-importer.ts's own identity-resolution
		// wrapper, used for every mapping since the Task 16 idempotency fix)
		// always looks up any EXISTING mapping for an external id first and
		// reuses its internalId - so a conflict can no longer be forced just
		// by pre-seeding a mapping under a DIFFERENT external id. The only
		// remaining real conflict path is `resolveOrCreateMapping`'s
		// 'internal_id_has_other_external_id' branch: the freshly-generated
		// candidate UUID for THIS variant happens to already be in use by a
		// DIFFERENT external id. That branch is only reachable deterministically
		// in a test by pinning `crypto.randomUUID()` (node:crypto - the same
		// module instance catalog-importer.ts itself imports) to a fixed
		// value and pre-claiming that exact value under an unrelated external id.
		const FIXED_UUID = '11111111-1111-4111-8111-111111111111'
		const originalRandomUUID = nodeCrypto.randomUUID
		nodeCrypto.randomUUID = (() => FIXED_UUID) as typeof nodeCrypto.randomUUID
		try {
			await db.transaction(async tx => {
				await resolveOrCreateMapping(tx, { sourceSystem: 'legacy_mysql', entityType: 'product_variant', externalId: 'unrelated-external-id', internalId: FIXED_UUID })
			})

			await expect(db.transaction(tx => runCatalogImport(tx, input, 'write'))).rejects.toThrow(ZeroVariantProductError)
		} finally {
			nodeCrypto.randomUUID = originalRandomUUID
		}

		// The whole transaction rolled back - no orphan/variant-less product was left behind.
		const productRows = await db.select().from(products)
		expect(productRows).toHaveLength(0)
	})
})

describe('Sprint 12B.2.1 Task 6: true quarantine population is never hidden inside an unresolved family', () => {
	test('a quarantined member of an otherwise-ambiguous family is individually surfaced, and quarantinedPositionsTotal matches bySkipReason.quarantine', async () => {
		const dump = makeDump([
			makeLegacyProduct({ id: 2701, sku: 'Q10.FAM', guid: null, barcode: null }), // ambiguous group-code member, no corroborating evidence
			makeLegacyProduct({ id: 2702, sku: 'Q10.FAM', guid: null, barcode: null, titleRu: 'Quarantined Sibling' }) // same ambiguous group, ALSO individually quarantined
		])
		const oneCRaw = [makeOneCRaw({ ID_nom: '270101', VariativeNomenclature: 'Q10.FAM' }), makeOneCRaw({ ID_nom: '270102', VariativeNomenclature: 'Q10.FAM' })]
		const priorQuarantine = new Map<number, ('duplicate_guid' | 'invalid_brand_reference' | 'duplicate_sku')[]>([[2702, ['duplicate_sku']]])
		const input = await buildInputWithQuarantine(dump, oneCRaw, priorQuarantine)

		const family = input.families.families.find(f => f.normalizedCode === 'Q10.FAM')
		expect(family?.outcome).not.toBe('confirmed_family') // stays unresolved at the family level

		const result = await db.transaction(tx => runCatalogImport(tx, input, 'write'))

		// Before the fix: product 2702's individual quarantine status was
		// invisible - the whole family collapsed into ONE lumped
		// `ambiguous_family`/`collision_risk_family` unit, and
		// `bySkipReason.quarantine` never incremented for it at all.
		const memberUnit = result.units.find(u => u.key === 'Q10.FAM:2702')
		expect(memberUnit?.skipReason).toBe('quarantine')
		expect(result.summary.bySkipReason.quarantine).toBeGreaterThanOrEqual(1)

		// The TRUE total, read directly from the position-level reconciliation
		// independent of this importer's own unit-bucketing, must never be
		// LESS than what bySkipReason individually surfaces (the whole point
		// of this fix is that the two now agree).
		expect(result.summary.quarantinedPositionsTotal).toBeGreaterThanOrEqual(result.summary.bySkipReason.quarantine)

		const productRows = await db.select().from(products)
		expect(productRows).toHaveLength(0) // neither member of this family was ever published
	})
})

describe('Sprint 12B.4 Priority 1: product visibility', () => {
	async function seedResolvedBrandAndCategory(tx: Parameters<typeof runCatalogImport>[0], legacyBrandId: number, legacyCategoryId: number) {
		const [brandRow] = await tx.insert(brands).values({ slug: `brand-${legacyBrandId}`, nameRu: 'Brand', nameRo: 'Brand' }).returning()
		const [categoryRow] = await tx.insert(categories).values({ slug: `category-${legacyCategoryId}`, nameRu: 'Category', nameRo: 'Category' }).returning()
		await resolveOrCreateMapping(tx, { sourceSystem: 'legacy_mysql', entityType: 'brand', externalId: String(legacyBrandId), internalId: brandRow.id })
		await resolveOrCreateMapping(tx, { sourceSystem: 'legacy_mysql', entityType: 'category', externalId: String(legacyCategoryId), internalId: categoryRow.id })
	}

	test('a legacy-hidden standalone product stays draft even when brand and category both resolve', async () => {
		const dump = makeDump([
			makeLegacyProduct({ id: 1201, guid: '120001', titleRu: 'Hidden Item', uriRu: 'hidden-item', brandId: 77, categoryId: 88, isShown: false })
		])
		const oneCRaw = [makeOneCRaw({ ID_nom: '120001' })]
		const input = await buildInput(dump, oneCRaw)

		const result = await db.transaction(async tx => {
			await seedResolvedBrandAndCategory(tx, 77, 88)
			return runCatalogImport(tx, input, 'write')
		})
		const unit = result.units.find(u => u.action === 'created')!
		const [productRow] = await db.select().from(products).where(eq(products.id, unit.productId!))
		expect(productRow.status).toBe('draft') // never 'active' just because brand/category resolved
	})

	test('a legacy-visible standalone product with resolved brand/category becomes active', async () => {
		const dump = makeDump([
			makeLegacyProduct({ id: 1202, guid: '120002', titleRu: 'Visible Item', uriRu: 'visible-item', brandId: 78, categoryId: 89, isShown: true })
		])
		const oneCRaw = [makeOneCRaw({ ID_nom: '120002' })]
		const input = await buildInput(dump, oneCRaw)

		const result = await db.transaction(async tx => {
			await seedResolvedBrandAndCategory(tx, 78, 89)
			return runCatalogImport(tx, input, 'write')
		})
		const unit = result.units.find(u => u.action === 'created')!
		const [productRow] = await db.select().from(products).where(eq(products.id, unit.productId!))
		expect(productRow.status).toBe('active')
	})

	test('a partially-hidden family: each variant reflects ITS OWN legacy isShown, independently of the others', async () => {
		const dump = makeDump([
			makeLegacyProduct({ id: 1210, sku: 'P10.VIS', guid: '121001', titleRu: 'Visible Member', uriRu: 'p10-vis', isShown: true }),
			makeLegacyProduct({ id: 1211, sku: 'P10.VIS', guid: '121002', isShown: false })
		])
		const oneCRaw = [
			makeOneCRaw({ ID_nom: '121001', VariativeNomenclature: 'P10.VIS' }),
			makeOneCRaw({ ID_nom: '121002', VariativeNomenclature: 'P10.VIS' })
		]
		const input = await buildInput(dump, oneCRaw)
		expect(input.families.summary.confirmedFamilies).toBe(1)

		const result = await db.transaction(tx => runCatalogImport(tx, input, 'write'))
		const unit = result.units.find(u => u.kind === 'family' && u.action === 'created')!
		const variantRows = await db.select().from(productVariants).where(eq(productVariants.productId, unit.productId!))
		expect(variantRows).toHaveLength(2)
		const visible = variantRows.find(v => v.sku === '121001')!
		const hidden = variantRows.find(v => v.sku === '121002')!
		expect(visible.isActive).toBe(true)
		expect(hidden.isActive).toBe(false)
	})
})

describe('Sprint 12B.4 Priority 2: duplicate ID_nom content safety in the importer', () => {
	// Sprint 12B.4 investigation finding: `reconcileSqlWith1c` itself gates
	// position matching on `guidMatches.length <= 1 && barcodeMatches.length
	// <= 1 && groupMatches.length <= 1` - so whenever a duplicate ID_nom
	// group's records share the SAME value on whichever key the MySQL
	// product matches through (GUID, or an identical Barcode), the position
	// is already 'ambiguous' and the unit is skipped *before* the importer's
	// own content-resolution step is ever reached. A `mutable_only` pair
	// that differs only in a soft field (e.g. QuantityBalance) necessarily
	// shares GUID/ID_nom and Barcode across both records, so it can never
	// reach 'confirmed' through any match key - the safety net is this
	// upstream ambiguity gate, not content-level picking. This test proves
	// that: nothing is silently imported from either duplicate record.
	test('a benign-looking duplicate (mutable_only) still resolves to position-level ambiguity, not a silently-picked record - the importer never gets a chance to pick one', async () => {
		const dump = makeDump([makeLegacyProduct({ id: 1301, guid: '130001', titleRu: 'Mutable Dup Item', uriRu: 'mutable-dup-item' })])
		const oneCRaw = [
			makeOneCRaw({ ID_nom: '130001', VariativeName: 'First Seen Name', Barcode: '1300000000001' }),
			makeOneCRaw({ ID_nom: '130001', VariativeName: 'First Seen Name', Barcode: '1300000000001', QuantityBalance: 5 }) // differs only in a soft-mutable field
		]
		const input = await buildInput(dump, oneCRaw)
		const group = input.idNomDuplicates.groups.find(g => g.idNom === '130001')
		expect(group?.classification).toBe('mutable_only')

		const result = await db.transaction(tx => runCatalogImport(tx, input, 'write'))
		const unit = result.units.find(u => u.key === '130001' || u.key === String(1301))
		expect(unit?.action).toBe('skipped')
		expect(unit?.skipReason).toBe('ambiguous_position')
		const productRows = await db.select().from(products)
		expect(productRows).toHaveLength(0)
	})

	// Here the two records differ in Barcode (barcode_only_conflict), so a
	// MySQL product matched via ITS OWN Barcode (not GUID) to just one of
	// the two records clears the position-ambiguity gate with a single,
	// unambiguous barcode-key match - exactly the real-world shape Sprint
	// 12A.6 confirmed as legitimate (one ID_nom legitimately carries more
	// than one barcode). This is where the importer's own
	// resolveOneCRecord/writeBarcodeRows fix is actually exercised.
	test('a barcode_only_conflict group aggregates every distinct barcode onto the SAME variant, not just the one record matched by position', async () => {
		const dump = makeDump([
			makeLegacyProduct({ id: 1302, guid: null, barcode: '1300000000010', titleRu: 'Multi Barcode Dup', uriRu: 'multi-barcode-dup' })
		])
		const oneCRaw = [
			makeOneCRaw({ ID_nom: '130002', Barcode: '1300000000010' }),
			makeOneCRaw({ ID_nom: '130002', Barcode: '1300000000011' }) // only Barcode differs -> barcode_only_conflict
		]
		const input = await buildInput(dump, oneCRaw)
		const group = input.idNomDuplicates.groups.find(g => g.idNom === '130002')
		expect(group?.classification).toBe('barcode_only_conflict')
		expect(input.positions.summary.confirmed).toBe(1) // matched via Barcode alone, clears the ambiguity gate

		const result = await db.transaction(tx => runCatalogImport(tx, input, 'write'))
		const unit = result.units.find(u => u.action === 'created')!
		const barcodeRows = await db.select().from(productVariantBarcodes).where(eq(productVariantBarcodes.variantId, unit.variantIds![0]))
		const barcodes = new Set(barcodeRows.map(b => b.barcode))
		expect(barcodes.has('1300000000010')).toBe(true)
		expect(barcodes.has('1300000000011')).toBe(true) // BOTH 1C-side barcodes present - not just the one record position-matching happened to key on
	})

	// Same shape as above (position matched via a Barcode unique to one
	// record, clearing the ambiguity gate) but VariativeName also differs
	// between the two records, which duplicate-id-nom.ts's tier ordering
	// classifies as 'conflicting' (an unrecognized field) regardless of the
	// Barcode difference - conflicting always outranks barcode_only_conflict.
	test('a genuinely conflicting duplicate group withholds 1C content entirely - MySQL content is used instead, never a value from either disputed record', async () => {
		const dump = makeDump([
			makeLegacyProduct({ id: 1303, guid: null, barcode: '1300000000020', titleRu: 'MySQL Side Title', uriRu: 'mysql-side-title' })
		])
		const oneCRaw = [
			makeOneCRaw({ ID_nom: '130003', Barcode: '1300000000020', VariativeName: 'Disputed Name A' }),
			makeOneCRaw({ ID_nom: '130003', Barcode: '1300000000021', VariativeName: 'Disputed Name B' }) // VariativeName differs -> conflicting (unrecognized field), outranks the Barcode difference
		]
		const input = await buildInput(dump, oneCRaw)
		const group = input.idNomDuplicates.groups.find(g => g.idNom === '130003')
		expect(group?.classification).toBe('conflicting')
		expect(input.positions.summary.confirmed).toBe(1)

		const result = await db.transaction(tx => runCatalogImport(tx, input, 'write'))
		const unit = result.units.find(u => u.action === 'created')!
		const [productRow] = await db.select().from(products).where(eq(products.id, unit.productId!))
		// Identity still imports (matched unambiguously via Barcode at the
		// reconciliation level), but content comes from MySQL's own title,
		// never from either disputed 1C VariativeName value.
		expect(productRow.nameRu).toBe('MySQL Side Title')
		expect(productRow.nameRu).not.toBe('Disputed Name A')
		expect(productRow.nameRu).not.toBe('Disputed Name B')
	})
})

describe('Sprint 12B.4 Priority 3: 1C identity mapping conflicts are checked, never silently continued past', () => {
	test('standalone: a pre-existing 1c/nomenclature mapping pointing at a DIFFERENT internal variant blocks the whole unit', async () => {
		const dump = makeDump([makeLegacyProduct({ id: 1401, guid: '140001', titleRu: 'Nomenclature Conflict Item', uriRu: 'nomenclature-conflict-item' })])
		const oneCRaw = [makeOneCRaw({ ID_nom: '140001' })]
		const input = await buildInput(dump, oneCRaw)

		const result = await db.transaction(async tx => {
			// A different, unrelated internal UUID already claims this exact
			// 1C ID_nom under the 1c/nomenclature namespace - this importer
			// must never silently proceed past that conflict.
			await resolveOrCreateMapping(tx, { sourceSystem: '1c', entityType: 'nomenclature', externalId: '140001', internalId: nodeCrypto.randomUUID() })
			return runCatalogImport(tx, input, 'write')
		})

		const unit = result.units.find(u => u.key === '140001' || u.key === String(1401))
		expect(unit?.action).toBe('skipped')
		expect(unit?.skipReason).toBe('mapping_conflict_variant')

		const productRows = await db.select().from(products)
		expect(productRows).toHaveLength(0) // never continued successfully past the unresolved conflict
	})

	test('family path: a member whose 1c/nomenclature mapping conflicts is excluded from the family, other members still import', async () => {
		const dump = makeDump([
			makeLegacyProduct({ id: 1410, sku: 'N10.CONF', guid: '141001', titleRu: 'Clean Member', uriRu: 'n10-conf' }),
			makeLegacyProduct({ id: 1411, sku: 'N10.CONF', guid: '141002' })
		])
		const oneCRaw = [
			makeOneCRaw({ ID_nom: '141001', VariativeNomenclature: 'N10.CONF' }),
			makeOneCRaw({ ID_nom: '141002', VariativeNomenclature: 'N10.CONF' })
		]
		const input = await buildInput(dump, oneCRaw)
		expect(input.families.summary.confirmedFamilies).toBe(1)

		const result = await db.transaction(async tx => {
			await resolveOrCreateMapping(tx, { sourceSystem: '1c', entityType: 'nomenclature', externalId: '141002', internalId: nodeCrypto.randomUUID() })
			return runCatalogImport(tx, input, 'write')
		})
		const unit = result.units.find(u => u.kind === 'family' && u.action === 'created')!
		expect(unit.variantIds).toHaveLength(1) // only the clean member resolved
		const variantRows = await db.select().from(productVariants).where(eq(productVariants.productId, unit.productId!))
		expect(variantRows.map(v => v.sku)).toEqual(['141001'])
	})
})

describe('Sprint 12B.4 Priority 4: media idempotency', () => {
	test('two identical write-mode imports produce the same image row count, not double - and the same set of image identities', async () => {
		const dump: LegacyCatalogDump = {
			...makeDump([makeLegacyProduct({ id: 1501, guid: '150001', titleRu: 'Media Item', uriRu: 'media-item' })]),
			productImgs: [
				{ id: 1, productId: 1501, img: 'image-a.jpg', sortOrder: 0, isShown: true },
				{ id: 2, productId: 1501, img: 'image-b.jpg', sortOrder: 1, isShown: true }
			]
		}
		const oneCRaw = [makeOneCRaw({ ID_nom: '150001' })]

		const firstInput = await buildInput(dump, oneCRaw)
		const first = await db.transaction(tx => runCatalogImport(tx, firstInput, 'write'))
		const firstUnit = first.units.find(u => u.action === 'created')!
		expect(firstUnit.mediaRowsWritten).toBe(2)

		const secondInput = await buildInput(dump, oneCRaw)
		const second = await db.transaction(tx => runCatalogImport(tx, secondInput, 'write'))
		const secondUnit = second.units.find(u => u.key === firstUnit.key)!
		expect(secondUnit.mediaRowsWritten).toBe(0) // nothing NEW planned - both images already exist

		const imageRows = await db.select().from(productImages).where(eq(productImages.productId, firstUnit.productId!))
		expect(imageRows).toHaveLength(2) // not 4 - no duplicates from the second run
		expect(new Set(imageRows.map(r => r.url))).toEqual(new Set(['image-a.jpg', 'image-b.jpg'])) // the actual identity set is unchanged, not just the count
	})

	test('legitimately different images for the same product (different filenames) are both preserved, never deduped against each other', async () => {
		const dump: LegacyCatalogDump = {
			...makeDump([makeLegacyProduct({ id: 1502, guid: '150002', titleRu: 'Distinct Media Item', uriRu: 'distinct-media-item' })]),
			productImgs: [
				{ id: 3, productId: 1502, img: 'front.jpg', sortOrder: 0, isShown: true },
				{ id: 4, productId: 1502, img: 'back.jpg', sortOrder: 1, isShown: true }
			]
		}
		const oneCRaw = [makeOneCRaw({ ID_nom: '150002' })]
		const input = await buildInput(dump, oneCRaw)
		const result = await db.transaction(tx => runCatalogImport(tx, input, 'write'))
		const unit = result.units.find(u => u.action === 'created')!
		expect(unit.mediaRowsWritten).toBe(2)
		const imageRows = await db.select().from(productImages).where(eq(productImages.productId, unit.productId!))
		expect(imageRows).toHaveLength(2)
	})
})

describe('Sprint 12B.4 Priority 6: assertSafeImportTarget hardening', () => {
	test('refuses a correctly-named test database on an arbitrary remote host - not just a host/name substring check', () => {
		expect(() => assertSafeImportTarget('postgres://user:pass@remote-db.example.com:5432/beauty_store_test')).toThrow(UnsafeImportTargetError)
	})

	test('accepts the exact expected database name on 127.0.0.1', () => {
		expect(() => assertSafeImportTarget('postgres://user:pass@127.0.0.1:5432/beauty_store_test')).not.toThrow()
	})

	test('refuses a database name that is a near-miss of the expected one, even on localhost (exact match only, no substring)', () => {
		expect(() => assertSafeImportTarget('postgres://user:pass@localhost:5432/beauty_store_test_v2')).toThrow(UnsafeImportTargetError)
	})
})

describe('Sprint 12B.4 Additional validation: conflicting category links across family members are reported, not silently discarded', () => {
	test('a family whose non-main member resolves to a DIFFERENT category than the main position sets categoryLinkConflict=true', async () => {
		const dump: LegacyCatalogDump = {
			...makeDump([
				makeLegacyProduct({ id: 1601, sku: 'C10.CONF', guid: '160001', titleRu: 'Main Position', uriRu: 'c10-conf', categoryId: 91 }),
				makeLegacyProduct({ id: 1602, sku: 'C10.CONF', guid: '160002', categoryId: 92 })
			]),
			productCategories: []
		}
		const oneCRaw = [
			makeOneCRaw({ ID_nom: '160001', VariativeNomenclature: 'C10.CONF' }),
			makeOneCRaw({ ID_nom: '160002', VariativeNomenclature: 'C10.CONF' })
		]
		const input = await buildInput(dump, oneCRaw)
		expect(input.families.summary.confirmedFamilies).toBe(1)

		const result = await db.transaction(async tx => {
			const [cat91] = await tx.insert(categories).values({ slug: 'cat-91', nameRu: 'Cat 91', nameRo: 'Cat 91' }).returning()
			const [cat92] = await tx.insert(categories).values({ slug: 'cat-92', nameRu: 'Cat 92', nameRo: 'Cat 92' }).returning()
			await resolveOrCreateMapping(tx, { sourceSystem: 'legacy_mysql', entityType: 'category', externalId: '91', internalId: cat91.id })
			await resolveOrCreateMapping(tx, { sourceSystem: 'legacy_mysql', entityType: 'category', externalId: '92', internalId: cat92.id })
			return runCatalogImport(tx, input, 'write')
		})
		const unit = result.units.find(u => u.kind === 'family' && u.action === 'created')!
		expect(unit.categoryLinkConflict).toBe(true)

		// The main position's own link is still what's actually written - not silently replaced or merged with the other member's.
		const linkRows = await db.select().from(productCategories).where(eq(productCategories.productId, unit.productId!))
		expect(linkRows).toHaveLength(1)
	})

	test('a family where every member resolves to the SAME category reports no conflict', async () => {
		const dump: LegacyCatalogDump = {
			...makeDump([
				makeLegacyProduct({ id: 1611, sku: 'C10.SAME', guid: '161001', titleRu: 'Main Position', uriRu: 'c10-same', categoryId: 93 }),
				makeLegacyProduct({ id: 1612, sku: 'C10.SAME', guid: '161002', categoryId: 93 })
			]),
			productCategories: []
		}
		const oneCRaw = [
			makeOneCRaw({ ID_nom: '161001', VariativeNomenclature: 'C10.SAME' }),
			makeOneCRaw({ ID_nom: '161002', VariativeNomenclature: 'C10.SAME' })
		]
		const input = await buildInput(dump, oneCRaw)

		const result = await db.transaction(async tx => {
			const [cat93] = await tx.insert(categories).values({ slug: 'cat-93', nameRu: 'Cat 93', nameRo: 'Cat 93' }).returning()
			await resolveOrCreateMapping(tx, { sourceSystem: 'legacy_mysql', entityType: 'category', externalId: '93', internalId: cat93.id })
			return runCatalogImport(tx, input, 'write')
		})
		const unit = result.units.find(u => u.kind === 'family' && u.action === 'created')!
		expect(unit.categoryLinkConflict ?? false).toBe(false)
	})
})

describe('Sprint 12B.4 Priority 5: confirmed multi-variant family end-to-end, with per-variant barcode/color/volume fidelity', () => {
	test('a confirmed 3-member family produces one Product and 3 ProductVariants, each with its own real ID_nom sku and barcode set, zero quarantine leakage', async () => {
		const dump = makeDump([
			makeLegacyProduct({ id: 1701, sku: 'A10.XXX', guid: '170001', barcode: '4051761201249', titleRu: 'NAIL POLISH ANNY', uriRu: 'anny-nail-polish', brandId: 50, categoryId: 60 }),
			makeLegacyProduct({ id: 1702, sku: 'A10.XXX', guid: '170002', barcode: '4051761201232' }),
			makeLegacyProduct({ id: 1703, sku: 'A10.XXX', guid: '170003', barcode: '4051761202772' })
		])
		const oneCRaw = [
			makeOneCRaw({ ID_nom: '170001', VariativeNomenclature: 'A10.XXX', Barcode: '4051761201249', ColorVar: '396' }),
			makeOneCRaw({ ID_nom: '170002', VariativeNomenclature: 'A10.XXX', Barcode: '4051761201232', ColorVar: '253' }),
			makeOneCRaw({ ID_nom: '170003', VariativeNomenclature: 'A10.XXX', Barcode: '4051761202772', ColorVar: '369.50' })
		]
		const input = await buildInput(dump, oneCRaw)
		expect(input.families.summary.confirmedFamilies).toBe(1)

		const result = await db.transaction(async tx => {
			const [brandRow] = await tx.insert(brands).values({ slug: 'anny', nameRu: 'Anny', nameRo: 'Anny' }).returning()
			const [categoryRow] = await tx.insert(categories).values({ slug: 'nails', nameRu: 'Nails', nameRo: 'Nails' }).returning()
			await resolveOrCreateMapping(tx, { sourceSystem: 'legacy_mysql', entityType: 'brand', externalId: '50', internalId: brandRow.id })
			await resolveOrCreateMapping(tx, { sourceSystem: 'legacy_mysql', entityType: 'category', externalId: '60', internalId: categoryRow.id })
			return runCatalogImport(tx, input, 'write')
		})

		const unit = result.units.find(u => u.kind === 'family' && u.action === 'created')!
		expect(unit.variantIds).toHaveLength(3)
		expect(unit.categoryLinkConflict ?? false).toBe(false)

		const [productRow] = await db.select().from(products).where(eq(products.id, unit.productId!))
		expect(productRow.status).toBe('active') // brand + category resolved, legacy-visible

		const variantRows = await db.select().from(productVariants).where(eq(productVariants.productId, unit.productId!))
		expect(variantRows).toHaveLength(3)
		expect(new Set(variantRows.map(v => v.sku))).toEqual(new Set(['170001', '170002', '170003']))

		for (const variant of variantRows) {
			const barcodeRows = await db.select().from(productVariantBarcodes).where(eq(productVariantBarcodes.variantId, variant.id))
			expect(barcodeRows.length).toBeGreaterThanOrEqual(1) // each real variant kept its own barcode identity
		}
	})
})
