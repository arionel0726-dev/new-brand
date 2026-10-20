/**
 * Decimal-safe MDL (major unit, leu) -> integer bani conversion
 * (Sprint 10A Task 5). Deliberately never does `value * 100` on a JS
 * number - a plain float like 19.99 is not exactly representable in IEEE
 * 754 binary, and `19.99 * 100` can land on 1998.9999999999998 rather
 * than 1999, which `Math.round` happens to paper over for *this specific*
 * case but is not a rule you can trust for arbitrary inputs. Instead this
 * parses the decimal digits directly as text and does integer arithmetic
 * only, matching this project's existing "all monetary calculations use
 * integers" rule (Sprint 6+) one step earlier, at the import boundary.
 */
export type MoneyParseResult = { ok: true; bani: number } | { ok: false; reason: string }

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/

export function parseMajorUnitToBani(raw: string | number | null | undefined): MoneyParseResult {
	if (raw === null || raw === undefined) {
		return { ok: false, reason: 'missing price value' }
	}

	// A JS number input is converted via String(), not toFixed/multiplication -
	// for any value that actually came from JSON-parsed decimal literal text
	// (the only way a price legitimately arrives as a `number` here), this
	// reproduces the original digits exactly; it is never used as an excuse
	// to do float math afterwards.
	const text = typeof raw === 'number' ? String(raw) : raw.trim()

	if (text.length === 0) {
		return { ok: false, reason: 'empty price value' }
	}
	if (!DECIMAL_PATTERN.test(text)) {
		return { ok: false, reason: `price "${text}" is not a plain decimal number` }
	}

	const negative = text.startsWith('-')
	const unsigned = negative ? text.slice(1) : text
	const [wholePart, fractionPart = ''] = unsigned.split('.')

	if (negative) {
		return { ok: false, reason: 'price cannot be negative' }
	}
	// More than 2 fractional digits is ambiguous (round? truncate? reject?) -
	// this project does not guess; it is surfaced as an explicit invalid-price
	// issue (import_issue_code 'invalid_price') instead.
	if (fractionPart.length > 2) {
		return { ok: false, reason: `price "${text}" has more than 2 fractional digits` }
	}

	const paddedFraction = fractionPart.padEnd(2, '0')
	const wholeBani = BigInt(wholePart || '0') * 100n
	const fractionBani = BigInt(paddedFraction || '0')
	const totalBani = wholeBani + fractionBani

	if (totalBani > BigInt(Number.MAX_SAFE_INTEGER)) {
		return { ok: false, reason: `price "${text}" exceeds the safe integer range` }
	}

	// Zero is a valid, explicitly supported price (Task 5) - never rejected
	// here; whether a zero-priced record is publishable is a normalization/
	// policy decision made later, not a parsing one.
	return { ok: true, bani: Number(totalBani) }
}
