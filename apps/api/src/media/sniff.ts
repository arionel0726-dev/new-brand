/**
 * Shared media constraints and real-content detection. The MIME type a
 * client declares in a request header is just a claim; `sniffImageMimeType`
 * is what actually decides what a file is, by looking at its first bytes -
 * this is what /complete uses instead of trusting Content-Type alone.
 */

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number]

export function isAllowedMimeType(value: string): value is AllowedMimeType {
	return (ALLOWED_MIME_TYPES as readonly string[]).includes(value)
}

const EXTENSION_BY_MIME_TYPE: Record<AllowedMimeType, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif'
}

export function extensionForMimeType(mimeType: AllowedMimeType): string {
	return EXTENSION_BY_MIME_TYPE[mimeType]
}

function bytesStartWith(bytes: Uint8Array, prefix: number[], offset = 0): boolean {
	if (bytes.length < offset + prefix.length) return false
	return prefix.every((value, index) => bytes[offset + index] === value)
}

function matchesAscii(bytes: Uint8Array, text: string, offset = 0): boolean {
	return bytesStartWith(
		bytes,
		Array.from(text, char => char.charCodeAt(0)),
		offset
	)
}

/**
 * Detects the real format of a file from its first bytes (magic numbers),
 * independent of whatever Content-Type the client or the storage object's
 * metadata claims. Returns null when the bytes don't match any supported
 * image format - the caller treats that as "not an allowed file", full stop.
 */
export function sniffImageMimeType(bytes: Uint8Array): AllowedMimeType | null {
	if (bytesStartWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
	if (bytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
	if (matchesAscii(bytes, 'GIF87a') || matchesAscii(bytes, 'GIF89a')) return 'image/gif'
	if (matchesAscii(bytes, 'RIFF') && matchesAscii(bytes, 'WEBP', 8)) return 'image/webp'
	return null
}
