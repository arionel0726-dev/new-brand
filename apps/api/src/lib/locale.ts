import { z } from 'zod'

export const localeSchema = z.enum(['ru', 'ro'])
export type Locale = z.infer<typeof localeSchema>
export const DEFAULT_LOCALE: Locale = 'ru'

export function localize(locale: Locale, ru: string, ro: string): string
export function localize(locale: Locale, ru: string | null, ro: string | null): string | null
export function localize(locale: Locale, ru: string | null, ro: string | null): string | null {
	return locale === 'ro' ? (ro ?? ru) : (ru ?? ro)
}
