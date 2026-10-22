/**
 * Sprint 12B.6.1 Task 1: the one function that performs a controlled slice
 * write AND every mandatory post-import check inside a SINGLE PostgreSQL
 * transaction. If any check fails, this function throws from inside the
 * `db.transaction` callback - which Postgres (via drizzle's transaction
 * wrapper) always rolls back on a thrown error - so a failing check means
 * the write that just happened is undone atomically, never left committed
 * for a human to notice and clean up by hand.
 *
 * Pulled out of the CLI entrypoint specifically so this atomicity property
 * has its own direct test coverage (see
 * `tests/catalog-slice-db.test.ts`'s "Task 1: atomic write + validation"
 * block) rather than only being exercised indirectly through a spawned CLI
 * process.
 */
import type { Database } from '../db/client'
import { runCatalogImport, type CatalogImportInput, type CatalogImportResult } from './catalog-importer'
import {
	checkRowCounts,
	checkNoOrphanVariants,
	checkNoDuplicateSkus,
	checkNoDuplicateExternalIdMappings,
	checkBarcodeIntegrity,
	checkCategoryBrandLinksResolve,
	type PostImportCheckResult
} from './catalog-slice-post-import-checks'
import { runScopedReferenceBootstrap, type ScopedReferenceBootstrapResult } from './scoped-reference-bootstrap'
import type { LegacyCatalogDump } from './parsers/mysql-catalog'

export type SliceWriteChecks = {
	rowCounts: PostImportCheckResult & { actual: { products: number; variants: number } }
	orphanVariants: PostImportCheckResult
	duplicateSkus: PostImportCheckResult
	duplicateExternalIdMappings: PostImportCheckResult
	barcodeIntegrity: PostImportCheckResult
	categoryBrandLinks: PostImportCheckResult & { missingBrandLinks: number; missingCategoryLinks: number }
}

export class PostImportChecksFailedError extends Error {
	constructor(public readonly checks: SliceWriteChecks) {
		super('One or more post-import checks failed - the entire write was rolled back, nothing was committed.')
	}
}

export type AtomicSliceWriteResult = {
	importResult: CatalogImportResult
	checks: SliceWriteChecks
}

/**
 * Runs `runCatalogImport(..., 'write')` and every Requirement 6 post-import
 * check against the SAME transaction, atomically. Resolves with both the
 * import result and the check results only if every check passed (meaning
 * the transaction committed); throws `PostImportChecksFailedError` - itself
 * carrying the checks that failed, for the caller to report - if any check
 * failed, in which case nothing from this call was actually persisted.
 */
export async function runAtomicSliceWrite(db: Database, input: CatalogImportInput): Promise<AtomicSliceWriteResult> {
	return db.transaction(async tx => {
		const importResult = await runCatalogImport(tx, input, 'write')

		const checks: SliceWriteChecks = {
			rowCounts: await checkRowCounts(tx, {
				products: importResult.summary.productsCreated + importResult.summary.productsUpdated,
				variants: importResult.summary.variantsWritten
			}),
			orphanVariants: await checkNoOrphanVariants(tx),
			duplicateSkus: await checkNoDuplicateSkus(tx),
			duplicateExternalIdMappings: await checkNoDuplicateExternalIdMappings(tx),
			barcodeIntegrity: await checkBarcodeIntegrity(tx),
			categoryBrandLinks: await checkCategoryBrandLinksResolve(tx)
		}

		const allOk = Object.values(checks).every(c => c.ok)
		if (!allOk) throw new PostImportChecksFailedError(checks)

		return { importResult, checks }
	})
}

export type AtomicSliceWriteWithBootstrapResult = AtomicSliceWriteResult & {
	bootstrap: ScopedReferenceBootstrapResult
}

/**
 * Sprint 12B.10.2 fix: a real first write of a brand-new slice (e.g. the
 * user's confirmed Pupa read-only run: 1 brand + 20 categories not yet
 * present in the target database) needs brand/category reference rows to
 * exist BEFORE `runCatalogImport`'s product/variant write runs - otherwise
 * `resolveBrandId`/`writeCategoryLinksPreview` (catalog-importer.ts) find
 * nothing in `external_entity_mappings` and every written product ends up
 * `unpublishedForMissingBrand`/`unpublishedForMissingCategory`, exactly the
 * gap Sprint 12B.7 fixed for the manual CLI flow but which the unified
 * `runWorkflowWrite` (Sprint 12B.10) never actually composed in.
 *
 * Runs `runScopedReferenceBootstrap` (write mode, reused unchanged from
 * Sprint 12B.7 - no new bootstrap logic) and `runCatalogImport` (write) and
 * every Requirement 6 post-import check in ONE transaction - not bootstrap-
 * then-separately-import - so a failure anywhere (a check failing, the
 * import throwing) rolls back the bootstrap too, atomically. This is a
 * strictly stronger guarantee than "bootstrap commits first, then import
 * commits": `runScopedReferenceBootstrap` takes a `Tx` and performs no
 * transaction management of its own (confirmed by reading its source), so
 * composing it inside this function's own `db.transaction` call was
 * straightforward and required no change to its internals or to
 * `bootstrapBrands`/`bootstrapCategories`.
 */
export async function runAtomicSliceWriteWithBootstrap(
	db: Database,
	dump: LegacyCatalogDump,
	legacyProductIds: readonly number[],
	input: CatalogImportInput
): Promise<AtomicSliceWriteWithBootstrapResult> {
	return db.transaction(async tx => {
		const bootstrap = await runScopedReferenceBootstrap(tx, dump, legacyProductIds, 'write')
		const importResult = await runCatalogImport(tx, input, 'write')

		const checks: SliceWriteChecks = {
			rowCounts: await checkRowCounts(tx, {
				products: importResult.summary.productsCreated + importResult.summary.productsUpdated,
				variants: importResult.summary.variantsWritten
			}),
			orphanVariants: await checkNoOrphanVariants(tx),
			duplicateSkus: await checkNoDuplicateSkus(tx),
			duplicateExternalIdMappings: await checkNoDuplicateExternalIdMappings(tx),
			barcodeIntegrity: await checkBarcodeIntegrity(tx),
			categoryBrandLinks: await checkCategoryBrandLinksResolve(tx)
		}

		const allOk = Object.values(checks).every(c => c.ok)
		if (!allOk) throw new PostImportChecksFailedError(checks)

		return { importResult, checks, bootstrap }
	})
}
