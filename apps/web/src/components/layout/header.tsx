import Link from 'next/link'
import { Suspense } from 'react'
import { Menu, Search, ShoppingBag, Heart, UserRound } from 'lucide-react'
import type { Dictionary } from '@/i18n/get-dictionary'
import type { Locale } from '@/i18n/config'
import { NavDrawer } from './nav-drawer'
import { BrandMark } from './brand-mark'
import { MobileBottomNav, MobileBottomNavFallback } from './mobile-bottom-nav'

type HeaderProps = {
	locale: Locale
	dict: Dictionary
}

export function Header({ locale, dict }: HeaderProps) {
	return (
		<>
			<header className="sticky top-0 z-30 bg-white">
				<div className="relative mx-auto flex h-[60px] max-w-[1920px] items-center justify-between px-3 sm:px-5">
					<NavDrawer locale={locale} dict={dict} triggerLabel={dict.nav.menu} triggerClassName="flex size-11 shrink-0 items-center justify-center text-[#070707]">
						<Menu className="size-6" strokeWidth={1.7} aria-hidden />
					</NavDrawer>

					<Link
						href={`/${locale}`}
						aria-label={dict.brand.name}
						className="absolute left-1/2 flex size-11 -translate-x-1/2 items-center justify-center text-[#070707]"
					>
						<BrandMark className="size-[26px]" />
					</Link>

					<nav aria-label={dict.nav.menu} className="ml-auto hidden items-center gap-1 md:flex">
						<Link
							href={`/${locale}/search`}
							aria-label={dict.nav.search}
							className="flex size-11 items-center justify-center text-[#070707]"
						>
							<Search className="size-[22px]" strokeWidth={1.7} aria-hidden />
						</Link>
						<Link
							href={`/${locale}/wishlist`}
							aria-label={dict.nav.wishlist}
							className="flex size-11 items-center justify-center text-[#070707]"
						>
							<Heart className="size-[22px]" strokeWidth={1.7} aria-hidden />
						</Link>
						<Link
							href={`/${locale}/account`}
							aria-label={dict.nav.account}
							className="flex size-11 items-center justify-center text-[#070707]"
						>
							<UserRound className="size-[22px]" strokeWidth={1.7} aria-hidden />
						</Link>
						<Link
							href={`/${locale}/cart`}
							aria-label={dict.nav.cart}
							className="flex size-11 items-center justify-center text-[#070707]"
						>
							<ShoppingBag className="size-[22px]" strokeWidth={1.7} aria-hidden />
						</Link>
					</nav>
				</div>
			</header>
			<Suspense fallback={<MobileBottomNavFallback locale={locale} dict={dict} />}>
				<MobileBottomNav locale={locale} dict={dict} />
			</Suspense>
		</>
	)
}
