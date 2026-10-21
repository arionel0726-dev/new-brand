import { notFound } from 'next/navigation'
import { InfoStatePage } from '@/components/navigation/info-state-page'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/get-dictionary'

export const instant = false

const legalSlugs = ['terms', 'privacy'] as const
type LegalSlug = (typeof legalSlugs)[number]

export default async function LegalPage({ params }: PageProps<'/[locale]/legal/[slug]'>) {
	const { locale, slug } = await params
	if (!isLocale(locale) || !legalSlugs.includes(slug as LegalSlug)) notFound()

	const dict = await getDictionary(locale)
	const title = slug === 'terms' ? dict.footer.terms : dict.footer.privacy

	return (
		<InfoStatePage
			title={title}
			text={dict.legalPage.placeholder}
			backLabel={dict.product.backToCatalog}
			backHref={`/${locale}/catalog`}
		/>
	)
}
