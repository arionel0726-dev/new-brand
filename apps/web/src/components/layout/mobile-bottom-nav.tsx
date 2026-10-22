'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Heart, Search, ShoppingBag, UserCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Dictionary } from '@/i18n/get-dictionary'
import type { Locale } from '@/i18n/config'
import { cn } from '@/lib/utils'
import { BrandMark } from './brand-mark'

type MobileBottomNavProps = {
	locale: Locale
	dict: Dictionary
}

type NavItem = {
	key: 'search' | 'wishlist' | 'home' | 'account' | 'cart'
	href: string
	label: string
	icon?: LucideIcon
}

export function MobileBottomNav({ locale, dict }: MobileBottomNavProps) {
	const pathname = usePathname() ?? ''
	return <MobileBottomNavContent locale={locale} dict={dict} pathname={pathname} />
}

export function MobileBottomNavFallback({ locale, dict }: MobileBottomNavProps) {
	return <MobileBottomNavContent locale={locale} dict={dict} pathname="" />
}

function MobileBottomNavContent({ locale, dict, pathname }: MobileBottomNavProps & { pathname: string }) {
	const items: NavItem[] = [
		{ key: 'search', href: `/${locale}/search`, label: dict.nav.search, icon: Search },
		{ key: 'wishlist', href: `/${locale}/wishlist`, label: dict.nav.wishlist, icon: Heart },
		{ key: 'home', href: `/${locale}`, label: dict.brand.name },
		{ key: 'account', href: `/${locale}/account`, label: dict.nav.account, icon: UserCircle },
		{ key: 'cart', href: `/${locale}/cart`, label: dict.nav.cart, icon: ShoppingBag }
	]

	return (
		<nav aria-label={dict.nav.menu} className="fixed inset-x-0 bottom-0 z-50 border-t border-[#EFEFEF] bg-white px-2 pt-2 pb-[env(safe-area-inset-bottom)] md:hidden">
			<div className="mx-auto grid h-14 max-w-md grid-cols-5 items-center">
				{items.map(item => {
					const active = item.key === 'home' ? pathname === `/${locale}` : pathname.startsWith(item.href)
					const Icon = item.icon

					return (
						<Link
							key={item.key}
							href={item.href}
							aria-label={item.label}
							aria-current={active ? 'page' : undefined}
							className={cn(
								'flex h-14 items-center justify-center text-[#070707] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#AE927C]',
								active && 'text-[#AE927C]'
							)}
						>
							{Icon ? <Icon className="size-7 stroke-[1.8]" aria-hidden /> : <BrandMark className="size-[26px]" />}
						</Link>
					)
				})}
			</div>
		</nav>
	)
}
