/**
 * Normalizes a Moldovan phone number to a single canonical form
 * (+373XXXXXXXX) without requiring SMS verification (explicitly out of
 * scope this sprint). Returns null for anything that doesn't resemble a
 * Moldovan number, which the caller turns into a 400.
 */
export function normalizeMoldovanPhone(raw: string): string | null {
	const trimmed = raw.trim()
	const hasPlus = trimmed.startsWith('+')
	const digits = trimmed.replace(/[^0-9]/g, '')

	let national: string | null = null
	if (hasPlus && digits.startsWith('373') && digits.length === 11) {
		national = digits.slice(3)
	} else if (!hasPlus && digits.startsWith('373') && digits.length === 11) {
		national = digits.slice(3)
	} else if (digits.startsWith('0') && digits.length === 9) {
		national = digits.slice(1)
	} else if (digits.length === 8) {
		national = digits
	}

	if (!national || !/^[0-9]{8}$/.test(national)) return null
	return `+373${national}`
}
