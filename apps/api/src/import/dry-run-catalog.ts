/**
 * Legacy MySQL catalog dry-run (Sprint 12 Task 7, quarantine model added in
 * Sprint 12A.2 Task 6). Builds a read-only preview of what importing the
 * real legacy catalog into V2 would do - creates / updates / quarantined -
 * without writing a single row to any catalog table. The only database
 * access here is SELECT (via findMapping, Sprint 10A's read-only lookup) -
 * exactly like src/import/dry-run.ts's existing zero-write guarantee for
 * the 1C feed dry-run, extended here to the MySQL-dump source.
 *
 * Identity strategy (Task 3): every legacy product's external id is its
 * MySQL `GUID` column - confirmed by this sprint's own audit to be a
 * stable, non-null numeric value for all 6999 products (never the MySQL
 * auto-increment `id`, which is not guaranteed stable across re-exports).
 * A product with product_variable rows becomes a V2 product with N real
 * variants (each keyed by its own products_variable.id); a product with no
 * variant rows becomes a V2 product with exactly one implicit variant
 * (keyed by the product's own id, under a distinct entity_type so it can
 * never collide with a real products_variable.id). Everything is namespaced
 * under source_system='legacy_mysql', entirely independent of the '1c'
 * namespace used by the existing 1C-feed importer - the same physical
 * catalog item migrated from both sources would get two independent
 * mapping rows, never merged automatically (Sprint 12 Task 3 restriction:
 * never match by title, and verify identifiers empirically rather than
 * assume uniqueness).
 *
 * Quarantine model (Sprint 12A.2 Task 6): a flat "conflict" bucket hides
 * *why* a record can't auto-create, which is exactly the information a
 * human needs to resolve it. Every ambiguous record - duplicate GUID,
 * broken category/brand reference, duplicate SKU, or (at the variant level)
 * an orphaned products_variable row - is instead tagged with one or more
 * structured QuarantineReasonCode values. Nothing is ever auto-merged,
 * auto-discarded, or silently dropped: a quarantined record still appears
 * in the result with its reasons, it is simply excluded from wouldCreate/
 * wouldUpdate until a human resolves it (Sprint 12A.2's own forensic
 * findings - see docs/vizaje-catalog-migration-report.md - narrow what
 * "resolve" means for each reason code, but do not resolve anything here).
 */
import type { DbOrTx } from '../db/tx'
import { findMapping } from './mappings'
import type { LegacyCatalogAuditReport } from './audit/legacy-catalog-audit'
import { auditLegacyCatalog } from './audit/legacy-catalog-audit'
import { loadLegacyCatalogDump } from './parsers/mysql-catalog'
import type { LegacyProduct, LegacyProductVariable } from './parsers/mysql-catalog'

export type CatalogDryRunAction = 'create' | 'update' | 'quarantine'

/**
 * One reason a product-level record was quarantined. A product can carry
 * more than one at once (e.g. both a duplicate GUID and a duplicate SKU),
 * so CatalogDryRunProductOutcome.quarantineReasonCodes is an array, never a
 * single value - collapsing to one would hide a second, independent
 * problem on the same record.
 */
export type QuarantineReasonCode =
	| 'duplicate_guid'
	| 'invalid_brand_reference'
	// products.category_id is broken, but a valid category_id exists for
	// this product via product_categories (Sprint 12A.2 Task 2 finding:
	// true for 30 of the 33 Phase-A invalid-category-reference products).
	| 'invalid_category_reference_resolvable_via_secondary'
	// products.category_id is broken AND no valid category_id exists
	// anywhere for this product (product_categories has zero valid rows
	// for it either) - a genuine "needs human decision" case (3 of 33).
	| 'invalid_category_reference_unresolvable'
	| 'duplicate_sku'

export type CatalogDryRunProductOutcome = {
	legacyProductId: number
	externalId: string
	action: CatalogDryRunAction
	variantCount: number
	reasons: string[]
	quarantineReasonCodes: QuarantineReasonCode[]
}

