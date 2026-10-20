import Image from 'next/image'
import Link from 'next/link'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/get-dictionary'
import { getHomeData, getBrands } from '@/lib/catalog/data'
import { ProductGrid } from '@/components/product/product-grid'
import { notFound } from 'next/navigation'

export default async function HomePage({ params }: PageProps<'/[locale]'>) {
	const { locale } = await params
	if (!isLocale(locale)) notFound()

	const [dict, home, brands] = await Promise.all([getDictionary(locale), getHomeData(), getBrands()])
	const brandsById = new Map(brands.map(b => [b.id, b]))

	return (
		<div className="flex flex-col gap-14 pb-16 sm:gap-20">
			<section aria-label={dict.nav.catalog} className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pt-4 sm:px-6">
				{home.hero.map(slide => (
					<Link
						key={slide.id}
						href={slide.href[locale]}
						className="relative aspect-[4/5] w-[88vw] shrink-0 snap-start overflow-hidden bg-surface-soft sm:w-[60vw] lg:w-[40vw]"
					>
						<Image src={slide.imageUrl} alt="" fill sizes="90vw" className="object-cover" priority />
						<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-5 text-white">
							<p className="text-xs uppercase tracking-wide opacity-80">{slide.eyebrow[locale]}</p>
							<h1 className="mt-1 text-xl font-medium">{slide.title[locale]}</h1>
							<p className="mt-1 text-sm opacity-90">{slide.subtitle[locale]}</p>
						</div>
					</Link>
				))}
			</section>

			<Section title={dict.home.featuredCategories}>
				<div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-4 sm:px-6">
					{home.featuredCategoryGroups.map(group => (
						<Link
							key={group}
							href={`/${locale}/catalog?category=${group}`}
							className="flex aspect-square items-center justify-center bg-surface-soft px-3 text-center text-sm text-ink transition-colors hover:bg-ink hover:text-white"
						>
							{dict.nav[group]}
						</Link>
					))}
				</div>
			</Section>

			{home.newArrivals.length > 0 && (
				<Section title={dict.home.newArrivals}>
					<div className="px-4 sm:px-6">
						<ProductGrid products={home.newArrivals} brandsById={brandsById} locale={locale} dict={dict} />
					</div>
				</Section>
			)}

			{home.bestsellers.length > 0 && (
				<Section title={dict.home.bestsellers}>
					<div className="px-4 sm:px-6">
						<ProductGrid products={home.bestsellers} brandsById={brandsById} locale={locale} dict={dict} />
					</div>
				</Section>
			)}

			{home.discounted.length > 0 && (
				<Section title={dict.home.discounts}>
					<div className="px-4 sm:px-6">
						<ProductGrid products={home.discounted} brandsById={brandsById} locale={locale} dict={dict} />
					</div>
				</Section>
			)}

			<Section title={dict.home.featuredBrands}>
				<div className="flex gap-3 overflow-x-auto px-4 sm:px-6">
					{home.featuredBrands.map(brand => (
						<Link
							key={brand.id}
							href={`/${locale}/brands/${brand.slug}`}
							className="flex h-16 shrink-0 items-center justify-center border border-border px-6 text-sm text-ink"
						>
							{brand.name}
						</Link>
					))}
				</div>
			</Section>

			<section className="mx-4 grid gap-3 sm:mx-6 sm:grid-cols-2">
				<InfoCard title={dict.home.bonusProgram} text={dict.home.bonusProgramText} />
				<InfoCard title={dict.home.omnichannel} text={dict.home.omnichannelText} />
			</section>
		</div>
	)
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section>
			<h2 className="px-4 pb-4 text-lg font-medium text-ink sm:px-6">{title}</h2>
			{children}
		</section>
	)
}

function InfoCard({ title, text }: { title: string; text: string }) {
	return (
		<div className="flex flex-col gap-1.5 bg-surface-soft p-6">
			<h2 className="text-base font-medium text-ink">{title}</h2>
			<p className="text-sm text-ink-muted">{text}</p>
		</div>
	)
}
