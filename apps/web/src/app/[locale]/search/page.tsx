import { notFound } from 'next/navigation'
import { Search as SearchIcon } from 'lucide-react'
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
		<div className="px-4 py-6 sm:px-6">
			<form method="get" role="search" className="relative">
				<SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
				<input
					type="search"
					name="q"
					defaultValue={query}
					placeholder={dict.search.placeholder}
					autoFocus
					className="w-full rounded-md border border-border py-3 pl-10 pr-3.5 text-sm text-ink"
				/>
			</form>

			{query ? (
				<>
					<p className="mt-4 text-sm text-ink-muted">{translate(dict, 'search.resultsCount', { count: results.length })}</p>
					<div className="mt-4">
						<ProductGrid products={results} brandsById={brandsById} locale={locale} dict={dict} />
					</div>
				</>
			) : (
				<p className="py-16 text-center text-sm text-ink-muted">{dict.search.empty}</p>
			)}
		</div>
	)
}
