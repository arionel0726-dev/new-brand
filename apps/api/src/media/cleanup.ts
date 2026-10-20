/**
 * Retries R2 object deletions that failed earlier (queued into
 * media_pending_deletions by deleteObjectOrQueueCleanup). PostgreSQL is the
 * source of truth for what's pending - this never assumes an object is gone
 * until a real deleteObject call succeeds.
 *
 * Usage: bun run media:cleanup
 */
import { queryClient } from '../db/client'
import {
	listPendingDeletions,
	recordPendingDeletionFailure,
	removePendingDeletion
} from '../db/queries/admin-media'
import { deleteObject } from './r2'

const BATCH_LIMIT = 100

export async function cleanupPendingDeletions() {
	const pending = await listPendingDeletions(BATCH_LIMIT)

	let succeeded = 0
	let failed = 0

	for (const row of pending) {
		try {
			await deleteObject(row.objectKey)
			await removePendingDeletion(row.id)
			succeeded++
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			await recordPendingDeletionFailure(row.id, message)
			failed++
		}
	}

	return { succeeded, failed }
}

if (import.meta.main) {
	cleanupPendingDeletions()
		.then(result => {
			console.log(`Cleanup done: ${result.succeeded} deleted, ${result.failed} still pending`)
			return queryClient.end()
		})
		.then(() => process.exit(0))
		.catch(error => {
			console.error('Cleanup failed:', error)
			process.exit(1)
		})
}
