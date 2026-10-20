/**
 * Legacy MySQL catalog dry-run (Sprint 12 Task 7). Builds a read-only
 * preview of what importing the real legacy catalog into V2 would do -
 * creates / updates / skips / conflicts / external-ID collisions / missing
 * media / SEO slug collisions - without writing a single row to any
 * catalog table. The only database access here is SELECT (via
 * findMapping, Sprint 10A's read-only lookup) - exactly like
 * src/import/dry-run.ts's existing zero-write guarantee for the 1C feed
 * dry-run, extended here to the MySQL-dump source.
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
 */
import type { DbOrTx } from '../db/tx'
import { findMapping } from './mappings'
import type { LegacyCatalogAuditReport } from './audit/legacy-catalog-audit'
import { auditLegacyCatalog } from './audit/legacy-catalog-audit'
import { loadLegacyCatalogDump } from './parsers/mysql-catalog'

export type CatalogDryRunAction = 'create' | 'update' | 'conflict'

export type CatalogDryRunProductOutcome = {
	legacyProductId: number
	externalId: string
	action: CatalogDryRunAction
	variantCount: number
	reasons: string[]
}

export type CatalogDryRunSummary = {
	totalLegacyProducts: number
	wouldCreate: number
	wouldUpdate: number
	conflicts: number
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

	const invalidProductIds = new Set([
		...audit.products.invalidBrandReferences.map(r => r.productId),
		...audit.products.invalidCategoryReferences.map(r => r.productId)
	])

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
	const collidingExternalIds = new Set(externalIdCollisions.map(c => c.externalId))

	const products: CatalogDryRunProductOutcome[] = []
	let wouldCreate = 0
	let wouldUpdate = 0
	let conflicts = 0

	for (const p of dump.products) {
		const externalId = p.guid ?? String(p.id)
		const reasons: string[] = []
		let action: CatalogDryRunAction = 'create'

		if (collidingExternalIds.has(externalId)) {
			action = 'conflict'
			reasons.push('duplicate legacy GUID shared by multiple products - identity is ambiguous')
		} else if (invalidProductIds.has(p.id)) {
			action = 'conflict'
			reasons.push('references a brand_id or category_id not present in this export')
		} else if (dbOrTx) {
			const existing = await findMapping(dbOrTx, 'legacy_mysql', 'product', externalId)
			if (existing) {
				action = 'update'
				reasons.push('legacy_mysql/product mapping already exists for this GUID')
			}
		}

		if (action === 'create') wouldCreate++
		else if (action === 'update') wouldUpdate++
		else conflicts++

		products.push({
			legacyProductId: p.id,
			externalId,
			action,
			variantCount: variantCountByProduct.get(p.id) ?? 0,
			reasons
		})
	}

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

	const summary: CatalogDryRunSummary = {
		totalLegacyProducts: dump.products.length,
		wouldCreate,
		wouldUpdate,
		conflicts,
		externalIdCollisions,
		missingMediaCount: audit.products.withoutImages,
		seoSlugCollisions,
		seoSlugsNotSet,
		invalidReferenceCount: invalidProductIds.size,
		audit
	}

	return { summary, products }
}
