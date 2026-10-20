/**
 * Family-level SQL ↔ 1C reconciliation (Sprint 12A.7).
 *
 * Implements the redesign Sprint 12A.6 §12A.6-C recommended but did not
 * implement: `VariativeNomenclature` is a *candidate parent-family*
 * identifier (per a VIZAJE-NICA employee's confirmation #2 - a group/folder
 * code in 1C that has "вариативность" switched on, under which every
 * `ID_nom` is a child variant differing by volume/colour/etc.), not an
 * individual-record identity. The existing per-record matcher in
 * `./sql-1c-reconciliation.ts` (`matchProduct`'s `variative_nomenclature_group`
 * key) only ever promotes a group-code hit to a record-level match when
 * BOTH sides resolve to exactly one member - which structurally excludes
 * every real multi-variant family (Sprint 12A.2's 128 real `products.SKU`
 * duplicate groups ARE multi-member families on the MySQL side), exactly
 * the data shape `VariativeNomenclature` exists to represent. This module
 * adds a genuinely family-first pass *alongside* (not replacing) that
 * existing per-record matcher - `reconcileSqlWith1c` is untouched by this
 * module and keeps working exactly as before for whole-dataset,
 * non-family-aware matching.
 *
 * Pipeline:
 *   1. Build a normalized family index for both sides (group-code → member
 *      list), preserving every original un-normalized code string seen
 *      (Requirement 2) - never discarded, only used as the Map *key* is
 *      normalized (same `normalizeGroupCodeKey` as the Sprint 12A.5 fix, so
 *      the two modules never diverge on what counts as "the same code").
 *   2. Match families to each other by normalized code. A family containing
 *      multiple members on both sides is the *expected* case now, not an
 *      automatic ambiguity trigger (Requirement 3).
 *   3. Within a matched family, resolve individual positions using
 *      independent identifiers (GUID/ID_nom, and barcode treated as a SET
 *      per `ID_nom` rather than a single value - Requirement 8, since a
 *      VIZAJE-NICA employee confirmed in Sprint 12A.6 that one nomenclature
 *      position can legitimately carry more than one barcode) - never by
 *      guessing from sibling order or member-count equality (Requirement 4).
 *   4. Because global uniqueness of `VariativeNomenclature` is explicitly
 *      UNVERIFIED (Sprint 12A.6 confirmation #3), a family match is never
 *      trusted on group-code string equality alone: it requires at least
 *      one independent GUID/barcode corroboration between a member pair,
 *      and any individual-level evidence that CONTRADICTS the family
 *      pairing (a member's GUID/barcode pointing to a 1C record *outside*
 *      this family) is surfaced as an explicit `collisionRisk` signal,
 *      never silently ignored (Requirement 5). A position whose own GUID/
 *      ID_nom appears under more than one distinct family code within the
 *      1C feed itself is reported as a `ConflictingMembership`, also never
 *      auto-assigned to either family.
 *
 * This module never auto-merges, auto-publishes, or clears a Sprint 12A.2
 * quarantine decision - every quarantined MySQL product's family-position
 * outcome stays `'quarantine'` regardless of what family-level evidence is
 * found (Requirement 6), exactly mirroring `reconcileSqlWith1c`'s own
 * `priorQuarantine` handling, including the 463-orphan-variant
 * `product_id=1` cluster, which has no `sku` group code anyway and so
 * never even enters a family bucket - but the same invariant is enforced
 * here independently in case that ever changes.
 *
 * Requirement 9 (duplicate-ID_nom and price-conflict preservation): this
 * module reads the already-parsed `ProductsFeedRecord[]` exactly as
 * `reconcileSqlWith1c` does and never merges, drops, or re-labels a
 * duplicate-`ID_nom` row - `../reconcile/duplicate-id-nom.ts`'s
 * classification of *why* a given `ID_nom` has multiple rows remains the
 * single source of truth for that question; this module only asks the
 * orthogonal question "which family does a position belong to", and a
 * position whose own `ID_nom` is itself a duplicate-ID_nom group is still
 * resolved (or left ambiguous/unmatched) by the same evidence-based rules
 * as any other position - it is never silently collapsed to "the first
 * row" or "the last row".
 */
