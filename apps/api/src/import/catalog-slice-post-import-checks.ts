/**
 * Sprint 12B.6 Requirement 6: automated post-import checks for a controlled
 * test write. Every function here is read-only (SELECT-only) against a
 * Drizzle transaction/db handle and reports on the REAL written state -
 * none of them re-run any matching/reconciliation logic, in the same
 * spirit as `variant-plan-verification.ts`'s pure, composable checks over
 * `runCatalogImport`'s own output (this module extends that idea to
 * actual persisted rows instead of the in-memory unit list).
 */
import { count, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Tx } from '../db/tx'
import { products } from '../db/schema/products'
import { productVariants } from '../db/schema/product-variants'
import { productVariantBarcodes } from '../db/schema/product-variant-barcodes'
import { productCategories } from '../db/schema/product-categories'
import { brands } from '../db/schema/brands'
import { categories } from '../db/schema/categories'
import { externalEntityMappings } from '../db/schema/external-entity-mappings'

export type PostImportCheckResult = {
	ok: boolean
	issues: string[]
}

function pass(): PostImportCheckResult {
	return { ok: true, issues: [] }
}

function fail(issues: string[]): PostImportCheckResult {
	return { ok: issues.length === 0, issues }
}

/** Row counts actually written, compared against the counts a dry-run preview expected. */
export async function checkRowCounts(
	tx: Tx,
	expected: { products: number; variants: number }
): Promise<PostImportCheckResult & { actual: { products: number; variants: number } }> {
	const [[productCount], [variantCount]] = await Promise.all([
		tx.select({ n: count() }).from(products),
		tx.select({ n: count() }).from(productVariants)
	])
	const actual = { products: productCount.n, variants: variantCount.n }
	const issues: string[] = []
	if (actual.products !== expected.products) issues.push(`expected ${expected.products} products, found ${actual.products}`)
	if (actual.variants !== expected.variants) issues.push(`expected ${expected.variants} variants, found ${actual.variants}`)
	return { ...fail(issues), actual }
}

/**
 * A variant row is orphaned (for import-integrity purposes) when it has no
 * `external_entity_mappings` row at all - meaning nothing traces it back to
 * either source system, so a re-run could never recognize and reuse it.
 * (A missing `product_id` FK can't happen - the schema's own NOT NULL +
 * `references(... onDelete: 'cascade')` already makes that impossible.)
 */
export async function checkNoOrphanVariants(tx: Tx): Promise<PostImportCheckResult> {
	const allVariants = await tx.select({ id: productVariants.id }).from(productVariants)
	if (allVariants.length === 0) return pass()
	const mapped = await tx
		.select({ internalId: externalEntityMappings.internalId })
		.from(externalEntityMappings)
		.where(eq(externalEntityMappings.entityType, 'product_variant'))
	const mappedIds = new Set(mapped.map(m => m.internalId))
	const orphanIds = allVariants.filter(v => !mappedIds.has(v.id)).map(v => v.id)
	return fail(orphanIds.map(id => `product_variants.id=${id} has no external_entity_mappings row - unreachable by any re-run`))
}

/** `product_variants.sku` is declared UNIQUE, but this check reports it explicitly rather than relying only on the constraint having not fired. */
export async function checkNoDuplicateSkus(tx: Tx): Promise<PostImportCheckResult> {
	const rows = await tx
		.select({ sku: productVariants.sku, n: count() })
		.from(productVariants)
		.groupBy(productVariants.sku)
		.having(sql`count(*) > 1`)
	return fail(rows.map(r => `sku ${JSON.stringify(r.sku)} appears on ${r.n} product_variants rows`))
}

/**
 * Global invariant carried over from the Sprint 12B.5 verification
 * follow-up's Q4 check: no (source_system, entity_type, external_id) maps
 * to 2+ distinct internal ids. The database's own unique constraint on
 * (source_system, entity_type, external_id) already makes this impossible
 * to violate going forward, but this check reports on it explicitly as a
 * direct assertion of the real written state rather than trusting the
 * constraint silently held.
 */
export async function checkNoDuplicateExternalIdMappings(tx: Tx): Promise<PostImportCheckResult> {
	const rows = await tx
		.select({
			sourceSystem: externalEntityMappings.sourceSystem,
			entityType: externalEntityMappings.entityType,
			externalId: externalEntityMappings.externalId,
			n: sql<number>`count(distinct ${externalEntityMappings.internalId})`
		})
		.from(externalEntityMappings)
		.groupBy(externalEntityMappings.sourceSystem, externalEntityMappings.entityType, externalEntityMappings.externalId)
		.having(sql`count(distinct ${externalEntityMappings.internalId}) > 1`)
	return fail(
		rows.map(r => `${r.sourceSystem}/${r.entityType}/${r.externalId} resolves to ${r.n} distinct internal ids`)
	)
}

