import Image from 'next/image'
import Link from 'next/link'
import { cn } from 'cn'
import type { Dictionary } from '@/i18n/get-dictionary'
import type { Locale } from '@/i18n/config'
import type { Brand, Product } from '@/types/catalog'
import { formatMoney } from '@/lib/catalog/money'

type ProductCardProps = {
	product: Product
	brand: Brand | undefined
	locale: Locale
	dict: Dictionary
	className?: string
}

/**
 * Reusable product card (Sprint 11 Task 8 / mobile-first addendum). Built
 * for a two-column mobile grid first: image fills the card width at a
 * fixed aspect ratio so varying name lengths never break grid alignment -
 * the text block below has a fixed min-height instead of growing the image
 * area. No star ratings / fake reviews.
 */
export function ProductCard({ product, brand, locale, dict, className }: ProductCardProps) {
	const lowestVariant = product.variants.reduce((min, v) => (v.priceBani < min.priceBani ? v : min), product.variants[0])
	const hasDiscount = product.variants.some(v => v.compareAtPriceBani !== null)
	const discountVariant = product.variants.find(v => v.compareAtPriceBani !== null)
	const discountPercent = discountVariant?.compareAtPriceBani
		? Math.round((1 - discountVariant.priceBani / discountVariant.compareAtPriceBani) * 100)
		: null
	const inStock = product.variants.some(v => v.quantityOnHand > 0)
	const variantCount = product.variants.length
	const name = product.name[locale] ?? product.name.ru
	const slug = product.slug[locale] ?? product.slug.ru

	return (
		<Link
			href={`/${locale}/product/${slug}`}
			className={cn(
				'group flex flex-col focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent',
				className
			)}
		>
			<div className="relative aspect-[4/5] w-full overflow-hidden bg-surface-soft">
				<Image
					src={product.images[0]}
					alt={name}
					fill
					sizes="(min-width: 1024px) 23vw, 50vw"
					className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
				/>
				<div className="absolute left-2 top-2 flex flex-col gap-1">
					{product.isNew && <Badge label={dict.product.new} />}
					{product.isHit && !product.isNew && <Badge label={dict.product.hit} />}
					{hasDiscount && discountPercent && <Badge label={`-${discountPercent}%`} tone="accent" />}
				</div>
				{!inStock && (
					<div className="absolute inset-x-0 bottom-0 bg-white/90 px-2 py-1.5 text-center text-xs text-ink-muted">
						{dict.product.outOfStock}
					</div>
				)}
			</div>

			<div className="flex flex-1 flex-col gap-0.5 pt-2.5">
				{brand && <span className="text-[11px] uppercase tracking-wide text-ink-muted">{brand.name}</span>}
				<span className="line-clamp-2 text-sm text-ink">{name}</span>
				{variantCount > 1 && (
					<span className="text-xs text-ink-muted">
						{variantCount} {dict.product.variant.toLowerCase()}
					</span>
				)}
				<div className="mt-1 flex items-baseline gap-2">
					<span className="text-sm font-medium text-ink">{formatMoney(lowestVariant.priceBani, locale)}</span>
					{discountVariant?.compareAtPriceBani && (
						<span className="text-xs text-ink-muted line-through">{formatMoney(discountVariant.compareAtPriceBani, locale)}</span>
					)}
				</div>
			</div>
		</Link>
	)
}

function Badge({ label, tone = 'ink' }: { label: string; tone?: 'ink' | 'accent' }) {
	return (
		<span
			className={cn(
				'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white',
				tone === 'ink' ? 'bg-ink' : 'bg-brand-accent'
			)}
		>
			{label}
		</span>
	)
}
