import { ShoppingBag } from 'lucide-react'
import { notFound } from 'next/navigation'
import { MobileStatePage } from '@/components/navigation/mobile-state-page'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/get-dictionary'

export default async function CartPage({ params }: PageProps<'/[locale]/cart'>) {
	const { locale } = await params
	if (!isLocale(locale)) notFound()

	const dict = await getDictionary(locale)
	return (
		<MobileStatePage
			title={dict.cartPage.title}
			emptyTitle={dict.cartPage.emptyTitle}
			text={dict.cartPage.emptyText}
			cta={dict.cartPage.cta}
			ctaHref={`/${locale}/catalog`}
			icon={ShoppingBag}
		/>
	)
}
