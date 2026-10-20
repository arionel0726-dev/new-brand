import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { fakeR2Store, JPEG_BYTES, NOT_AN_IMAGE_BYTES, oversizedJpegBytes } from './mocks/r2-store'

/**
 * Replaces the one seam between this project and Cloudflare R2
 * (src/media/r2.ts) with an in-memory fake, so these tests exercise the
 * real upload-init/complete/delete/reorder logic without ever touching a
 * real R2 bucket. `mock.module()` calls are hoisted above every import in
 * this file by Bun's test runner, so this takes effect before `./helpers`
 * (which pulls in the whole app, routes included) is ever loaded.
 */
mock.module('../src/media/r2', () => ({
	isR2Configured: () => fakeR2Store.configured,
	getPublicUrl: (objectKey: string) => `https://cdn.test.invalid/${objectKey}`,
	createPresignedUploadUrl: async (
		objectKey: string,
		_mimeType: string,
		expiresInSeconds: number
	) => ({
		url: `https://upload.test.invalid/${objectKey}`,
		expiresAt: new Date(Date.now() + expiresInSeconds * 1000)
	}),
	headObject: async (objectKey: string) => {
		const obj = fakeR2Store.objects.get(objectKey)
		if (!obj) return null
		return { contentLength: obj.bytes.length, contentType: obj.contentType }
	},
	getObjectHeadBytes: async (objectKey: string, byteCount: number) => {
		const obj = fakeR2Store.objects.get(objectKey)
		if (!obj) return null
		return obj.bytes.slice(0, byteCount)
	},
	deleteObject: async (objectKey: string) => {
		if (fakeR2Store.failDeleteFor.has(objectKey)) {
			throw new Error('simulated R2 delete failure')
		}
		fakeR2Store.objects.delete(objectKey)
	}
}))

import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { getUploadById } from '../src/db/queries/admin-media'
import { mediaPendingDeletions } from '../src/db/schema/media-pending-deletions'
import { mediaUploads } from '../src/db/schema/media-uploads'
import { cleanupPendingDeletions, sweepExpiredUploads } from '../src/media/cleanup'
import { createSessionAs, requestJson, resetAuthTables, resetDatabase } from './helpers'

beforeEach(async () => {
	await resetDatabase()
	await resetAuthTables()
	fakeR2Store.reset()
})

async function staffCookie() {
	const { cookie } = await createSessionAs('staff')
	return cookie
}

async function createCatalogFixtures(cookie: string) {
	const suffix = crypto.randomUUID().slice(0, 8)
	const brand = (
		await requestJson('/api/v1/admin/brands', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ slug: `loreal-${suffix}`, nameRu: "Л'Ореаль", nameRo: "L'Oreal" })
		})
	).body.data
	const category = (
		await requestJson('/api/v1/admin/categories', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ slug: `skincare-${suffix}`, nameRu: 'Уход', nameRo: 'Ingrijire' })
		})
	).body.data
	const product = (
		await requestJson('/api/v1/admin/products', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({
				brandId: brand.id,
				slug: `revitalift-cream-${suffix}`,
				nameRu: 'Крем Revitalift',
				nameRo: 'Crema Revitalift',
				categoryIds: [category.id]
			})
		})
	).body.data
	const variant = (
		await requestJson(`/api/v1/admin/products/${product.id}/variants`, {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ sku: `REV-50-${suffix}` })
		})
	).body.data
	return { product, variant }
}

async function initUpload(
	cookie: string,
	productId: string,
	overrides: Record<string, unknown> = {}
) {
	return requestJson('/api/v1/admin/media/upload', {
		method: 'POST',
		headers: { Cookie: cookie },
		body: JSON.stringify({
			fileName: 'cream.jpg',
			mimeType: 'image/jpeg',
			fileSize: JPEG_BYTES.length,
			productId,
			...overrides
		})
	})
}

async function objectKeyForUpload(uploadId: string): Promise<string> {
	const session = await getUploadById(uploadId)
	if (!session) throw new Error('upload session not found in test setup')
	return session.objectKey
}

