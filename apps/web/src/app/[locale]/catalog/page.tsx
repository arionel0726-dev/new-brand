import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isLocale } from '@/i18n/config'

// Reads searchParams to drive filtering/sorting - genuinely request-time, so
// this segment opts out of Cache Components' instant-navigation static shell
// rather than faking a static prerender of a page whose entire output
// depends on the query string.
export const instant = false
import { translate, getDictionary } from '@/i18n/get-dictionary'
import { getCatalogProducts, getBrands, priceBounds } from '@/lib/catalog/data'
import { productCategoryGroup, type ProductCategoryGroup, type SortOption } from '@/types/catalog'
import { ProductGrid } from '@/components/product/product-grid'
import { FilterSheet } from '@/components/catalog/filter-sheet'
import { SortSelect } from '@/components/catalog/sort-select'

const PAGE_SIZE = 12

export default async function CatalogPage({ params, searchParams }: PageProps<'/[locale]/catalog'>) {
	const { locale } = await params
	if (!isLocale(locale)) notFound()
	const sp = await searchParams

	const categoryRaw = typeof sp.category === 'string' ? sp.category : undefined
	const category = productCategoryGroup.safeParse(categoryRaw).success ? (categoryRaw as ProductCategoryGroup) : undefined
	const brandSlug = typeof sp.brand === 'string' && sp.brand ? sp.brand : undefined
	const minPrice = typeof sp.minPrice === 'string' && sp.minPrice ? Number(sp.minPrice) * 100 : undefined
	const maxPrice = typeof sp.maxPrice === 'string' && sp.maxPrice ? Number(sp.maxPrice) * 100 : undefined
	const inStockOnly = sp.inStock === '1'
	const sort = (typeof sp.sort === 'string' ? sp.sort : undefined) as SortOption | undefined
	const page = typeof sp.page === 'string' ? Math.max(1, Number(sp.page) || 1) : 1

	const [dict, brands, bounds, result] = await Promise.all([
		getDictionary(locale),
		getBrands(),
		Promise.resolve(priceBounds()),
		getCatalogProducts({
			categoryGroup: category,
			brandSlug,
			minPriceBani: minPrice,
			maxPriceBani: maxPrice,
			inStockOnly,
			sort,
			page,
			pageSize: PAGE_SIZE
		})
	])

	const brandsById = new Map(brands.map(b => [b.id, b]))
	const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE))

	function pageHref(target: number) {
		const params = new URLSearchParams()
		if (category) params.set('category', category)
		if (brandSlug) params.set('brand', brandSlug)
		if (minPrice !== undefined) params.set('minPrice', String(minPrice / 100))
		if (maxPrice !== undefined) params.set('maxPrice', String(maxPrice / 100))
		if (inStockOnly) params.set('inStock', '1')
		if (sort) params.set('sort', sort)
		if (target > 1) params.set('page', String(target))
		const qs = params.toString()
		return qs ? `?${qs}` : '.'
	}

	return (
		<div className="px-4 py-6 sm:px-6">
			<div className="flex items-center justify-between gap-3">
				<h1 className="text-xl font-medium text-ink">{dict.catalog.title}</h1>
				<p className="text-sm text-ink-muted">{translate(dict, 'catalog.resultsCount', { count: result.total })}</p>
			</div>

			<div className="sticky top-14 z-10 -mx-4 mt-4 flex items-center justify-between gap-2 border-b border-border bg-white px-4 py-3 sm:top-16 sm:mx-0 sm:border-none sm:px-0">
				<FilterSheet
					dict={dict}
					brands={brands}
					priceBounds={bounds}
					current={{ category, brand: brandSlug, minPrice, maxPrice, inStock: inStockOnly }}
				/>
				<SortSelect dict={dict} />
			</div>

			<div className="mt-5">
				<ProductGrid products={result.products} brandsById={brandsById} locale={locale} dict={dict} />
			</div>

			{totalPages > 1 && (
				<nav aria-label="Pagination" className="mt-10 flex items-center justify-center gap-4 text-sm">
					{page > 1 && (
						<Link href={pageHref(page - 1)} className="rounded-md border border-border px-4 py-2 text-ink">
							←
						</Link>
					)}
					<span className="text-ink-muted">
						{page} / {totalPages}
					</span>
					{page < totalPages && (
						<Link href={pageHref(page + 1)} className="rounded-md border border-border px-4 py-2 text-ink">
							{dict.catalog.loadMore}
						</Link>
					)}
				</nav>
			)}
		</div>
	)
}
