'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { Dictionary } from '@/i18n/get-dictionary'
import type { Locale } from '@/i18n/config'
import { SheetRoot, SheetContent, SheetTrigger } from '@/components/ui/sheet'

type NavDrawerProps = {
	locale: Locale
	dict: Dictionary
	triggerLabel: string
	triggerClassName?: string
	children: React.ReactNode
}

const categoryLinks = (dict: Dictionary) => [
	{ href: '/catalog?category=perfume', label: dict.nav.perfume },
	{ href: '/catalog?category=makeup', label: dict.nav.makeup },
	{ href: '/catalog?category=skincare', label: dict.nav.skincare },
	{ href: '/catalog?category=haircare', label: dict.nav.haircare }
]

/**
 * Mobile navigation drawer - a semantic <nav> landmark inside an
 * accessible, focus-trapped sheet. Real hrefs throughout (not JS-only
 * state), so back/forward and direct links behave like a normal site.
 */
export function NavDrawer({ locale, dict, triggerLabel, triggerClassName, children }: NavDrawerProps) {
	return (
		<SheetRoot>
			<SheetTrigger aria-label={triggerLabel} className={triggerClassName}>
				{children}
			</SheetTrigger>
			<SheetContent side="left" title={dict.nav.menu}>
				<nav aria-label={dict.nav.menu} className="flex flex-col px-2 py-2">
					<DrawerLink href={`/${locale}/catalog`} label={dict.nav.catalog} />
					{categoryLinks(dict).map(item => (
						<DrawerLink key={item.href} href={`/${locale}${item.href}`} label={item.label} indent />
					))}
					<DrawerLink href={`/${locale}/brands`} label={dict.nav.brands} />
					<DrawerLink href={`/${locale}/catalog?discount=1`} label={dict.nav.discounts} />
					<DrawerLink href={`/${locale}/stores`} label={dict.nav.stores} />
				</nav>
				<div className="mt-auto flex items-center justify-center gap-4 border-t border-border px-5 py-4 text-sm">
					<LocaleLink locale="ru" current={locale} label="RU" />
					<span className="text-border">/</span>
					<LocaleLink locale="ro" current={locale} label="RO" />
				</div>
			</SheetContent>
		</SheetRoot>
	)
}

function DrawerLink({ href, label, indent }: { href: string; label: string; indent?: boolean }) {
	return (
		<Link
			href={href}
			className={`flex items-center justify-between rounded-lg px-3 py-3 text-[15px] text-ink transition-colors active:bg-surface-soft ${indent ? 'pl-6 text-ink-muted' : ''}`}
		>
			{label}
			{!indent && <ChevronRight className="size-4 text-ink-muted" aria-hidden />}
		</Link>
	)
}

function LocaleLink({ locale, current, label }: { locale: Locale; current: Locale; label: string }) {
	return (
		<Link
			href={`/${locale}`}
			aria-current={locale === current ? 'true' : undefined}
			className={locale === current ? 'font-medium text-ink' : 'text-ink-muted'}
		>
			{label}
		</Link>
	)
}
