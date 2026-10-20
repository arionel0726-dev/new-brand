import type { Locale } from './config'

const dictionaries = {
	ru: () => import('./dictionaries/ru.json').then(m => m.default),
	ro: () => import('./dictionaries/ro.json').then(m => m.default)
}

export type Dictionary = Awaited<ReturnType<(typeof dictionaries)['ru']>>

export async function getDictionary(locale: Locale): Promise<Dictionary> {
	return dictionaries[locale]()
}

/** Resolves a dotted key path ("nav.catalog") against the dictionary, with {placeholder} interpolation. */
export function translate(dict: Dictionary, key: string, vars?: Record<string, string | number>): string {
	const value = key.split('.').reduce<unknown>((node, segment) => {
		if (node && typeof node === 'object' && segment in node) return (node as Record<string, unknown>)[segment]
		return undefined
	}, dict)

	if (typeof value !== 'string') return key

	if (!vars) return value
	return value.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match))
}