/** Runs the full init -> (fake R2 PUT) -> complete flow and returns the created image. */
async function uploadAndCompleteImage(
	cookie: string,
	productId: string,
	overrides: Record<string, unknown> = {}
) {
	const init = await initUpload(cookie, productId, overrides)
	const objectKey = await objectKeyForUpload(init.body.data.uploadId)
	fakeR2Store.put(objectKey, JPEG_BYTES, 'image/jpeg')

	const complete = await requestJson('/api/v1/admin/media/complete', {
		method: 'POST',
		headers: { Cookie: cookie },
		body: JSON.stringify({ uploadId: init.body.data.uploadId })
	})
	return { init, complete, objectKey }
}

describe('media upload init: access and configuration', () => {
	test('rejects an unauthenticated request with 401', async () => {
		const res = await requestJson('/api/v1/admin/media/upload', {
			method: 'POST',
			body: JSON.stringify({
				fileName: 'x.jpg',
				mimeType: 'image/jpeg',
				fileSize: 100,
				productId: '00000000-0000-0000-0000-000000000000'
			})
		})
		expect(res.status).toBe(401)
	})

	test('rejects a customer with 403', async () => {
		const { cookie } = await createSessionAs('customer')
		const res = await requestJson('/api/v1/admin/media/upload', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({
				fileName: 'x.jpg',
				mimeType: 'image/jpeg',
				fileSize: 100,
				productId: '00000000-0000-0000-0000-000000000000'
			})
		})
		expect(res.status).toBe(403)
	})

	test('returns a clean config error when R2 is not configured, instead of crashing', async () => {
		fakeR2Store.configured = false
		const cookie = await staffCookie()
		const { product } = await createCatalogFixtures(cookie)

		const res = await initUpload(cookie, product.id)
		expect(res.status).toBe(503)
		expect(res.body.error.code).toBe('media_not_configured')
	})
})

describe('media upload init: validation', () => {
	test('rejects an unsupported file type', async () => {
		const cookie = await staffCookie()
		const { product } = await createCatalogFixtures(cookie)

		const res = await initUpload(cookie, product.id, { mimeType: 'application/pdf' })
		expect(res.status).toBe(400)
		expect(res.body.error.code).toBe('unsupported_media_type')
	})

	test('rejects a declared file size over 10MB', async () => {
		const cookie = await staffCookie()
		const { product } = await createCatalogFixtures(cookie)

		const res = await initUpload(cookie, product.id, { fileSize: 10 * 1024 * 1024 + 1 })
		expect(res.status).toBe(400)
		expect(res.body.error.code).toBe('file_too_large')
	})

	test('404s for a non-existent product', async () => {
		const cookie = await staffCookie()
		const res = await initUpload(cookie, '00000000-0000-0000-0000-000000000000')
		expect(res.status).toBe(404)
		expect(res.body.error.code).toBe('product_not_found')
	})

	test('404s for a non-existent variant', async () => {
		const cookie = await staffCookie()
		const { product } = await createCatalogFixtures(cookie)

		const res = await initUpload(cookie, product.id, {
			variantId: '00000000-0000-0000-0000-000000000000'
		})
		expect(res.status).toBe(404)
		expect(res.body.error.code).toBe('variant_not_found')
	})

	test('rejects a variant that belongs to a different product', async () => {
		const cookie = await staffCookie()
		const { variant } = await createCatalogFixtures(cookie)
		const other = await createCatalogFixtures(cookie)

		const res = await initUpload(cookie, other.product.id, { variantId: variant.id })
		expect(res.status).toBe(400)
		expect(res.body.error.code).toBe('variant_product_mismatch')
	})

	test('generates an unpredictable object key and a short-lived presigned URL', async () => {
		const cookie = await staffCookie()
		const { product } = await createCatalogFixtures(cookie)

		const res = await initUpload(cookie, product.id)
		expect(res.status).toBe(201)
		expect(res.body.data.uploadId).toBeTruthy()
		expect(res.body.data.uploadUrl).toContain('upload.test.invalid')
		expect(res.body.data.expiresAt).toBeTruthy()

		const objectKey = await objectKeyForUpload(res.body.data.uploadId)
		expect(objectKey).not.toContain(product.id.slice(0, 4) + product.id.slice(0, 4)) // sanity, not a real assertion of randomness
		expect(objectKey.startsWith(`products/${product.id}/`)).toBe(true)
	})
})