import type { QuarantineReasonCode } from '../dry-run-catalog'
import type { LegacyProduct } from '../parsers/mysql-catalog'
import type { ProductsFeedRecord } from '../parsers/products-feed'
import { buildBarcodeIndex, buildGuidIndex, detectGroupCode, normalizeGroupCodeKey } from './sql-1c-reconciliation'

const EXAMPLE_LIMIT = 3

export type FamilyOutcome = 'confirmed_family' | 'ambiguous_family' | 'unmatched_mysql_family' | 'unmatched_1c_family'

export type FamilyEvidenceKey = 'guid_id_nom' | 'barcode'

export type FamilyCorroborationEntry = {
	key: FamilyEvidenceKey
	mysqlProductId: number
	oneCIdNom: string
}

export type FamilyContradictionEntry = {
	key: FamilyEvidenceKey
	mysqlProductId: number
	/** The 1C ID_nom the evidence actually points to - a member of a DIFFERENT family (or no detected family) than the one being evaluated. */
	oneCIdNom: string
	oneCFamilyCode: string | null
}

export type FamilyMatch = {
	normalizedCode: string
	/** Every original, un-normalized code string seen on the MySQL side for this family - never discarded (Requirement 2). */
	mysqlOriginalCodes: string[]
	/** Same, for the 1C side. */
	oneCOriginalCodes: string[]
	mysqlMemberIds: number[]
	oneCMemberIdNoms: string[]
	outcome: FamilyOutcome
	/** Independent GUID/barcode evidence that a member pair within this family really do correspond to each other - never empty for `confirmed_family`. */
	corroboration: FamilyCorroborationEntry[]
	/** Independent GUID/barcode evidence that CONTRADICTS this family pairing (points outside it) - a real group-code-collision risk signal (Requirement 5), never silently dropped. */
	contradictions: FamilyContradictionEntry[]
	/** `true` whenever this family's pairing rests on code-string equality alone (no corroboration) or has any contradiction - i.e. whenever the match should NOT be treated as proven, given VariativeNomenclature's unverified global uniqueness (Sprint 12A.6 confirmation #3). */
	collisionRisk: boolean
	reasoning: string
}

export type FamilyPositionOutcome = 'confirmed_position' | 'ambiguous_position' | 'unmatched_position' | 'quarantine'

export type FamilyPositionResult = {
	normalizedCode: string
	mysqlProductId: number
	outcome: FamilyPositionOutcome
	matchedOneCIdNoms: string[]
	basis: FamilyEvidenceKey[]
	reasoning: string
	priorQuarantineReasonCodes?: QuarantineReasonCode[]
}

/** An `ID_nom` observed under more than one distinct normalized family code within the 1C feed's own rows - its family membership is structurally ambiguous and is never auto-assigned to either family (Requirement 5). */
export type ConflictingMembership = {
	idNom: string
	normalizedCodes: string[]
	note: string
}

export type FamilyReconciliationSummary = {
	totalMysqlFamilies: number
	totalOneCFamilies: number
	confirmedFamilies: number
	ambiguousFamilies: number
	unmatchedMysqlFamilies: number
	unmatchedOneCFamilies: number
	collisionRiskFamilies: number
	conflictingMembershipCount: number
	confirmedPositions: number
	ambiguousPositions: number
	unmatchedPositions: number
	quarantinedPositions: number
	examples: {
		confirmedFamilies: { normalizedCode: string; mysqlMemberCount: number; oneCMemberCount: number }[]
		ambiguousFamilies: { normalizedCode: string; mysqlMemberCount: number; oneCMemberCount: number; reasoning: string }[]
		conflictingMemberships: { idNom: string; normalizedCodes: string[] }[]
	}
}

