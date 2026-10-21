import { Heart } from 'lucide-react'
import { notFound } from 'next/navigation'
import { MobileStatePage } from '@/components/navigation/mobile-state-page'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/get-dictionary'

export default async function WishlistPage({ params }: PageProps<'/[locale]/wishlist'>) {
	const { locale } = await params
	if (!isLocale(locale)) notFound()

	const dict = await getDictionary(locale)
	return (
		<MobileStatePage
			title={dict.wishlistPage.title}
			emptyTitle={dict.wishlistPage.emptyTitle}
			text={dict.wishlistPage.emptyText}
			cta={dict.wishlistPage.cta}
			ctaHref={`/${locale}/catalog`}
			icon={Heart}
		/>
	)
}
