import Link from 'next/link'

type InfoStatePageProps = {
	title: string
	text: string
	backLabel: string
	backHref: string
}

export function InfoStatePage({ title, text, backLabel, backHref }: InfoStatePageProps) {
	return (
		<div className="mx-auto min-h-[calc(100svh-8rem)] max-w-3xl px-4 pb-16 pt-5 sm:px-6">
			<h1 className="text-3xl font-medium tracking-tight text-ink sm:text-4xl">{title}</h1>
			<div className="mt-12 border-t border-border pt-6">
				<p className="max-w-xl text-base leading-7 text-ink-muted">{text}</p>
				<Link href={backHref} className="mt-8 inline-flex min-h-12 items-center justify-center bg-ink px-6 text-sm font-medium text-white transition-colors hover:bg-brand-accent">
					{backLabel}
				</Link>
			</div>
		</div>
	)
}