export type FamilyReconciliationResult = {
	summary: FamilyReconciliationSummary
	families: FamilyMatch[]
	conflictingMemberships: ConflictingMembership[]
	positions: FamilyPositionResult[]
}

type FamilyBucket<TMember> = { originalCodes: Set<string>; members: TMember[] }

function buildMysqlFamilyIndex(products: LegacyProduct[]): Map<string, FamilyBucket<LegacyProduct>> {
	const index = new Map<string, FamilyBucket<LegacyProduct>>()
	for (const product of products) {
		const code = detectGroupCode(product.sku)
		if (code === null) continue
		const key = normalizeGroupCodeKey(code)
		const bucket = index.get(key) ?? { originalCodes: new Set<string>(), members: [] }
		bucket.originalCodes.add(code)
		bucket.members.push(product)
		index.set(key, bucket)
	}
	return index
}

function buildOneCFamilyIndex(oneCRecords: ProductsFeedRecord[]): {
	index: Map<string, FamilyBucket<ProductsFeedRecord>>
	conflictingMemberships: ConflictingMembership[]
} {
	const index = new Map<string, FamilyBucket<ProductsFeedRecord>>()
	const codesByIdNom = new Map<string, Set<string>>()

	for (const record of oneCRecords) {
		if (record.VariativeNomenclature === null) continue
		const key = normalizeGroupCodeKey(record.VariativeNomenclature)
		const bucket = index.get(key) ?? { originalCodes: new Set<string>(), members: [] }
		bucket.originalCodes.add(record.VariativeNomenclature)
		bucket.members.push(record)
		index.set(key, bucket)

		const codes = codesByIdNom.get(record.ID_nom) ?? new Set<string>()
		codes.add(key)
		codesByIdNom.set(record.ID_nom, codes)
	}

	const conflictingMemberships: ConflictingMembership[] = []
	for (const [idNom, codes] of codesByIdNom) {
		if (codes.size > 1) {
			conflictingMemberships.push({
				idNom,
				normalizedCodes: [...codes].sort(),
				note: 'this ID_nom appears under more than one distinct family (VariativeNomenclature) code across the 1C feed - its family membership is structurally ambiguous, never auto-assigned'
			})
		}
	}

	return { index, conflictingMemberships }
}

/** Every barcode seen across any row sharing a given ID_nom, unioned into a set - Requirement 8: a nomenclature position's barcode(s), never assumed to be a single value (Sprint 12A.6 confirmation #1). */
function buildBarcodeSetByIdNom(oneCRecords: ProductsFeedRecord[]): Map<string, Set<string>> {
	const map = new Map<string, Set<string>>()
	for (const record of oneCRecords) {
		if (record.Barcode === null) continue
		const set = map.get(record.ID_nom) ?? new Set<string>()
		set.add(record.Barcode)
		map.set(record.ID_nom, set)
	}
	return map
}

function quarantinedPosition(
	product: LegacyProduct,
	normalizedCode: string,
	existingQuarantine: QuarantineReasonCode[]
): FamilyPositionResult {
	return {
		normalizedCode,
		mysqlProductId: product.id,
		outcome: 'quarantine',
		matchedOneCIdNoms: [],
		basis: [],
		reasoning: `already quarantined by the Sprint 12A.2 catalog dry-run (${existingQuarantine.join(', ')}) - family-level reconciliation evidence attached but does not clear the quarantine`,
		priorQuarantineReasonCodes: existingQuarantine
	}
}

function resolveUnmatchedMysqlFamilyPosition(
	product: LegacyProduct,
	normalizedCode: string,
	priorQuarantine?: Map<number, QuarantineReasonCode[]>
): FamilyPositionResult {
	const existingQuarantine = priorQuarantine?.get(product.id)
	if (existingQuarantine !== undefined && existingQuarantine.length > 0) {
		return quarantinedPosition(product, normalizedCode, existingQuarantine)
	}
	return {
		normalizedCode,
		mysqlProductId: product.id,
		outcome: 'unmatched_position',
		matchedOneCIdNoms: [],
		basis: [],
		reasoning: 'this MySQL group-code family has no 1C VariativeNomenclature counterpart at all'
	}
}

