/**
 * Legacy brand & category bootstrap (Sprint 12B.3).
 *
 * Runs BEFORE `runCatalogImport` (catalog-importer.ts) so that products can
 * actually resolve a brand/category instead of reporting
 * `unpublishedForMissingBrand`/`unpublishedForMissingCategory` for every
 * product, as the real dry-run after Sprint 12B.2.1 correctly did (there was
 * no bootstrap step yet - "missing brand: 5972 / missing category: 5972" was
 * the expected, honest result of that gap, not a bug).
 *
 * Reuses the existing Phase A/Sprint 12 parser (parsers/mysql-catalog.ts's
 * extractBrands/extractCategories/loadLegacyCatalogDump) - this module adds
 * no new SQL parsing, only the write path. Follows the exact identity
 * pattern already established by catalog-importer.ts: resolveIdentity
 * (dry-run-safe mapping preview) -> write or report, one legacy_mysql
 * external_entity_mappings row per brand/category, never a fabricated
 * placeholder for a missing/invalid reference.
 *
 * Legacy `brands` has only a single `title`/`uri` pair (confirmed by reading
 * docs/legacy-reference/vizaje_nica_local.sql's real CREATE TABLE brands -
 * no titleRU/titleRO split, unlike `categories`, which does have genuine
 * RU/RO columns throughout). V2's brands.nameRu/nameRo are both NOT NULL.
 * Decision: nameRu = legacy title (canonical, since the storefront's primary
 * locale is ru per Sprint 11), nameRo = the SAME value, duplicated rather
 * than left null or machine-translated - duplicating a known-correct string
 * is honest (it says "not yet localized", which is true), while a null
 * would violate the NOT NULL constraint and a fabricated translation would
 * misrepresent invented text as real brand copy. Flagged here and in
 * docs/vizaje-identity-architecture.md as needing real RO translation before
 * launch.
 *
 * Categories DO have real titleRU/titleRO - no duplication needed there.
 */
import { eq } from 'drizzle-orm'
import crypto from 'node:crypto'
import type { Tx } from '../db/tx'
import { brands } from '../db/schema/brands'
import { categories } from '../db/schema/categories'
import { findMapping, resolveOrCreateMapping, type MappingResolution } from './mappings'
import type { LegacyBrand, LegacyCategory } from './parsers/mysql-catalog'

export type BootstrapMode = 'dry-run' | 'write'

/** Mirrors catalog-importer.ts's resolveIdentity exactly: in dry-run mode only the read-only `findMapping` ever runs - `resolveOrCreateMapping` (which inserts a mapping row) is never called. A dry-run of this bootstrap must never create a real `external_entity_mappings` row, or a second dry-run of the same input would misreport a fresh 'created' as 'existing'. */
async function resolveIdentity(
	tx: Tx,
	mode: BootstrapMode,
	input: { entityType: 'brand' | 'category'; externalId: string; internalId: string }
): Promise<MappingResolution> {
	const existing = await findMapping(tx, 'legacy_mysql', input.entityType, input.externalId)
	const internalId = existing?.internalId ?? input.internalId
	if (mode === 'dry-run') {
		if (existing) return { outcome: 'existing', mapping: existing }
		return {
			outcome: 'created',
			mapping: {
				id: '',
				sourceSystem: 'legacy_mysql',
				entityType: input.entityType,
				externalId: input.externalId,
				internalId,
				createdAt: new Date(),
				updatedAt: new Date()
			}
		}
	}
	return resolveOrCreateMapping(tx, { sourceSystem: 'legacy_mysql', ...input, internalId })
}

export type BootstrapSkipReason =
	| 'empty_title'
	| 'duplicate_slug'
	| 'invalid_parent'
	| 'mapping_conflict'
	| 'parent_not_resolved'

export type BootstrapUnitOutcome<Kind extends 'brand' | 'category'> = {
	kind: Kind
	legacyId: number
	action: 'created' | 'updated' | 'skipped'
	skipReason?: BootstrapSkipReason
	internalId?: string
	note: string
}

export type BrandBootstrapSummary = {
	mode: BootstrapMode
	total: number
	created: number
	updated: number
	skipped: number
	bySkipReason: Record<BootstrapSkipReason, number>
	conflicts: { legacyId: number; slug: string; otherLegacyId: number; note: string }[]
}

export type CategoryBootstrapSummary = BrandBootstrapSummary & {
	/** Count of category rows whose insertion was deferred because their parent hadn't resolved yet when the breadth-first pass reached them - should always be 0 at the end of a correctly-ordered run; a nonzero value here is itself evidence of a cycle or an unresolvable parent chain, not expected real-data noise. */
	deferredForUnresolvedParent: number
}

