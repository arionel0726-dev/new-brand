import { randomBytes } from 'node:crypto'

// Excludes visually ambiguous characters (0/O, 1/I) so a support agent can
// read a number back over the phone without transcription errors.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * A random, non-sequential public order reference - never derived from
 * row count or any other predictable counter. Collisions are
 * astronomically unlikely (33^10 space) but the caller still retries the
 * insert on the off chance of one - see createOrderFromCart.
 */
export function generateOrderNumber(): string {
	const bytes = randomBytes(10)
	let code = ''
	for (const byte of bytes) {
		code += ALPHABET[byte % ALPHABET.length]
	}
	return `ORD-${code}`
}
