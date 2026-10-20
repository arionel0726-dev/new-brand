/**
 * The single seam between this project and Cloudflare R2. Every other admin
 * media module (upload init/complete, image delete, cleanup) calls only the
 * functions exported here - never `@aws-sdk/client-s3` directly - so tests
 * can swap this whole module out with `mock.module()` instead of needing a
 * real R2 bucket or a local S3-compatible server.
 *
 * R2 is an optional integration: nothing here runs at import time that would
 * stop the server from booting without the R2_* env vars set. Callers must
 * check isR2Configured() first and surface AppError('media_not_configured')
 * themselves (see src/routes/v1/admin/media.ts) rather than this module
 * throwing deep inside an AWS SDK call.
 */
import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '../config/env'

export function isR2Configured(): boolean {
	return Boolean(
		env.R2_ACCOUNT_ID &&
			env.R2_ACCESS_KEY_ID &&
			env.R2_SECRET_ACCESS_KEY &&
			env.R2_BUCKET &&
			env.R2_PUBLIC_URL
	)
}

let cachedClient: S3Client | null = null

/** Throws if called before isR2Configured() has been checked by the caller. */
function getClient(): S3Client {
	if (!isR2Configured()) {
		throw new Error('R2 is not configured')
	}
	if (!cachedClient) {
		cachedClient = new S3Client({
			region: 'auto',
			endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
			credentials: {
				accessKeyId: env.R2_ACCESS_KEY_ID!,
				secretAccessKey: env.R2_SECRET_ACCESS_KEY!
			}
		})
	}
	return cachedClient
}

function getBucket(): string {
	return env.R2_BUCKET!
}

/** The public (read) URL for an object - never a signed URL, never the bucket's internal endpoint. */
export function getPublicUrl(objectKey: string): string {
	const base = env.R2_PUBLIC_URL!
	return `${base.replace(/\/+$/, '')}/${objectKey}`
}

/**
 * A short-lived presigned PUT URL. Deliberately does not try to bind
 * Content-Length into the signature - presigned PUT cannot reliably enforce
 * size or content on its own (S3-compatible signing doesn't cover the body),
 * so the real size/type checks happen in confirmUpload() against the object
 * actually sitting in R2, not anything the client claims up front.
 */
export async function createPresignedUploadUrl(
	objectKey: string,
	mimeType: string,
	expiresInSeconds: number
): Promise<{ url: string; expiresAt: Date }> {
	const command = new PutObjectCommand({
		Bucket: getBucket(),
		Key: objectKey,
		ContentType: mimeType
	})
	const url = await getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds })
	return { url, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) }
}

export type HeadResult = { contentLength: number; contentType: string | undefined }

/** null when the object does not exist (e.g. the client never actually uploaded it). */
export async function headObject(objectKey: string): Promise<HeadResult | null> {
	try {
		const result = await getClient().send(
			new HeadObjectCommand({ Bucket: getBucket(), Key: objectKey })
		)
		return { contentLength: result.ContentLength ?? 0, contentType: result.ContentType }
	} catch (error) {
		if (isNotFoundError(error)) return null
		throw error
	}
}

/** Fetches only the first `byteCount` bytes of an object - enough to sniff its real format without downloading the whole file. */
export async function getObjectHeadBytes(
	objectKey: string,
	byteCount: number
): Promise<Uint8Array | null> {
	try {
		const result = await getClient().send(
			new GetObjectCommand({
				Bucket: getBucket(),
				Key: objectKey,
				Range: `bytes=0-${byteCount - 1}`
			})
		)
		if (!result.Body) return null
		return await result.Body.transformToByteArray()
	} catch (error) {
		if (isNotFoundError(error)) return null
		throw error
	}
}

/** Throws on failure - callers (image delete, cleanup sweep) are responsible for retry bookkeeping. */
export async function deleteObject(objectKey: string): Promise<void> {
	await getClient().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: objectKey }))
}

function isNotFoundError(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false
	const name = 'name' in error ? String(error.name) : ''
	const httpStatus =
		'$metadata' in error &&
		typeof error.$metadata === 'object' &&
		error.$metadata !== null &&
		'httpStatusCode' in error.$metadata
			? Number(error.$metadata.httpStatusCode)
			: undefined
	return name === 'NotFound' || name === 'NoSuchKey' || httpStatus === 404
}