/**
 * Orphan products_variable rows (variantId.productId points at a products
 * row that doesn't exist in this export) can never become a V2 product
 * themselves - they have no parent to attach to - so they never appear in
 * CatalogDryRunResult.products. They get their own quarantine list instead.
 * possibleReattachProductId is populated only when exactly one legacy
 * product shares the orphan's barcode or SKU (Sprint 12A.2 Task 4 finding:
 * true for 137 of 721 orphans); left undefined when no match or more than
 * one candidate exists, so a human still has to pick, never this code.
 */
export type QuarantinedVariantOutcome = {
	variantId: number
	missingProductId: number
	reasonCode: 'orphan_variant'
	possibleReattachProductId?: number
	possibleReattachMatchedOn?: 'barcode' | 'sku'
}

export type QuarantineSummary = {
	totalProductsQuarantined: number
	totalVariantsQuarantined: number
	byReasonCode: Record<QuarantineReasonCode | 'orphan_variant', number>
	/**
	 * A small number of sanitized, non-sensitive illustrative examples per
	 * reason code (ids and the reason only - never full rows, prices, or
	 * free-text content), for a report author to quote without having to
	 * re-derive them from the full product list.
	 */
	examples: Record<QuarantineReasonCode | 'orphan_variant', { legacyId: number; note: string }[]>
}

export type CatalogDryRunSummary = {
	totalLegacyProducts: number
	wouldCreate: number
	wouldUpdate: number
	quarantine: QuarantineSummary
	externalIdCollisions: { externalId: string; legacyProductIds: number[] }[]
	missingMediaCount: number
	seoSlugCollisions: { slug: string; legacyProductIds: number[] }[]
	seoSlugsNotSet: number
	invalidReferenceCount: number
	audit: LegacyCatalogAuditReport
}

export type CatalogDryRunResult = {
	summary: CatalogDryRunSummary
	products: CatalogDryRunProductOutcome[]
	quarantinedVariants: QuarantinedVariantOutcome[]
}

const EXAMPLE_LIMIT = 3

function findReattachCandidate(
	orphan: LegacyProductVariable,
	productsByBarcode: Map<string, number[]>,
	productsBySku: Map<string, number[]>
): { productId: number; matchedOn: 'barcode' | 'sku' } | undefined {
	if (orphan.barcode !== null) {
		const matches = productsByBarcode.get(orphan.barcode)
		if (matches && matches.length === 1) return { productId: matches[0], matchedOn: 'barcode' }
	}
	if (orphan.sku !== null) {
		const matches = productsBySku.get(orphan.sku)
		if (matches && matches.length === 1) return { productId: matches[0], matchedOn: 'sku' }
	}
	return undefined
}

/**
 * `dbOrTx` is optional specifically so this function (and its tests) can
 * run with zero database connectivity at all - external-id lookups then
 * simply report "would create" for everything, which is the correct,
 * honest answer when no mappings exist yet. When a database is supplied,
 * every call made through it is a SELECT only.
 */
