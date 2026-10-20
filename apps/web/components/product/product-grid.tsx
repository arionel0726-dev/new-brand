import type { Dictionary } from '@/i18n/get-dictionary'
import type { Locale } from '@/i18n/config'
import type { Brand, Product } from '@/types/catalog'
import { ProductCard } from './product-card'

type ProductGridProps = {
	products: Product[]
	brandsById: Map<string, Brand>
	locale: Locale
	dict: Dictionary
}

/** Two-column grid on mobile (the mobile-first addendum's #4 priority), opening up at larger breakpoints. */
export function ProductGrid({ products, brandsById, locale, dict }: ProductGridProps) {
	if (products.length === 0) {
		return <p className="py-16 text-center text-sm text-ink-muted">{dict.catalog.empty}</p>
	}

	return (
		<ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
			{products.map(product => (
				<li key={product.id}>
					<ProductCard product={product} brand={brandsById.get(product.brandId)} locale={locale} dict={dict} />
				</li>
			))}
		</ul>
	)
}
