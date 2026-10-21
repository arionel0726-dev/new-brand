/**
 * Controlled catalog importer (Sprint 12B.2).
 *
 * Writes INTO the V2 Postgres schema - the one and only module in this
 * entire Sprint 12 series that does. Every prior Sprint 12 module
 * (dry-run.ts, dry-run-catalog.ts, the reconcile/* family) is read-only by
 * design; this module composes their OUTPUTS into real Drizzle
 * insert/update statements, but only ever for a MySQL product whose
 * identity reconciliation outcome is unambiguously 'confirmed' - everything
 * else (quarantine, ambiguous, collision-risk, unmatched) is counted and
 * reported, never written.
 *
 * Scope explicitly NOT covered this sprint (see docs/vizaje-identity-
 * architecture.md §D for why each is still an open business rule, not an
 * oversight):
 *   - product_prices / inventory / variant_inventory_by_location: no price
 *     or stock value is ever written by this module. There is still no
 *     confirmed source-of-truth rule for retail Price (products.json vs
 *     pricevn.json), no confirmed meaning for the Bal* per-warehouse
 *     columns, and 1C's own DiscountPrice=0 ambiguity is only resolved for
 *     *comparison* (duplicate-id-nom.ts), not for a real price-selection
 *     decision. Writing a price or stock number here would be exactly the
 *     "arbitrary selection" Sprint 12B.2's Task 13 forbids.
 *   - SEO title/description fields (Legacy's seoTitleRu/Ro, seoDescRu/Ro): not
 *     mapped onto any V2 column yet; out of this sprint's task list.
 *
 * Identity write pattern (every entity below follows this shape):
 *   1. Generate a candidate UUID client-side.
 *   2. resolveOrCreateMapping(tx, { sourceSystem, entityType, externalId,
 *      internalId: candidateUuid }).
 *   3. 'created'  -> INSERT a new row using candidateUuid as its id.
 *      'existing' -> UPDATE the row at mapping.internalId with the same
 *                    freshly-computed field values (this is what makes a
 *                    second run against identical input idempotent: same
 *                    input -> same computed values -> UPDATE is a no-op in
 *                    effect, not just "no duplicate row").
 *      'conflict' -> never written; counted and reported, a human decides.
 * This exact pattern is applied once for the product-level entity and once
 * per variant - never short-circuited, so a product can succeed while one
 * of its variants conflicts (and vice versa), each reported independently.
 */
import { and, eq } from 'drizzle-orm'
import crypto from 'node:crypto'
import type { Tx } from '../db/tx'
import { products } from '../db/schema/products'
import { productVariants } from '../db/schema/product-variants'
import { productVariantBarcodes } from '../db/schema/product-variant-barcodes'
import { productSlugAliases } from '../db/schema/product-slug-aliases'
import { productCategories } from '../db/schema/product-categories'
import { productImages } from '../db/schema/product-images'
import { findMapping, resolveOrCreateMapping, type MappingResolution } from './mappings'
import type { EntityType, SourceSystem } from './constants'

/** Narrowed to the two outcomes writeProductRow/writeVariantRow are ever called with - every call site already returns early on `'conflict'` before reaching them. */
type ResolvedMapping = Extract<MappingResolution, { outcome: 'created' } | { outcome: 'existing' }>

/**
 * The one seam between "preview a mapping decision" and "actually write
 * one." In dry-run mode this calls ONLY the read-only `findMapping` - never
 * `resolveOrCreateMapping`, which inserts a row on a `'created'` outcome.
 * Without this split, a dry-run run would silently create real
 * `external_entity_mappings` rows (and, on a second dry-run of the same
 * input, misreport them as `'updated'`) - exactly the kind of accidental
 * write Task 14's "dry-run by default" and the testing list's "zero writes
 * in dry-run mode" exist to rule out. The synthesized `'created'`-shaped
 * result below carries `internalId: candidateId` so every caller's
 * `mapping.mapping.internalId` read stays correct without a conditional
 * special case at the call site.
 */
async function resolveIdentity(
	tx: Tx,
	mode: CatalogImportMode,
	input: { sourceSystem: SourceSystem; entityType: EntityType; externalId: string; internalId: string }
): Promise<MappingResolution> {
	// Always look up any EXISTING mapping first (read-only, identical in both
	// modes) and, when one exists, reuse its internalId rather than the
	// caller's freshly-generated candidate. This is not optional: Sprint 10A's
	// resolveOrCreateMapping is idempotent only when called with the SAME
	// (sourceSystem, entityType, externalId, internalId) every time - calling
	// it with a brand-new random internalId on a second run, when a mapping
	// already exists under a DIFFERENT (the real, original) internalId,
	// deterministically returns {outcome:'conflict', reason:
	// 'external_id_points_elsewhere'} rather than {outcome:'existing'}. That
	// would make every re-run of this importer misreport a real, successful
	// second run as a mapping conflict - exactly the idempotency bug Task 16
	// exists to rule out.
	const existing = await findMapping(tx, input.sourceSystem, input.entityType, input.externalId)
	const internalId = existing?.internalId ?? input.internalId

	if (mode === 'dry-run') {
		if (existing) return { outcome: 'existing', mapping: existing }
		return {
			outcome: 'created',
			mapping: {
				id: '',
				sourceSystem: input.sourceSystem,
				entityType: input.entityType,
				externalId: input.externalId,
				internalId,
				createdAt: new Date(),
				updatedAt: new Date()
			}
		}
	}
	return resolveOrCreateMapping(tx, { ...input, internalId })
}
import type { LegacyCatalogDump, LegacyProduct } from './parsers/mysql-catalog'
import type { ProductsFeedRecord } from './parsers/products-feed'
import type { FamilyReconciliationResult, FamilyMatch, FamilyPositionResult } from './reconcile/family-reconciliation'
import type { ReconciliationResult } from './reconcile/sql-1c-reconciliation'
import type { IdNomDuplicateReport } from './reconcile/duplicate-id-nom'

export type CatalogImportMode = 'dry-run' | 'write'

export type CatalogImportInput = {
	dump: LegacyCatalogDump
	oneCRecords: ProductsFeedRecord[]
	families: FamilyReconciliationResult
	positions: ReconciliationResult
	/** From classifyIdNomDuplicates(oneCRecords, 'ID_nom') - a confirmed-matched position whose own ID_nom is a `conflicting`/`price_conflict` duplicate group is still imported for identity (Requirement 9: never silently merged or dropped), but never gets content/price sourced from the disputed field. */
	idNomDuplicates: IdNomDuplicateReport
}

export type CatalogImportUnitKind = 'family' | 'standalone'

export type CatalogImportSkipReason =
	| 'ambiguous_family'
	| 'collision_risk_family'
	| 'unmatched_family'
	| 'ambiguous_position'
	| 'unmatched_position'
	| 'quarantine'
	| 'mapping_conflict_product'
	| 'mapping_conflict_variant'

