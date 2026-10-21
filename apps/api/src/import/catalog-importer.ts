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
	mode: CatalogImportMode
	totalUnits: number
	productsCreated: number
	productsUpdated: number
	unitsSkipped: number
	bySkipReason: Record<CatalogImportSkipReason, number>
	variantsWritten: number
	barcodesWritten: number
	unpublishedForMissingCategory: number
	unpublishedForMissingBrand: number
	slugAliasConflicts: number
	mediaRowsWritten: number
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
async function ensureUniqueSlug(tx: Tx, baseSlug: string, externalId: string, existingProductId: string | null): Promise<string> {
	const [existing] = await tx.select({ id: products.id }).from(products).where(eq(products.slug, baseSlug)).limit(1)
	if (!existing || existing.id === existingProductId) return baseSlug
	return `${baseSlug}-${externalId}`
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
async function writeBarcodeRows(tx: Tx, variantId: string, mysqlBarcode: string | null, oneCBarcodes: Set<string>): Promise<number> {
	const ordered = [...(mysqlBarcode !== null ? [mysqlBarcode] : []), ...[...oneCBarcodes].filter(b => b !== mysqlBarcode)]
	let written = 0
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
			if (existingForVariant.isPrimary !== isPrimary) {
				await tx.update(productVariantBarcodes).set({ isPrimary }).where(eq(productVariantBarcodes.id, existingForVariant.id))
			}
			continue
		}
		await tx.insert(productVariantBarcodes).values({ variantId, barcode, isPrimary, source: mysqlBarcode === barcode ? 'legacy_mysql' : '1c' })
		written++
	}
	return written
}

/** Writes the canonical slug alias plus every known legacy uri as its own alias row. A locale/slug collision with a DIFFERENT product is reported and skipped (Task from the user's testing list: "SEO alias conflicts") - never overwritten, never crashes the run. */
async function writeSlugAliases(
	tx: Tx,
	productId: string,
	canonicalSlug: string,
	legacyUris: { locale: 'ru' | 'ro'; slug: string; source: string; isCanonical: boolean }[],
	conflicts: CatalogImportSlugAliasConflict[]
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
		await tx.insert(productSlugAliases).values({ productId, locale: row.locale, slug: row.slug, isCanonical: row.isCanonical, source: row.source })
	}
}

async function writeMediaRows(
	tx: Tx,
	dump: LegacyCatalogDump,
	productId: string,
	memberMysqlIds: number[],
	variantIdByMysqlId: Map<number, string>
): Promise<number> {
	let written = 0
	for (const img of dump.productImgs) {
		if (!memberMysqlIds.includes(img.productId) || img.img === null) continue
		const variantId = variantIdByMysqlId.get(img.productId) ?? null
		await tx.insert(productImages).values({
			productId,
			variantId,
			url: img.img,
			sortOrder: img.sortOrder ?? 0
		})
		written++
	}
	return written
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

	const oneCByIdNom = new Map(input.oneCRecords.map(r => [r.ID_nom, r]))
	const productById = new Map(input.dump.products.map(p => [p.id, p]))
	const positionByLegacyId = new Map(input.positions.mysqlResults.map(r => [r.legacyProductId, r]))
	const conflictingIdNoms = new Set(
		input.idNomDuplicates.groups.filter(g => g.classification === 'conflicting' || g.classification === 'price_conflict').map(g => g.idNom)
	)

	const handledLegacyIds = new Set<number>()

	// --- Pass 1: confirmed families -> one product + N variants. ---
	for (const family of input.families.families) {
		if (family.mysqlMemberIds.length === 0) continue // 1C-only family, nothing on the MySQL side to import
		for (const id of family.mysqlMemberIds) handledLegacyIds.add(id)

		if (family.outcome !== 'confirmed_family' || family.collisionRisk) {
			const reason: CatalogImportSkipReason = family.outcome === 'ambiguous_family' ? (family.collisionRisk ? 'collision_risk_family' : 'ambiguous_family') : 'unmatched_family'
			units.push(skipUnit('family', family.normalizedCode, reason, family.reasoning))
			continue
		}

		const positions = input.families.positions.filter(p => p.normalizedCode === family.normalizedCode && family.mysqlMemberIds.includes(p.mysqlProductId))
		const confirmedPositions = positions.filter((p): p is FamilyPositionResult & { outcome: 'confirmed_position' } => p.outcome === 'confirmed_position')
		if (confirmedPositions.length === 0) {
			units.push(skipUnit('family', family.normalizedCode, 'unmatched_position', 'family matched, but no individual member resolved to a confirmed position'))
			continue
		}

		const outcome = await importFamily(tx, family, confirmedPositions, productById, oneCByIdNom, conflictingIdNoms, input.dump, dryRun)
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

		const outcome = await importStandalone(tx, product, position.matchedOneCIdNoms[0], oneCByIdNom, conflictingIdNoms, input.dump, dryRun)
		units.push(outcome)
	}

	return buildResult(units, mode)
}

