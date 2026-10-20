import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../client'
import { mediaPendingDeletions } from '../schema/media-pending-deletions'
import { mediaUploads } from '../schema/media-uploads'
import { productImages } from '../schema/product-images'
import type { CreateImageInput, ImageRow } from './admin-images'

export type MediaUploadRow = typeof mediaUploads.$inferSelect
export type PendingDeletionRow = typeof mediaPendingDeletions.$inferSelect

export type CreateUploadSessionInput = {
	objectKey: string
	productId: string
	variantId?: string | null
	fileName: string
	mimeType: string
	declaredFileSize: number
	createdBy: string
	expiresAt: Date
}

export async function createUploadSession(input: CreateUploadSessionInput): Promise<MediaUploadRow> {
	const [row] = await db.insert(mediaUploads).values(input).returning()
	return row
}

export async function getUploadById(id: string): Promise<MediaUploadRow | null> {
	const [row] = await db.select().from(mediaUploads).where(eq(mediaUploads.id, id)).limit(1)
	return row ?? null
}

/**
 * Atomically moves a 'pending' upload to 'rejected' - a conditional UPDATE,
 * not a read-then-write, so two concurrent /complete calls for the same
 * uploadId can't both think they "won". Returns false if the row was
 * already completed or rejected by the time this ran (lost the race, or a
 * genuine repeat confirmation).
 */
export async function rejectUploadIfPending(uploadId: string): Promise<boolean> {
	const result = await db
		.update(mediaUploads)
		.set({ status: 'rejected' })
		.where(and(eq(mediaUploads.id, uploadId), eq(mediaUploads.status, 'pending')))
		.returning({ id: mediaUploads.id })
	return result.length > 0
}

/**
 * The only path that creates a product_images row from a completed upload.
 * Transitions the upload row ('pending' -> 'completed') and inserts the
 * image in one transaction, using the same conditional-UPDATE trick as
 * rejectUploadIfPending to close the double-confirmation race: if the
 * upload is no longer 'pending' by the time this runs, nothing is inserted
 * and null is returned instead of creating a duplicate image.
 */
export async function completeUploadWithImage(
	uploadId: string,
	imageInput: CreateImageInput
): Promise<ImageRow | null> {
	return db.transaction(async tx => {
		const [updated] = await tx
			.update(mediaUploads)
			.set({ status: 'completed', completedAt: new Date() })
			.where(and(eq(mediaUploads.id, uploadId), eq(mediaUploads.status, 'pending')))
			.returning({ id: mediaUploads.id })

		if (!updated) return null

		const [image] = await tx.insert(productImages).values(imageInput).returning()
		await tx.update(mediaUploads).set({ imageId: image.id }).where(eq(mediaUploads.id, uploadId))
		return image
	})
}

/**
 * Every 'pending' upload session whose presigned URL has expired
 * (Sprint 9 Task 4). A session the client abandoned after actually PUTting
 * the object to R2 but never calling /complete would otherwise leak that
 * object forever - nothing else in this codebase ever revisits a session
 * nobody confirmed or re-attempted. Same conditional-UPDATE-then-act shape
 * as rejectUploadIfPending, just batched: each row only transitions
 * 'pending' -> 'rejected' once, so re-running this sweep concurrently or
 * repeatedly is always safe.
 */
export async function sweepExpiredUploadSessions(limit: number): Promise<MediaUploadRow[]> {
	const candidates = await db
		.select({ id: mediaUploads.id })
		.from(mediaUploads)
		.where(and(eq(mediaUploads.status, 'pending'), sql`${mediaUploads.expiresAt} < now()`))
		.limit(limit)
	if (candidates.length === 0) return []

	return db
		.update(mediaUploads)
		.set({ status: 'rejected' })
		.where(
			and(
				eq(mediaUploads.status, 'pending'),
				inArray(
					mediaUploads.id,
					candidates.map(row => row.id)
				)
			)
		)
		.returning()
}

/** Best-effort bookkeeping so a failed/never-attempted R2 delete is never mistaken for "done". Safe to call more than once for the same key. */
export async function queuePendingDeletion(objectKey: string, reason: string): Promise<void> {
	await db
		.insert(mediaPendingDeletions)
		.values({ objectKey, reason })
		.onConflictDoNothing({ target: mediaPendingDeletions.objectKey })
}

export async function listPendingDeletions(limit: number): Promise<PendingDeletionRow[]> {
	return db.select().from(mediaPendingDeletions).limit(limit)
}

export async function removePendingDeletion(id: string): Promise<void> {
	await db.delete(mediaPendingDeletions).where(eq(mediaPendingDeletions.id, id))
}

export async function recordPendingDeletionFailure(id: string, error: string): Promise<void> {
	await db
		.update(mediaPendingDeletions)
		.set({
			attempts: sql`${mediaPendingDeletions.attempts} + 1`,
			lastError: error,
			lastAttemptAt: new Date()
		})
		.where(eq(mediaPendingDeletions.id, id))
}