function resolveFamilyPosition(
	product: LegacyProduct,
	normalizedCode: string,
	oneCMembers: ProductsFeedRecord[],
	barcodeSetByIdNom: Map<string, Set<string>>,
	familyContradictions: FamilyContradictionEntry[],
	priorQuarantine?: Map<number, QuarantineReasonCode[]>
): FamilyPositionResult {
	const existingQuarantine = priorQuarantine?.get(product.id)
	if (existingQuarantine !== undefined && existingQuarantine.length > 0) {
		return quarantinedPosition(product, normalizedCode, existingQuarantine)
	}

	const candidateIdNoms = new Set<string>()
	const basis: FamilyEvidenceKey[] = []

	if (product.guid !== null) {
		const direct = oneCMembers.filter(m => m.ID_nom === product.guid)
		if (direct.length > 0 && !basis.includes('guid_id_nom')) basis.push('guid_id_nom')
		for (const m of direct) candidateIdNoms.add(m.ID_nom)
	}
	if (product.barcode !== null) {
		const byBarcodeSet = oneCMembers.filter(m => barcodeSetByIdNom.get(m.ID_nom)?.has(product.barcode as string))
		if (byBarcodeSet.length > 0 && !basis.includes('barcode')) basis.push('barcode')
		for (const m of byBarcodeSet) candidateIdNoms.add(m.ID_nom)
	}

	// This specific position's own GUID/barcode pointed outside the family -
	// its within-family candidate(s), if any, cannot be trusted either,
	// since the identity evidence itself is split across two families.
	const productContradicted = familyContradictions.some(c => c.mysqlProductId === product.id)

	if (candidateIdNoms.size === 0) {
		// A contradiction (this member's own GUID/barcode evidence resolves
		// to a 1C record *outside* the family) is a stronger, more specific
		// signal than plain absence of evidence - the position's identity is
		// not unknown, it is in conflict with its apparent family
		// membership, so it is reported `ambiguous_position`, not
		// `unmatched_position`.
		return {
			normalizedCode,
			mysqlProductId: product.id,
			outcome: productContradicted ? 'ambiguous_position' : 'unmatched_position',
			matchedOneCIdNoms: [],
			basis: [],
			reasoning: productContradicted
				? 'this position has independent GUID/barcode evidence pointing outside the matched family, and no candidate within the family - conflicting signals, never auto-resolved'
				: 'member of a matched family, but no independent GUID/barcode evidence within the family resolves which specific 1C position this is - never guessed from sibling order or member-count equality'
		}
	}

	if (candidateIdNoms.size === 1 && !productContradicted) {
		return {
			normalizedCode,
			mysqlProductId: product.id,
			outcome: 'confirmed_position',
			matchedOneCIdNoms: [...candidateIdNoms],
			basis,
			reasoning: `unambiguous within-family match on ${basis.join(', ')}`
		}
	}

	return {
		normalizedCode,
		mysqlProductId: product.id,
		outcome: 'ambiguous_position',
		matchedOneCIdNoms: [...candidateIdNoms],
		basis,
		reasoning: productContradicted
			? 'this position has independent GUID/barcode evidence pointing outside the matched family - conflicting signals, never auto-resolved'
			: 'multiple distinct 1C candidates within the family - conflicting or duplicate signals, never guessed'
	}
}

/**
 * @param dump Already-parsed MySQL catalog (only `products` is used; Sprint 12 Phase A's `loadLegacyCatalogDump`).
 * @param oneCRecords Already-parsed/validated 1C products-feed records (Sprint 10A's `parseProductsFeed(...).validRecords`) - the same array `reconcileSqlWith1c` takes, including every duplicate-ID_nom row (never deduped upstream).
 * @param priorQuarantine Optional map of legacyProductId -> quarantine reason codes from the Sprint 12A.2 catalog dry-run, exactly as `reconcileSqlWith1c` takes it. A quarantined product's family-position outcome here is always `'quarantine'`, regardless of family-level evidence.
 */
