import Link from 'next/link'
import { Suspense } from 'react'
import { Menu, Search, ShoppingBag, Heart } from 'lucide-react'
import type { Dictionary } from '@/i18n/get-dictionary'
import type { Locale } from '@/i18n/config'
import { translate } from '@/i18n/get-dictionary'
import { NavDrawer } from './nav-drawer'
import { MobileBottomNav, MobileBottomNavFallback } from './mobile-bottom-nav'
import { freeDeliveryThresholdBani } from '@/data/mock/home'
import { formatMoney } from '@/lib/catalog/money'

type HeaderProps = {
	locale: Locale
	dict: Dictionary
}

const navLinks = (locale: Locale, dict: Dictionary) => [
	{ href: `/${locale}/catalog`, label: dict.nav.catalog },
	{ href: `/${locale}/brands`, label: dict.nav.brands },
	{ href: `/${locale}/catalog?discount=1`, label: dict.nav.discounts },
	{ href: `/${locale}/stores`, label: dict.nav.stores }
]

/**
 * Compact mobile-first header (addendum priority #3) with a simple desktop
 * row below md. No forced hamburger on desktop - desktop gets a plain
 * inline nav instead, per the spec's "structured catalog nav, no forced
 * burger menu" requirement; mobile keeps the drawer since it's the
 * priority surface this sprint.
 */

export function Header({ locale, dict }: HeaderProps) {
	return (
		<>
			<header className="sticky top-0 z-30 border-b border-border bg-white">
				<div className="hidden items-center justify-center bg-ink px-4 py-2 text-center text-xs text-white md:flex">
					{translate(dict, 'announcement.freeDelivery', { amount: formatMoney(freeDeliveryThresholdBani, locale) })}
				</div>

				<div className="flex h-14 items-center gap-2 px-4 sm:h-16 sm:px-6">
					<NavDrawer locale={locale} dict={dict} triggerLabel={dict.nav.menu} triggerClassName="-ml-2 flex size-10 items-center justify-center text-ink md:hidden">
						<Menu className="size-5" aria-hidden />
					</NavDrawer>

					<Link href={`/${locale}`} className="mr-auto text-[17px] font-medium tracking-tight text-ink sm:mr-0">
						{dict.brand.name}
					</Link>

					<nav aria-label={dict.nav.catalog} className="hidden flex-1 items-center justify-center gap-7 md:flex">
						{navLinks(locale, dict).map(item => (
							<Link key={item.href} href={item.href} className="text-sm text-ink transition-colors hover:text-brand-accent">
								{item.label}
							</Link>
						))}
					</nav>

					<div className="hidden items-center gap-1 sm:gap-2 md:flex">
						<Link
							href={`/${locale}/search`}
							aria-label={dict.nav.search}
							className="flex size-10 items-center justify-center text-ink"
						>
							<Search className="size-5" aria-hidden />
						</Link>
						<Link
							href={`/${locale}/wishlist`}
							aria-label={dict.nav.wishlist}
							className="hidden size-10 items-center justify-center text-ink sm:flex"
						>
							<Heart className="size-5" aria-hidden />
						</Link>
						<Link
							href={`/${locale}/cart`}
							aria-label={dict.nav.cart}
							className="-mr-2 flex size-10 items-center justify-center text-ink"
						>
							<ShoppingBag className="size-5" aria-hidden />
						</Link>
					</div>
				</div>
			</header>
			<Suspense fallback={<MobileBottomNavFallback locale={locale} dict={dict} />}>
				<MobileBottomNav locale={locale} dict={dict} />
			</Suspense>
		</>
	)
}