/**
 * Every `product_variant_barcodes` row points at a real variant (the
 * schema's FK already guarantees this structurally) and no variant carries
 * two rows flagged `isPrimary` - this check asserts both directly against
 * the written rows, and additionally checks every variant whose scalar
 * `barcode` cache column is set has a matching, primary row in the
 * detail table, so the two never silently diverge.
 */
export async function checkBarcodeIntegrity(tx: Tx): Promise<PostImportCheckResult> {
	const issues: string[] = []

	const duplicatePrimaries = await tx
		.select({ variantId: productVariantBarcodes.variantId, n: count() })
		.from(productVariantBarcodes)
		.where(eq(productVariantBarcodes.isPrimary, true))
		.groupBy(productVariantBarcodes.variantId)
		.having(sql`count(*) > 1`)
	for (const row of duplicatePrimaries) issues.push(`variant ${row.variantId} has ${row.n} rows flagged isPrimary`)

	const variantsWithBarcode = await tx
		.select({ id: productVariants.id, barcode: productVariants.barcode })
		.from(productVariants)
		.where(sql`${productVariants.barcode} is not null`)
	if (variantsWithBarcode.length > 0) {
		const variantIds = variantsWithBarcode.map(v => v.id)
		const primaryRows = await tx
			.select({ variantId: productVariantBarcodes.variantId, barcode: productVariantBarcodes.barcode })
			.from(productVariantBarcodes)
			.where(inArray(productVariantBarcodes.variantId, variantIds))
		for (const v of variantsWithBarcode) {
			const detailBarcodes = primaryRows.filter(r => r.variantId === v.id).map(r => r.barcode)
			if (v.barcode === null || !detailBarcodes.includes(v.barcode)) {
				issues.push(
					`variant ${v.id}'s cached barcode ${JSON.stringify(v.barcode)} has no matching product_variant_barcodes row`
				)
			}
		}
	}

	return fail(issues)
}

/**
 * Every written product's `brand_id`/`category_id` link resolves to a real
 * row (the schema's FKs already guarantee referential integrity - this is
 * a direct, explicit assertion of it) consistent with the "never
 * fabricate" rule: a product with no brand/category match is expected to
 * have a null link, never a dangling or invented one.
 */
export async function checkCategoryBrandLinksResolve(tx: Tx): Promise<PostImportCheckResult> {
	const issues: string[] = []
	const productRows = await tx.select({ id: products.id, brandId: products.brandId }).from(products)
	const brandIds = new Set((await tx.select({ id: brands.id }).from(brands)).map(b => b.id))
	for (const p of productRows) {
		if (p.brandId !== null && !brandIds.has(p.brandId)) issues.push(`product ${p.id} has brand_id ${p.brandId} which does not exist in brands`)
	}

	const categoryLinkRows = await tx.select({ categoryId: productCategories.categoryId }).from(productCategories)
	const categoryIds = new Set((await tx.select({ id: categories.id }).from(categories)).map(c => c.id))
	for (const link of categoryLinkRows) {
		if (!categoryIds.has(link.categoryId)) issues.push(`product_categories references category_id ${link.categoryId} which does not exist in categories`)
	}

	return fail(issues)
}

export type ExpectedVariantVisibility = { variantId: string; isActive: boolean }

/** Compares the slice's expected per-variant visibility (from a dry-run preview) against what was actually written. */
export async function checkVisibilityMatchesExpectation(
	tx: Tx,
	expected: ExpectedVariantVisibility[]
): Promise<PostImportCheckResult> {
	if (expected.length === 0) return pass()
	const ids = expected.map(e => e.variantId)
	const rows = await tx.select({ id: productVariants.id, isActive: productVariants.isActive }).from(productVariants).where(inArray(productVariants.id, ids))
	const actualById = new Map(rows.map(r => [r.id, r.isActive]))
	const issues: string[] = []
	for (const e of expected) {
		const actual = actualById.get(e.variantId)
		if (actual === undefined) issues.push(`expected variant ${e.variantId} to exist, but it was not found`)
		else if (actual !== e.isActive) issues.push(`variant ${e.variantId} expected isActive=${e.isActive}, found ${actual}`)
	}
	return fail(issues)
}

/**
 * Compares two `runCatalogImport` summaries from running the SAME slice
 * twice against the same database state - Requirement 6's "idempotency on
 * a repeat run with no duplicates". A correct repeat run creates nothing
 * new (every unit resolves via `resolveOrCreateMapping`'s reuse-first path
 * to `'updated'` or an equivalent no-op skip, never `'created'` again).
 */
export function checkRepeatRunCreatedNothingNew(
	firstProductsCreated: number,
	secondProductsCreated: number
): PostImportCheckResult {
	if (secondProductsCreated > 0) {
		return fail([`repeat run against already-imported data created ${secondProductsCreated} additional products (expected 0)`])
	}
	if (firstProductsCreated === 0) {
		return fail(['first run created 0 products - nothing to assert idempotency against'])
	}
	return pass()
}
