/**
 * Secondary-source rescue computation (Sprint 12A.4 Task 2/8) - a small,
 * pure, DB-free helper so the `old_products.json` wiring in
 * `../cli/reconcile-1c-local.ts` is unit-testable without spinning up
 * Postgres.
 *
 * `old_products.json` is, per the real Sprint 12A.3 audit
 * (`docs/legacy-audit/vizaje-1c-audit.md`), a near-total subset of
 * `products.json` by `ID_nom` (702/703 shared) - a stale snapshot, not an
 * independent source. It is therefore never used to find a *new* identity
 * for a product the primary pass already resolved (confirmed, ambiguous,
 * or quarantined); it is only consulted for products the primary pass left
 * `unmatched`, and even then its result is surfaced as separate evidence
 * for a human reviewer - never merged into the primary counts, and never
 * able to clear a quarantine (a quarantined product's secondary-pass
 * outcome is always `'quarantine'` too, since quarantine is decided
 * independently of which 1C source matched - see
 * `reconcileSqlWith1c`'s own `priorQuarantine` handling).
 */
import type { MysqlReconciliationResult } from './sql-1c-reconciliation'

export type SecondarySourceRescue = {
	legacyProductId: number
	outcome: 'confirmed' | 'ambiguous'
	matchedOneCIdNoms: string[]
	reasoning: string
}

/**
 * @param primaryResults Results of `reconcileSqlWith1c` against the primary 1C source (products.json).
 * @param secondaryResults Results of `reconcileSqlWith1c` (same MySQL dump, same `priorQuarantine` map) against a secondary source (e.g. old_products.json).
 * @returns Only the products that were `unmatched` in the primary pass AND resolved to `confirmed`/`ambiguous` in the secondary pass. A product quarantined in the primary pass can never appear here, because `reconcileSqlWith1c` forces its secondary-pass outcome to `'quarantine'` as well when the same `priorQuarantine` map is supplied to both calls.
 */
export function computeSecondarySourceRescues(
	primaryResults: MysqlReconciliationResult[],
	secondaryResults: MysqlReconciliationResult[]
): SecondarySourceRescue[] {
	const primaryUnmatchedIds = new Set(primaryResults.filter(r => r.outcome === 'unmatched').map(r => r.legacyProductId))

	return secondaryResults
		.filter((r): r is MysqlReconciliationResult & { outcome: 'confirmed' | 'ambiguous' } => {
			if (!primaryUnmatchedIds.has(r.legacyProductId)) return false
			return r.outcome === 'confirmed' || r.outcome === 'ambiguous'
		})
		.map(r => ({
			legacyProductId: r.legacyProductId,
			outcome: r.outcome,
			matchedOneCIdNoms: r.matchedOneCIdNoms,
			reasoning: r.reasoning
		}))
}
