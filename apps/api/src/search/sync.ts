/**
 * Internal catalog -> Meilisearch sync service.
 *
 * PostgreSQL is always the source of truth; this module never writes to
 * Postgres, only reads from it to keep the Meilisearch index in step. It is
 * meant to be called by a future Catalog Management API right after a write
 * (e.g. "product saved, now sync its search document") - there is no public
 * HTTP route for it in this sprint, deliberately.
 *
 * Meilisearch writes are asynchronous (they enqueue a task). Every operation
 * here awaits that task via `.waitTask()` so callers that need the index to
 * already reflect the change (tests, or a synchronous admin action) can rely
 * on the function's return instead of polling. A failure here (Meilisearch
 * down, network error, ...) is caught and reported as an `error` outcome
 * rather than thrown: Postgres has already committed by the time this runs,
 * so a search-side failure must never look like a catalog write failure.
 * Recovery from a missed or failed sync is the full `reindexProducts()`
 * reindex (Task 3 requirement: no queue/outbox is being introduced here).
 */
import { fetchCategoriesForProducts, fetchSkusForProducts, getPublishableProductRowById } from '../db/queries/products'
import { indexProducts, removeProductsFromIndex, toSearchDocument } from './products-index'

export type SyncOutcome =
	| { status: 'indexed'; productId: string }
	| { status: 'removed'; productId: string; reason: 'not_found' | 'unpublished' | 'requested' }
	| { status: 'error'; productId: string; operation: 'index' | 'remove'; message: string }

function logFailure(operation: 'index' | 'remove', productId: string, error: unknown) {
	const message = error instanceof Error ? error.message : String(error)
	console.error(`[search-sync] failed to ${operation} product ${productId} in Meilisearch:`, message)
	return message
}

/**
 * Indexes a single product by id, or removes it from the index if it is no
 * longer publishable (missing, draft/archived, or with no published
 * variant left - e.g. its last active/priced variant was just disabled).
 */
export async function syncProductToIndex(productId: string): Promise<SyncOutcome> {
	let row: Awaited<ReturnType<typeof getPublishableProductRowById>>

	try {
		row = await getPublishableProductRowById(productId)
	} catch (error) {
		return { status: 'error', productId, operation: 'index', message: logFailure('index', productId, error) }
	}

	if (!row) {
		try {
			await removeProductsFromIndex([productId])
			return { status: 'removed', productId, reason: 'unpublished' }
		} catch (error) {
			return { status: 'error', productId, operation: 'remove', message: logFailure('remove', productId, error) }
		}
	}

	try {
		const [categoriesByProduct, skusByProduct] = await Promise.all([
			fetchCategoriesForProducts([productId]),
			fetchSkusForProducts([productId])
		])

		const document = toSearchDocument(
			row,
			categoriesByProduct.get(productId) ?? [],
			skusByProduct.get(productId) ?? []
		)
		await indexProducts([document])
		return { status: 'indexed', productId }
	} catch (error) {
		return { status: 'error', productId, operation: 'index', message: logFailure('index', productId, error) }
	}
}

/** Explicitly removes a product from the index (e.g. it was just deleted outright). */
export async function removeProductFromIndex(productId: string): Promise<SyncOutcome> {
	try {
		await removeProductsFromIndex([productId])
		return { status: 'removed', productId, reason: 'requested' }
	} catch (error) {
		return { status: 'error', productId, operation: 'remove', message: logFailure('remove', productId, error) }
	}
}

export { reindexProducts } from './reindex'
