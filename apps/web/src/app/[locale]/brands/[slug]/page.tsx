import { notFound } from 'next/navigation'
import { isLocale, locales } from '@/i18n/config'
import { getDictionary } from '@/i18n/get-dictionary'
import { getBrandBySlug, getBrandProducts, getBrands } from '@/lib/catalog/data'
import { ProductGrid } from '@/components/product/product-grid'

export async function generateStaticParams() {
	const brands = await getBrands()
	return locales.flatMap(locale => brands.map(brand => ({ locale, slug: brand.slug })))
}

export default async function BrandDetailPage({ params }: PageProps<'/[locale]/brands/[slug]'>) {
	const { locale, slug } = await params
	if (!isLocale(locale)) notFound()

	const [dict, brand] = await Promise.all([getDictionary(locale), getBrandBySlug(slug)])
	if (!brand) notFound()

	const products = await getBrandProducts(brand.id)
	const brandsById = new Map([[brand.id, brand]])

	return (
		<div className="px-4 py-6 sm:px-6">
			<h1 className="text-xl font-medium text-ink">{brand.name}</h1>
			{brand.description && <p className="mt-2 max-w-xl text-sm text-ink-muted">{brand.description[locale] ?? brand.description.ru}</p>}

			<h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-ink-muted">{dict.brands.products}</h2>
			<div className="mt-4">
				<ProductGrid products={products} brandsById={brandsById} locale={locale} dict={dict} />
			</div>
		</div>
	)
}