async function importFamily(
	tx: Tx,
	family: FamilyMatch,
	confirmedPositions: (FamilyPositionResult & { outcome: 'confirmed_position' })[],
	productById: Map<number, LegacyProduct>,
	oneCByIdNom: Map<string, ProductsFeedRecord>,
	_conflictingIdNoms: Set<string>,
	dump: LegacyCatalogDump,
	dryRun: boolean
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

	if (dryRun) {
		return {
			kind: 'family',
			key: externalId,
			action: productMapping.outcome === 'created' ? 'created' : 'updated',
			productId: productMapping.mapping.internalId,
			variantIds: confirmedPositions.map(p => p.mysqlProductId.toString()),
			note: `dry-run: would ${productMapping.outcome === 'created' ? 'create' : 'update'} family product with ${confirmedPositions.length} variant(s)`
		}
	}

	const brandId = mainPosition.brandId !== null ? await resolveBrandId(tx, mainPosition.brandId) : null
	const existingProductId = productMapping.outcome === 'existing' ? productMapping.mapping.internalId : null
	const uniqueSlug = await ensureUniqueSlug(tx, slug, externalId, existingProductId)
	const { productId, action } = await writeProductRow(tx, productMapping, candidateProductId, {
		brandId,
		slug: uniqueSlug,
		content,
		status: brandId === null || mainPosition.categoryId === null ? 'draft' : 'active'
	})

	await writeCategoryLinks(tx, productId, mainPosition, dump)

	const conflicts: CatalogImportSlugAliasConflict[] = []
	const legacyUris: { locale: 'ru' | 'ro'; slug: string; source: string; isCanonical: boolean }[] = []
	if (mainPosition.uriRu !== null) legacyUris.push({ locale: 'ru', slug: mainPosition.uriRu.trim().toLowerCase(), source: 'legacy_uri_ru', isCanonical: false })
	if (mainPosition.uriRo !== null) legacyUris.push({ locale: 'ro', slug: mainPosition.uriRo.trim().toLowerCase(), source: 'legacy_uri_ro', isCanonical: false })
	await writeSlugAliases(tx, productId, uniqueSlug, legacyUris, conflicts)

	const variantIds: string[] = []
	let barcodesWritten = 0
	const variantIdByMysqlId = new Map<number, string>()
	for (const pos of confirmedPositions) {
		const member = productById.get(pos.mysqlProductId)
		if (!member) continue
		const idNom = pos.matchedOneCIdNoms[0]
		const oneC = oneCByIdNom.get(idNom)
		const candidateVariantId = crypto.randomUUID()
		const variantMapping = await resolveOrCreateMapping(tx, {
			sourceSystem: 'legacy_mysql',
			entityType: 'product_variant',
			externalId: String(member.id),
			internalId: candidateVariantId
		})
		if (variantMapping.outcome === 'conflict') continue
		// Requirement 6: the real matched 1C ID_nom is always used verbatim as
		// product_variants.sku, regardless of whether this ID_nom also
		// appears in idNomDuplicates (a real legacy identifier stays real
		// even when it has a duplicate-group classification elsewhere in the
		// feed - only its CONTENT, never its use as a stable identifier,
		// would be affected by that classification, and this importer never
		// sources content from a conflicting/price_conflict duplicate group).
		const variantId = await writeVariantRow(tx, variantMapping, candidateVariantId, productId, {
			sku: idNom,
			nameRu: member.titleRu !== mainPosition.titleRu ? member.titleRu : null,
			nameRo: member.titleRo !== mainPosition.titleRo ? member.titleRo : null
		})
		// Second, independent mapping under the 1c namespace for the same
		// variant - both namespaces stay independent (never merged by a
		// shared externalId string) per the standing identity-namespace rule.
		await resolveOrCreateMapping(tx, { sourceSystem: '1c', entityType: 'nomenclature', externalId: idNom, internalId: variantId })
		variantIdByMysqlId.set(member.id, variantId)
		variantIds.push(variantId)

		const oneCBarcodes = new Set<string>()
		if (oneC?.Barcode) oneCBarcodes.add(oneC.Barcode)
		barcodesWritten += await writeBarcodeRows(tx, variantId, member.barcode, oneCBarcodes)
	}

	const mediaWritten = await writeMediaRows(
		tx,
		dump,
		productId,
		members.map(m => m.id),
		variantIdByMysqlId
	)

	return {
		kind: 'family',
		key: externalId,
		action,
		productId,
		variantIds,
		barcodesWritten,
		mediaRowsWritten: mediaWritten,
		slugAliasConflicts: conflicts,
		unpublishedForMissingBrand: brandId === null,
		unpublishedForMissingCategory: mainPosition.categoryId === null,
		note: `${action} family product (${variantIds.length} variant(s), ${barcodesWritten} barcode row(s), ${mediaWritten} media row(s), ${conflicts.length} slug conflict(s))`
	}
}

