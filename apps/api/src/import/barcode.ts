/**
 * Barcode normalization (Sprint 10A Task 5) - trims whitespace only.
 * Deliberately never parsed as a number anywhere in this pipeline: a
 * barcode like "0012345678905" has a leading zero that is part of its
 * identity (EAN-13 padding), and `Number("0012345678905")` or any
 * numeric round-trip would silently drop it. The only transformation
 * applied is whitespace trimming and treating an empty result as absent.
 */
export function normalizeBarcode(raw: string | number | null | undefined): string | null {
	if (raw === null || raw === undefined) return null
	const text = String(raw).trim()
	return text.length > 0 ? text : null
}
