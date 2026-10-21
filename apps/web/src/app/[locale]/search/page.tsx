import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ScanLine, Search as SearchIcon } from 'lucide-react'
import { isLocale } from '@/i18n/config'

// Reads searchParams (q) - request-time, see catalog/page.tsx.
export const instant = false
import { translate, getDictionary } from '@/i18n/get-dictionary'
import { searchProducts, getBrands } from '@/lib/catalog/data'
import { ProductGrid } from '@/components/product/product-grid'

/**
 * Local mock search (Sprint 11 Task 14): matches against product name,
 * brand name, SKU and category in-memory. Swapping for Meilisearch later
 * only needs searchProducts() in lib/catalog/data.ts to change.
 */
export default async function SearchPage({ params, searchParams }: PageProps<'/[locale]/search'>) {
	const { locale } = await params
	if (!isLocale(locale)) notFound()
	const sp = await searchParams
	const query = typeof sp.q === 'string' ? sp.q : ''

	const [dict, brands, results] = await Promise.all([getDictionary(locale), getBrands(), searchProducts(query)])
	const brandsById = new Map(brands.map(b => [b.id, b]))

	return (
		<div className="mx-auto max-w-3xl px-4 pb-12 pt-2 sm:px-6">
			<h1 className="sr-only">{dict.search.title}</h1>
			<form method="get" role="search" className="flex items-center gap-3 border-b border-border py-3">
				<SearchIcon className="size-8 shrink-0 stroke-[1.5] text-ink" aria-hidden />
				<input
					type="search"
					name="q"
					defaultValue={query}
					placeholder={dict.search.placeholder}
					autoFocus
					className="min-w-0 flex-1 bg-transparent text-2xl font-medium tracking-tight text-ink outline-none placeholder:text-[#D7D7D7] sm:text-3xl"
				/>
				<Link href={`/${locale}/categories`} aria-label={dict.search.openCategories} className="flex size-11 shrink-0 items-center justify-center text-ink transition-colors hover:text-brand-accent">
					<ScanLine className="size-7 stroke-[1.6]" aria-hidden />
				</Link>
			</form>

			{query ? (
				<>
					<p className="mt-4 text-sm text-ink-muted">{translate(dict, 'search.resultsCount', { count: results.length })}</p>
					<div className="mt-4">
						<ProductGrid products={results} brandsById={brandsById} locale={locale} dict={dict} />
					</div>
				</>
			) : (
				<section className="pt-10" aria-label={dict.search.popular}>
					<p className="text-xs font-medium uppercase tracking-[0.18em] text-ink-muted">{dict.search.popular}</p>
					<div className="mt-5 divide-y divide-border border-y border-border">
						<Link href={`/${locale}/categories`} className="flex min-h-16 items-center justify-between text-xl text-ink">
							{dict.nav.catalog}
							<span aria-hidden>→</span>
						</Link>
						<Link href={`/${locale}/brands`} className="flex min-h-16 items-center justify-between text-xl text-ink">
							{dict.nav.brands}
							<span aria-hidden>→</span>
						</Link>
						<Link href={`/${locale}/catalog?sort=newest`} className="flex min-h-16 items-center justify-between text-xl text-ink">
							{dict.home.newArrivals}
							<span aria-hidden>→</span>
						</Link>
					</div>
				</section>
			)}
		</div>
	)
}
