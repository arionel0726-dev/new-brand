/**
 * Sprint 12B.6 Requirement 7: safe rollback mechanisms for the isolated
 * `beauty_store_test` database - so exercising a real (write-mode)
 * controlled test import, and the Requirement 6 post-import checks
 * against it, never requires trusting that nobody forgets to clean up
 * afterwards.
 *
 * Two complementary mechanisms, matching the two situations Requirement 7
 * names:
 *   - `runInRolledBackTransaction`: wraps a real write-mode import (and
 *     whatever checks run against it) in one transaction that is always
 *     rolled back at the end, regardless of outcome - for TESTING the
 *     checks themselves against real written state without leaving
 *     anything behind.
 *   - `resetCatalogTestDatabase`: truncates every catalog-import-relevant
 *     table and restarts identity sequences, for resetting the isolated
 *     test database to a known-clean state between full (committed) test
 *     runs. Guarded by the existing `assertSafeImportTarget` host/db-name
 *     allowlist (unchanged, reused directly) so it can never run against
 *     anything but the isolated local test database - failing closed.
 */
import { sql } from 'drizzle-orm'
import type { Database } from '../db/client'
import type { Tx } from '../db/tx'
import { assertSafeImportTarget } from './catalog-importer'

/**
 * Runs `fn` inside a transaction that is unconditionally rolled back once
 * `fn` resolves - `fn`'s return value is preserved and returned to the
 * caller even though nothing it wrote is kept. Any real error `fn` throws
 * propagates normally (and the transaction rolls back anyway, as any
 * thrown error inside `db.transaction` already does).
 */
export class IntentionalRollback extends Error {}

export async function runInRolledBackTransaction<T>(db: Database, fn: (tx: Tx) => Promise<T>): Promise<T> {
	let captured: T | undefined
	let captureSet = false
	try {
		await db.transaction(async tx => {
			captured = await fn(tx)
			captureSet = true
			throw new IntentionalRollback('Sprint 12B.6 Requirement 7: intentional rollback, not a real failure')
		})
	} catch (error) {
		if (!(error instanceof IntentionalRollback)) throw error
	}
	if (!captureSet) throw new Error('runInRolledBackTransaction: fn never completed before the rollback fired')
	return captured as T
}

/**
 * Every table a catalog-import write touches, in FK-safe truncation order
 * (children before parents is actually unnecessary with CASCADE, but kept
 * readable). Deliberately scoped to catalog-import tables only - never
 * touches auth/cart/order tables, so this can run between catalog-import
 * test iterations without disturbing unrelated test fixtures.
 */
const CATALOG_IMPORT_TABLES = [
	'product_variant_barcodes',
	'product_slug_aliases',
	'product_categories',
	'product_images',
	'product_variants',
	'products',
	'categories',
	'brands',
	'external_entity_mappings',
	'import_runs',
	'import_record_issues'
] as const

/**
 * Requirement 7's "reset beauty_store_test to a known clean state" script.
 * Fails closed via `assertSafeImportTarget` (reused, not reimplemented) -
 * refuses to run against anything but the local isolated test database,
 * exactly the same guard write-mode catalog imports already require.
 */
export async function resetCatalogTestDatabase(db: Database, databaseUrl: string): Promise<void> {
	assertSafeImportTarget(databaseUrl)
	await db.execute(sql`truncate table ${sql.raw(CATALOG_IMPORT_TABLES.join(', '))} restart identity cascade`)
}

export { CATALOG_IMPORT_TABLES }