export async function runLegacyCatalogDryRun(sql: string, dbOrTx?: DbOrTx): Promise<CatalogDryRunResult> {
	const dump = loadLegacyCatalogDump(sql)
	const audit = auditLegacyCatalog(dump)

	const variantCountByProduct = new Map<number, number>()
	for (const v of dump.productVariables) {
		variantCountByProduct.set(v.productId, (variantCountByProduct.get(v.productId) ?? 0) + 1)
	}

	const productById = new Map<number, LegacyProduct>(dump.products.map(p => [p.id, p]))
	const categoryIds = new Set(dump.categories.map(c => c.id))

	// Per Sprint 12A.2 Task 2's forensic finding: a product's broken
	// products.category_id is "resolvable" when product_categories carries
	// at least one *other* category_id that does exist; it's genuinely
	// unresolvable only when product_categories has no valid row for it
	// either. Computed once here so both reason-code assignment below and
	// future tooling can reuse the same classification.
	const validCategoryLinksByProduct = new Map<number, number[]>()
	for (const pc of dump.productCategories) {
		if (!categoryIds.has(pc.categoryId)) continue
		const list = validCategoryLinksByProduct.get(pc.productId) ?? []
		list.push(pc.categoryId)
		validCategoryLinksByProduct.set(pc.productId, list)
	}
	const invalidBrandRefProductIds = new Set(audit.products.invalidBrandReferences.map(r => r.productId))
	const invalidCategoryRefProductIds = new Set(audit.products.invalidCategoryReferences.map(r => r.productId))

	const guidDuplicateIds = new Set(audit.products.duplicateGuids.flatMap(g => g.ids))
	const skuDuplicateIds = new Set(audit.products.duplicateSkus.flatMap(g => g.ids))

	const externalIdOwners = new Map<string, number[]>()
	for (const p of dump.products) {
		if (p.guid === null) continue
		const owners = externalIdOwners.get(p.guid) ?? []
		owners.push(p.id)
		externalIdOwners.set(p.guid, owners)
	}
	const externalIdCollisions = [...externalIdOwners.entries()]
		.filter(([, ids]) => ids.length > 1)
		.map(([externalId, legacyProductIds]) => ({ externalId, legacyProductIds }))

	const products: CatalogDryRunProductOutcome[] = []
	let wouldCreate = 0
	let wouldUpdate = 0
	const quarantineCounts: Record<QuarantineReasonCode, number> = {
		duplicate_guid: 0,
		invalid_brand_reference: 0,
		invalid_category_reference_resolvable_via_secondary: 0,
		invalid_category_reference_unresolvable: 0,
		duplicate_sku: 0
	}
	const quarantineExampleIds: Record<QuarantineReasonCode, number[]> = {
		duplicate_guid: [],
		invalid_brand_reference: [],
		invalid_category_reference_resolvable_via_secondary: [],
		invalid_category_reference_unresolvable: [],
		duplicate_sku: []
	}

	for (const p of dump.products) {
		const externalId = p.guid ?? String(p.id)
		const reasons: string[] = []
		const quarantineReasonCodes: QuarantineReasonCode[] = []

		if (p.guid !== null && guidDuplicateIds.has(p.id)) {
			quarantineReasonCodes.push('duplicate_guid')
			reasons.push('duplicate legacy GUID shared by multiple products - identity is ambiguous')
		}
		if (invalidBrandRefProductIds.has(p.id)) {
			quarantineReasonCodes.push('invalid_brand_reference')
			reasons.push('references a brand_id not present in this export')
		}
		if (invalidCategoryRefProductIds.has(p.id)) {
			const hasValidSecondary = (validCategoryLinksByProduct.get(p.id) ?? []).length > 0
			if (hasValidSecondary) {
				quarantineReasonCodes.push('invalid_category_reference_resolvable_via_secondary')
				reasons.push('products.category_id is invalid, but a valid category exists via product_categories')
			} else {
				quarantineReasonCodes.push('invalid_category_reference_unresolvable')
				reasons.push('products.category_id is invalid and no valid category exists via product_categories either')
			}
		}
		if (p.sku !== null && skuDuplicateIds.has(p.id)) {
			quarantineReasonCodes.push('duplicate_sku')
			reasons.push('duplicate legacy SKU shared by multiple products - V2 product_variants.sku is unique, cannot import as-is')
		}

		let action: CatalogDryRunAction
		if (quarantineReasonCodes.length > 0) {
			action = 'quarantine'
			for (const code of quarantineReasonCodes) {
				quarantineCounts[code]++
				if (quarantineExampleIds[code].length < EXAMPLE_LIMIT) quarantineExampleIds[code].push(p.id)
			}
		} else if (dbOrTx) {
			const existing = await findMapping(dbOrTx, 'legacy_mysql', 'product', externalId)
			action = existing ? 'update' : 'create'
			if (existing) reasons.push('legacy_mysql/product mapping already exists for this GUID')
		} else {
			action = 'create'
		}

		if (action === 'create') wouldCreate++
		else if (action === 'update') wouldUpdate++

		products.push({
			legacyProductId: p.id,
			externalId,
			action,
			variantCount: variantCountByProduct.get(p.id) ?? 0,
			reasons,
			quarantineReasonCodes
		})
	}

	// Orphan products_variable rows can never attach to a V2 product on
	// their own - quarantined separately from the product list (Sprint
	// 12A.2 Task 4). A possible reattachment target is surfaced, never
	// applied: it's still a human call, since a shared barcode/SKU is
	// suggestive, not proof of identity.
	const productsByBarcode = new Map<string, number[]>()
	const productsBySku = new Map<string, number[]>()
	for (const p of dump.products) {
		if (p.barcode !== null) productsByBarcode.set(p.barcode, [...(productsByBarcode.get(p.barcode) ?? []), p.id])
		if (p.sku !== null) productsBySku.set(p.sku, [...(productsBySku.get(p.sku) ?? []), p.id])
	}
	const variantById = new Map(dump.productVariables.map(v => [v.id, v]))
	const quarantinedVariants: QuarantinedVariantOutcome[] = audit.variants.orphanVariants.map(o => {
		const variant = variantById.get(o.variantId)
		const candidate = variant ? findReattachCandidate(variant, productsByBarcode, productsBySku) : undefined
		return {
			variantId: o.variantId,
			missingProductId: o.productId,
			reasonCode: 'orphan_variant',
			possibleReattachProductId: candidate?.productId,
			possibleReattachMatchedOn: candidate?.matchedOn
		}
	})
	const orphanVariantExampleIds = quarantinedVariants.slice(0, EXAMPLE_LIMIT).map(v => v.variantId)

	// SEO: a "real" uriRU is one that isn't just the numeric product id
	// (Task 6's "duplicate slugs and URL collisions" plus the migration
	// architecture's established distinction between a curated slug and the
	// legacy default-to-numeric-id fallback).
	const slugOwners = new Map<string, number[]>()
	let seoSlugsNotSet = 0
	for (const p of dump.products) {
		if (p.uriRu === null || /^\d+$/.test(p.uriRu)) {
			seoSlugsNotSet++
			continue
		}
		const owners = slugOwners.get(p.uriRu) ?? []
		owners.push(p.id)
		slugOwners.set(p.uriRu, owners)
	}
	const seoSlugCollisions = [...slugOwners.entries()]
		.filter(([, ids]) => ids.length > 1)
		.map(([slug, legacyProductIds]) => ({ slug, legacyProductIds }))

	const totalProductsQuarantined = products.filter(p => p.action === 'quarantine').length

	const quarantine: QuarantineSummary = {
		totalProductsQuarantined,
		totalVariantsQuarantined: quarantinedVariants.length,
		byReasonCode: { ...quarantineCounts, orphan_variant: quarantinedVariants.length },
		examples: {
			duplicate_guid: quarantineExampleIds.duplicate_guid.map(id => ({ legacyId: id, note: 'shares a legacy GUID with another product' })),
			invalid_brand_reference: quarantineExampleIds.invalid_brand_reference.map(id => ({ legacyId: id, note: 'brand_id not present in this export' })),
			invalid_category_reference_resolvable_via_secondary: quarantineExampleIds.invalid_category_reference_resolvable_via_secondary.map(id => ({
				legacyId: id,
				note: 'category_id invalid, but a valid secondary category exists'
			})),
			invalid_category_reference_unresolvable: quarantineExampleIds.invalid_category_reference_unresolvable.map(id => ({
				legacyId: id,
				note: 'category_id invalid and no valid secondary category exists'
			})),
			duplicate_sku: quarantineExampleIds.duplicate_sku.map(id => ({ legacyId: id, note: 'shares a legacy SKU with another product' })),
			orphan_variant: orphanVariantExampleIds.map(id => ({ legacyId: id, note: 'products_variable row whose product_id does not exist in this export' }))
		}
	}

	const summary: CatalogDryRunSummary = {
		totalLegacyProducts: dump.products.length,
		wouldCreate,
		wouldUpdate,
		quarantine,
		externalIdCollisions,
		missingMediaCount: audit.products.withoutImages,
		seoSlugCollisions,
		seoSlugsNotSet,
		invalidReferenceCount: invalidBrandRefProductIds.size + invalidCategoryRefProductIds.size,
		audit
	}

	return { summary, products, quarantinedVariants }
}
