import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { notFound } from 'next/navigation'
import './globals.css'
import { cn } from '@/lib/utils'
import { isLocale, locales, localeToBcp47 } from '@/i18n/config'
import { getDictionary } from '@/i18n/get-dictionary'
import { Header } from '@/components/layout/header'
import { Footer } from '@/components/layout/footer'

const geistSans = Geist({
	variable: '--font-geist-sans',
	subsets: ['latin', 'cyrillic']
})

const geistMono = Geist_Mono({
	variable: '--font-geist-mono',
	subsets: ['latin']
})

export function generateStaticParams() {
	return locales.map(locale => ({ locale }))
}

export async function generateMetadata({ params }: LayoutProps<'/[locale]'>): Promise<Metadata> {
	const { locale } = await params
	if (!isLocale(locale)) return {}
	const dict = await getDictionary(locale)

	return {
		title: { default: dict.brand.name, template: `%s · ${dict.brand.name}` },
		description: dict.home.heroCta,
		alternates: {
			languages: Object.fromEntries(locales.map(l => [l, `/${l}`]))
		}
	}
}

export default async function LocaleLayout({ children, params }: LayoutProps<'/[locale]'>) {
	const { locale } = await params
	if (!isLocale(locale)) notFound()

	const dict = await getDictionary(locale)

	return (
		<html lang={localeToBcp47[locale]} className={cn('h-full antialiased', geistSans.variable, geistMono.variable, 'font-sans')}>
			<body className="flex min-h-full flex-col bg-white pb-[calc(76px+env(safe-area-inset-bottom))] text-ink md:pb-0">
				<a
					href="#main-content"
					className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:text-white"
				>
					{dict.a11y.skipToContent}
				</a>
				<Header locale={locale} dict={dict} />
				<main id="main-content" className="flex-1">
					{children}
				</main>
				<Footer locale={locale} dict={dict} />
			</body>
		</html>
	)
}
