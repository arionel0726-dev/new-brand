import { z } from 'zod'
import { normalizeBarcode } from '../barcode'
import { parseMajorUnitToBani } from '../money'

/**
 * A source external id, accepted as either a JSON number or a JSON string
 * (Task 5: "numeric or string external IDs only when explicitly safe") -
 * normalized to a trimmed string. Rejects anything that isn't an obviously
 * safe whole-number-shaped value: no fractional part, no scientific
 * notation, no sign - an id is never a quantity, so none of those are
 * legitimate here. A float-looking id (e.g. a spreadsheet tool having
 * coerced "10568" to 10568.0 somewhere upstream) is rejected rather than
 * silently truncated, since silently truncating an identifier is far more
 * dangerous than refusing it.
 */
export const externalIdSchema = z
	.union([z.string(), z.number()])
	.transform((value, ctx) => {
		const text = typeof value === 'number' ? String(value) : value.trim()
		if (text.length === 0) {
			ctx.addIssue({ code: 'custom', message: 'external id is empty' })
			return z.NEVER
		}
		if (!/^\d+$/.test(text)) {
			ctx.addIssue({ code: 'custom', message: `external id "${text}" is not a plain whole-number identifier` })
			return z.NEVER
		}
		return text
	})

/** A price field in major-unit MDL (as the source supplies it), parsed decimal-safe into integer bani. Rejects negative/malformed/overly-precise values; accepts zero (Task 5). */
export const priceBaniSchema = z
	.union([z.string(), z.number()])
	.nullish()
	.transform((value, ctx) => {
		if (value === null || value === undefined) return null
		const result = parseMajorUnitToBani(value)
		if (!result.ok) {
			ctx.addIssue({ code: 'custom', message: result.reason })
			return z.NEVER
		}
		return result.bani
	})

/** A required (non-nullable) counterpart of priceBaniSchema, for a feed where the price field itself is mandatory even if its value can be zero. */
export const requiredPriceBaniSchema = z
	.union([z.string(), z.number()])
	.transform((value, ctx) => {
		const result = parseMajorUnitToBani(value)
		if (!result.ok) {
			ctx.addIssue({ code: 'custom', message: result.reason })
			return z.NEVER
		}
		return result.bani
	})

/** Barcode - trimmed text only, leading zeros preserved (src/import/barcode.ts). */
export const barcodeSchema = z
	.union([z.string(), z.number()])
	.nullish()
	.transform(value => normalizeBarcode(value ?? null))

/** A blank-or-whitespace-only string is treated the same as "not supplied" - never coerced into a real value, never used as a reason to fabricate content (Task 6/7). */
export const optionalTextSchema = z
	.string()
	.nullish()
	.transform(value => {
		if (value === null || value === undefined) return null
		const trimmed = value.trim()
		return trimmed.length > 0 ? trimmed : null
	})

export type FeedRecordIssue = { recordIndex: number; recordIdentifier: string; message: string }

export type FeedParseResult<T> = {
	validRecords: T[]
	rejected: FeedRecordIssue[]
	/** Records sharing the same id_nom (or other declared key) within this one feed payload - Task 5's "duplicate records within one feed". Both occurrences are reported; neither is silently dropped by the parser itself (the normalization layer decides what to do with duplicates). */
	duplicateKeys: { key: string; recordIndexes: number[] }[]
}

/**
 * Parses every record in a feed payload independently (one record's
 * failure never aborts the rest - Task 4's "an invalid record must not
 * silently become a valid published product" cuts the other way too: a
 * valid record must not be discarded just because a sibling record in the
 * same file is malformed). `keyOf` extracts the field this feed considers
 * its natural per-record key, purely for duplicate detection and for
 * giving a rejected record a human-readable identifier in diagnostics -
 * never used by this function to decide validity.
 */
export function parseFeedRecords<Raw, T>(
	rawRecords: unknown[],
	schema: z.ZodType<T, Raw>,
	keyOf: (raw: unknown, parsed: T | undefined) => string
): FeedParseResult<T> {
	const validRecords: T[] = []
	const rejected: FeedRecordIssue[] = []
	const seenKeys = new Map<string, number[]>()

	rawRecords.forEach((raw, recordIndex) => {
		const result = schema.safeParse(raw)
		if (!result.success) {
			const recordIdentifier = keyOf(raw, undefined) || `#${recordIndex}`
			rejected.push({
				recordIndex,
				recordIdentifier,
				message: result.error.issues.map(issue => issue.message).join('; ')
			})
			return
		}
		validRecords.push(result.data)
		const key = keyOf(raw, result.data)
		if (key) {
			const indexes = seenKeys.get(key) ?? []
			indexes.push(recordIndex)
			seenKeys.set(key, indexes)
		}
	})

	const duplicateKeys = [...seenKeys.entries()]
		.filter(([, indexes]) => indexes.length > 1)
		.map(([key, recordIndexes]) => ({ key, recordIndexes }))

	return { validRecords, rejected, duplicateKeys }
}
