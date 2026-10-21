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
	'product_prices',
	'variant_inventory_by_location',
	'product_variants',
	'products',
	'categories',
	'brands',
	'external_entity_mappings',
	'import_runs',
	'import_record_issues'
] as const

/**
 * Sprint 12B.6.1 Task 3: every table OUTSIDE the catalog-import domain that
 * carries a foreign key into one of `CATALOG_IMPORT_TABLES` (`products`,
 * `product_variants`, `categories`, or `brands`), found by grepping every
 * schema file's `.references(() => ...)` calls. PostgreSQL's `TRUNCATE ...
 * CASCADE` is structurally required here (a bare `TRUNCATE` on a table any
 * other table has an FK into is rejected outright, regardless of whether
 * that other table has rows), but CASCADE itself does NOT respect a
 * referencing table's own `onDelete` clause - even an `onDelete: 'set
 * null'` table (e.g. `order_items`) gets cascade-TRUNCATED, not
 * cascade-nulled. None of these tables are in the catalog-import domain,
 * and several (`orders`/`order_items`) are real customer data in a
 * potentially-shared test database - so this reset must never silently
 * reach them. If this list and the real schema ever diverge (a new table
 * adds such a reference), `checkNoForeignCatalogReferences`'s own test
 * coverage is the backstop, not this comment.
 */
const TABLES_THAT_MUST_STAY_EMPTY = [
	'cart_items',
	'collection_products',
	'coupon_products',
	'coupon_brands',
	'coupon_categories',
	'inventory',
	'media_uploads',
	'order_items',
	'promotion_products',
	'promotion_brands',
	'promotion_categories',
	'promotion_excluded_products',
	'wishlist_items'
] as const

export class UnsafeResetError extends Error {}

/**
 * Sprint 12B.6.1 Task 3: refuses the reset if ANY out-of-domain table that
 * `TRUNCATE ... CASCADE` would reach actually has rows in it - the one
 * property that makes the CASCADE safe (truncating an empty table loses
 * nothing) without having to drop CASCADE itself, which PostgreSQL would
 * reject structurally regardless of row counts. Fails closed: a table this
 * list doesn't yet know about is not this function's problem to guess at,
 * but every table this list DOES know about must be provably empty first.
 */
async function assertNoForeignCatalogReferences(db: Database): Promise<void> {
	const nonEmpty: string[] = []
	for (const table of TABLES_THAT_MUST_STAY_EMPTY) {
		const [row] = await db.execute<{ n: string }>(sql`select count(*)::text as n from ${sql.raw(table)}`)
		if (row && Number(row.n) > 0) nonEmpty.push(`${table} (${row.n} row(s))`)
	}
	if (nonEmpty.length > 0) {
		throw new UnsafeResetError(
			`Refusing to reset the catalog test database: TRUNCATE ... CASCADE on ${CATALOG_IMPORT_TABLES.join(', ')} would also cascade-delete rows in out-of-domain table(s) that are not empty: ${nonEmpty.join(', ')}. Clear those tables first (or use a database with no such data) before resetting.`
		)
	}
}

/**
 * Requirement 7's "reset beauty_store_test to a known clean state" script.
 * Fails closed via `assertSafeImportTarget` (reused, not reimplemented) -
 * refuses to run against anything but the local isolated test database,
 * exactly the same guard write-mode catalog imports already require - and,
 * as of Sprint 12B.6.1 Task 3, additionally refuses if the structurally
 * required CASCADE would actually delete any out-of-domain data.
 */
export async function resetCatalogTestDatabase(db: Database, databaseUrl: string): Promise<void> {
	assertSafeImportTarget(databaseUrl)
	await assertNoForeignCatalogReferences(db)
	await db.execute(sql`truncate table ${sql.raw(CATALOG_IMPORT_TABLES.join(', '))} restart identity cascade`)
}

export { CATALOG_IMPORT_TABLES, TABLES_THAT_MUST_STAY_EMPTY }