export type BrandBootstrapResult = { summary: BrandBootstrapSummary; units: BootstrapUnitOutcome<'brand'>[] }
export type CategoryBootstrapResult = { summary: CategoryBootstrapSummary; units: BootstrapUnitOutcome<'category'>[] }

function slugify(input: string): string {
	return input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9Ѐ-ӿ]+/g, '-')
		.replace(/^-+|-+$/g, '')
}

function skip<Kind extends 'brand' | 'category'>(
	kind: Kind,
	legacyId: number,
	reason: BootstrapSkipReason,
	note: string
): BootstrapUnitOutcome<Kind> {
	return { kind, legacyId, action: 'skipped', skipReason: reason, note }
}

/**
 * Requirement 7 (duplicate names/slugs -> explicit conflict reporting, never
 * auto-merged/auto-picked) + Important-B (surface BOTH legacy owning ids for
 * a slug collision, never silently reassign). In dry-run mode no row is
 * persisted, so sibling units within the same call can't see each other via
 * a DB read - mirrors catalog-importer.ts's DryRunSlugLedger for exactly
 * that reason.
 */
type SlugLedger = Map<string, number> // slug -> owning legacy id

async function resolveUniqueSlug(
	tx: Tx,
	table: typeof brands | typeof categories,
	baseSlug: string,
	legacyId: number,
	existingInternalId: string | null,
	ledger: SlugLedger
): Promise<{ slug: string; conflictWith: number } | { slug: string; conflictWith: null }> {
	const [existingRow] = await tx
		.select({ id: table.id, slug: table.slug })
		.from(table)
		.where(eq(table.slug, baseSlug))
		.limit(1)
	const dbCollides = existingRow !== undefined && existingRow.id !== existingInternalId
	const ledgerOwner = ledger.get(baseSlug)
	const ledgerCollides = ledgerOwner !== undefined && ledgerOwner !== legacyId

	if (!dbCollides && !ledgerCollides) {
		ledger.set(baseSlug, legacyId)
		return { slug: baseSlug, conflictWith: null }
	}
	// Never auto-reassign an already-claimed slug: the colliding record keeps
	// its own distinct slug (suffixed by its own legacy id - same pattern as
	// catalog-importer.ts's ensureUniqueSlug / the forensic audit's legacy
	// update_url() precedent), while the conflict itself is still reported so
	// a human can see both owners and decide the real resolution.
	const suffixed = `${baseSlug}-${legacyId}`
	ledger.set(suffixed, legacyId)
	return { slug: suffixed, conflictWith: ledgerOwner ?? -1 }
}

export async function bootstrapBrands(tx: Tx, legacyBrands: LegacyBrand[], mode: BootstrapMode): Promise<BrandBootstrapResult> {
	const dryRun = mode === 'dry-run'
	const units: BootstrapUnitOutcome<'brand'>[] = []
	const slugLedger: SlugLedger = new Map()
	const conflicts: BrandBootstrapSummary['conflicts'] = []

	for (const legacy of legacyBrands) {
		if (legacy.title === null || legacy.title.trim().length === 0) {
			units.push(skip('brand', legacy.id, 'empty_title', 'Legacy brand has no title - never invented.'))
			continue
		}

		const externalId = String(legacy.id)
		const existingMapping = await findMapping(tx, 'legacy_mysql', 'brand', externalId)
		const candidateId = existingMapping?.internalId ?? crypto.randomUUID()

		const baseSlug = legacy.uri !== null && legacy.uri.trim().length > 0 ? slugify(legacy.uri) : slugify(legacy.title)
		const slugResult = await resolveUniqueSlug(tx, brands, baseSlug, legacy.id, existingMapping?.internalId ?? null, slugLedger)
		if (slugResult.conflictWith !== null) {
			conflicts.push({
				legacyId: legacy.id,
				slug: baseSlug,
				otherLegacyId: slugResult.conflictWith,
				note: `Brand ${legacy.id} and brand ${slugResult.conflictWith} both derive slug "${baseSlug}" - ${legacy.id} assigned "${slugResult.slug}" instead; neither auto-reassigned.`
			})
		}

		const mapping = await resolveIdentity(tx, mode, { entityType: 'brand', externalId, internalId: candidateId })
		if (mapping.outcome === 'conflict') {
			units.push(skip('brand', legacy.id, 'mapping_conflict', `legacy_mysql/brand/${externalId} mapping conflict: ${mapping.reason}.`))
			continue
		}

		// Duplicated, not translated or left null - see module doc comment.
		const fields = {
			slug: slugResult.slug,
			nameRu: legacy.title,
			nameRo: legacy.title,
			descriptionRu: legacy.textRu,
			descriptionRo: legacy.textRo,
			isActive: legacy.isShown,
			sortOrder: legacy.sortOrder ?? 0
		}

		const action: 'created' | 'updated' = mapping.outcome === 'created' ? 'created' : 'updated'
		if (!dryRun) {
			if (action === 'created') {
				await tx.insert(brands).values({ id: mapping.mapping.internalId, ...fields })
			} else {
				await tx.update(brands).set({ ...fields, updatedAt: new Date() }).where(eq(brands.id, mapping.mapping.internalId))
			}
		}
		units.push({ kind: 'brand', legacyId: legacy.id, action, internalId: mapping.mapping.internalId, note: `${action} brand "${legacy.title}".` })
	}

	return { summary: buildBrandSummary(units, mode, conflicts), units }
}

