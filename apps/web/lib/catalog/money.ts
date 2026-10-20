import type { Locale } from '@/i18n/config'

const currencyByLocale: Record<Locale, string> = { ru: 'ru-MD', ro: 'ro-MD' }

/** Formats an integer bani amount as MDL currency, e.g. 17000 -> "170 MDL". */
export function formatMoney(bani: number, locale: Locale): string {
	const leu = bani / 100
	return new Intl.NumberFormat(currencyByLocale[locale], {
		style: 'currency',
		currency: 'MDL',
		maximumFractionDigits: leu % 1 === 0 ? 0 : 2
	}).format(leu)
}