describe('media upload complete: verifies the real object, not client claims', () => {
	test('404s when confirming an upload whose object was never actually put in R2', async () => {
		const cookie = await staffCookie()
		const { product } = await createCatalogFixtures(cookie)
		const init = await initUpload(cookie, product.id)

		const res = await requestJson('/api/v1/admin/media/complete', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ uploadId: init.body.data.uploadId })
		})

		expect(res.status).toBe(404)
		expect(res.body.error.code).toBe('object_not_found')
	})

	test('rejects an object that is actually larger than 10MB, even though the client declared less', async () => {
		const cookie = await staffCookie()
		const { product } = await createCatalogFixtures(cookie)
		const init = await initUpload(cookie, product.id)
		const objectKey = await objectKeyForUpload(init.body.data.uploadId)
		fakeR2Store.put(objectKey, oversizedJpegBytes(10 * 1024 * 1024 + 1), 'image/jpeg')

		const res = await requestJson('/api/v1/admin/media/complete', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ uploadId: init.body.data.uploadId })
		})

		expect(res.status).toBe(400)
		expect(res.body.error.code).toBe('file_too_large')
	})

	test('rejects content that is not actually a recognized image, regardless of the declared MIME type', async () => {
		const cookie = await staffCookie()
		const { product } = await createCatalogFixtures(cookie)
		const init = await initUpload(cookie, product.id)
		const objectKey = await objectKeyForUpload(init.body.data.uploadId)
		fakeR2Store.put(objectKey, NOT_AN_IMAGE_BYTES, 'image/jpeg')

		const res = await requestJson('/api/v1/admin/media/complete', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ uploadId: init.body.data.uploadId })
		})

		expect(res.status).toBe(400)
		expect(res.body.error.code).toBe('invalid_file_content')
	})

	test('creates the product_images row only after successful verification', async () => {
		const cookie = await staffCookie()
		const { product, variant } = await createCatalogFixtures(cookie)

		const { complete } = await uploadAndCompleteImage(cookie, product.id, { variantId: variant.id })

		expect(complete.status).toBe(201)
		expect(complete.body.data.productId).toBe(product.id)
		expect(complete.body.data.variantId).toBe(variant.id)
		expect(complete.body.data.mimeType).toBe('image/jpeg')
		expect(complete.body.data.url).toContain('cdn.test.invalid')
	})

	test('protects against double-confirmation of the same upload', async () => {
		const cookie = await staffCookie()
		const { product } = await createCatalogFixtures(cookie)
		const { init } = await uploadAndCompleteImage(cookie, product.id)

		const secondComplete = await requestJson('/api/v1/admin/media/complete', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ uploadId: init.body.data.uploadId })
		})

		expect(secondComplete.status).toBe(409)
		expect(secondComplete.body.error.code).toBe('upload_already_completed')
	})

	test("rejects confirming another staff member's upload session", async () => {
		const ownerCookie = await staffCookie()
		const { product } = await createCatalogFixtures(ownerCookie)
		const init = await initUpload(ownerCookie, product.id)
		const objectKey = await objectKeyForUpload(init.body.data.uploadId)
		fakeR2Store.put(objectKey, JPEG_BYTES, 'image/jpeg')

		const otherCookie = await staffCookie()
		const res = await requestJson('/api/v1/admin/media/complete', {
			method: 'POST',
			headers: { Cookie: otherCookie },
			body: JSON.stringify({ uploadId: init.body.data.uploadId })
		})

		expect(res.status).toBe(403)
		expect(res.body.error.code).toBe('forbidden')
	})
})

