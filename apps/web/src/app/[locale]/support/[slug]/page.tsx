import { notFound } from 'next/navigation'
import { InfoStatePage } from '@/components/navigation/info-state-page'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/get-dictionary'

export const instant = false

const supportSlugs = ['delivery', 'payment', 'returns', 'faq'] as const
type SupportSlug = (typeof supportSlugs)[number]

export default async function SupportPage({ params }: PageProps<'/[locale]/support/[slug]'>) {
	const { locale, slug } = await params
	if (!isLocale(locale) || !supportSlugs.includes(slug as SupportSlug)) notFound()

	const dict = await getDictionary(locale)
	const title = {
		delivery: dict.footer.delivery,
		payment: dict.footer.payment,
		returns: dict.footer.returns,
		faq: dict.supportPage.faq
	}[slug as SupportSlug]

	return (
		<InfoStatePage
			title={title}
			text={dict.supportPage.placeholder}
			backLabel={dict.product.backToCatalog}
			backHref={`/${locale}/catalog`}
		/>
	)
}
