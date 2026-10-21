import { UserCircle } from 'lucide-react'
import { notFound } from 'next/navigation'
import { MobileStatePage } from '@/components/navigation/mobile-state-page'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/get-dictionary'

export default async function AccountPage({ params }: PageProps<'/[locale]/account'>) {
	const { locale } = await params
	if (!isLocale(locale)) notFound()

	const dict = await getDictionary(locale)
	return (
		<MobileStatePage
			title={dict.accountPage.title}
			emptyTitle={dict.accountPage.emptyTitle}
			text={dict.accountPage.emptyText}
			cta={dict.accountPage.cta}
			ctaHref={`/${locale}/catalog`}
			icon={UserCircle}
		/>
	)
}
