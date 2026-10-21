/**
 * Scoped Brand/Category reference bootstrap (Sprint 12B.7).
 *
 * The real Mac integration run proved the controlled slice importer itself
 * works end to end (4 Products / 7 Variants written, idempotent on repeat),
 * but left every written product `unpublishedForMissingBrand: true` /
 * `unpublishedForMissingCategory: true` - because `brand-category-bootstrap.ts`
 * had never been run against `beauty_store_test` at all, so
 * `external_entity_mappings` had zero `legacy_mysql/brand` or
 * `legacy_mysql/category` rows for `resolveBrandId`/`writeCategoryLinksPreview`
 * (catalog-importer.ts) to find.
 *
 * Requirement 1: this module creates NO new bootstrap mechanism. It reuses
 * `bootstrapBrands`/`bootstrapCategories` (brand-category-bootstrap.ts)
 * completely unchanged - the only new logic here is SCOPING: given the
 * legacy product ids of an already-imported slice, work out exactly which
 * brand/category rows (including the full category parent-ancestor chain)
 * those products actually reference, via `buildCatalogSlice`
 * (catalog-slice.ts) - the same FK-closure primitive the slice importer
 * itself already uses - rather than bootstrapping the entire legacy dump.
 *
 * Requirement 2 (safety): `bootstrapBrands`/`bootstrapCategories` only ever
 * write to the `brands`/`categories` tables (confirmed by reading their
 * source - every `tx.insert`/`tx.update` call targets one of those two
 * tables). This module never touches `products`/`product_variants` and
 * never resets/truncates anything, so it cannot clear the already-imported
 * slice - it is purely additive, exactly like any other bootstrap run.
 */
import type { Tx } from '../db/tx'
import { buildCatalogSlice, UnknownLegacyProductIdError } from './catalog-slice'
import { bootstrapBrands, bootstrapCategories, type BootstrapMode, type BrandBootstrapResult, type CategoryBootstrapResult } from './brand-category-bootstrap'
import type { LegacyCatalogDump } from './parsers/mysql-catalog'

export type ReferenceSlice = {
	brands: LegacyCatalogDump['brands']
	categories: LegacyCatalogDump['categories']
}

/**
 * Requirement 3: resolves the exact legacy brand_id/category_id rows (plus
 * full category parent chain) referenced by a given set of legacy
 * `products.id` values. Delegates entirely to `buildCatalogSlice`'s own
 * brand/category closure logic - this function adds no new selection rule,
 * it only picks the two fields out of the slice callers actually need here.
 * Throws `UnknownLegacyProductIdError` (from catalog-slice.ts, re-exported
 * via the thrown error itself) if any requested id doesn't exist in the
 * dump - never silently narrows the scope.
 */
export function extractReferencedBrandCategorySlice(dump: LegacyCatalogDump, legacyProductIds: readonly number[]): ReferenceSlice {
	const slice = buildCatalogSlice(dump, legacyProductIds)
	return { brands: slice.brands, categories: slice.categories }
}

/**
 * Same "unique products per legacy brand/category id" counting the existing
 * CLI (cli/brand-category-bootstrap.ts) already does over a full dump,
 * applied here to the SCOPED reference slice's own products instead - so
 * `referencingProductCount`/`referencingProductCountPrimary/Secondary` on
 * the returned units reflect "how many of THIS slice's products reference
 * this brand/category", not the whole legacy catalog's unrelated usage.
 */
function buildScopedProductReferenceCounts(dump: LegacyCatalogDump, legacyProductIds: readonly number[]) {
	const scoped = new Set(legacyProductIds)
	const productsByBrand = new Map<number, number>()
	const uniqueByCategoryPrimary = new Map<number, Set<number>>()
	const uniqueByCategorySecondary = new Map<number, Set<number>>()

	for (const product of dump.products) {
		if (!scoped.has(product.id)) continue
		if (product.brandId !== null) productsByBrand.set(product.brandId, (productsByBrand.get(product.brandId) ?? 0) + 1)
		if (product.categoryId !== null) {
			if (!uniqueByCategoryPrimary.has(product.categoryId)) uniqueByCategoryPrimary.set(product.categoryId, new Set())
			uniqueByCategoryPrimary.get(product.categoryId)!.add(product.id)
		}
	}
	for (const link of dump.productCategories) {
		if (!scoped.has(link.productId)) continue
		if (!uniqueByCategorySecondary.has(link.categoryId)) uniqueByCategorySecondary.set(link.categoryId, new Set())
		uniqueByCategorySecondary.get(link.categoryId)!.add(link.productId)
	}

	const productsByCategoryPrimary = new Map([...uniqueByCategoryPrimary].map(([catId, ids]) => [catId, ids.size]))
	const productsByCategorySecondary = new Map([...uniqueByCategorySecondary].map(([catId, ids]) => [catId, ids.size]))
	const productsByCategory = new Map<number, number>()
	const allCategoryIds = new Set([...uniqueByCategoryPrimary.keys(), ...uniqueByCategorySecondary.keys()])
	for (const catId of allCategoryIds) {
		const union = new Set<number>([...(uniqueByCategoryPrimary.get(catId) ?? []), ...(uniqueByCategorySecondary.get(catId) ?? [])])
		productsByCategory.set(catId, union.size)
	}

	return { productsByBrand, productsByCategory, productsByCategoryPrimary, productsByCategorySecondary }
}

export type ScopedReferenceBootstrapResult = {
	slice: ReferenceSlice
	brandResult: BrandBootstrapResult
	categoryResult: CategoryBootstrapResult
}

/**
 * Requirement 2: the one entrypoint Sprint 12B.7 adds. Resolves the exact
 * brand/category rows the given legacy product ids reference (Requirement
 * 3), then runs the EXISTING `bootstrapBrands`/`bootstrapCategories`
 * against only that scoped subset (Requirement 1's reuse). Requirement 10:
 * idempotent by construction - it is a thin wrapper, so it inherits
 * `bootstrapBrands`/`bootstrapCategories`'s own `external_entity_mappings`-
 * keyed idempotency (a second call with the same product ids resolves every
 * unit to 'updated', never a second 'created').
 *
 * Caller is responsible for running this inside the same kind of
 * transaction/safety posture as any other write (`assertSafeImportTarget`
 * before `mode: 'write'`) - this function itself performs no environment
 * check, matching `bootstrapBrands`/`bootstrapCategories`'s own posture.
 */
export async function runScopedReferenceBootstrap(
	tx: Tx,
	dump: LegacyCatalogDump,
	legacyProductIds: readonly number[],
	mode: BootstrapMode
): Promise<ScopedReferenceBootstrapResult> {
	const slice = extractReferencedBrandCategorySlice(dump, legacyProductIds)
	const { productsByBrand, productsByCategory, productsByCategoryPrimary, productsByCategorySecondary } = buildScopedProductReferenceCounts(
		dump,
		legacyProductIds
	)

	const brandResult = await bootstrapBrands(tx, slice.brands, mode, productsByBrand)
	const categoryResult = await bootstrapCategories(tx, slice.categories, mode, productsByCategory, {
		primary: productsByCategoryPrimary,
		secondary: productsByCategorySecondary
	})

	return { slice, brandResult, categoryResult }
}

export { UnknownLegacyProductIdError }
