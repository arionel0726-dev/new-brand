/**
 * Retries R2 object deletions that failed earlier (queued into
 * media_pending_deletions by deleteObjectOrQueueCleanup), and sweeps upload
 * sessions whose presigned URL expired with the client never calling
 * /complete (Sprint 9 Task 4) - the one orphan-leak path nothing else in
 * this codebase revisits: a client that actually PUT an object to R2 but
 * abandoned the flow before confirming it. PostgreSQL is the source of
 * truth for what's pending in both cases - this never assumes an object is
 * gone until a real deleteObject call succeeds.
 *
 * Usage: bun run media:cleanup
 */
import { queryClient } from '../db/client'
import {
	listPendingDeletions,
	queuePendingDeletion,
	recordPendingDeletionFailure,
	removePendingDeletion,
	sweepExpiredUploadSessions
} from '../db/queries/admin-media'
import { deleteObject } from './r2'

const BATCH_LIMIT = 100

/**
 * Marks every expired, never-confirmed upload session 'rejected' and queues
 * its object key for deletion - harmless if the client never actually
 * uploaded anything (deleting a key that was never written is a no-op in
 * an S3-compatible store), necessary if they did.
 */
export async function sweepExpiredUploads() {
	const expired = await sweepExpiredUploadSessions(BATCH_LIMIT)
	for (const upload of expired) {
		await queuePendingDeletion(upload.objectKey, 'upload_session_expired_unconfirmed')
	}
	return { swept: expired.length }
}

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
	sweepExpiredUploads()
		.then(sweepResult => {
			console.log(`Swept ${sweepResult.swept} expired, unconfirmed upload session(s)`)
			return cleanupPendingDeletions()
		})
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
