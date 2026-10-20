import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthVariables } from '../../../auth/middleware'
import type { ImageRow } from '../../../db/queries/admin-images'
import {
	completeUploadWithImage,
	createUploadSession,
	getUploadById,
	queuePendingDeletion,
	rejectUploadIfPending
} from '../../../db/queries/admin-media'
import { getAdminProductById } from '../../../db/queries/admin-products'
import { getVariantById } from '../../../db/queries/admin-variants'
import { ok } from '../../../lib/respond'
import { validateJson } from '../../../lib/validate'
import { AppError } from '../../../middleware/error-handler'
import {
	createPresignedUploadUrl,
	deleteObject,
	getObjectHeadBytes,
	getPublicUrl,
	headObject,
	isR2Configured
} from '../../../media/r2'
import {
	ALLOWED_MIME_TYPES,
	MAX_FILE_SIZE_BYTES,
	extensionForMimeType,
	isAllowedMimeType,
	sniffImageMimeType
} from '../../../media/sniff'

// How long a presigned upload URL (and its matching session row) stays
// valid for. Short-lived by design - see Task 6.
const UPLOAD_EXPIRY_SECONDS = 5 * 60
// How many leading bytes are enough to recognize any of the supported
// image formats' magic numbers.
const SNIFF_BYTE_COUNT = 32

const uploadInitSchema = z.object({
	fileName: z.string().min(1).max(255),
	mimeType: z.string().min(1),
	fileSize: z.number().int().positive(),
	productId: z.uuid(),
	variantId: z.uuid().optional()
})

const uploadCompleteSchema = z.object({ uploadId: z.uuid() })

function requireR2Configured() {
	if (!isR2Configured()) {
		throw new AppError(
			'Media storage is not configured on this server',
			503,
			'media_not_configured'
		)
	}
}

function serializeImage(image: ImageRow) {
	return {
		id: image.id,
		productId: image.productId,
		variantId: image.variantId,
		url: image.url,
		mimeType: image.mimeType,
		fileSize: image.fileSize,
		width: image.width,
		height: image.height,
		altRu: image.altRu,
		altRo: image.altRo,
		sortOrder: image.sortOrder,
		createdAt: image.createdAt
	}
}

export const adminMediaRoute = new Hono<{ Variables: AuthVariables }>()
	.post('/upload', validateJson(uploadInitSchema), async c => {
		requireR2Configured()
		const body = c.req.valid('json')

		if (!isAllowedMimeType(body.mimeType)) {
			throw new AppError(
				`Unsupported file type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
				400,
				'unsupported_media_type'
			)
		}
		if (body.fileSize > MAX_FILE_SIZE_BYTES) {
			throw new AppError('File exceeds the 10 MB limit', 400, 'file_too_large')
		}

		const product = await getAdminProductById(body.productId)
		if (!product) {
			throw new AppError('Product not found', 404, 'product_not_found')
		}

		if (body.variantId) {
			const variant = await getVariantById(body.variantId)
			if (!variant) {
				throw new AppError('Variant not found', 404, 'variant_not_found')
			}
			if (variant.productId !== body.productId) {
				throw new AppError(
					'Variant does not belong to the given product',
					400,
					'variant_product_mismatch'
				)
			}
		}

		// Random and unguessable - not derived from the filename, product id,
		// or anything else an attacker could predict or target.
		const objectKey = `products/${body.productId}/${randomUUID()}.${extensionForMimeType(body.mimeType)}`
		const expiresAt = new Date(Date.now() + UPLOAD_EXPIRY_SECONDS * 1000)

		const presigned = await createPresignedUploadUrl(
			objectKey,
			body.mimeType,
			UPLOAD_EXPIRY_SECONDS
		)

		const session = await createUploadSession({
			objectKey,
			productId: body.productId,
			variantId: body.variantId ?? null,
			fileName: body.fileName,
			mimeType: body.mimeType,
			declaredFileSize: body.fileSize,
			createdBy: c.get('user').id,
			expiresAt
		})

		return ok(
			c,
			{
				uploadId: session.id,
				uploadUrl: presigned.url,
				headers: { 'Content-Type': body.mimeType },
				expiresAt: presigned.expiresAt
			},
			201
		)
	})
	.post('/complete', validateJson(uploadCompleteSchema), async c => {
		requireR2Configured()
		const { uploadId } = c.req.valid('json')

		const session = await getUploadById(uploadId)
		if (!session) {
			throw new AppError('Upload session not found', 404, 'upload_not_found')
		}
		if (session.createdBy !== c.get('user').id) {
			throw new AppError('This upload session belongs to a different user', 403, 'forbidden')
		}
		if (session.status !== 'pending') {
			throw new AppError(
				'This upload has already been confirmed or rejected',
				409,
				'upload_already_completed'
			)
		}
		if (session.expiresAt.getTime() < Date.now()) {
			await rejectUploadIfPending(uploadId)
			await queuePendingDeletion(session.objectKey, 'upload_expired')
			throw new AppError('Upload session has expired', 410, 'upload_expired')
		}

		// From here on, nothing from the client is trusted - only what R2
		// actually has stored under this object key.
		const head = await headObject(session.objectKey)
		if (!head) {
			await rejectUploadIfPending(uploadId)
			throw new AppError(
				'No object was found at the expected location - it may never have been uploaded',
				404,
				'object_not_found'
			)
		}

		if (head.contentLength <= 0 || head.contentLength > MAX_FILE_SIZE_BYTES) {
			await rejectUploadIfPending(uploadId)
			await queuePendingDeletion(session.objectKey, 'file_too_large')
			throw new AppError('Uploaded object exceeds the 10 MB limit', 400, 'file_too_large')
		}

		const headBytes = await getObjectHeadBytes(session.objectKey, SNIFF_BYTE_COUNT)
		const sniffedMimeType = headBytes ? sniffImageMimeType(headBytes) : null
		if (!sniffedMimeType) {
			await rejectUploadIfPending(uploadId)
			await queuePendingDeletion(session.objectKey, 'invalid_file_content')
			throw new AppError(
				'The uploaded object is not a recognized image format',
				400,
				'invalid_file_content'
			)
		}

		const image = await completeUploadWithImage(uploadId, {
			productId: session.productId,
			variantId: session.variantId,
			url: getPublicUrl(session.objectKey),
			objectKey: session.objectKey,
			mimeType: sniffedMimeType,
			fileSize: head.contentLength
		})

		if (!image) {
			// Lost a race with another /complete call for the same session.
			throw new AppError(
				'This upload has already been confirmed or rejected',
				409,
				'upload_already_completed'
			)
		}

		return ok(c, serializeImage(image), 201)
	})

export type AdminMediaRouteType = typeof adminMediaRoute

/** Exported for the image-delete endpoint and the cleanup CLI - a single controlled sequence: try the real delete, and only queue a retry if it fails. */
export async function deleteObjectOrQueueCleanup(objectKey: string, reason: string): Promise<void> {
	try {
		await deleteObject(objectKey)
	} catch (error) {
		console.error(`[media] failed to delete R2 object ${objectKey}:`, error)
		await queuePendingDeletion(objectKey, reason)
	}
}