async function importStandalone(
	tx: Tx,
	product: LegacyProduct,
	idNom: string,
	oneCByIdNom: Map<string, ProductsFeedRecord>,
	_conflictingIdNoms: Set<string>,
	dump: LegacyCatalogDump,
	dryRun: boolean
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

	if (dryRun) {
		return {
			kind: 'standalone',
			key: externalId,
			action: productMapping.outcome === 'created' ? 'created' : 'updated',
			productId: productMapping.mapping.internalId,
			note: `dry-run: would ${productMapping.outcome === 'created' ? 'create' : 'update'} standalone product + default variant`
		}
	}

	const brandId = product.brandId !== null ? await resolveBrandId(tx, product.brandId) : null
	const existingProductId = productMapping.outcome === 'existing' ? productMapping.mapping.internalId : null
	const uniqueSlug = await ensureUniqueSlug(tx, slug, externalId, existingProductId)
	const { productId, action } = await writeProductRow(tx, productMapping, candidateProductId, {
		brandId,
		slug: uniqueSlug,
		content,
		status: brandId === null || product.categoryId === null ? 'draft' : 'active'
	})

	await writeCategoryLinks(tx, productId, product, dump)

	const conflicts: CatalogImportSlugAliasConflict[] = []
	const legacyUris: { locale: 'ru' | 'ro'; slug: string; source: string; isCanonical: boolean }[] = []
	if (product.uriRu !== null) legacyUris.push({ locale: 'ru', slug: product.uriRu.trim().toLowerCase(), source: 'legacy_uri_ru', isCanonical: false })
	if (product.uriRo !== null) legacyUris.push({ locale: 'ro', slug: product.uriRo.trim().toLowerCase(), source: 'legacy_uri_ro', isCanonical: false })
	await writeSlugAliases(tx, productId, uniqueSlug, legacyUris, conflicts)

	const candidateVariantId = crypto.randomUUID()
	const variantMapping = await resolveOrCreateMapping(tx, { sourceSystem: 'legacy_mysql', entityType: 'product_variant', externalId, internalId: candidateVariantId })
	let variantIds: string[] = []
	let barcodesWritten = 0
	const variantIdByMysqlId = new Map<number, string>()
	if (variantMapping.outcome !== 'conflict') {
		const variantId = await writeVariantRow(tx, variantMapping, candidateVariantId, productId, { sku: idNom, nameRu: null, nameRo: null })
		await resolveOrCreateMapping(tx, { sourceSystem: '1c', entityType: 'nomenclature', externalId: idNom, internalId: variantId })
		variantIds = [variantId]
		variantIdByMysqlId.set(product.id, variantId)
		const oneCBarcodes = new Set<string>()
		if (oneC?.Barcode) oneCBarcodes.add(oneC.Barcode)
		barcodesWritten = await writeBarcodeRows(tx, variantId, product.barcode, oneCBarcodes)
	}

	const mediaWritten = await writeMediaRows(tx, dump, productId, [product.id], variantIdByMysqlId)

	return {
		kind: 'standalone',
		key: externalId,
		action,
		productId,
		variantIds,
		barcodesWritten,
		mediaRowsWritten: mediaWritten,
		slugAliasConflicts: conflicts,
		unpublishedForMissingBrand: brandId === null,
		unpublishedForMissingCategory: product.categoryId === null,
		note: `${action} standalone product + default variant (${barcodesWritten} barcode row(s), ${mediaWritten} media row(s), ${conflicts.length} slug conflict(s))`
	}
}

