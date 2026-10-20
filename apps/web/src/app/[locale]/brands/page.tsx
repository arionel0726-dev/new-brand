import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'

// Reads searchParams (q, letter) - request-time, see catalog/page.tsx.
export const instant = false
import { getDictionary } from '@/i18n/get-dictionary'
import { getBrands } from '@/lib/catalog/data'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

export default async function BrandsPage({ params, searchParams }: PageProps<'/[locale]/brands'>) {
	const { locale } = await params
	if (!isLocale(locale)) notFound()
	const sp = await searchParams

	const query = typeof sp.q === 'string' ? sp.q.trim().toLowerCase() : ''
	const letter = typeof sp.letter === 'string' ? sp.letter.toUpperCase() : ''

	const [dict, brands] = await Promise.all([getDictionary(locale), getBrands()])

	const filtered = brands
		.filter(b => (query ? b.name.toLowerCase().includes(query) : true))
		.filter(b => (letter ? b.name.toUpperCase().startsWith(letter) : true))
		.sort((a, b) => a.name.localeCompare(b.name))

	const availableLetters = new Set(brands.map(b => b.name[0]?.toUpperCase()))

	return (
		<div className="px-4 py-6 sm:px-6">
			<h1 className="text-xl font-medium text-ink">{dict.brands.title}</h1>

			<form method="get" className="mt-4">
				<input
					type="search"
					name="q"
					defaultValue={query}
					placeholder={dict.brands.searchPlaceholder}
					className="w-full rounded-md border border-border px-3.5 py-2.5 text-sm text-ink"
				/>
			</form>

			<nav aria-label={dict.brands.title} className="mt-4 flex flex-wrap gap-1.5">
				<Link
					href={`/${locale}/brands`}
					className={`flex size-8 items-center justify-center rounded-full text-xs ${!letter ? 'bg-ink text-white' : 'text-ink-muted'}`}
				>
					{dict.brands.allLetters}
				</Link>
				{ALPHABET.filter(l => availableLetters.has(l)).map(l => (
					<Link
						key={l}
						href={`/${locale}/brands?letter=${l}`}
						className={`flex size-8 items-center justify-center rounded-full text-xs ${letter === l ? 'bg-ink text-white' : 'text-ink-muted'}`}
					>
						{l}
					</Link>
				))}
			</nav>

			{filtered.length === 0 ? (
				<p className="py-16 text-center text-sm text-ink-muted">{dict.brands.empty}</p>
			) : (
				<ul className="mt-6 divide-y divide-border border-t border-border">
					{filtered.map(brand => (
						<li key={brand.id}>
							<Link href={`/${locale}/brands/${brand.slug}`} className="flex items-center justify-between py-4 text-ink">
								<span>{brand.name}</span>
							</Link>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