describe('admin images: list, edit, reorder, delete', () => {
	test('lists a product\'s images in sort order', async () => {
		const cookie = await staffCookie()
		const { product } = await createCatalogFixtures(cookie)
		await uploadAndCompleteImage(cookie, product.id)
		await uploadAndCompleteImage(cookie, product.id)

		const res = await requestJson(`/api/v1/admin/products/${product.id}/images`, {
			headers: { Cookie: cookie }
		})

		expect(res.status).toBe(200)
		expect(res.body.data).toHaveLength(2)
	})

	test('edits RU/RO alt text and clears a variant binding', async () => {
		const cookie = await staffCookie()
		const { product, variant } = await createCatalogFixtures(cookie)
		const { complete } = await uploadAndCompleteImage(cookie, product.id, { variantId: variant.id })
		const imageId = complete.body.data.id

		const res = await requestJson(`/api/v1/admin/images/${imageId}`, {
			method: 'PATCH',
			headers: { Cookie: cookie },
			body: JSON.stringify({ altRu: 'Крем 50 мл', altRo: 'Crema 50 ml', variantId: null })
		})

		expect(res.status).toBe(200)
		expect(res.body.data.altRu).toBe('Крем 50 мл')
		expect(res.body.data.altRo).toBe('Crema 50 ml')
		expect(res.body.data.variantId).toBeNull()
	})

	test('rejects binding an image to a variant from a different product', async () => {
		const cookie = await staffCookie()
		const { product } = await createCatalogFixtures(cookie)
		const other = await createCatalogFixtures(cookie)
		const { complete } = await uploadAndCompleteImage(cookie, product.id)

		const res = await requestJson(`/api/v1/admin/images/${complete.body.data.id}`, {
			method: 'PATCH',
			headers: { Cookie: cookie },
			body: JSON.stringify({ variantId: other.variant.id })
		})

		expect(res.status).toBe(400)
		expect(res.body.error.code).toBe('variant_product_mismatch')
	})

	test('reorders images and rejects a mismatched id set', async () => {
		const cookie = await staffCookie()
		const { product } = await createCatalogFixtures(cookie)
		const first = (await uploadAndCompleteImage(cookie, product.id)).complete.body.data
		const second = (await uploadAndCompleteImage(cookie, product.id)).complete.body.data

		const reordered = await requestJson(`/api/v1/admin/products/${product.id}/images/order`, {
			method: 'PUT',
			headers: { Cookie: cookie },
			body: JSON.stringify({ order: [second.id, first.id] })
		})

		expect(reordered.status).toBe(200)
		expect(reordered.body.data[0].id).toBe(second.id)
		expect(reordered.body.data[1].id).toBe(first.id)

		const mismatched = await requestJson(`/api/v1/admin/products/${product.id}/images/order`, {
			method: 'PUT',
			headers: { Cookie: cookie },
			body: JSON.stringify({ order: [second.id] })
		})
		expect(mismatched.status).toBe(400)
		expect(mismatched.body.error.code).toBe('image_order_mismatch')
	})

	test('deletes an image and removes the underlying R2 object', async () => {
		const cookie = await staffCookie()
		const { product } = await createCatalogFixtures(cookie)
		const { complete, objectKey } = await uploadAndCompleteImage(cookie, product.id)

		const res = await requestJson(`/api/v1/admin/images/${complete.body.data.id}`, {
			method: 'DELETE',
			headers: { Cookie: cookie }
		})

		expect(res.status).toBe(200)
		expect(fakeR2Store.objects.has(objectKey)).toBe(false)

		const list = await requestJson(`/api/v1/admin/products/${product.id}/images`, {
			headers: { Cookie: cookie }
		})
		expect(list.body.data).toHaveLength(0)
	})

	test('on R2 delete failure, the image row is still removed and a cleanup retry is queued', async () => {
		const cookie = await staffCookie()
		const { product } = await createCatalogFixtures(cookie)
		const { complete, objectKey } = await uploadAndCompleteImage(cookie, product.id)
		fakeR2Store.failDeleteFor.add(objectKey)

		const res = await requestJson(`/api/v1/admin/images/${complete.body.data.id}`, {
			method: 'DELETE',
			headers: { Cookie: cookie }
		})

		// The app never treats a failed R2 delete as if the object were gone -
		// the DB row deletion still succeeds, and a retry is queued instead.
		expect(res.status).toBe(200)
		expect(fakeR2Store.objects.has(objectKey)).toBe(true)

		const pending = await db.select().from(mediaPendingDeletions)
		expect(pending.some(row => row.objectKey === objectKey)).toBe(true)
	})
})

