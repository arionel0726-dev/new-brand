import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test } from 'bun:test'
import { db } from '../src/db/client'
import { products } from '../src/db/schema/products'
import { productVariants } from '../src/db/schema/product-variants'
import { productImages } from '../src/db/schema/product-images'
import { runCatalogImport, type CatalogImportInput } from '../src/import/catalog-importer'
import { resolveOrCreateMapping } from '../src/import/mappings'
import type { LegacyCatalogDump, LegacyProduct, LegacyProductVariable, LegacyProductVariableImg } from '../src/import/parsers/mysql-catalog'
import { parseProductsFeed, type ProductsFeedRecord } from '../src/import/parsers/products-feed'
import { classifyIdNomDuplicates } from '../src/import/reconcile/duplicate-id-nom'
import { reconcileFamilies } from '../src/import/reconcile/family-reconciliation'
import { reconcileLegacyVariantFamilies } from '../src/import/reconcile/legacy-variant-family-reconciliation'
import { reconcileSqlWith1c } from '../src/import/reconcile/sql-1c-reconciliation'
import { resetDatabase } from './helpers'

/**
 * Sprint 12B.5 - "Legacy-Confirmed Variant Family Reconstruction".
 *
 * Every fixture here is 100% synthetic (no real legacy ids, SKUs, GUIDs,
 * barcodes, or 1C ID_noms - the standing discipline across every Sprint 12
 * module). Legacy product 2579 (14 real color variants) is reproduced
 * structurally with an unmistakably-synthetic id (999001) and synthetic
 * values throughout, per the directive's "never use real legacy ids in
 * synthetic fixtures" rule - only the SHAPE (one parent, 14 products_variable
 * rows differing by color) is real-world-derived.
 *
 * `ID_nom`/SKU values here are all-digit strings (not the word-shaped codes
 * used in some other sprints' examples) because `externalIdSchema`
 * (parsers/shared.ts) rejects any non-numeric external id outright - a
 * SKU/ID_nom that doesn't satisfy `/^\d+$/` is dropped during
 * `parseProductsFeed`, never reaching `validRecords` at all.
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

function makeVariableImg(overrides: Partial<LegacyProductVariableImg> & { id: number; productId: number; variableId: number }): LegacyProductVariableImg {
	return { img: null, sortOrder: null, isShown: true, ...overrides }
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

describe('reconcileLegacyVariantFamilies (unit)', () => {
	test('confirmed parent with 2+ variants: every products_variable row independently matches a distinct 1C ID_nom', () => {
		const parent = makeLegacyProduct({ id: 701, titleRu: 'Lipstick Family' })
		const v1 = makeVariable({ id: 9001, productId: 701, sku: '700101', colorRu: 'Красный' })
		const v2 = makeVariable({ id: 9002, productId: 701, sku: '700102', colorRu: 'Розовый' })
		const dump = makeDump({ products: [parent], productVariables: [v1, v2] })
		const oneC = parseOneC([makeOneCRaw({ ID_nom: '700101' }), makeOneCRaw({ ID_nom: '700102' })])

		const result = reconcileLegacyVariantFamilies(dump, oneC)
		expect(result.families).toHaveLength(1)
		expect(result.families[0].classification).toBe('confirmed')
		expect(result.families[0].confirmedMembers).toHaveLength(2)
		expect(result.summary.confirmedFamilies).toBe(1)
		expect(result.summary.totalConfirmedVariants).toBe(2)
	})

	test('confirmed mixed-color family: differing colorRu/colorHex/volumeVar preserved as independent variant identities, not grouping keys', () => {
		const parent = makeLegacyProduct({ id: 702 })
		const variables = [
			makeVariable({ id: 9101, productId: 702, sku: '702101', colorRu: 'Красный', colorHex: '#FF0000', volumeVar: '50ml' }),
			makeVariable({ id: 9102, productId: 702, sku: '702102', colorRu: 'Синий', colorHex: '#0000FF', volumeVar: '100ml' }),
			makeVariable({ id: 9103, productId: 702, sku: '702103', colorRu: 'Зелёный', colorHex: '#00FF00', volumeVar: '50ml' })
		]
		const dump = makeDump({ products: [parent], productVariables: variables })
		const oneC = parseOneC(variables.map(v => makeOneCRaw({ ID_nom: v.sku! })))

		const result = reconcileLegacyVariantFamilies(dump, oneC)
		expect(result.families[0].classification).toBe('confirmed')
		const colors = result.families[0].confirmedMembers.map(m => m.colorRu).sort()
		expect(colors).toEqual(['Зелёный', 'Красный', 'Синий'])
		const volumes = new Set(result.families[0].confirmedMembers.map(m => m.volumeVar))
		expect(volumes).toEqual(new Set(['50ml', '100ml']))
	})

	test('barcode-only duplicate ID_nom: a variable with no SKU but a unique barcode still confirms via barcode evidence alone', () => {
		const parent = makeLegacyProduct({ id: 703 })
		const v1 = makeVariable({ id: 9201, productId: 703, sku: '703101' })
		const v2 = makeVariable({ id: 9202, productId: 703, sku: null, barcode: '4600000000001' })
		const dump = makeDump({ products: [parent], productVariables: [v1, v2] })
		const oneC = parseOneC([makeOneCRaw({ ID_nom: '703101' }), makeOneCRaw({ ID_nom: '703102', Barcode: '4600000000001' })])

		const result = reconcileLegacyVariantFamilies(dump, oneC)
		expect(result.families[0].classification).toBe('confirmed')
		const member = result.families[0].confirmedMembers.find(m => m.variableId === 9202)!
		expect(member.idNom).toBe('703102')
		expect(member.basis).toContain('barcode')
	})

	test('ambiguous variant identity: a variable whose SKU/barcode point at two distinct 1C ID_noms never joins the reconstructed family, leaving fewer than 2 confirmed', () => {
		const parent = makeLegacyProduct({ id: 704 })
		const v1 = makeVariable({ id: 9301, productId: 704, sku: '704199', barcode: '4600000000111' })
		const v2 = makeVariable({ id: 9302, productId: 704, sku: '704102' })
		const dump = makeDump({ products: [parent], productVariables: [v1, v2] })
		// v1's SKU points at ID_nom 704199, but its barcode ALSO matches a
		// second, distinct ID_nom (704199b-equivalent) - two different
		// candidates for the same variable row, exactly the shape
		// `matchLegacyVariants` classifies as 'ambiguous'.
		const oneC = parseOneC([
			makeOneCRaw({ ID_nom: '704199', Barcode: '4600000000111' }),
			makeOneCRaw({ ID_nom: '704198', Barcode: '4600000000111' }),
			makeOneCRaw({ ID_nom: '704102' })
		])

		const result = reconcileLegacyVariantFamilies(dump, oneC)
		// Only v2 ends up independently confirmed - not enough (need 2+) to
		// reconstruct a family, so nothing is reported here (left for the
		// existing standalone path to handle v2 on its own; v1 stays
		// ambiguous, never guessed).
		expect(result.families).toHaveLength(0)
		expect(result.summary.insufficientEvidenceParents).toBe(1)
	})

	test('parent with hidden variants: a variable with isShown=false is still independently confirmed and carries its own visibility through', () => {
		const parent = makeLegacyProduct({ id: 705, isShown: true })
		const v1 = makeVariable({ id: 9401, productId: 705, sku: '705101', isShown: true })
		const v2 = makeVariable({ id: 9402, productId: 705, sku: '705102', isShown: false })
		const dump = makeDump({ products: [parent], productVariables: [v1, v2] })
		const oneC = parseOneC([makeOneCRaw({ ID_nom: '705101' }), makeOneCRaw({ ID_nom: '705102' })])

		const result = reconcileLegacyVariantFamilies(dump, oneC)
		expect(result.families[0].classification).toBe('confirmed')
		const hidden = result.families[0].confirmedMembers.find(m => m.variableId === 9402)!
		expect(hidden.isShown).toBe(false)
		const shown = result.families[0].confirmedMembers.find(m => m.variableId === 9401)!
		expect(shown.isShown).toBe(true)
	})

	test('parent already quarantined: the reconstructed family is classified "quarantined", never silently written', () => {
		const parent = makeLegacyProduct({ id: 706 })
		const v1 = makeVariable({ id: 9501, productId: 706, sku: '706101' })
		const v2 = makeVariable({ id: 9502, productId: 706, sku: '706102' })
		const dump = makeDump({ products: [parent], productVariables: [v1, v2] })
		const oneC = parseOneC([makeOneCRaw({ ID_nom: '706101' }), makeOneCRaw({ ID_nom: '706102' })])
		const priorQuarantine = new Map([[706, ['duplicate_guid' as const]]])

		const result = reconcileLegacyVariantFamilies(dump, oneC, priorQuarantine)
		expect(result.families[0].classification).toBe('quarantined')
		expect(result.families[0].confirmedMembers).toHaveLength(0)
		expect(result.summary.quarantinedFamilies).toBe(1)
	})

	test('requirement 10: products_variable rows whose product_id points at no parsed parent are never fabricated into a family', () => {
		const v1 = makeVariable({ id: 9601, productId: 0, sku: '900101' })
		const v2 = makeVariable({ id: 9602, productId: 0, sku: '900102' })
		const dump = makeDump({ products: [], productVariables: [v1, v2] })
		const oneC = parseOneC([makeOneCRaw({ ID_nom: '900101' }), makeOneCRaw({ ID_nom: '900102' })])

		const result = reconcileLegacyVariantFamilies(dump, oneC)
		expect(result.families).toHaveLength(0)
		expect(result.summary.insufficientEvidenceParents).toBe(1)
	})

	test('requirement 11: two different legacy parents whose variable rows both resolve to the same 1C ID_nom - the conflict is reported, never silently resolved', () => {
		const parentA = makeLegacyProduct({ id: 707 })
		const parentB = makeLegacyProduct({ id: 708 })
		const a1 = makeVariable({ id: 9701, productId: 707, sku: '707101' })
		const a2 = makeVariable({ id: 9702, productId: 707, sku: '700999' }) // contested
		const b1 = makeVariable({ id: 9801, productId: 708, sku: '708101' })
		const b2 = makeVariable({ id: 9802, productId: 708, sku: '700999' }) // contested
		const dump = makeDump({ products: [parentA, parentB], productVariables: [a1, a2, b1, b2] })
		const oneC = parseOneC([makeOneCRaw({ ID_nom: '707101' }), makeOneCRaw({ ID_nom: '708101' }), makeOneCRaw({ ID_nom: '700999' })])

		const result = reconcileLegacyVariantFamilies(dump, oneC)
		// Deterministic (ascending legacyProductId order): 707 processed first
		// and wins the claim on 700999; 708's own claim is reported as a
		// conflict. 708 then has only 1 confirmed member (708101) left - not
		// enough to reconstruct a family on its own, so 708 is NOT
		// reconstructed at all, while 707 IS confirmed with both its members.
		expect(result.duplicateMembershipConflicts).toHaveLength(1)
		expect(result.duplicateMembershipConflicts[0]).toMatchObject({
			idNom: '700999',
			claimedByLegacyProductId: 707,
			alsoClaimedByLegacyProductId: 708
		})
		const family707 = result.families.find(f => f.legacyProductId === 707)!
		expect(family707.classification).toBe('confirmed')
		expect(family707.confirmedMembers.map(m => m.idNom).sort()).toEqual(['700999', '707101'])
		expect(result.families.find(f => f.legacyProductId === 708)).toBeUndefined()
	})

	test('partial family: some members confirmed, some not - classified "partial", never silently dropped or promoted to "confirmed"', () => {
		const parent = makeLegacyProduct({ id: 709 })
		const v1 = makeVariable({ id: 9901, productId: 709, sku: '709101' })
		const v2 = makeVariable({ id: 9902, productId: 709, sku: '709102' })
		const v3 = makeVariable({ id: 9903, productId: 709, sku: null }) // no corroborating evidence at all
		const dump = makeDump({ products: [parent], productVariables: [v1, v2, v3] })
		const oneC = parseOneC([makeOneCRaw({ ID_nom: '709101' }), makeOneCRaw({ ID_nom: '709102' })])

		const result = reconcileLegacyVariantFamilies(dump, oneC)
		expect(result.families[0].classification).toBe('partial')
		expect(result.families[0].confirmedMembers).toHaveLength(2)
		expect(result.families[0].unconfirmedMembers).toHaveLength(1)
		expect(result.families[0].unconfirmedMembers[0].reason).toBe('unmatched')
	})

	test('product 2579 synthetic fixture: 14 color variants, honestly reporting how many corroborate (not assumed to be all 14)', () => {
		const SYNTHETIC_PARENT_ID = 999001 // unmistakably synthetic - distinct from any real legacy id
		const parent = makeLegacyProduct({ id: SYNTHETIC_PARENT_ID, titleRu: 'Synthetic Fourteen-Color Lipstick' })
		const colors = Array.from({ length: 14 }, (_, i) => `Color${i + 1}`)
		const variables: LegacyProductVariable[] = colors.map((color, i) =>
			makeVariable({
				id: 990100 + i,
				productId: SYNTHETIC_PARENT_ID,
				sku: String(925700 + i),
				colorRu: color,
				colorHex: `#${(i * 111111).toString(16).padStart(6, '0').slice(-6)}`
			})
		)
		// Only 11 of the 14 synthetic SKUs actually have a corresponding 1C
		// record - the other 3 represent legacy rows with NO independent 1C
		// corroboration (exactly the honest, not-all-rows-count scenario
		// Requirement 15 requires this fixture to prove out).
		const oneC = parseOneC(variables.slice(0, 11).map(v => makeOneCRaw({ ID_nom: v.sku! })))
		const dump = makeDump({ products: [parent], productVariables: variables })

		const result = reconcileLegacyVariantFamilies(dump, oneC)
		expect(result.families).toHaveLength(1)
		const family = result.families[0]
		expect(family.legacyProductId).toBe(SYNTHETIC_PARENT_ID)
		expect(family.classification).toBe('partial')
		expect(family.confirmedMembers).toHaveLength(11)
		expect(family.unconfirmedMembers).toHaveLength(3)
		for (const u of family.unconfirmedMembers) expect(u.reason).toBe('unmatched')
	})
})

describe('catalog-importer: legacy_variant_family write path (Sprint 12B.5 Pass 0)', () => {
	test('a confirmed multi-variant family writes ONE product row with MULTIPLE product_variants rows', async () => {
		const parent = makeLegacyProduct({ id: 801, titleRu: 'Family Product', isShown: true })
		const variables = [
			makeVariable({ id: 10001, productId: 801, sku: '801101', colorRu: 'Red', barcode: 'bc-a' }),
			makeVariable({ id: 10002, productId: 801, sku: '801102', colorRu: 'Blue', barcode: 'bc-b' })
		]
		const dump = makeDump({ products: [parent], productVariables: variables })
		const oneCRaw = [makeOneCRaw({ ID_nom: '801101' }), makeOneCRaw({ ID_nom: '801102' })]
		const input = await buildInput(dump, oneCRaw)

		const result = await db.transaction(async tx => runCatalogImport(tx, input, 'write'))
		const unit = result.units.find(u => u.kind === 'legacy_variant_family')!
		expect(unit.action).toBe('created')
		expect(unit.variantIds).toHaveLength(2)

		const rows = await db.select().from(productVariants).where(eq(productVariants.productId, unit.productId!))
		expect(rows).toHaveLength(2)
		const skus = rows.map(r => r.sku).sort()
		expect(skus).toEqual(['801101', '801102'])

		const productRows = await db.select().from(products).where(eq(products.id, unit.productId!))
		expect(productRows).toHaveLength(1)
	})

	test('existing external mapping conflict: a pre-existing 1c/nomenclature mapping pointing at a DIFFERENT internal variant excludes just that member, the rest of the family still imports (reuses the Sprint 12B.4 Priority 3 conflict check)', async () => {
		const parent = makeLegacyProduct({ id: 802 })
		const variables = [makeVariable({ id: 10101, productId: 802, sku: '802101' }), makeVariable({ id: 10102, productId: 802, sku: '802102' })]
		const dump = makeDump({ products: [parent], productVariables: variables })
		const oneCRaw = [makeOneCRaw({ ID_nom: '802101' }), makeOneCRaw({ ID_nom: '802102' })]
		const input = await buildInput(dump, oneCRaw)

		const result = await db.transaction(async tx => {
			// A different, unrelated internal UUID already claims ID_nom
			// 802102 under the 1c/nomenclature namespace - this must never be
			// silently reassigned.
			await resolveOrCreateMapping(tx, { sourceSystem: '1c', entityType: 'nomenclature', externalId: '802102', internalId: crypto.randomUUID() })
			return runCatalogImport(tx, input, 'write')
		})
		const unit = result.units.find(u => u.kind === 'legacy_variant_family')!
		expect(unit.action).toBe('created')
		expect(unit.variantIds).toHaveLength(1) // only the clean member resolved

		const variantRows = await db.select().from(productVariants).where(eq(productVariants.productId, unit.productId!))
		expect(variantRows.map(v => v.sku)).toEqual(['802101'])
	})

	test('repeated import idempotency: running the same input twice produces the same product/variant rows, not duplicates', async () => {
		const parent = makeLegacyProduct({ id: 803, titleRu: 'Idempotent Family' })
		const variables = [makeVariable({ id: 10201, productId: 803, sku: '803101' }), makeVariable({ id: 10202, productId: 803, sku: '803102' })]
		const dump = makeDump({ products: [parent], productVariables: variables })
		const oneCRaw = [makeOneCRaw({ ID_nom: '803101' }), makeOneCRaw({ ID_nom: '803102' })]
		const input = await buildInput(dump, oneCRaw)

		const first = await db.transaction(async tx => runCatalogImport(tx, input, 'write'))
		const firstUnit = first.units.find(u => u.kind === 'legacy_variant_family')!
		expect(firstUnit.action).toBe('created')

		const second = await db.transaction(async tx => runCatalogImport(tx, input, 'write'))
		const secondUnit = second.units.find(u => u.kind === 'legacy_variant_family')!
		expect(secondUnit.action).toBe('updated')
		expect(secondUnit.productId).toBe(firstUnit.productId)
		expect(new Set(secondUnit.variantIds)).toEqual(new Set(firstUnit.variantIds))

		const productRows = await db.select().from(products).where(eq(products.id, firstUnit.productId!))
		expect(productRows).toHaveLength(1)
		const variantRows = await db.select().from(productVariants).where(eq(productVariants.productId, firstUnit.productId!))
		expect(variantRows).toHaveLength(2)
	})

	test('conflicting brand/category membership: unresolved brand/category leaves the reconstructed product draft and uncategorized, never guessed', async () => {
		const parent = makeLegacyProduct({ id: 804, brandId: 9999, categoryId: 9999 }) // neither brand nor category mapping exists
		const variables = [makeVariable({ id: 10301, productId: 804, sku: '804101' }), makeVariable({ id: 10302, productId: 804, sku: '804102' })]
		const dump = makeDump({ products: [parent], productVariables: variables })
		const oneCRaw = [makeOneCRaw({ ID_nom: '804101' }), makeOneCRaw({ ID_nom: '804102' })]
		const input = await buildInput(dump, oneCRaw)

		const result = await db.transaction(async tx => runCatalogImport(tx, input, 'write'))
		const unit = result.units.find(u => u.kind === 'legacy_variant_family')!
		expect(unit.unpublishedForMissingBrand).toBe(true)
		expect(unit.unpublishedForMissingCategory).toBe(true)
		const [productRow] = await db.select().from(products).where(eq(products.id, unit.productId!))
		expect(productRow.status).toBe('draft')
		expect(productRow.brandId).toBeNull()
	})

	test('rollback and dry-run/write parity: dry-run plans the same shape write mode produces, and dry-run writes zero rows', async () => {
		const parent = makeLegacyProduct({ id: 805, titleRu: 'Parity Family' })
		const variables = [
			makeVariable({ id: 10401, productId: 805, sku: '805101', barcode: 'bc-par-a' }),
			makeVariable({ id: 10402, productId: 805, sku: '805102', barcode: 'bc-par-b' })
		]
		const dump = makeDump({ products: [parent], productVariables: variables })
		const oneCRaw = [makeOneCRaw({ ID_nom: '805101' }), makeOneCRaw({ ID_nom: '805102' })]
		const input = await buildInput(dump, oneCRaw)

		const dryRunResult = await db.transaction(async tx => runCatalogImport(tx, input, 'dry-run'))
		const dryUnit = dryRunResult.units.find(u => u.kind === 'legacy_variant_family')!
		expect(dryUnit.action).toBe('created')
		expect(dryUnit.variantIds).toHaveLength(2)
		expect(dryUnit.barcodesWritten).toBe(2)

		const productsAfterDryRun = await db.select().from(products)
		expect(productsAfterDryRun).toHaveLength(0) // zero rows written

		const writeResult = await db.transaction(async tx => runCatalogImport(tx, input, 'write'))
		const writeUnit = writeResult.units.find(u => u.kind === 'legacy_variant_family')!
		expect(writeUnit.action).toBe(dryUnit.action)
		expect(writeUnit.variantIds).toHaveLength(dryUnit.variantIds!.length)
		expect(writeUnit.barcodesWritten).toBe(dryUnit.barcodesWritten)
	})

	test('a legacy product reconstructed by Pass 0 is never also processed by Pass 1 (group-code family) or Pass 2 (standalone)', async () => {
		const parent = makeLegacyProduct({ id: 806, titleRu: 'Claimed Family' })
		const variables = [makeVariable({ id: 10501, productId: 806, sku: '806101' }), makeVariable({ id: 10502, productId: 806, sku: '806102' })]
		const dump = makeDump({ products: [parent], productVariables: variables })
		const oneCRaw = [makeOneCRaw({ ID_nom: '806101' }), makeOneCRaw({ ID_nom: '806102' })]
		const input = await buildInput(dump, oneCRaw)

		const result = await db.transaction(async tx => runCatalogImport(tx, input, 'write'))
		const unitsForThisProduct = result.units.filter(u => u.key.includes('806'))
		expect(unitsForThisProduct).toHaveLength(1)
		expect(unitsForThisProduct[0].kind).toBe('legacy_variant_family')

		const productRows = await db.select().from(products)
		expect(productRows).toHaveLength(1)
	})

	test('variant-specific media (products_variable_img) is written per variant, never merged with shared parent-level images', async () => {
		const parent = makeLegacyProduct({ id: 807 })
		const variables = [makeVariable({ id: 10601, productId: 807, sku: '807101' }), makeVariable({ id: 10602, productId: 807, sku: '807102' })]
		const dump = makeDump({
			products: [parent],
			productVariables: variables,
			productImgs: [{ id: 1, productId: 807, img: 'shared.jpg', sortOrder: 0, isShown: true }],
			productVariableImgs: [
				makeVariableImg({ id: 1, productId: 807, variableId: 10601, img: 'variant-a.jpg' }),
				makeVariableImg({ id: 2, productId: 807, variableId: 10602, img: 'variant-b.jpg' })
			]
		})
		const oneCRaw = [makeOneCRaw({ ID_nom: '807101' }), makeOneCRaw({ ID_nom: '807102' })]
		const input = await buildInput(dump, oneCRaw)

		const result = await db.transaction(async tx => runCatalogImport(tx, input, 'write'))
		const unit = result.units.find(u => u.kind === 'legacy_variant_family')!
		expect(unit.mediaRowsWritten).toBe(3) // 1 shared + 2 variant-specific

		const images = await db.select().from(productImages).where(eq(productImages.productId, unit.productId!))
		expect(images).toHaveLength(3)
		const shared = images.filter(i => i.variantId === null)
		expect(shared).toHaveLength(1)
		expect(shared[0].url).toBe('shared.jpg')
	})
})
