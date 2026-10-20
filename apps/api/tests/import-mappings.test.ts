import { beforeEach, describe, expect, test } from 'bun:test'
import { db } from '../src/db/client'
import {
	findMapping,
	findMappingsForInternalId,
	InvalidExternalIdError,
	resolveOrCreateMapping
} from '../src/import/mappings'
import { resetDatabase } from './helpers'

beforeEach(async () => {
	await resetDatabase()
})

describe('resolveOrCreateMapping', () => {
	test('creates a new mapping and is idempotent on repeat', async () => {
		const internalId = crypto.randomUUID()

		const first = await db.transaction(tx =>
			resolveOrCreateMapping(tx, {
				sourceSystem: '1c',
				entityType: 'nomenclature',
				externalId: '10568',
				internalId
			})
		)
		expect(first.outcome).toBe('created')

		// A repeated import run resolving the exact same external id against
		// the exact same internal entity must be a no-op, not a duplicate row
		// or an error.
		const second = await db.transaction(tx =>
			resolveOrCreateMapping(tx, {
				sourceSystem: '1c',
				entityType: 'nomenclature',
				externalId: '10568',
				internalId
			})
		)
		expect(second.outcome).toBe('existing')

		const found = await findMapping(db, '1c', 'nomenclature', '10568')
		expect(found?.internalId).toBe(internalId)
	})

	test('rejects an empty external id', async () => {
		await expect(
			db.transaction(tx =>
				resolveOrCreateMapping(tx, {
					sourceSystem: '1c',
					entityType: 'nomenclature',
					externalId: '   ',
					internalId: crypto.randomUUID()
				})
			)
		).rejects.toThrow(InvalidExternalIdError)
	})

	test('independent namespaces: a legacy_mysql id and a 1c id with the same digits never merge', async () => {
		const legacyInternalId = crypto.randomUUID()
		const oneCInternalId = crypto.randomUUID()

		await db.transaction(tx =>
			resolveOrCreateMapping(tx, {
				sourceSystem: 'legacy_mysql',
				entityType: 'product',
				externalId: '4582',
				internalId: legacyInternalId
			})
		)
		await db.transaction(tx =>
			resolveOrCreateMapping(tx, {
				sourceSystem: '1c',
				entityType: 'nomenclature',
				externalId: '4582',
				internalId: oneCInternalId
			})
		)

		const legacyMapping = await findMapping(db, 'legacy_mysql', 'product', '4582')
		const oneCMapping = await findMapping(db, '1c', 'nomenclature', '4582')
		expect(legacyMapping?.internalId).toBe(legacyInternalId)
		expect(oneCMapping?.internalId).toBe(oneCInternalId)
		expect(legacyMapping?.internalId).not.toBe(oneCMapping?.internalId)
	})

	test('one internal entity can carry identities from more than one source system', async () => {
		const internalId = crypto.randomUUID()
		await db.transaction(tx =>
			resolveOrCreateMapping(tx, {
				sourceSystem: 'legacy_mysql',
				entityType: 'product',
				externalId: '4582',
				internalId
			})
		)
		await db.transaction(tx =>
			resolveOrCreateMapping(tx, {
				sourceSystem: '1c',
				entityType: 'nomenclature_group',
				externalId: 'A10.XXX',
				internalId
			})
		)

		const mappings = await findMappingsForInternalId(db, internalId)
		expect(mappings).toHaveLength(2)
		expect(mappings.map(m => m.sourceSystem).sort()).toEqual(['1c', 'legacy_mysql'])
	})

	test('a duplicate external id now pointing at a different internal entity is a conflict, never silently reassigned', async () => {
		const firstInternalId = crypto.randomUUID()
		const secondInternalId = crypto.randomUUID()

		await db.transaction(tx =>
			resolveOrCreateMapping(tx, {
				sourceSystem: '1c',
				entityType: 'nomenclature',
				externalId: '10568',
				internalId: firstInternalId
			})
		)

		const result = await db.transaction(tx =>
			resolveOrCreateMapping(tx, {
				sourceSystem: '1c',
				entityType: 'nomenclature',
				externalId: '10568',
				internalId: secondInternalId
			})
		)
		expect(result.outcome).toBe('conflict')
		if (result.outcome === 'conflict') {
			expect(result.reason).toBe('external_id_points_elsewhere')
			expect(result.existing.internalId).toBe(firstInternalId)
		}

		// The conflicting mapping was never created.
		const mappings = await findMappingsForInternalId(db, secondInternalId)
		expect(mappings).toHaveLength(0)
	})

	test('mapping the same internal entity to a second external id in the same source is flagged, not silently created', async () => {
		const internalId = crypto.randomUUID()
		await db.transaction(tx =>
			resolveOrCreateMapping(tx, {
				sourceSystem: '1c',
				entityType: 'nomenclature',
				externalId: '10568',
				internalId
			})
		)

		const result = await db.transaction(tx =>
			resolveOrCreateMapping(tx, {
				sourceSystem: '1c',
				entityType: 'nomenclature',
				externalId: '99999',
				internalId
			})
		)
		expect(result.outcome).toBe('conflict')
		if (result.outcome === 'conflict') {
			expect(result.reason).toBe('internal_id_has_other_external_id')
		}

		const mappings = await findMappingsForInternalId(db, internalId)
		expect(mappings).toHaveLength(1)
	})

	test('concurrent mapping creation for the same external id: exactly one wins, the other sees it (real Postgres transactions)', async () => {
		const internalIdA: string = crypto.randomUUID()
		const internalIdB: string = crypto.randomUUID()

		const [resultA, resultB] = await Promise.all([
			db.transaction(tx =>
				resolveOrCreateMapping(tx, {
					sourceSystem: '1c',
					entityType: 'nomenclature',
					externalId: '55555',
					internalId: internalIdA
				})
			),
			db.transaction(tx =>
				resolveOrCreateMapping(tx, {
					sourceSystem: '1c',
					entityType: 'nomenclature',
					externalId: '55555',
					internalId: internalIdB
				})
			)
		])

		const outcomes = [resultA.outcome, resultB.outcome].sort()
		// Either one created + one conflict, or (less likely but valid) both
		// observe each other as a conflict - what must never happen is both
		// succeeding as 'created' for the same external id.
		expect(outcomes.filter(o => o === 'created').length).toBeLessThanOrEqual(1)

		const mappings = await db
			.transaction(tx => findMapping(tx, '1c', 'nomenclature', '55555'))
		expect(mappings).not.toBeNull()
		expect([internalIdA, internalIdB]).toContain(mappings!.internalId)
	})
})
