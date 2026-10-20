'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import type { Dictionary } from '@/i18n/get-dictionary'
import type { SortOption } from '@/types/catalog'

export function SortSelect({ dict }: { dict: Dictionary }) {
	const router = useRouter()
	const searchParams = useSearchParams()

	function onChange(value: string) {
		const params = new URLSearchParams(searchParams.toString())
		if (value) params.set('sort', value)
		else params.delete('sort')
		params.delete('page')
		router.push(`?${params.toString()}`, { scroll: false })
	}

	return (
		<label className="flex items-center gap-2 text-sm text-ink">
			<span className="sr-only">{dict.catalog.sort}</span>
			<select
				defaultValue={searchParams.get('sort') ?? ''}
				onChange={e => onChange(e.target.value)}
				className="rounded-md border border-border bg-white px-2.5 py-2 text-sm text-ink"
			>
				<option value="">{dict.catalog.sortNewest}</option>
				<option value={'price-asc' satisfies SortOption}>{dict.catalog.sortPriceAsc}</option>
				<option value={'price-desc' satisfies SortOption}>{dict.catalog.sortPriceDesc}</option>
				<option value={'name-asc' satisfies SortOption}>{dict.catalog.sortNameAsc}</option>
			</select>
		</label>
	)
}
