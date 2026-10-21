import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/get-dictionary'
import { MobileCategoryMenu } from '@/components/categories/mobile-category-menu'

export default async function CategoriesPage({ params }: PageProps<'/[locale]/categories'>) {
	const { locale } = await params
	if (!isLocale(locale)) notFound()

	const dict = await getDictionary(locale)

	return (
		<div className="min-h-[calc(100svh-8rem)]" aria-labelledby="categories-title">
			<h1 id="categories-title" className="sr-only">
				{dict.mobileCategories.title}
			</h1>
			<MobileCategoryMenu locale={locale} dict={dict} />
		</div>
	)
}