/** Only ever resolves an EXISTING legacy_mysql/brand mapping (never creates one - this importer has no brand-creation logic of its own, Task 9 treats a missing mapping as "unmatched", not as license to invent a V2 brand). */
async function resolveBrandId(tx: Tx, legacyBrandId: number): Promise<string | null> {
	const { findMapping } = await import('./mappings')
	const mapping = await findMapping(tx, 'legacy_mysql', 'brand', String(legacyBrandId))
	return mapping?.internalId ?? null
}

/** Same resolve-only posture as resolveBrandId - a broken/missing category reference leaves the product uncategorized (and, by the caller's own status computation, draft) rather than inventing or guessing a category, per the standing Sprint 12A.2 decision. */
async function writeCategoryLinks(tx: Tx, productId: string, product: LegacyProduct, dump: LegacyCatalogDump): Promise<void> {
	const { findMapping } = await import('./mappings')
	const candidateCategoryIds = new Set<number>()
	if (product.categoryId !== null) candidateCategoryIds.add(product.categoryId)
	for (const pc of dump.productCategories) {
		if (pc.productId === product.id) candidateCategoryIds.add(pc.categoryId)
	}
	for (const legacyCategoryId of candidateCategoryIds) {
		const mapping = await findMapping(tx, 'legacy_mysql', 'category', String(legacyCategoryId))
		if (!mapping) continue
		const [existing] = await tx
			.select()
			.from(productCategories)
			.where(and(eq(productCategories.productId, productId), eq(productCategories.categoryId, mapping.internalId)))
			.limit(1)
		if (existing) continue
		await tx.insert(productCategories).values({ productId, categoryId: mapping.internalId })
	}
}

function buildResult(units: CatalogImportUnitOutcome[], mode: CatalogImportMode): CatalogImportResult {
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
			examples: {
				created: created.slice(0, EXAMPLE_LIMIT).map(u => ({ key: u.key, productId: u.productId ?? '' })),
				skipped: skipped.slice(0, EXAMPLE_LIMIT).map(u => ({ key: u.key, reason: u.skipReason as CatalogImportSkipReason })),
				slugAliasConflicts: allSlugConflicts.slice(0, EXAMPLE_LIMIT)
			}
		},
		units
	}
}
