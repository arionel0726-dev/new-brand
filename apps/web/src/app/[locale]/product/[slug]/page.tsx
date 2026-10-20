import Image from 'next/image'
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isLocale, locales } from '@/i18n/config'
import { getDictionary } from '@/i18n/get-dictionary'
import { getProductBySlug, findBrandById, getCatalogProducts } from '@/lib/catalog/data'
import { AddToCart } from '@/components/product/add-to-cart'

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

	const [dict, product] = await Promise.all([getDictionary(locale), getProductBySlug(locale, slug)])
	if (!product) notFound()

	const brand = findBrandById(product.brandId)
	const name = product.name[locale] ?? product.name.ru
	const description = product.description[locale] ?? product.description.ru
	const lowestVariant = product.variants.reduce((min, v) => (v.priceBani < min.priceBani ? v : min), product.variants[0])

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

			<div className="mt-3 lg:grid lg:grid-cols-2 lg:gap-10 lg:px-6">
				<div className="flex snap-x snap-mandatory gap-0 overflow-x-auto lg:grid lg:grid-cols-2 lg:gap-2 lg:overflow-visible">
					{product.images.map((src, i) => (
						<div key={src} className="relative aspect-[4/5] w-full shrink-0 snap-center bg-surface-soft">
							<Image src={src} alt={i === 0 ? name : ''} fill sizes="(min-width: 1024px) 45vw, 100vw" priority={i === 0} className="object-cover" />
						</div>
					))}
				</div>

				<div className="px-4 pt-5 sm:px-6 lg:px-0 lg:pt-0">
					{brand && (
						<Link href={`/${locale}/brands/${brand.slug}`} className="text-xs uppercase tracking-wide text-ink-muted">
							{brand.name}
						</Link>
					)}
					<h1 className="mt-1 text-xl font-medium text-ink">{name}</h1>

					<div className="mt-5">
						<AddToCart product={product} locale={locale} dict={dict} />
					</div>
				</div>
			</div>

			<div className="mt-10 border-t border-border px-4 pt-8 sm:px-6 lg:px-6">
				<h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">{dict.product.details}</h2>
				<p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink">{description}</p>
			</div>
		</div>
	)
}