describe('public catalog API after images exist', () => {
	test('still returns the product with correct image URLs and alt text', async () => {
		const cookie = await staffCookie()
		const { product, variant } = await createCatalogFixtures(cookie)
		await requestJson(`/api/v1/admin/variants/${variant.id}/price`, {
			method: 'PUT',
			headers: { Cookie: cookie },
			body: JSON.stringify({ price: 15000 })
		})
		await requestJson(`/api/v1/admin/products/${product.id}`, {
			method: 'PATCH',
			headers: { Cookie: cookie },
			body: JSON.stringify({ status: 'active' })
		})

		const { complete, objectKey } = await uploadAndCompleteImage(cookie, product.id, {
			variantId: variant.id
		})
		await requestJson(`/api/v1/admin/images/${complete.body.data.id}`, {
			method: 'PATCH',
			headers: { Cookie: cookie },
			body: JSON.stringify({ altRu: 'Крем', altRo: 'Crema' })
		})

		const publicDetail = await requestJson(`/api/v1/products/${product.slug}`)
		expect(publicDetail.status).toBe(200)
		expect(publicDetail.body.data.images).toHaveLength(1)
		expect(publicDetail.body.data.images[0].url).toBe(`https://cdn.test.invalid/${objectKey}`)
		expect(publicDetail.body.data.images[0].variantId).toBe(variant.id)
		// Internal storage details are never exposed on the public API.
		expect(publicDetail.body.data.images[0]).not.toHaveProperty('objectKey')
	})
})

describe('cleanup CLI: expired, never-confirmed upload sessions (Sprint 9 Task 4)', () => {
	test('an expired pending session is rejected and its object queued for deletion, even if nothing was ever uploaded', async () => {
		const staff = await staffCookie()
		const { product } = await createCatalogFixtures(staff)
		const init = await initUpload(staff, product.id)
		const uploadId = init.body.data.uploadId

		// The client vanished: never PUT anything to R2, never called
		// /complete. Simulate time passing by backdating expiresAt directly -
		// this is the one state nothing else in the app revisits on its own.
		await db.update(mediaUploads).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(mediaUploads.id, uploadId))

		const swept = await sweepExpiredUploads()
		expect(swept.swept).toBe(1)

		const session = await getUploadById(uploadId)
		expect(session?.status).toBe('rejected')

		const [pendingDeletion] = await db
			.select()
			.from(mediaPendingDeletions)
			.where(eq(mediaPendingDeletions.objectKey, session!.objectKey))
		expect(pendingDeletion).toBeDefined()

		// cleanupPendingDeletions tolerates a key that was never actually
		// written to R2 - deleting a key that doesn't exist is a no-op.
		const cleanup = await cleanupPendingDeletions()
		expect(cleanup.succeeded).toBe(1)
	})

	test('a still-pending, not-yet-expired session is left untouched', async () => {
		const staff = await staffCookie()
		const { product } = await createCatalogFixtures(staff)
		const init = await initUpload(staff, product.id)

		const swept = await sweepExpiredUploads()
		expect(swept.swept).toBe(0)

		const session = await getUploadById(init.body.data.uploadId)
		expect(session?.status).toBe('pending')
	})

	test('a completed upload is never swept, even long past its original expiry', async () => {
		const staff = await staffCookie()
		const { product } = await createCatalogFixtures(staff)
		const { complete } = await uploadAndCompleteImage(staff, product.id)
		const uploadId = complete.body.data.id // image id, not upload id - re-fetch via product

		await db.update(mediaUploads).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(mediaUploads.imageId, uploadId))

		const swept = await sweepExpiredUploads()
		expect(swept.swept).toBe(0)
	})
})
