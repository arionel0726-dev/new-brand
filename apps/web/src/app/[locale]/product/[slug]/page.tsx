import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isLocale, locales } from '@/i18n/config'
import { getDictionary } from '@/i18n/get-dictionary'
import { getProductBySlug, findBrandById, getBrands, getCatalogProducts } from '@/lib/catalog/data'
import { ProductDetail } from '@/components/product/product-detail'
import { ProductGrid } from '@/components/product/product-grid'
import { getProductEditorialCopy } from '@/data/mock/product-details'

export async function generateStaticParams() {
	const { products } = await getCatalogProducts({ pageSize: 1000 })
	return locales.flatMap(locale => products.map(product => ({ locale, slug: product.slug[locale] ?? product.slug.ru })))
}

export async function generateMetadata({ params }: PageProps<'/[locale]/product/[slug]'>): Promise<Metadata> {
	const { locale, slug } = await params
	if (!isLocale(locale)) return {}
	const product = await getProductBySlug(locale, slug)
	if (!product) return {}

	const title = product.seo.titleRu ?? product.name[locale] ?? product.name.ru
	const description = product.seo.descriptionRu ?? product.description[locale] ?? product.description.ru

	// Current route (/[locale]/product/[slug]) is a Sprint 11 placeholder, NOT
	// the final production path. The legacy and target V2 shape is
	// /{locale}/{catalog-uri}/{category-uri}/{product-uri} - see
	// docs/vizaje-migration-architecture.md. Canonical/hreflang is intentionally
	// left unset here rather than inventing a production URL from mock data.
	return { title, description }
}

export default async function ProductDetailPage({ params }: PageProps<'/[locale]/product/[slug]'>) {
	const { locale, slug } = await params
	if (!isLocale(locale)) notFound()

	const [dict, product, brands, relatedResult] = await Promise.all([
		getDictionary(locale),
		getProductBySlug(locale, slug),
		getBrands(),
		getCatalogProducts({ pageSize: 100 })
	])
	if (!product) notFound()

	const brand = findBrandById(product.brandId)
	const name = product.name[locale] ?? product.name.ru
	const description = product.description[locale] ?? product.description.ru
	const lowestVariant = product.variants.reduce((min, v) => (v.priceBani < min.priceBani ? v : min), product.variants[0])
	const relatedProducts = relatedResult.products.filter(item => item.id !== product.id && item.categoryGroup === product.categoryGroup).slice(0, 4)
	const brandsById = new Map(brands.map(item => [item.id, item]))

	const jsonLd = {
		'@context': 'https://schema.org',
		'@type': 'Product',
		name,
		description,
		brand: brand ? { '@type': 'Brand', name: brand.name } : undefined,
		offers: {
			'@type': 'Offer',
			priceCurrency: 'MDL',
			price: (lowestVariant.priceBani / 100).toFixed(2),
			availability: product.variants.some(v => v.quantityOnHand > 0)
				? 'https://schema.org/InStock'
				: 'https://schema.org/OutOfStock'
		}
	}

	const breadcrumbJsonLd = {
		'@context': 'https://schema.org',
		'@type': 'BreadcrumbList',
		itemListElement: [
			{ '@type': 'ListItem', position: 1, name: dict.product.breadcrumbHome, item: `/${locale}` },
			{ '@type': 'ListItem', position: 2, name: dict.nav.catalog, item: `/${locale}/catalog` },
			{ '@type': 'ListItem', position: 3, name }
		]
	}

	return (
		<div className="pb-16">
			{/* eslint-disable-next-line react/no-danger */}
			<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
			{/* eslint-disable-next-line react/no-danger */}
			<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />

			<nav aria-label="Breadcrumb" className="flex items-center gap-1.5 px-4 pt-4 text-xs text-ink-muted sm:px-6">
				<Link href={`/${locale}`}>{dict.product.breadcrumbHome}</Link>
				<span>/</span>
				<Link href={`/${locale}/catalog`}>{dict.nav.catalog}</Link>
				<span>/</span>
				<span className="text-ink">{name}</span>
			</nav>

			<div className="mt-6 lg:mt-8">
				<ProductDetail
					product={product}
					brand={brand}
					locale={locale}
					dict={dict}
					editorial={getProductEditorialCopy(locale, product.categoryGroup)}
				/>
			</div>

			{relatedProducts.length > 0 && (
				<section className="mx-auto mt-20 max-w-[1440px] border-t border-border px-4 pt-12 sm:px-6 lg:mt-28 lg:px-10 xl:px-16">
					<div className="mb-7 flex items-end justify-between gap-4">
						<div>
							<p className="text-[11px] font-medium uppercase tracking-[0.2em] text-brand-accent">{dict.brand.name}</p>
							<h2 className="mt-3 text-2xl font-medium tracking-tight text-ink sm:text-3xl">{dict.product.recommended}</h2>
						</div>
						<Link href={`/${locale}/catalog?category=${product.categoryGroup}`} className="hidden text-xs font-medium uppercase tracking-[0.14em] text-ink underline decoration-border underline-offset-4 transition-colors hover:text-brand-accent sm:block">
							{dict.product.viewCatalog}
						</Link>
					</div>
					<ProductGrid products={relatedProducts} brandsById={brandsById} locale={locale} dict={dict} />
				</section>
			)}
		</div>
	)
}