function buildBrandSummary(units: BootstrapUnitOutcome<'brand'>[], mode: BootstrapMode, conflicts: BrandBootstrapSummary['conflicts']): BrandBootstrapSummary {
	const bySkipReason: Record<BootstrapSkipReason, number> = {
		empty_title: 0,
		duplicate_slug: 0,
		invalid_parent: 0,
		mapping_conflict: 0,
		parent_not_resolved: 0
	}
	for (const u of units) if (u.skipReason) bySkipReason[u.skipReason]++
	return {
		mode,
		total: units.length,
		created: units.filter(u => u.action === 'created').length,
		updated: units.filter(u => u.action === 'updated').length,
		skipped: units.filter(u => u.action === 'skipped').length,
		bySkipReason,
		conflicts
	}
}

/**
 * Requirement 4: breadth-first insertion order so a parent category always
 * resolves before any of its children are written (V2's categories.parentId
 * FK would otherwise reject a child inserted before its parent exists).
 * Requirement 6: a legacy `parent_id` that does not reference any real
 * legacy category row (confirmed possible - legacy's own `parent_id`
 * defaults to 0, which is never a real category id) is never promoted to a
 * fabricated root; such a category is imported as a ROOT (parentId: null)
 * explicitly, not silently dropped and not given an invented parent -
 * `parent_id = 0` is legacy's own "no parent" sentinel, not a broken
 * reference, so this is root-ness, not a data-quality problem to report.
 * A parent_id that is nonzero but does not match any `id` in the legacy
 * `categories` table IS a genuine broken reference and is reported via
 * `invalid_parent`, never silently rooted.
 */
export async function bootstrapCategories(tx: Tx, legacyCategories: LegacyCategory[], mode: BootstrapMode): Promise<CategoryBootstrapResult> {
	const dryRun = mode === 'dry-run'
	const units: BootstrapUnitOutcome<'category'>[] = []
	const slugLedger: SlugLedger = new Map()
	const conflicts: CategoryBootstrapSummary['conflicts'] = []
	const legacyIds = new Set(legacyCategories.map(c => c.id))

	// legacyId -> resolved V2 internalId, populated as each category is
	// written/resolved, so children processed later in the same pass can
	// find their already-handled parent.
	const resolvedInternalIds = new Map<number, string>()
	const remaining = new Map(legacyCategories.map(c => [c.id, c]))
	let deferredForUnresolvedParent = 0
	let progressedThisPass = true

	// Process roots and already-resolvable children in waves, until nothing
	// more can progress - this correctly handles arbitrary tree depth
	// without assuming a fixed number of levels.
	while (remaining.size > 0 && progressedThisPass) {
		progressedThisPass = false
		for (const legacy of [...remaining.values()].sort((a, b) => a.id - b.id)) {
			const isRoot = legacy.parentId === null || legacy.parentId === 0
			let parentInternalId: string | null = null

			if (!isRoot) {
				if (!legacyIds.has(legacy.parentId as number)) {
					units.push(skip('category', legacy.id, 'invalid_parent', `parent_id ${legacy.parentId} does not reference any legacy category row.`))
					remaining.delete(legacy.id)
					progressedThisPass = true
					continue
				}
				const resolved = resolvedInternalIds.get(legacy.parentId as number)
				if (resolved === undefined) continue // parent not processed yet this wave
				parentInternalId = resolved
			}

			if (legacy.titleRu === null || legacy.titleRu.trim().length === 0) {
				units.push(skip('category', legacy.id, 'empty_title', 'Legacy category has no titleRU - never invented.'))
				remaining.delete(legacy.id)
				progressedThisPass = true
				continue
			}

			const externalId = String(legacy.id)
			const existingMapping = await findMapping(tx, 'legacy_mysql', 'category', externalId)
			const candidateId = existingMapping?.internalId ?? crypto.randomUUID()

			const baseSlug = isRealSlugCandidate(legacy.uriRu) ? slugify(legacy.uriRu) : slugify(legacy.titleRu)
			const slugResult = await resolveUniqueSlug(tx, categories, baseSlug, legacy.id, existingMapping?.internalId ?? null, slugLedger)
			if (slugResult.conflictWith !== null) {
				conflicts.push({
					legacyId: legacy.id,
					slug: baseSlug,
					otherLegacyId: slugResult.conflictWith,
					note: `Category ${legacy.id} and category ${slugResult.conflictWith} both derive slug "${baseSlug}" - ${legacy.id} assigned "${slugResult.slug}" instead; neither auto-reassigned.`
				})
			}

			const mapping = await resolveIdentity(tx, mode, { entityType: 'category', externalId, internalId: candidateId })
			if (mapping.outcome === 'conflict') {
				units.push(skip('category', legacy.id, 'mapping_conflict', `legacy_mysql/category/${externalId} mapping conflict: ${mapping.reason}.`))
				remaining.delete(legacy.id)
				progressedThisPass = true
				continue
			}

			const fields = {
				parentId: parentInternalId,
				slug: slugResult.slug,
				nameRu: legacy.titleRu,
				nameRo: legacy.titleRo ?? legacy.titleRu,
				descriptionRu: legacy.descRu,
				descriptionRo: legacy.descRo,
				isActive: legacy.isShown,
				sortOrder: legacy.sortOrder ?? 0
			}
			const action: 'created' | 'updated' = mapping.outcome === 'created' ? 'created' : 'updated'
			if (!dryRun) {
				if (action === 'created') {
					await tx.insert(categories).values({ id: mapping.mapping.internalId, ...fields })
				} else {
					await tx.update(categories).set({ ...fields, updatedAt: new Date() }).where(eq(categories.id, mapping.mapping.internalId))
				}
			}
			resolvedInternalIds.set(legacy.id, mapping.mapping.internalId)
			units.push({
				kind: 'category',
				legacyId: legacy.id,
				action,
				internalId: mapping.mapping.internalId,
				note: `${action} category "${legacy.titleRu}"${isRoot ? ' (root)' : ` under parent ${legacy.parentId}`}.`
			})
			remaining.delete(legacy.id)
			progressedThisPass = true
		}
	}

	// Whatever is left after the loop stabilizes has a parent chain that
	// never resolved (a cycle, or a parent whose own processing failed for
	// another reason) - reported explicitly, never force-rooted.
	for (const legacy of remaining.values()) {
		deferredForUnresolvedParent++
		units.push(skip('category', legacy.id, 'parent_not_resolved', `parent_id ${legacy.parentId} never resolved (cycle or upstream failure).`))
	}

	const baseSummary = buildCategorySummary(units, mode, conflicts)
	return { summary: { ...baseSummary, deferredForUnresolvedParent }, units }
}