export function reconcileFamilies(
	dump: { products: LegacyProduct[] },
	oneCRecords: ProductsFeedRecord[],
	priorQuarantine?: Map<number, QuarantineReasonCode[]>
): FamilyReconciliationResult {
	const mysqlFamilyIndex = buildMysqlFamilyIndex(dump.products)
	const { index: oneCFamilyIndex, conflictingMemberships } = buildOneCFamilyIndex(oneCRecords)
	const barcodeSetByIdNom = buildBarcodeSetByIdNom(oneCRecords)
	const fullGuidIndex = buildGuidIndex(oneCRecords)
	const fullBarcodeIndex = buildBarcodeIndex(oneCRecords)

	const allCodes = new Set<string>([...mysqlFamilyIndex.keys(), ...oneCFamilyIndex.keys()])
	const families: FamilyMatch[] = []
	const positions: FamilyPositionResult[] = []

	for (const code of allCodes) {
		const mysqlBucket = mysqlFamilyIndex.get(code)
		const oneCBucket = oneCFamilyIndex.get(code)

		if (mysqlBucket === undefined && oneCBucket !== undefined) {
			families.push({
				normalizedCode: code,
				mysqlOriginalCodes: [],
				oneCOriginalCodes: [...oneCBucket.originalCodes],
				mysqlMemberIds: [],
				oneCMemberIdNoms: oneCBucket.members.map(m => m.ID_nom),
				outcome: 'unmatched_1c_family',
				corroboration: [],
				contradictions: [],
				collisionRisk: false,
				reasoning: 'a 1C VariativeNomenclature family exists with no MySQL-side group-code counterpart'
			})
			continue
		}

		if (mysqlBucket !== undefined && oneCBucket === undefined) {
			families.push({
				normalizedCode: code,
				mysqlOriginalCodes: [...mysqlBucket.originalCodes],
				oneCOriginalCodes: [],
				mysqlMemberIds: mysqlBucket.members.map(m => m.id),
				oneCMemberIdNoms: [],
				outcome: 'unmatched_mysql_family',
				corroboration: [],
				contradictions: [],
				collisionRisk: false,
				reasoning: 'a MySQL-side group-code family exists with no 1C VariativeNomenclature counterpart'
			})
			for (const product of mysqlBucket.members) {
				positions.push(resolveUnmatchedMysqlFamilyPosition(product, code, priorQuarantine))
			}
			continue
		}

		if (mysqlBucket === undefined || oneCBucket === undefined) continue // unreachable - narrows both to defined below

		const oneCMemberIdNomSet = new Set(oneCBucket.members.map(m => m.ID_nom))
		const corroboration: FamilyCorroborationEntry[] = []
		const contradictions: FamilyContradictionEntry[] = []

		for (const product of mysqlBucket.members) {
			if (product.guid !== null) {
				for (const m of fullGuidIndex.get(product.guid) ?? []) {
					if (oneCMemberIdNomSet.has(m.ID_nom)) {
						corroboration.push({ key: 'guid_id_nom', mysqlProductId: product.id, oneCIdNom: m.ID_nom })
					} else {
						contradictions.push({
							key: 'guid_id_nom',
							mysqlProductId: product.id,
							oneCIdNom: m.ID_nom,
							oneCFamilyCode: m.VariativeNomenclature !== null ? normalizeGroupCodeKey(m.VariativeNomenclature) : null
						})
					}
				}
			}
			if (product.barcode !== null) {
				for (const m of fullBarcodeIndex.get(product.barcode) ?? []) {
					if (oneCMemberIdNomSet.has(m.ID_nom)) {
						corroboration.push({ key: 'barcode', mysqlProductId: product.id, oneCIdNom: m.ID_nom })
					} else {
						contradictions.push({
							key: 'barcode',
							mysqlProductId: product.id,
							oneCIdNom: m.ID_nom,
							oneCFamilyCode: m.VariativeNomenclature !== null ? normalizeGroupCodeKey(m.VariativeNomenclature) : null
						})
					}
				}
			}
		}

		const hasContradiction = contradictions.length > 0
		const hasCorroboration = corroboration.length > 0
		const outcome: FamilyOutcome = hasCorroboration && !hasContradiction ? 'confirmed_family' : 'ambiguous_family'
		const collisionRisk = hasContradiction || !hasCorroboration

		const reasoning = hasContradiction
			? "at least one member's GUID/barcode evidence points to a 1C record outside this family - possible group-code collision, since VariativeNomenclature's global uniqueness is unverified (Sprint 12A.6 confirmation #3)"
			: hasCorroboration
				? 'independent GUID/barcode evidence corroborates at least one member pairing within this family'
				: `group code present on both sides (MySQL ${mysqlBucket.members.length} member(s), 1C ${oneCBucket.members.length} member(s)) but no independent GUID/barcode evidence corroborates they are the same real family - treated as a candidate only, never assumed`

		families.push({
			normalizedCode: code,
			mysqlOriginalCodes: [...mysqlBucket.originalCodes],
			oneCOriginalCodes: [...oneCBucket.originalCodes],
			mysqlMemberIds: mysqlBucket.members.map(m => m.id),
			oneCMemberIdNoms: oneCBucket.members.map(m => m.ID_nom),
			outcome,
			corroboration,
			contradictions,
			collisionRisk,
			reasoning
		})

		for (const product of mysqlBucket.members) {
			positions.push(resolveFamilyPosition(product, code, oneCBucket.members, barcodeSetByIdNom, contradictions, priorQuarantine))
		}
	}

	return buildResult(families, positions, conflictingMemberships)
}

