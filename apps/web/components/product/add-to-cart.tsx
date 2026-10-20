'use client'

import { useState } from 'react'
import { Heart } from 'lucide-react'
import type { Dictionary } from '@/i18n/get-dictionary'
import type { Locale } from '@/i18n/config'
import type { Product } from '@/types/catalog'
import { formatMoney } from '@/lib/catalog/money'
import { useCartStore } from '@/lib/cart-store'

type AddToCartProps = {
	product: Product
	locale: Locale
	dict: Dictionary
}

/**
 * Variant picker + add-to-cart. Uses a real <select> (keyboard and screen
 * reader accessible out of the box) rather than decorative swatch circles,
 * per the spec's explicit PDP requirement.
 */
export function AddToCart({ product, locale, dict }: AddToCartProps) {
	const [variantId, setVariantId] = useState(product.variants[0].id)
	const [added, setAdded] = useState(false)
	const add = useCartStore(state => state.add)

	const variant = product.variants.find(v => v.id === variantId) ?? product.variants[0]
	const inStock = variant.quantityOnHand > 0
	const hasVariants = product.variants.length > 1
	const variantLabel = product.variants.some(v => v.volumeVar) ? dict.product.volume : dict.product.shade

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-baseline gap-2.5">
				<span className="text-lg font-medium text-ink">{formatMoney(variant.priceBani, locale)}</span>
				{variant.compareAtPriceBani && <span className="text-sm text-ink-muted line-through">{formatMoney(variant.compareAtPriceBani, locale)}</span>}
			</div>

			{hasVariants && (
				<label className="flex flex-col gap-1.5">
					<span className="text-xs font-medium uppercase tracking-wide text-ink-muted">{variantLabel}</span>
					<select
						value={variantId}
						onChange={e => {
							setVariantId(e.target.value)
							setAdded(false)
						}}
						className="rounded-md border border-border px-3 py-2.5 text-sm text-ink"
					>
						{product.variants.map(v => (
							<option key={v.id} value={v.id} disabled={v.quantityOnHand === 0}>
								{v.label}
								{v.quantityOnHand === 0 ? ` — ${dict.product.outOfStock}` : ''}
							</option>
						))}
					</select>
				</label>
			)}

			<p className="text-sm text-ink-muted">{inStock ? dict.product.inStock : dict.product.outOfStock}</p>

			<div className="flex gap-2.5">
				<button
					type="button"
					disabled={!inStock}
					onClick={() => {
						add(product.id, variant.id)
						setAdded(true)
					}}
					className="flex-1 rounded-md bg-ink px-4 py-3.5 text-sm font-medium text-white transition-opacity disabled:opacity-40"
				>
					{added ? dict.product.addedToCart : dict.product.addToCart}
				</button>
				<button
					type="button"
					aria-label={dict.product.wishlistAdd}
					className="flex size-12 items-center justify-center rounded-md border border-border text-ink"
				>
					<Heart className="size-5" aria-hidden />
				</button>
			</div>
		</div>
	)
}
