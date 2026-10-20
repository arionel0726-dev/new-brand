export const locales = ['ru', 'ro'] as const

export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = 'ru'

export function isLocale(value: string): value is Locale {
	return (locales as readonly string[]).includes(value)
}

// BCP-47 tags for <html lang> and Intl formatters - distinct from the route
// segment, which stays the short `ru`/`ro` code.
export const localeToBcp47: Record<Locale, string> = {
	ru: 'ru-MD',
	ro: 'ro-MD'
}
