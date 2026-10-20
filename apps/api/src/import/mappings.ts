import { and, eq } from 'drizzle-orm'
import type { DbOrTx, Tx } from '../db/tx'
import { externalEntityMappings } from '../db/schema/external-entity-mappings'
import type { EntityType, SourceSystem } from './constants'

export type ExternalEntityMappingRow = typeof externalEntityMappings.$inferSelect

export class InvalidExternalIdError extends Error {
	constructor(sourceSystem: string, entityType: string) {
		super(`external id for ${sourceSystem}/${entityType} is empty after trimming`)
	}
}

/** Trims only - never reshapes or reinterprets the value (a legacy integer id and a 1C alphanumeric id are both just text here). Throws on empty (Task 2: "reject empty identifiers"). */
export function normalizeExternalId(sourceSystem: SourceSystem, entityType: EntityType, raw: string | number): string {
	const text = String(raw).trim()
	if (text.length === 0) {
		throw new InvalidExternalIdError(sourceSystem, entityType)
	}
	return text
}

export async function findMapping(
	dbOrTx: DbOrTx,
	sourceSystem: SourceSystem,
	entityType: EntityType,
	externalId: string
): Promise<ExternalEntityMappingRow | null> {
	const [row] = await dbOrTx
		.select()
		.from(externalEntityMappings)
		.where(
			and(
				eq(externalEntityMappings.sourceSystem, sourceSystem),
				eq(externalEntityMappings.entityType, entityType),
				eq(externalEntityMappings.externalId, externalId)
			)
		)
		.limit(1)
	return row ?? null
}

/** Every external identity currently recorded for a given internal entity, across every (sourceSystem, entityType) it has been mapped under - a product commonly has both a legacy_mysql/product mapping and a 1c/nomenclature_group mapping. */
export async function findMappingsForInternalId(
	dbOrTx: DbOrTx,
	internalId: string
): Promise<ExternalEntityMappingRow[]> {
	return dbOrTx.select().from(externalEntityMappings).where(eq(externalEntityMappings.internalId, internalId))
}

export type MappingResolution =
	| { outcome: 'existing'; mapping: ExternalEntityMappingRow }
	| { outcome: 'created'; mapping: ExternalEntityMappingRow }
	| {
			outcome: 'conflict'
			// The same (sourceSystem, entityType, externalId) already points at a
			// *different* internal entity - e.g. a reused/duplicate GUID or SKU,
			// which the confirmed legacy findings explicitly warn is possible.
			reason: 'external_id_points_elsewhere'
			existing: ExternalEntityMappingRow
	  }
	| {
			outcome: 'conflict'
			// This internal entity already has a *different* external id under
			// the same (sourceSystem, entityType) - Task 2's "protect against
			// mapping one internal entity to conflicting external IDs in the
			// same source". Not necessarily wrong (a legitimate SKU change is
			// possible) but never silently created as a second identity - the
			// caller must decide.
			reason: 'internal_id_has_other_external_id'
			existing: ExternalEntityMappingRow
	  }

/**
 * The one place a mapping row is ever created (Task 2). Always called
 * inside the caller's own transaction, alongside whatever entity write it
 * accompanies (Task 2: "all mapping mutations must be transactional with
 * the corresponding entity operations") - this function never opens its
 * own transaction.
 *
 * Idempotent: calling this twice with the exact same
 * (sourceSystem, entityType, externalId, internalId) returns
 * {outcome: 'existing'} the second time, never a duplicate row or an error
 * - that is what makes a repeated import run safe to re-run.
 */
export async function resolveOrCreateMapping(
	tx: Tx,
	input: { sourceSystem: SourceSystem; entityType: EntityType; externalId: string; internalId: string }
): Promise<MappingResolution> {
	const externalId = normalizeExternalId(input.sourceSystem, input.entityType, input.externalId)

	const [existingByExternalId] = await tx
		.select()
		.from(externalEntityMappings)
		.where(
			and(
				eq(externalEntityMappings.sourceSystem, input.sourceSystem),
				eq(externalEntityMappings.entityType, input.entityType),
				eq(externalEntityMappings.externalId, externalId)
			)
		)
		.for('update')
		.limit(1)

	if (existingByExternalId) {
		if (existingByExternalId.internalId === input.internalId) {
			return { outcome: 'existing', mapping: existingByExternalId }
		}
		return { outcome: 'conflict', reason: 'external_id_points_elsewhere', existing: existingByExternalId }
	}

	const [existingByInternalId] = await tx
		.select()
		.from(externalEntityMappings)
		.where(
			and(
				eq(externalEntityMappings.sourceSystem, input.sourceSystem),
				eq(externalEntityMappings.entityType, input.entityType),
				eq(externalEntityMappings.internalId, input.internalId)
			)
		)
		.for('update')
		.limit(1)

	if (existingByInternalId) {
		return { outcome: 'conflict', reason: 'internal_id_has_other_external_id', existing: existingByInternalId }
	}

	try {
		// Wrapped in a nested transaction (Postgres SAVEPOINT under the
		// hood) specifically so a unique-violation here doesn't abort the
		// *outer* transaction - without a savepoint, Postgres refuses every
		// further statement on this connection (including the recovery
		// SELECT below) until the whole transaction ends, even if the JS
		// error is caught.
		const [created] = await tx.transaction(async inner =>
			inner
				.insert(externalEntityMappings)
				.values({
					sourceSystem: input.sourceSystem,
					entityType: input.entityType,
					externalId,
					internalId: input.internalId
				})
				.returning()
		)
		return { outcome: 'created', mapping: created }
	} catch (error) {
		// Lost a race with a concurrent resolveOrCreateMapping call for the
		// same (sourceSystem, entityType, externalId) - the SELECT ... FOR
		// UPDATE above only guards against a row that already existed when
		// this transaction started, not one created by another transaction
		// in between. The database's own unique constraint is the real guard
		// here; re-resolve from what actually landed instead of throwing a
		// raw Postgres error at the caller.
		if (!isUniqueViolation(error)) throw error
		const [afterRace] = await tx
			.select()
			.from(externalEntityMappings)
			.where(
				and(
					eq(externalEntityMappings.sourceSystem, input.sourceSystem),
					eq(externalEntityMappings.entityType, input.entityType),
					eq(externalEntityMappings.externalId, externalId)
				)
			)
			.limit(1)
		if (!afterRace) throw error
		return afterRace.internalId === input.internalId
			? { outcome: 'existing', mapping: afterRace }
			: { outcome: 'conflict', reason: 'external_id_points_elsewhere', existing: afterRace }
	}
}

function isUniqueViolation(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false
	if ('code' in error && (error as { code: unknown }).code === '23505') return true
	const cause = 'cause' in error ? (error as { cause: unknown }).cause : undefined
	return typeof cause === 'object' && cause !== null && 'code' in cause && (cause as { code: unknown }).code === '23505'
}