function isRealSlugCandidate(uri: string | null): uri is string {
	return uri !== null && !/^\d+$/.test(uri)
}

function buildCategorySummary(
	units: BootstrapUnitOutcome<'category'>[],
	mode: BootstrapMode,
	conflicts: CategoryBootstrapSummary['conflicts']
): BrandBootstrapSummary {
	const bySkipReason: Record<BootstrapSkipReason, number> = {
		empty_title: 0,
		duplicate_slug: 0,
		invalid_parent: 0,
		mapping_conflict: 0,
		parent_not_resolved: 0
	}
	for (const u of units) if (u.skipReason) bySkipReason[u.skipReason]++
	return {
		mode,
		total: units.length,
		created: units.filter(u => u.action === 'created').length,
		updated: units.filter(u => u.action === 'updated').length,
		skipped: units.filter(u => u.action === 'skipped').length,
		bySkipReason,
		conflicts
	}
}

/**
 * Requirement 14: NOT a fabricated real number (no real 5972-product dataset
 * is available here) - a documented, reusable formula plus a demonstration
 * on whatever synthetic/real `catalog-importer.ts` units are passed in. Run
 * this against a REAL dry-run's `result.units` (after a real bootstrap run)
 * to get the real answer; this function is the methodology, not the number.
 *
 * A unit "could transition from draft to publishable" when BOTH:
 *   - it already produced a Product (`action` is 'created' or 'updated' -
 *     a skipped/quarantined/ambiguous unit was never a draft product to
 *     begin with, so it is excluded, not silently counted as "would become
 *     publishable"), AND
 *   - `unpublishedForMissingBrand` and `unpublishedForMissingCategory` are
 *     BOTH false-y on that unit - i.e. both a real V2 brand AND at least
 *     one real V2 category link actually resolved.
 * This intentionally does NOT flip anything to 'active' (Requirement 15) -
 * it only counts how many units meet the condition that would make a
 * SEPARATE, later, explicitly-authorized publish step correct to run.
 */
export function countDraftToPublishableCandidates(units: { action: string; unpublishedForMissingBrand?: boolean; unpublishedForMissingCategory?: boolean }[]): number {
	return units.filter(u => (u.action === 'created' || u.action === 'updated') && !u.unpublishedForMissingBrand && !u.unpublishedForMissingCategory).length
}