function buildResult(
	families: FamilyMatch[],
	positions: FamilyPositionResult[],
	conflictingMemberships: ConflictingMembership[]
): FamilyReconciliationResult {
	const confirmedFamilies = families.filter(f => f.outcome === 'confirmed_family')
	const ambiguousFamilies = families.filter(f => f.outcome === 'ambiguous_family')

	return {
		summary: {
			totalMysqlFamilies: families.filter(f => f.mysqlMemberIds.length > 0).length,
			totalOneCFamilies: families.filter(f => f.oneCMemberIdNoms.length > 0).length,
			confirmedFamilies: confirmedFamilies.length,
			ambiguousFamilies: ambiguousFamilies.length,
			unmatchedMysqlFamilies: families.filter(f => f.outcome === 'unmatched_mysql_family').length,
			unmatchedOneCFamilies: families.filter(f => f.outcome === 'unmatched_1c_family').length,
			collisionRiskFamilies: families.filter(f => f.collisionRisk).length,
			conflictingMembershipCount: conflictingMemberships.length,
			confirmedPositions: positions.filter(p => p.outcome === 'confirmed_position').length,
			ambiguousPositions: positions.filter(p => p.outcome === 'ambiguous_position').length,
			unmatchedPositions: positions.filter(p => p.outcome === 'unmatched_position').length,
			quarantinedPositions: positions.filter(p => p.outcome === 'quarantine').length,
			examples: {
				confirmedFamilies: confirmedFamilies
					.slice(0, EXAMPLE_LIMIT)
					.map(f => ({ normalizedCode: f.normalizedCode, mysqlMemberCount: f.mysqlMemberIds.length, oneCMemberCount: f.oneCMemberIdNoms.length })),
				ambiguousFamilies: ambiguousFamilies.slice(0, EXAMPLE_LIMIT).map(f => ({
					normalizedCode: f.normalizedCode,
					mysqlMemberCount: f.mysqlMemberIds.length,
					oneCMemberCount: f.oneCMemberIdNoms.length,
					reasoning: f.reasoning
				})),
				conflictingMemberships: conflictingMemberships.slice(0, EXAMPLE_LIMIT).map(c => ({ idNom: c.idNom, normalizedCodes: c.normalizedCodes }))
			}
		},
		families,
		conflictingMemberships,
		positions
	}
}
