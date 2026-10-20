/**
 * In-memory stand-in for the one real object store R2 would hold, used by
 * admin-media.test.ts via `mock.module('../src/media/r2', ...)`. Nothing
 * here talks to Cloudflare or any S3-compatible service - `bun test` never
 * needs real R2 for this to work.
 */

export type FakeObject = { bytes: Uint8Array; contentType: string }

class FakeR2Store {
	configured = true
	objects = new Map<string, FakeObject>()
	failDeleteFor = new Set<string>()

	reset() {
		this.configured = true
		this.objects.clear()
		this.failDeleteFor.clear()
	}

	/** Simulates the client's presigned-PUT upload actually landing in R2. */
	put(objectKey: string, bytes: Uint8Array, contentType = 'application/octet-stream') {
		this.objects.set(objectKey, { bytes, contentType })
	}
}

export const fakeR2Store = new FakeR2Store()

export const JPEG_BYTES = new Uint8Array([
	0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
	0x00, 0x01, 0x00, 0x00, 0xff, 0xd9
])

export const PNG_BYTES = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
])

export const NOT_AN_IMAGE_BYTES = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07])

export function oversizedJpegBytes(sizeInBytes: number): Uint8Array {
	const bytes = new Uint8Array(sizeInBytes)
	bytes.set(JPEG_BYTES.subarray(0, 3), 0)
	return bytes
}
