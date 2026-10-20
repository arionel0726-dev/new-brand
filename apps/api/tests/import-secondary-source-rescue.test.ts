import { describe, expect, test } from 'bun:test'
import type { MysqlReconciliationResult } from '../src/import/reconcile/sql-1c-reconciliation'
import { computeSecondarySourceRescues } from '../src/import/reconcile/secondary-source-rescue'

/** All synthetic - no field values copied from any real dataset. */
function result(overrides: Partial<MysqlReconciliationResult> & { legacyProductId: number; outcome: MysqlReconciliationResult['outcome'] }): MysqlReconciliationResult {
	return {
		mysqlGuid: null,
		basis: [],
		matchedOneCIdNoms: [],
		reasoning: 'synthetic',
		...overrides
	}
}

describe('computeSecondarySourceRescues (old_products.json wiring, Sprint 12A.4)', () => {
	test('a product unmatched in the primary pass but confirmed in the secondary pass is surfaced as a rescue', () => {
		const primary = [result({ legacyProductId: 1, outcome: 'unmatched' })]
		const secondary = [result({ legacyProductId: 1, outcome: 'confirmed', matchedOneCIdNoms: ['9001'] })]
		const rescues = computeSecondarySourceRescues(primary, secondary)
		expect(rescues).toHaveLength(1)
		expect(rescues[0]).toEqual({ legacyProductId: 1, outcome: 'confirmed', matchedOneCIdNoms: ['9001'], reasoning: 'synthetic' })
	})

	test('a product already confirmed in the primary pass is never re-surfaced as a rescue, even if the secondary pass also matches it', () => {
		const primary = [result({ legacyProductId: 1, outcome: 'confirmed', matchedOneCIdNoms: ['9001'] })]
		const secondary = [result({ legacyProductId: 1, outcome: 'confirmed', matchedOneCIdNoms: ['9001'] })]
		expect(computeSecondarySourceRescues(primary, secondary)).toHaveLength(0)
	})

	test('a quarantined product never becomes a rescue, even if the secondary source matches it - quarantine is never overridden', () => {
		// reconcileSqlWith1c forces outcome to 'quarantine' on both passes when the
		// same priorQuarantine map is supplied - this test documents the
		// contract computeSecondarySourceRescues relies on: it trusts the
		// 'outcome' field exactly as given, and a 'quarantine' outcome is
		// simply never 'confirmed' or 'ambiguous', so it is excluded by
		// construction.
		const primary = [result({ legacyProductId: 1, outcome: 'quarantine' })]
		const secondary = [result({ legacyProductId: 1, outcome: 'quarantine', matchedOneCIdNoms: ['9001'] })]
		expect(computeSecondarySourceRescues(primary, secondary)).toHaveLength(0)
	})

	test('an unmatched-in-both-passes product is never surfaced', () => {
		const primary = [result({ legacyProductId: 1, outcome: 'unmatched' })]
		const secondary = [result({ legacyProductId: 1, outcome: 'unmatched' })]
		expect(computeSecondarySourceRescues(primary, secondary)).toHaveLength(0)
	})

	test('an ambiguous secondary match for a primary-unmatched product is surfaced as ambiguous, not silently upgraded to confirmed', () => {
		const primary = [result({ legacyProductId: 1, outcome: 'unmatched' })]
		const secondary = [result({ legacyProductId: 1, outcome: 'ambiguous', matchedOneCIdNoms: ['9001', '9002'] })]
		const rescues = computeSecondarySourceRescues(primary, secondary)
		expect(rescues).toHaveLength(1)
		expect(rescues[0].outcome).toBe('ambiguous')
		expect(rescues[0].matchedOneCIdNoms).toEqual(['9001', '9002'])
	})

	test('multiple products are handled independently', () => {
		const primary = [
			result({ legacyProductId: 1, outcome: 'unmatched' }),
			result({ legacyProductId: 2, outcome: 'confirmed', matchedOneCIdNoms: ['x'] }),
			result({ legacyProductId: 3, outcome: 'unmatched' })
		]
		const secondary = [
			result({ legacyProductId: 1, outcome: 'confirmed', matchedOneCIdNoms: ['9001'] }),
			result({ legacyProductId: 2, outcome: 'confirmed', matchedOneCIdNoms: ['x'] }),
			result({ legacyProductId: 3, outcome: 'unmatched' })
		]
		const rescues = computeSecondarySourceRescues(primary, secondary)
		expect(rescues.map(r => r.legacyProductId)).toEqual([1])
	})
})
