import { describe, expect, test } from 'bun:test'
import { canonicalSlugFor } from '../src/import/catalog-importer'
import type { LegacyProduct } from '../src/import/parsers/mysql-catalog'

/**
 * Sprint 12B.8: direct unit coverage for the fallback-slug fix. The real Mac
 * dry-run reported double-prefixed slugs like "legacy-legacy-variant-family-40"
 * for Pass 0 reconstructed families - canonicalSlugFor's fallback branch was
 * unconditionally prepending "legacy-" even when the externalId it received
 * (e.g. "legacy-variant-family-40" from importLegacyVariantFamily) already
 * carried that marker.
 */
function makeMinimalProduct(overrides: Partial<LegacyProduct> & { id: number }): LegacyProduct {
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

describe('canonicalSlugFor', () => {
	test('a real non-numeric uriRu is used verbatim (lowercased, trimmed), regardless of externalId shape', () => {
		const product = makeMinimalProduct({ id: 1, uriRu: '  Real-Product-Slug  ' })
		expect(canonicalSlugFor(product, 'legacy-variant-family-1')).toEqual({ slug: 'real-product-slug', isGenerated: false })
	})

	test('a purely numeric uriRu is NOT treated as a real slug (matches dry-run-catalog.ts seoSlugsNotSet)', () => {
		const product = makeMinimalProduct({ id: 2, uriRu: '12345' })
		const result = canonicalSlugFor(product, '2')
		expect(result.isGenerated).toBe(true)
	})

	test('standalone externalId (bare numeric legacy id): single "legacy-" prefix, unchanged from before', () => {
		const product = makeMinimalProduct({ id: 5403 })
		expect(canonicalSlugFor(product, '5403')).toEqual({ slug: 'legacy-5403', isGenerated: true })
	})

	test('Pass 0 family externalId already carrying the "legacy-" marker: no double prefix', () => {
		const product = makeMinimalProduct({ id: 40 })
		expect(canonicalSlugFor(product, 'legacy-variant-family-40')).toEqual({
			slug: 'legacy-variant-family-40',
			isGenerated: true
		})
	})

	test('a GUID externalId that happens to start with "legacy-" is still only prefixed once', () => {
		const product = makeMinimalProduct({ id: 7 })
		expect(canonicalSlugFor(product, 'legacy-abc-123-guid')).toEqual({
			slug: 'legacy-abc-123-guid',
			isGenerated: true
		})
	})
})
