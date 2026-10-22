import Link from 'next/link'
import { ChevronDown, ChevronRight, Flower2, Gift, Percent, Search, Sparkles } from 'lucide-react'
import type { Dictionary } from '@/i18n/get-dictionary'
import type { Locale } from '@/i18n/config'
import { mobileCategoryMenuItems, type MobileCategoryMenuItem } from '@/data/mock/mobile-category-menu'

type MobileCategoryMenuProps = {
	locale: Locale
	dict: Dictionary
}

export function MobileCategoryMenu({ locale, dict }: MobileCategoryMenuProps) {
	const copy = dict.mobileCategories

	return (
		<div className="mx-auto w-full max-w-3xl overflow-hidden">
			<section className="border-b border-border px-4 pb-4 pt-2 sm:px-6" aria-label={copy.brandSearch}>
				<Link
					href={`/${locale}/search`}
					className="flex min-h-16 items-center gap-3 border-b border-border text-3xl font-medium tracking-tight text-ink-muted transition-colors hover:text-ink sm:text-4xl"
				>
					<span className="min-w-0 flex-1 truncate">{copy.brandSearch}</span>
					<Search className="size-8 shrink-0 stroke-[1.5] text-ink" aria-hidden />
					<span className="flex size-10 shrink-0 items-center justify-center text-ink" aria-hidden>
						<span className="block size-6 border-2 border-ink" />
					</span>
				</Link>
			</section>

			<section className="px-4 pt-8 sm:px-6" aria-label={copy.city}>
				<Link href={`/${locale}/stores`} className="flex min-h-12 items-center gap-3 text-xl font-medium text-ink">
					<ChevronDown className="size-7 fill-ink stroke-[2.5]" aria-hidden />
					<span>{copy.city}</span>
				</Link>
			</section>

			<nav aria-label={copy.title} className="px-4 pb-8 pt-5 sm:px-6">
				<div className="divide-y divide-transparent">
					{mobileCategoryMenuItems.map(item => (
						<CategoryMenuRow key={item.id} item={item} locale={locale} copy={copy} />
					))}
				</div>
			</nav>

			<section className="border-t border-border px-4 py-2 sm:px-6" aria-label={copy.information}>
				{[
					{ href: `/${locale}/support/delivery`, label: copy.deliveryReturns },
					{ href: `/${locale}/stores`, label: copy.contacts },
					{ href: `/${locale}/stores`, label: copy.stores },
					{ href: `/${locale}/support/faq`, label: copy.faq }
				].map(item => (
					<Link key={item.label} href={item.href} className="flex min-h-16 items-center text-xl text-ink transition-colors hover:text-brand-accent sm:text-2xl">
						{item.label}
					</Link>
				))}
			</section>

			<section className="mt-5 border-y border-border bg-surface-soft px-4 py-5 sm:px-6" aria-label={copy.supportTitle}>
				<p className="text-sm uppercase tracking-[0.14em] text-ink-muted">{copy.supportTitle}</p>
				<Link href={`/${locale}/stores`} className="mt-3 block text-xl text-ink sm:text-2xl">
					{copy.supportCta}
				</Link>
				<p className="mt-7 text-sm text-ink-muted">{copy.supportHours}</p>
				<p className="mt-1 text-lg text-ink">{dict.footer.contactsPlaceholder}</p>
			</section>
		</div>
	)
}

function CategoryMenuRow({ item, locale, copy }: { item: MobileCategoryMenuItem; locale: Locale; copy: Dictionary['mobileCategories'] }) {
	return (
		<Link
			href={item.href(locale)}
			className="group flex min-h-16 items-center gap-3 py-1 text-3xl font-medium tracking-tight text-ink transition-colors hover:text-brand-accent sm:text-4xl"
		>
			{item.visual !== 'plain' && <CategoryVisual visual={item.visual} />}
			<span className="min-w-0 flex-1 truncate">{copy[item.labelKey]}</span>
			{item.trailing && <ChevronRight className="size-8 shrink-0 stroke-[2.5] text-ink sm:size-9" aria-hidden />}
		</Link>
	)
}

function CategoryVisual({ visual }: { visual: MobileCategoryMenuItem['visual'] }) {
	if (visual === 'flacon') {
		return <span className="shrink-0 text-[0.72em] font-semibold tracking-[-0.08em] text-ink">flacon<sup className="ml-1 text-[0.45em] tracking-normal">(MAG)</sup></span>
	}

	if (visual === 'flower') return <Flower2 className="size-10 shrink-0 stroke-[1.5] text-ink-muted sm:size-12" aria-hidden />
	if (visual === 'tamagotchi') return <Sparkles className="size-10 shrink-0 text-status-new sm:size-12" aria-hidden />
	if (visual === 'gift') return <Gift className="size-10 shrink-0 stroke-[1.5] text-promo sm:size-12" aria-hidden />
	return <Percent className="size-10 shrink-0 stroke-[2] text-promo sm:size-12" aria-hidden />
}