export type CatalogImportUnitOutcome = {
	kind: CatalogImportUnitKind
	key: string
	action: 'created' | 'updated' | 'skipped'
	skipReason?: CatalogImportSkipReason
	productId?: string
	variantIds?: string[]
	barcodesWritten?: number
	mediaRowsWritten?: number
	slugAliasConflicts?: CatalogImportSlugAliasConflict[]
	unpublishedForMissingBrand?: boolean
	unpublishedForMissingCategory?: boolean
	note: string
}

export type CatalogImportSlugAliasConflict = { locale: string; slug: string; note: string }

export type CatalogImportSummary = {
	/** 'dry-run' or 'write' - read this before interpreting any count below: in dry-run mode every *Written/*Planned number below is a PREVIEW (computed, never persisted); in write mode it reflects rows actually committed to Postgres. */
	mode: CatalogImportMode
	/** Count of import UNITS considered - one per confirmed family, one per unresolved-family MEMBER (Sprint 12B.2.1 Task 6: each member of an unresolved family is now its own unit, not lumped into one family-level unit), and one per standalone legacy product. Sums to created + updated + skipped. */
	totalUnits: number
	/** Count of units where a NEW Product row was (write mode) or would be (dry-run) inserted. */
	productsCreated: number
	/** Count of units where an EXISTING Product row was (write mode) or would be (dry-run) updated - a second run against identical input lands here, not in productsCreated (Task 16's idempotency guarantee). */
	productsUpdated: number
	/** Count of units that produced no Product at all - sum of bySkipReason's values. */
	unitsSkipped: number
	bySkipReason: Record<CatalogImportSkipReason, number>
	/**
	 * Sum of planned/written ProductVariant rows across EVERY created/updated
	 * unit (family-derived and standalone-default variants both count, in
	 * both modes). Sprint 12B.2.1 Task 2 fix: a real dry-run previously
	 * reported 16 here against 5972 `productsCreated`, because the
	 * standalone import path's dry-run branch never set `variantIds` on its
	 * returned unit at all - only family-matched units contributed anything
	 * to this sum. Standalone positions are the majority of real legacy
	 * data (most products have no VariativeNomenclature), so this number was
	 * a near-total undercount, not evidence that standalone products were
	 * missing their default variant - they were planned correctly, just not
	 * counted.
	 */
	variantsWritten: number
	/**
	 * Sum of planned/written product_variant_barcodes rows. Sprint 12B.2.1
	 * Task 3 fix: a real dry-run previously reported this as 0
	 * unconditionally, for every unit, in every run, regardless of real
	 * data - both import paths' dry-run branches returned before
	 * `writeBarcodeRows` was ever called. This was a pure dry-run reporting
	 * gap: write mode's barcode-planning logic itself was already correct
	 * and untouched by this fix.
	 */
	barcodesWritten: number
	/**
	 * Count of created/updated units with ZERO resolved category links.
	 * Sprint 12B.2.1 Task 8/9 fix: previously keyed off the raw LEGACY
	 * `categoryId` being null, not off whether a V2 category mapping
	 * actually resolved - a product with a non-null legacy category id but
	 * no matching V2 mapping yet was silently published `active` with zero
	 * `product_categories` rows. Now keyed off the real resolved-link count.
	 */
	unpublishedForMissingCategory: number
	unpublishedForMissingBrand: number
	/**
	 * Count of slug/locale collisions with a DIFFERENT product, detected and
	 * never auto-reassigned. Sprint 12B.2.1 Task 8 fix: a real dry-run
	 * previously reported this as 0 unconditionally for the same reason as
	 * `barcodesWritten` - `writeSlugAliases`'s collision-detecting `select`
	 * was never reached in dry-run mode at all, so "zero conflicts" was not
	 * evidence the real data has none; the check had simply never run.
	 */
	slugAliasConflicts: number
	mediaRowsWritten: number
	/**
	 * Sprint 12B.2.1 Task 6: the TRUE total count of legacy MySQL products
	 * whose reconciliation outcome is `'quarantine'`, read directly from
	 * `reconcileSqlWith1c`'s own summary (computed over every product in the
	 * dump, unconditionally - independent of this importer's family/
	 * standalone unit-bucketing). Compare against `bySkipReason.quarantine`:
	 * the two should now match (the Task 6 fix makes every family member's
	 * quarantine status individually visible as its own unit), and a future
	 * mismatch between them is itself evidence of a regression in that
	 * per-member surfacing, not a number to reconcile by hand.
	 */
	quarantinedPositionsTotal: number
	examples: {
		created: { key: string; productId: string }[]
		skipped: { key: string; reason: CatalogImportSkipReason }[]
		slugAliasConflicts: CatalogImportSlugAliasConflict[]
	}
}

export type CatalogImportResult = {
	summary: CatalogImportSummary
	units: CatalogImportUnitOutcome[]
}

const EXAMPLE_LIMIT = 5

export class UnsafeImportTargetError extends Error {}

/**
 * Task 15's enforced environment safety guard. Mirrors the convention
 * already established in tests/helpers.ts (which refuses to run the test
 * suite at all unless DATABASE_URL contains "test") - this is the same
 * check, applied to write-mode catalog imports specifically, so the two
 * safeguards reinforce rather than duplicate each other by accident.
 * Intentionally conservative: a database name is only accepted when it
 * contains "test" (case-insensitive) AND does not contain "prod" - a
 * database renamed to something ambiguous is refused, not guessed at.
 */
