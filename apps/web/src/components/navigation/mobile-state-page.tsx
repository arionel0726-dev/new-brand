import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'

type MobileStatePageProps = {
	title: string
	emptyTitle: string
	text: string
	cta: string
	ctaHref: string
	icon: LucideIcon
}

export function MobileStatePage({ title, emptyTitle, text, cta, ctaHref, icon: Icon }: MobileStatePageProps) {
	return (
		<div className="mx-auto flex min-h-[calc(100svh-8rem)] max-w-3xl flex-col px-4 pb-16 pt-5 sm:px-6">
			<h1 className="text-3xl font-medium tracking-tight text-ink sm:text-4xl">{title}</h1>
			<div className="flex flex-1 flex-col items-center justify-center py-20 text-center">
				<div className="flex size-20 items-center justify-center rounded-full border border-border text-ink-muted">
					<Icon className="size-9 stroke-[1.5]" aria-hidden />
				</div>
				<h2 className="mt-7 text-xl font-medium text-ink">{emptyTitle}</h2>
				<p className="mt-3 max-w-sm text-sm leading-6 text-ink-muted">{text}</p>
				<Link href={ctaHref} className="mt-8 inline-flex min-h-12 items-center justify-center bg-ink px-6 text-sm font-medium text-white transition-colors hover:bg-brand-accent">
					{cta}
				</Link>
			</div>
		</div>
	)
}
