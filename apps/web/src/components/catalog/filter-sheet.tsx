'use client'

import { SlidersHorizontal } from 'lucide-react'
import type { Dictionary } from '@/i18n/get-dictionary'
import type { Brand, ProductCategoryGroup } from '@/types/catalog'
import { SheetRoot, SheetContent, SheetTrigger } from '@/components/ui/sheet'

type FilterSheetProps = {
	dict: Dictionary
	brands: Brand[]
	priceBounds: { min: number; max: number }
	current: {
		category?: ProductCategoryGroup
		brand?: string
		minPrice?: number
		maxPrice?: number
		inStock?: boolean
	}
}

const categoryGroups: ProductCategoryGroup[] = ['perfume', 'makeup', 'skincare', 'haircare']

/**
 * Catalog filters as a mobile bottom sheet (addendum priority #7), built as
 * a plain GET <form> - submitting navigates to the filtered URL, so
 * filtering works even without client JS and the resulting state is
 * link-shareable/back-button-safe.
 */
export function FilterSheet({ dict, brands, priceBounds, current }: FilterSheetProps) {
	return (
		<SheetRoot>
			<SheetTrigger className="flex items-center gap-1.5 border border-border px-3 py-2 text-sm text-ink">
				<SlidersHorizontal className="size-4" aria-hidden />
				{dict.catalog.filters}
			</SheetTrigger>
			<SheetContent side="left" title={dict.catalog.filters}>
				<form method="get" className="flex flex-col gap-6 px-5 py-5">
					<fieldset className="flex flex-col gap-2">
						<legend className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">{dict.catalog.category}</legend>
						<label className="flex items-center gap-2 text-sm text-ink">
							<input type="radio" name="category" value="" defaultChecked={!current.category} /> {dict.brands.allLetters}
						</label>
						{categoryGroups.map(group => (
							<label key={group} className="flex items-center gap-2 text-sm text-ink">
								<input type="radio" name="category" value={group} defaultChecked={current.category === group} /> {dict.nav[group]}
							</label>
						))}
					</fieldset>

					<fieldset className="flex flex-col gap-2">
						<legend className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">{dict.catalog.brand}</legend>
					<select name="brand" defaultValue={current.brand ?? ''} className="border border-border px-2.5 py-2 text-sm text-ink">
							<option value="">{dict.brands.allLetters}</option>
							{brands.map(brand => (
								<option key={brand.id} value={brand.slug}>
									{brand.name}
								</option>
							))}
						</select>
					</fieldset>

					<fieldset className="flex flex-col gap-2">
						<legend className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">{dict.catalog.priceRange}</legend>
						<div className="flex items-center gap-2">
							<input
								type="number"
								name="minPrice"
								placeholder={String(Math.floor(priceBounds.min / 100))}
								defaultValue={current.minPrice !== undefined ? Math.floor(current.minPrice / 100) : undefined}
								className="w-full border border-border px-2.5 py-2 text-sm text-ink"
								min={0}
							/>
							<span className="text-ink-muted">—</span>
							<input
								type="number"
								name="maxPrice"
								placeholder={String(Math.ceil(priceBounds.max / 100))}
								defaultValue={current.maxPrice !== undefined ? Math.ceil(current.maxPrice / 100) : undefined}
								className="w-full border border-border px-2.5 py-2 text-sm text-ink"
								min={0}
							/>
						</div>
					</fieldset>

					<label className="flex items-center gap-2 text-sm text-ink">
						<input type="checkbox" name="inStock" value="1" defaultChecked={current.inStock} />
						{dict.catalog.availabilityInStock}
					</label>

					<div className="sticky bottom-0 -mx-5 mt-auto flex gap-2 border-t border-border bg-white px-5 py-4">
						<a href="?" className="flex-1 border border-border px-4 py-2.5 text-center text-sm text-ink">
							{dict.catalog.reset}
						</a>
						<button type="submit" className="flex-1 bg-ink px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-white">
							{dict.catalog.apply}
						</button>
					</div>
				</form>
			</SheetContent>
		</SheetRoot>
	)
}