export function assertSafeImportTarget(databaseUrl: string): void {
	let name: string
	try {
		name = new URL(databaseUrl).pathname.replace(/^\//, '')
	} catch {
		throw new UnsafeImportTargetError(`DATABASE_URL is not a valid URL - refusing write-mode import`)
	}
	const lower = name.toLowerCase()
	if (lower.includes('prod')) {
		throw new UnsafeImportTargetError(
			`Refusing write-mode catalog import: DATABASE_URL points at a database named "${name}", which contains "prod".`
		)
	}
	if (!lower.includes('test')) {
		throw new UnsafeImportTargetError(
			`Refusing write-mode catalog import: DATABASE_URL points at a database named "${name}", which does not contain "test". ` +
				`Write mode only runs against an isolated test database by design - see docs/vizaje-identity-architecture.md §E.`
		)
	}
}

/** The MySQL family member chosen to supply the family's canonical product-level content (Requirement 8's "one main position" rule - Sprint 12B.1 business-rule confirmation 4). Deterministic: lowest legacy product id among members that have a non-null titleRu, falling back to the lowest id overall if none do. */
function pickMainPosition(members: LegacyProduct[]): LegacyProduct {
	const withTitle = members.filter(m => m.titleRu !== null).sort((a, b) => a.id - b.id)
	if (withTitle.length > 0) return withTitle[0]
	return [...members].sort((a, b) => a.id - b.id)[0]
}

/** `true` only for a non-numeric legacy uri - the "real" slug signal already established in dry-run-catalog.ts's seoSlugsNotSet logic (Sprint 12A.2). */
function isRealSlugCandidate(uri: string | null): uri is string {
	return uri !== null && !/^\d+$/.test(uri)
}

/**
 * Canonical slug generation rule (Task 8, documented explicitly per the
 * Sprint 12B.2 instruction "never auto-generate a pretty slug without an
 * explicit, documented rule"): prefer the main position's real (non-numeric)
 * legacy uriRu verbatim; otherwise fall back to a clearly-synthetic,
 * never-pretty placeholder `legacy-<externalId>` so it is unmistakably a
 * V2-generated stand-in awaiting real SEO review, not a real curated slug.
 */
function canonicalSlugFor(mainPosition: LegacyProduct, externalId: string): { slug: string; isGenerated: boolean } {
	if (isRealSlugCandidate(mainPosition.uriRu)) return { slug: mainPosition.uriRu.trim().toLowerCase(), isGenerated: false }
	return { slug: `legacy-${externalId}`, isGenerated: true }
}

/**
 * Two unrelated confirmed products can legitimately derive the same
 * canonical slug from colliding legacy `uriRu` values (the testing list's
 * "SEO alias conflicts" scenario) - `products.slug` is a hard, non-nullable
 * unique column, so an uncaught collision here would abort the whole
 * transaction with a raw Postgres error, not a graceful per-record
 * diagnostic. Read-only check first: if `baseSlug` already belongs to a
 * DIFFERENT product, de-duplicate by appending this product's own external
 * id - the same `-id` suffixing pattern the forensic audit found legacy's
 * own `update_url()` already uses for exactly this situation (Sprint 12B.0
 * forensic audit §8.2), not an invented scheme. `existingProductId` is the
 * id this very call is about to write to (non-null on an 'existing' mapping
 * outcome) - a product "colliding" with its own prior slug is not a
 * collision at all.
 */
/**
 * In dry-run mode no row is ever persisted, so two sibling units processed
 * within the SAME `runCatalogImport` call can never see each other's slug
 * via a DB read (Sprint 12B.2.1 Task 8 finding: a dry-run over two
 * confirmed products sharing a colliding legacy `uriRu` reported ZERO
 * `slugAliasConflicts`, because neither product's slug/alias was ever
 * actually written for the SECOND unit's read to find). This ledger tracks
 * "claimed" canonical slugs and aliases in memory for the duration of one
 * dry-run call, so collision detection is a faithful preview of what write
 * mode would find once prior units in the SAME run had actually committed.
 * `null` in write mode - the DB itself already plays this role there, since
 * writes commit and become visible to later reads within the same
 * transaction.
 */
type DryRunSlugLedger = { canonical: Map<string, string>; aliases: Map<string, string> }

async function ensureUniqueSlug(
	tx: Tx,
	baseSlug: string,
	externalId: string,
	existingProductId: string | null,
	claimingProductId: string,
	ledger: DryRunSlugLedger | null
): Promise<string> {
	const [existing] = await tx.select({ id: products.id }).from(products).where(eq(products.slug, baseSlug)).limit(1)
	let collides = existing !== undefined && existing.id !== existingProductId
	if (!collides && ledger) {
		const claimedBy = ledger.canonical.get(baseSlug)
		if (claimedBy !== undefined && claimedBy !== claimingProductId) collides = true
	}
	const finalSlug = collides ? `${baseSlug}-${externalId}` : baseSlug
	if (ledger) ledger.canonical.set(finalSlug, claimingProductId)
	return finalSlug
}

type ContentSource = {
	nameRu: string
	nameRo: string
	descriptionRu: string | null
	descriptionRo: string | null
	shortDescriptionRu: string | null
	shortDescriptionRo: string | null
	ingredientsRu: string | null
	ingredientsRo: string | null
	instructionsRu: string | null
	instructionsRo: string | null
}

/** Prefers the matched 1C record's content fields (richer, per the field-correspondence matrix) and falls back to the MySQL main position's own fields - never fabricates a title when both are empty (falls back to the external id, which is always a real, non-empty legacy identifier, never an invented string). */
function buildContent(mainPosition: LegacyProduct, oneCRecord: ProductsFeedRecord | undefined, externalId: string): ContentSource {
	return {
		nameRu: mainPosition.titleRu ?? oneCRecord?.VariativeName ?? externalId,
		nameRo: mainPosition.titleRo ?? mainPosition.titleRu ?? externalId,
		descriptionRu: mainPosition.descRu ?? mainPosition.textRu ?? null,
		descriptionRo: mainPosition.descRo ?? mainPosition.textRo ?? null,
		shortDescriptionRu: oneCRecord?.ShortDescriptionRus ?? null,
		shortDescriptionRo: oneCRecord?.ShortDescriptionMD ?? null,
		ingredientsRu: oneCRecord?.componentsRu ?? mainPosition.componentsRu ?? null,
		ingredientsRo: oneCRecord?.componentsMD ?? mainPosition.componentsRo ?? null,
		instructionsRu: oneCRecord?.InstructionRU ?? mainPosition.instructionRu ?? null,
		instructionsRo: oneCRecord?.InstructionMD ?? mainPosition.instructionRo ?? null
	}
}

/**
 * Read-only prediction of whether `resolveOrCreateMapping` would return
 * `'conflict'` for this (sourceSystem, entityType, externalId) if a FRESH
 * internalId were generated for it, WITHOUT ever generating or using one.
 * `resolveIdentity` already does this correctly (look up any existing
 * mapping first, reuse ITS internalId) - this is a documentation note, not
 * a second implementation: every variant-identity resolution in this file
 * must go through `resolveIdentity`, never a bare `resolveOrCreateMapping`
 * call with a freshly-`crypto.randomUUID()`-generated internalId. Calling
 * `resolveOrCreateMapping` directly with a fresh random internalId on a
 * SECOND run against the same external id deterministically mis-reports a
 * legitimate repeat import as `{outcome:'conflict', reason:
 * 'external_id_points_elsewhere'}` (the existing row's internalId - the
 * real, original one - never equals this run's brand-new random guess).
 * This was a real bug in this file prior to Sprint 12B.2.1: variant
 * mappings (both the legacy_mysql/product_variant and the 1c/nomenclature
 * mapping created alongside it) were resolved via a bare
 * `resolveOrCreateMapping` call, so every SECOND run of the importer over
 * the same confirmed family/standalone position would see 100% of its
 * variants falsely conflict - breaking both Task 16's idempotency
 * guarantee and Task 4's "every planned Product has at least one planned
 * ProductVariant" invariant on any re-run. Fixed by routing variant
 * identity resolution through `resolveIdentity` exactly like the product
 * identity resolution already did.
 */
async function writeProductRow(
	tx: Tx,
	mapping: ResolvedMapping,
	candidateId: string,
	fields: {
		brandId: string | null
		slug: string
		content: ContentSource
		status: 'draft' | 'active'
	}
): Promise<{ productId: string; action: 'created' | 'updated' }> {
	if (mapping.outcome === 'created') {
		await tx.insert(products).values({
			id: candidateId,
			brandId: fields.brandId,
			slug: fields.slug,
			nameRu: fields.content.nameRu,
			nameRo: fields.content.nameRo,
			descriptionRu: fields.content.descriptionRu,
			descriptionRo: fields.content.descriptionRo,
			shortDescriptionRu: fields.content.shortDescriptionRu,
			shortDescriptionRo: fields.content.shortDescriptionRo,
			ingredientsRu: fields.content.ingredientsRu,
			ingredientsRo: fields.content.ingredientsRo,
			instructionsRu: fields.content.instructionsRu,
			instructionsRo: fields.content.instructionsRo,
			status: fields.status
		})
		return { productId: candidateId, action: 'created' }
	}
	const productId = mapping.mapping.internalId
	await tx
		.update(products)
		.set({
			brandId: fields.brandId,
			nameRu: fields.content.nameRu,
			nameRo: fields.content.nameRo,
			descriptionRu: fields.content.descriptionRu,
			descriptionRo: fields.content.descriptionRo,
			shortDescriptionRu: fields.content.shortDescriptionRu,
			shortDescriptionRo: fields.content.shortDescriptionRo,
			ingredientsRu: fields.content.ingredientsRu,
			ingredientsRo: fields.content.ingredientsRo,
			instructionsRu: fields.content.instructionsRu,
			instructionsRo: fields.content.instructionsRo,
			status: fields.status,
			updatedAt: new Date()
		})
		.where(eq(products.id, productId))
	return { productId, action: 'updated' }
}

async function writeVariantRow(
	tx: Tx,
	mapping: ResolvedMapping,
	candidateId: string,
	productId: string,
	fields: { sku: string; nameRu: string | null; nameRo: string | null }
): Promise<string> {
	if (mapping.outcome === 'created') {
		await tx.insert(productVariants).values({
			id: candidateId,
			productId,
			sku: fields.sku,
			nameRu: fields.nameRu,
			nameRo: fields.nameRo
		})
		return candidateId
	}
	const variantId = mapping.mapping.internalId
	await tx
		.update(productVariants)
		.set({ productId, nameRu: fields.nameRu, nameRo: fields.nameRo, updatedAt: new Date() })
		.where(eq(productVariants.id, variantId))
	return variantId
}

/**
 * Requirement 5's explicit primary-barcode rule: the MySQL-side barcode
 * wins when present (MySQL/legacy is the system currently serving the live
 * site, per the forensic audit - its barcode is the one actually in
 * production use today), otherwise the first 1C barcode observed for this
 * position. Every other distinct barcode for the same position is still
 * recorded, just not marked primary.
 */
/**
 * `dryRun` gates ONLY the mutating `insert`/`update` calls at the bottom of
 * the loop - every read (the primary-collision check, the
 * already-exists-for-this-variant check) still runs in both modes, so the
 * returned count is a real, DB-state-aware preview in dry-run, not a naive
 * in-memory guess (Sprint 12B.2.1 Task 3: dry-run mode previously never
 * called this function at all for EITHER import path, so `barcodesWritten`
 * was unconditionally 0 in every dry-run regardless of what real data would
 * produce - a pure reporting gap, not evidence the real barcode-planning
 * logic was broken).
 */
async function writeBarcodeRows(tx: Tx, variantId: string, mysqlBarcode: string | null, oneCBarcodes: Set<string>, dryRun: boolean): Promise<number> {
	const ordered = [...(mysqlBarcode !== null ? [mysqlBarcode] : []), ...[...oneCBarcodes].filter(b => b !== mysqlBarcode)]
	let planned = 0
	for (const [index, barcode] of ordered.entries()) {
		const wantsPrimary = index === 0
		let isPrimary = wantsPrimary
		if (wantsPrimary) {
			const [existingPrimary] = await tx
				.select()
				.from(productVariantBarcodes)
				.where(and(eq(productVariantBarcodes.barcode, barcode), eq(productVariantBarcodes.isPrimary, true)))
				.limit(1)
			// Another variant already holds this exact barcode as primary
			// (the global partial-unique index this schema deliberately keeps,
			// mirroring today's single-barcode uniqueness for "the" canonical
			// value) - this row is still recorded, just never marked primary,
			// rather than crashing the whole import over one contested value.
			if (existingPrimary && existingPrimary.variantId !== variantId) isPrimary = false
		}
		const [existingForVariant] = await tx
			.select()
			.from(productVariantBarcodes)
			.where(and(eq(productVariantBarcodes.variantId, variantId), eq(productVariantBarcodes.barcode, barcode)))
			.limit(1)
		if (existingForVariant) {
			if (!dryRun && existingForVariant.isPrimary !== isPrimary) {
				await tx.update(productVariantBarcodes).set({ isPrimary }).where(eq(productVariantBarcodes.id, existingForVariant.id))
			}
			continue
		}
		if (!dryRun) {
			await tx.insert(productVariantBarcodes).values({ variantId, barcode, isPrimary, source: mysqlBarcode === barcode ? 'legacy_mysql' : '1c' })
		}
		planned++
	}
	return planned
}

/**
 * Writes the canonical slug alias plus every known legacy uri as its own
 * alias row. A locale/slug collision with a DIFFERENT product is reported
 * and skipped (Task from the user's testing list: "SEO alias conflicts") -
 * never overwritten, never crashes the run. `dryRun` gates only the final
 * `insert` - the collision-detecting `select` always runs, so `conflicts`
 * is populated correctly in both modes (Sprint 12B.2.1 Task 8: dry-run mode
 * previously returned before this function was ever called at all for
 * EITHER import path, so "zero alias conflicts" in a dry-run summary was
 * not evidence of a clean real dataset - the conflict check had simply
 * never run. Same root cause and same fix shape as the barcode gap above).
 */
async function writeSlugAliases(
	tx: Tx,
	productId: string,
	canonicalSlug: string,
	legacyUris: { locale: 'ru' | 'ro'; slug: string; source: string; isCanonical: boolean }[],
	conflicts: CatalogImportSlugAliasConflict[],
	dryRun: boolean,
	ledger: DryRunSlugLedger | null
): Promise<void> {
	const rows = [{ locale: 'ru' as const, slug: canonicalSlug, source: 'v2_generated_or_legacy_slug', isCanonical: true }, ...legacyUris]
	const seen = new Set<string>()
	for (const row of rows) {
		const dedupeKey = `${row.locale}:${row.slug}`
		if (seen.has(dedupeKey)) continue
		seen.add(dedupeKey)

		const [existing] = await tx
			.select()
			.from(productSlugAliases)
			.where(and(eq(productSlugAliases.locale, row.locale), eq(productSlugAliases.slug, row.slug)))
			.limit(1)
		if (existing) {
			if (existing.productId !== productId) {
				conflicts.push({ locale: row.locale, slug: row.slug, note: 'slug already claimed by a different product - not reassigned' })
			}
			continue
		}
		if (ledger) {
			const claimedBy = ledger.aliases.get(dedupeKey)
			if (claimedBy !== undefined && claimedBy !== productId) {
				conflicts.push({ locale: row.locale, slug: row.slug, note: 'slug already claimed by a different product earlier in this same dry-run - not reassigned' })
				continue
			}
			ledger.aliases.set(dedupeKey, productId)
		}
		if (dryRun) continue
		await tx.insert(productSlugAliases).values({ productId, locale: row.locale, slug: row.slug, isCanonical: row.isCanonical, source: row.source })
	}
}

/** Purely in-memory candidate selection against the already-loaded `dump` - no DB read needed to know what WOULD be written, so `dryRun` gates only the final `insert`. */
async function writeMediaRows(
	tx: Tx,
	dump: LegacyCatalogDump,
	productId: string,
	memberMysqlIds: number[],
	variantIdByMysqlId: Map<number, string>,
	dryRun: boolean
): Promise<number> {
	let planned = 0
	for (const img of dump.productImgs) {
		if (!memberMysqlIds.includes(img.productId) || img.img === null) continue
		planned++
		if (dryRun) continue
		const variantId = variantIdByMysqlId.get(img.productId) ?? null
		await tx.insert(productImages).values({
			productId,
			variantId,
			url: img.img,
			sortOrder: img.sortOrder ?? 0
		})
	}
	return planned
}

function skipUnit(kind: CatalogImportUnitKind, key: string, reason: CatalogImportSkipReason, note: string): CatalogImportUnitOutcome {
	return { kind, key, action: 'skipped', skipReason: reason, note }
}

/**
 * The single entry point. Always runs inside one database transaction
 * (Requirement 17) - any thrown error anywhere in the loop rolls back every
 * write this call attempted, not just the one unit that failed. Dry-run
 * mode never opens a transaction with writes at all; it runs the exact same
 * decision logic (so its skip/create/update counts are a faithful preview)
 * but every write call is replaced with a no-op that still returns a
 * deterministic placeholder id, so the returned summary shape is identical
 * between modes.
 */
export async function runCatalogImport(tx: Tx, input: CatalogImportInput, mode: CatalogImportMode): Promise<CatalogImportResult> {
	const dryRun = mode === 'dry-run'
	const units: CatalogImportUnitOutcome[] = []
	const slugLedger: DryRunSlugLedger | null = dryRun ? { canonical: new Map(), aliases: new Map() } : null

	const oneCByIdNom = new Map(input.oneCRecords.map(r => [r.ID_nom, r]))
	const productById = new Map(input.dump.products.map(p => [p.id, p]))
	const positionByLegacyId = new Map(input.positions.mysqlResults.map(r => [r.legacyProductId, r]))

	const handledLegacyIds = new Set<number>()

	// --- Pass 1: confirmed families -> one product + N variants. ---
	for (const family of input.families.families) {
		if (family.mysqlMemberIds.length === 0) continue // 1C-only family, nothing on the MySQL side to import
		for (const id of family.mysqlMemberIds) handledLegacyIds.add(id)

		if (family.outcome !== 'confirmed_family' || family.collisionRisk) {
			// Sprint 12B.2.1 Task 6 fix: an unresolved family used to collapse
			// ALL of its members into one lumped skip unit, with the reason
			// taken from the FAMILY's own outcome only - so a member that was
			// individually quarantined (e.g. by the Sprint 12A.2 catalog
			// dry-run) never surfaced as `quarantine` in `bySkipReason` at all
			// whenever its family also happened to be ambiguous/unmatched/
			// collision-risk. This is the real, code-grounded explanation for
			// why a dry-run's `bySkipReason.quarantine` undercounted against
			// the true total quarantine population
			// (`input.positions.summary.quarantine`, exposed below as
			// `quarantinedPositionsTotal`): some genuinely-quarantined legacy
			// products were invisible here, hidden inside a family-level
			// bucket. Now each member gets its OWN unit, carrying its OWN true
			// position-level outcome (quarantine takes priority, exactly as
			// `reconcileSqlWith1c` itself already decides it), so no member's
			// individual status is ever lost inside a family-level lump.
			for (const memberId of family.mysqlMemberIds) {
				const position = positionByLegacyId.get(memberId)
				const reason: CatalogImportSkipReason =
					position?.outcome === 'quarantine'
						? 'quarantine'
						: position?.outcome === 'ambiguous'
							? 'ambiguous_position'
							: family.outcome === 'ambiguous_family'
								? family.collisionRisk
									? 'collision_risk_family'
									: 'ambiguous_family'
								: 'unmatched_family'
				units.push(
					skipUnit(
						'family',
						`${family.normalizedCode}:${memberId}`,
						reason,
						position ? `member of unresolved family (${family.reasoning}) - this member's own position-level status: ${position.reasoning}` : family.reasoning
					)
				)
			}
			continue
		}

		const positions = input.families.positions.filter(p => p.normalizedCode === family.normalizedCode && family.mysqlMemberIds.includes(p.mysqlProductId))
		const confirmedPositions = positions.filter((p): p is FamilyPositionResult & { outcome: 'confirmed_position' } => p.outcome === 'confirmed_position')
		if (confirmedPositions.length === 0) {
			units.push(skipUnit('family', family.normalizedCode, 'unmatched_position', 'family matched, but no individual member resolved to a confirmed position'))
			continue
		}

		const outcome = await importFamily(tx, family, confirmedPositions, productById, oneCByIdNom, input.dump, dryRun, slugLedger)
		units.push(outcome)

		for (const p of positions) {
			if (p.outcome !== 'confirmed_position') {
				units.push(skipUnit('family', `${family.normalizedCode}:${p.mysqlProductId}`, p.outcome === 'quarantine' ? 'quarantine' : 'ambiguous_position', p.reasoning))
			}
		}
	}

	// --- Pass 2: standalone (non-family) confirmed positions -> product + default variant. ---
	for (const product of input.dump.products) {
		if (handledLegacyIds.has(product.id)) continue
		handledLegacyIds.add(product.id)

		const position = positionByLegacyId.get(product.id)
		if (!position || position.outcome !== 'confirmed' || position.matchedOneCIdNoms.length !== 1) {
			const reason: CatalogImportSkipReason =
				position?.outcome === 'quarantine' ? 'quarantine' : position?.outcome === 'ambiguous' ? 'ambiguous_position' : 'unmatched_position'
			units.push(skipUnit('standalone', String(product.id), reason, position?.reasoning ?? 'no confirmed 1C match'))
			continue
		}

		const outcome = await importStandalone(tx, product, position.matchedOneCIdNoms[0], oneCByIdNom, input.dump, dryRun, slugLedger)
		units.push(outcome)
	}

	// Sprint 12B.2.1 Task 6: the TRUE total quarantine population, read
	// directly from `reconcileSqlWith1c`'s own per-legacy-product summary -
	// computed unconditionally over every product in the dump, independent
	// of this importer's family/standalone unit-bucketing. Always equal to
	// (or, now that the Task 6 fix above surfaces every family member's own
	// status, consistent with) `bySkipReason.quarantine`'s sum once every
	// member is individually visible - kept as a SEPARATE field rather than
	// folded into `bySkipReason` so a future regression in the per-member
	// surfacing above is immediately visible as a mismatch between the two
	// numbers, instead of silently reintroducing the undercount.
	return buildResult(units, mode, input.positions.summary.quarantine)
}

/**
 * Thrown when every one of a confirmed family's or standalone position's
 * variant-identity mappings resolved to `'conflict'` - i.e. this unit would
 * otherwise produce a Product with zero planned ProductVariants. Rolls back
 * the whole write-mode transaction (Requirement 17's rollback guarantee)
 * rather than letting a variant-less product slip through. A genuine
 * external-id-points-elsewhere conflict for EVERY member of a family is an
 * identity collision that needs a human decision, not an automatic partial
 * import (Sprint 12B.2.1 Task 4).
 */
export class ZeroVariantProductError extends Error {
	constructor(kind: CatalogImportUnitKind, key: string) {
		super(`${kind} unit "${key}" would produce a Product with zero planned ProductVariants (every member's variant-identity mapping conflicted) - aborting rather than publishing an orphan product`)
	}
}

/**
 * Builds the entire write/plan for one confirmed family. Dry-run and write
 * modes now run the SAME code path end to end - every mutating `insert`/
 * `update` is gated by `dryRun` inside the `write*` helpers themselves, not
 * by an early return here - so a dry-run summary is a faithful preview of
 * every write mode would perform (brand/category resolution, slug
 * collision detection, barcode planning, media planning), not just the
 * product-mapping decision. This fixes the Sprint 12B.2.1 real-run findings:
 * dry-run `variantIds`/`barcodesWritten`/`slugAliasConflicts`/
 * `unpublishedFor*` were previously either missing or hard-coded absent
 * for every unit, because the function returned before computing any of
 * them.
 */
async function importFamily(
	tx: Tx,
	family: FamilyMatch,
	confirmedPositions: (FamilyPositionResult & { outcome: 'confirmed_position' })[],
	productById: Map<number, LegacyProduct>,
	oneCByIdNom: Map<string, ProductsFeedRecord>,
	dump: LegacyCatalogDump,
	dryRun: boolean,
	slugLedger: DryRunSlugLedger | null
): Promise<CatalogImportUnitOutcome> {
	const members = confirmedPositions.map(p => productById.get(p.mysqlProductId)).filter((p): p is LegacyProduct => p !== undefined)
	const mainPosition = pickMainPosition(members)
	const externalId = family.normalizedCode
	const mainOneC = oneCByIdNom.get(confirmedPositions.find(p => p.mysqlProductId === mainPosition.id)?.matchedOneCIdNoms[0] ?? '')
	const content = buildContent(mainPosition, mainOneC, externalId)
	const { slug } = canonicalSlugFor(mainPosition, externalId)

	const candidateProductId = crypto.randomUUID()
	const mode: CatalogImportMode = dryRun ? 'dry-run' : 'write'
	const productMapping = await resolveIdentity(tx, mode, {
		sourceSystem: 'legacy_mysql',
		entityType: 'nomenclature_group',
		externalId,
		internalId: candidateProductId
	})
	if (productMapping.outcome === 'conflict') {
		return skipUnit('family', externalId, 'mapping_conflict_product', 'external_entity_mappings conflict for this nomenclature_group - never auto-resolved')
	}
	const productId = productMapping.mapping.internalId
	const existingProductId = productMapping.outcome === 'existing' ? productId : null

	// Phase 1: IDENTITY resolution only (external_entity_mappings has no FK
	// to products/product_variants, so this is always safe before the
	// product row exists). Runs for every confirmed member BEFORE any
	// product-level write is attempted, so a family where every member's
	// variant mapping conflicts never gets as far as writing a product row
	// at all (Task 4's "every planned Product has at least one planned
	// ProductVariant" invariant) - but the ACTUAL `product_variants`/
	// `product_variant_barcodes` inserts are deferred to Phase 3 below,
	// because both tables have a hard FK to a row that does not exist yet
	// at this point (`product_variants.product_id -> products.id`). Writing
	// them here, before the product row, was a real bug found while
	// verifying this fix: every write-mode family/standalone import failed
	// outright with a foreign-key violation, which is why this ordering
	// fix ships together with the zero-variant-invariant fix rather than
	// as a separate change - the two are inseparable once variant
	// resolution moves ahead of the product write.
	type ResolvedVariant = { member: LegacyProduct; idNom: string; oneC: ProductsFeedRecord | undefined; candidateVariantId: string; variantMapping: ResolvedMapping; variantId: string }
	const resolved: ResolvedVariant[] = []
	for (const pos of confirmedPositions) {
		const member = productById.get(pos.mysqlProductId)
		if (!member) continue
		const idNom = pos.matchedOneCIdNoms[0]
		const oneC = oneCByIdNom.get(idNom)
		const candidateVariantId = crypto.randomUUID()
		// Routed through resolveIdentity, NOT a bare resolveOrCreateMapping
		// call - see the comment above writeProductRow for why a fresh
		// random internalId on every run would otherwise falsely conflict
		// on every re-run (Sprint 12B.2.1's idempotency fix).
		const variantMapping = await resolveIdentity(tx, mode, {
			sourceSystem: 'legacy_mysql',
			entityType: 'product_variant',
			externalId: String(member.id),
			internalId: candidateVariantId
		})
		if (variantMapping.outcome === 'conflict') continue
		const variantId = variantMapping.mapping.internalId
		// Second, independent mapping under the 1c namespace for the same
		// variant - both namespaces stay independent (never merged by a
		// shared externalId string) per the standing identity-namespace rule.
		await resolveIdentity(tx, mode, { sourceSystem: '1c', entityType: 'nomenclature', externalId: idNom, internalId: variantId })
		resolved.push({ member, idNom, oneC, candidateVariantId, variantMapping, variantId })
	}

	if (resolved.length === 0) {
		if (!dryRun) throw new ZeroVariantProductError('family', externalId)
		return skipUnit('family', externalId, 'unmatched_position', "every confirmed member's variant-identity mapping conflicted - would publish zero variants, so this family is skipped rather than auto-published")
	}

	// Phase 2: read-only computations that don't need the product row to
	// exist (brand mapping lookup, slug-collision check against OTHER
	// products' already-committed rows).
	const brandId = mainPosition.brandId !== null ? await resolveBrandId(tx, mainPosition.brandId) : null
	const uniqueSlug = await ensureUniqueSlug(tx, slug, externalId, existingProductId, productId, slugLedger)

	// Phase 3: now that at least one variant is guaranteed, write the
	// product row FIRST (every downstream write in this function has an FK
	// to `products.id`), then everything that depends on it.
	const { linkedCategoryIds } = await writeCategoryLinksPreview(tx, mainPosition, dump)
	const unpublishedForMissingCategory = linkedCategoryIds.length === 0
	const status: 'draft' | 'active' = brandId === null || unpublishedForMissingCategory ? 'draft' : 'active'

	let action: 'created' | 'updated'
	if (!dryRun) {
		const written = await writeProductRow(tx, productMapping, candidateProductId, { brandId, slug: uniqueSlug, content, status })
		action = written.action
	} else {
		action = productMapping.outcome === 'created' ? 'created' : 'updated'
	}

	if (!dryRun) await persistCategoryLinks(tx, productId, linkedCategoryIds)

	const variantIds: string[] = []
	let barcodesPlanned = 0
	const variantIdByMysqlId = new Map<number, string>()
	for (const r of resolved) {
		if (!dryRun) {
			// Requirement 6: the real matched 1C ID_nom is always used verbatim
			// as product_variants.sku, regardless of whether this ID_nom also
			// appears in idNomDuplicates (a real legacy identifier stays real
			// even when it has a duplicate-group classification elsewhere in
			// the feed - only its CONTENT, never its use as a stable
			// identifier, would be affected, and this importer never sources
			// content from a conflicting/price_conflict duplicate group).
			await writeVariantRow(tx, r.variantMapping, r.candidateVariantId, productId, {
				sku: r.idNom,
				nameRu: r.member.titleRu !== mainPosition.titleRu ? r.member.titleRu : null,
				nameRo: r.member.titleRo !== mainPosition.titleRo ? r.member.titleRo : null
			})
		}
		variantIdByMysqlId.set(r.member.id, r.variantId)
		variantIds.push(r.variantId)

		const oneCBarcodes = new Set<string>()
		if (r.oneC?.Barcode) oneCBarcodes.add(r.oneC.Barcode)
		barcodesPlanned += await writeBarcodeRows(tx, r.variantId, r.member.barcode, oneCBarcodes, dryRun)
	}

	const conflicts: CatalogImportSlugAliasConflict[] = []
	const legacyUris: { locale: 'ru' | 'ro'; slug: string; source: string; isCanonical: boolean }[] = []
	if (mainPosition.uriRu !== null) legacyUris.push({ locale: 'ru', slug: mainPosition.uriRu.trim().toLowerCase(), source: 'legacy_uri_ru', isCanonical: false })
	if (mainPosition.uriRo !== null) legacyUris.push({ locale: 'ro', slug: mainPosition.uriRo.trim().toLowerCase(), source: 'legacy_uri_ro', isCanonical: false })
	await writeSlugAliases(tx, productId, uniqueSlug, legacyUris, conflicts, dryRun, slugLedger)

	const mediaWritten = await writeMediaRows(
		tx,
		dump,
		productId,
		members.map(m => m.id),
		variantIdByMysqlId,
		dryRun
	)

	return {
		kind: 'family',
		key: externalId,
		action,
		productId,
		variantIds,
		barcodesWritten: barcodesPlanned,
		mediaRowsWritten: mediaWritten,
		slugAliasConflicts: conflicts,
		unpublishedForMissingBrand: brandId === null,
		unpublishedForMissingCategory,
		note: `${dryRun ? 'dry-run: would ' : ''}${action} family product (${variantIds.length} variant(s), ${barcodesPlanned} barcode row(s) ${dryRun ? 'planned' : 'written'}, ${mediaWritten} media row(s), ${conflicts.length} slug conflict(s))`
	}
}

/** Same unified dry-run/write code path as importFamily - see its doc comment. */
async function importStandalone(
	tx: Tx,
	product: LegacyProduct,
	idNom: string,
	oneCByIdNom: Map<string, ProductsFeedRecord>,
	dump: LegacyCatalogDump,
	dryRun: boolean,
	slugLedger: DryRunSlugLedger | null
): Promise<CatalogImportUnitOutcome> {
	const oneC = oneCByIdNom.get(idNom)
	const externalId = product.guid ?? String(product.id)
	const content = buildContent(product, oneC, externalId)
	const { slug } = canonicalSlugFor(product, externalId)

	const candidateProductId = crypto.randomUUID()
	const mode: CatalogImportMode = dryRun ? 'dry-run' : 'write'
	const productMapping = await resolveIdentity(tx, mode, { sourceSystem: 'legacy_mysql', entityType: 'product', externalId, internalId: candidateProductId })
	if (productMapping.outcome === 'conflict') {
		return skipUnit('standalone', externalId, 'mapping_conflict_product', 'external_entity_mappings conflict for this product - never auto-resolved')
	}
	const productId = productMapping.mapping.internalId
	const existingProductId = productMapping.outcome === 'existing' ? productId : null

	// Phase 1: resolve the single default variant's IDENTITY only (external_entity_mappings has no FK to products/product_variants - safe before the product row exists). The product_variants row itself is written in Phase 3, after the product row (see importFamily's doc comment for why this ordering is not optional - a bug here was the direct cause of the Sprint 12B.2.1 real-run foreign-key failures).
	const candidateVariantId = crypto.randomUUID()
	const variantMapping = await resolveIdentity(tx, mode, { sourceSystem: 'legacy_mysql', entityType: 'product_variant', externalId, internalId: candidateVariantId })
	if (variantMapping.outcome === 'conflict') {
		return skipUnit('standalone', externalId, 'mapping_conflict_variant', "the default variant's external_entity_mappings conflict - product skipped rather than publishing with zero variants")
	}
	const variantId = variantMapping.mapping.internalId
	await resolveIdentity(tx, mode, { sourceSystem: '1c', entityType: 'nomenclature', externalId: idNom, internalId: variantId })

	// Phase 2: read-only computations that don't need the product row to exist.
	const brandId = product.brandId !== null ? await resolveBrandId(tx, product.brandId) : null
	const uniqueSlug = await ensureUniqueSlug(tx, slug, externalId, existingProductId, productId, slugLedger)
	const { linkedCategoryIds } = await writeCategoryLinksPreview(tx, product, dump)
	const unpublishedForMissingCategory = linkedCategoryIds.length === 0
	const status: 'draft' | 'active' = brandId === null || unpublishedForMissingCategory ? 'draft' : 'active'

	// Phase 3: write the product row, then everything with an FK to it.
	let action: 'created' | 'updated'
	if (!dryRun) {
		const written = await writeProductRow(tx, productMapping, candidateProductId, { brandId, slug: uniqueSlug, content, status })
		action = written.action
		await persistCategoryLinks(tx, productId, linkedCategoryIds)
		await writeVariantRow(tx, variantMapping, candidateVariantId, productId, { sku: idNom, nameRu: null, nameRo: null })
	} else {
		action = productMapping.outcome === 'created' ? 'created' : 'updated'
	}
	const variantIds: string[] = [variantId]
	const variantIdByMysqlId = new Map<number, string>([[product.id, variantId]])
	const oneCBarcodes = new Set<string>()
	if (oneC?.Barcode) oneCBarcodes.add(oneC.Barcode)
	const barcodesPlanned = await writeBarcodeRows(tx, variantId, product.barcode, oneCBarcodes, dryRun)

	const conflicts: CatalogImportSlugAliasConflict[] = []
	const legacyUris: { locale: 'ru' | 'ro'; slug: string; source: string; isCanonical: boolean }[] = []
	if (product.uriRu !== null) legacyUris.push({ locale: 'ru', slug: product.uriRu.trim().toLowerCase(), source: 'legacy_uri_ru', isCanonical: false })
	if (product.uriRo !== null) legacyUris.push({ locale: 'ro', slug: product.uriRo.trim().toLowerCase(), source: 'legacy_uri_ro', isCanonical: false })
	await writeSlugAliases(tx, productId, uniqueSlug, legacyUris, conflicts, dryRun, slugLedger)

	const mediaWritten = await writeMediaRows(tx, dump, productId, [product.id], variantIdByMysqlId, dryRun)

	return {
		kind: 'standalone',
		key: externalId,
		action,
		productId,
		variantIds,
		barcodesWritten: barcodesPlanned,
		mediaRowsWritten: mediaWritten,
		slugAliasConflicts: conflicts,
		unpublishedForMissingBrand: brandId === null,
		unpublishedForMissingCategory,
		note: `${dryRun ? 'dry-run: would ' : ''}${action} standalone product + default variant (${barcodesPlanned} barcode row(s) ${dryRun ? 'planned' : 'written'}, ${mediaWritten} media row(s), ${conflicts.length} slug conflict(s))`
	}
}

/** Only ever resolves an EXISTING legacy_mysql/brand mapping (never creates one - this importer has no brand-creation logic of its own, Task 9 treats a missing mapping as "unmatched", not as license to invent a V2 brand). */
async function resolveBrandId(tx: Tx, legacyBrandId: number): Promise<string | null> {
	const { findMapping } = await import('./mappings')
	const mapping = await findMapping(tx, 'legacy_mysql', 'brand', String(legacyBrandId))
	return mapping?.internalId ?? null
}

/**
 * Same resolve-only posture as resolveBrandId - a broken/missing category
 * reference leaves the product uncategorized rather than inventing or
 * guessing a category, per the standing Sprint 12A.2 decision (products
 * 1455/6519/7698: no valid category anywhere, must import uncategorized).
 *
 * Returns the V2 category ids actually resolved (in both modes - the
 * `findMapping` read always runs; only the `productCategories` insert is
 * gated by `dryRun`), so the CALLER can compute "is this product actually
 * uncategorized" from real mapping-resolution success. Sprint 12B.2.1 Task
 * 8/9 fix: the caller previously used `product.categoryId === null` (the
 * raw LEGACY field being merely absent) to decide `unpublishedForMissingCategory`
 * and `status`, NOT whether a V2 category mapping actually resolved. A
 * product whose legacy `categoryId` was a non-null id with NO matching V2
 * category mapping yet (a real, confirmed Sprint 12A.2 scenario: 3/33
 * category-broken products, and potentially more once real category
 * mappings are seeded) would therefore have been marked `status: 'active'`
 * and `unpublishedForMissingCategory: false` while having ZERO rows in
 * `product_categories` - a published, uncategorized product. Returning the
 * resolved id list lets the caller key off `linkedCategoryIds.length === 0`
 * instead, which is actually true "no category ended up linked."
 *
 * Split into a read-only PREVIEW (this function - safe to call before the
 * product row exists, since it only reads `external_entity_mappings`) and
 * `persistCategoryLinks` (the actual `product_categories` insert, which has
 * a hard FK to `products.id` and so must only ever run AFTER the product
 * row has been written).
 */
async function writeCategoryLinksPreview(tx: Tx, product: LegacyProduct, dump: LegacyCatalogDump): Promise<{ linkedCategoryIds: string[] }> {
	const { findMapping } = await import('./mappings')
	const candidateCategoryIds = new Set<number>()
	if (product.categoryId !== null) candidateCategoryIds.add(product.categoryId)
	for (const pc of dump.productCategories) {
		if (pc.productId === product.id) candidateCategoryIds.add(pc.categoryId)
	}
	const linkedCategoryIds: string[] = []
	for (const legacyCategoryId of candidateCategoryIds) {
		const mapping = await findMapping(tx, 'legacy_mysql', 'category', String(legacyCategoryId))
		if (!mapping) continue
		linkedCategoryIds.push(mapping.internalId)
	}
	return { linkedCategoryIds }
}

/** The actual `product_categories` insert - write-mode only, always called AFTER the product row exists. */
async function persistCategoryLinks(tx: Tx, productId: string, linkedCategoryIds: string[]): Promise<void> {
	for (const categoryId of linkedCategoryIds) {
		const [existing] = await tx
			.select()
			.from(productCategories)
			.where(and(eq(productCategories.productId, productId), eq(productCategories.categoryId, categoryId)))
			.limit(1)
		if (existing) continue
		await tx.insert(productCategories).values({ productId, categoryId })
	}
}

function buildResult(units: CatalogImportUnitOutcome[], mode: CatalogImportMode, quarantinedPositionsTotal: number): CatalogImportResult {
	const bySkipReason: Record<CatalogImportSkipReason, number> = {
		ambiguous_family: 0,
		collision_risk_family: 0,
		unmatched_family: 0,
		ambiguous_position: 0,
		unmatched_position: 0,
		quarantine: 0,
		mapping_conflict_product: 0,
		mapping_conflict_variant: 0
	}
	for (const u of units) if (u.skipReason) bySkipReason[u.skipReason]++

	const created = units.filter(u => u.action === 'created')
	const updated = units.filter(u => u.action === 'updated')
	const skipped = units.filter(u => u.action === 'skipped')

	const variantsWritten = units.reduce((n, u) => n + (u.variantIds?.length ?? 0), 0)
	const barcodesWritten = units.reduce((n, u) => n + (u.barcodesWritten ?? 0), 0)
	const mediaRowsWritten = units.reduce((n, u) => n + (u.mediaRowsWritten ?? 0), 0)
	const allSlugConflicts = units.flatMap(u => u.slugAliasConflicts ?? [])
	const unpublishedForMissingCategory = units.filter(u => u.unpublishedForMissingCategory).length
	const unpublishedForMissingBrand = units.filter(u => u.unpublishedForMissingBrand).length

	return {
		summary: {
			mode,
			totalUnits: units.length,
			productsCreated: created.length,
			productsUpdated: updated.length,
			unitsSkipped: skipped.length,
			bySkipReason,
			variantsWritten,
			barcodesWritten,
			unpublishedForMissingCategory,
			unpublishedForMissingBrand,
			slugAliasConflicts: allSlugConflicts.length,
			mediaRowsWritten,
			quarantinedPositionsTotal,
			examples: {
				created: created.slice(0, EXAMPLE_LIMIT).map(u => ({ key: u.key, productId: u.productId ?? '' })),
				skipped: skipped.slice(0, EXAMPLE_LIMIT).map(u => ({ key: u.key, reason: u.skipReason as CatalogImportSkipReason })),
				slugAliasConflicts: allSlugConflicts.slice(0, EXAMPLE_LIMIT)
			}
		},
		units
	}
}
