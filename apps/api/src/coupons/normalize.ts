/** Every coupon code is stored and looked up in exactly this form - "save10", " Save10 ", and "SAVE10" are all the same coupon. */
export function normalizeCouponCode(raw: string): string {
	return raw.trim().toUpperCase().replace(/\s+/g, '')
}
