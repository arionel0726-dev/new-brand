import type { Brand } from '@/types/catalog'

/**
 * All demo data (Sprint 11 mock catalog). "Anny" is the one brand name that
 * also appears in the real, source-confirmed ANNY product fixture (see
 * products.ts) - the brand record itself (description/logo) is still
 * invented, since no verified brand-profile content exists in the legacy
 * sources reviewed in Sprint 10A/10A.1.
 */
export const mockBrands: Brand[] = [
	{
		id: 'brand-anny',
		slug: 'anny',
		name: 'Anny',
		description: {
			ru: 'Немецкий бренд декоративной косметики для ногтей, известный насыщенными лаками.',
			ro: 'Brand german de cosmetice decorative pentru unghii, cunoscut pentru lacuri intense.'
		},
		logoUrl: null
	},
	{
		id: 'brand-lumeri',
		slug: 'lumeri',
		name: 'Lumeri',
		description: {
			ru: 'Нишевая парфюмерия с акцентом на натуральные composition.',
			ro: 'Parfumerie de nișă, axată pe compoziții naturale.'
		},
		logoUrl: null
	},
	{
		id: 'brand-velvetine',
		slug: 'velvetine',
		name: 'Velvetine',
		description: {
			ru: 'Декоративная косметика для лица с бархатистой текстурой покрытия.',
			ro: 'Cosmetice decorative pentru față, cu textură catifelată.'
		},
		logoUrl: null
	},
	{
		id: 'brand-claire-derme',
		slug: 'claire-derme',
		name: 'Claire Derme',
		description: {
			ru: 'Дерматологически протестированный уход за кожей лица.',
			ro: 'Îngrijire facială testată dermatologic.'
		},
		logoUrl: null
	},
	{
		id: 'brand-nordhair',
		slug: 'nordhair',
		name: 'NordHair',
		description: {
			ru: 'Скандинавский уход за волосами на основе растительных масел.',
			ro: 'Îngrijire scandinavă a părului pe bază de uleiuri vegetale.'
		},
		logoUrl: null
	},
	{
		id: 'brand-matiere',
		slug: 'matiere',
		name: 'Matière',
		description: {
			ru: 'Французский бренд макияжа с минималистичной линейкой оттенков.',
			ro: 'Brand francez de machiaj, cu o gamă minimalistă de nuanțe.'
		},
		logoUrl: null
	}
]

export function findBrandBySlug(slug: string): Brand | undefined {
	return mockBrands.find(b => b.slug === slug)
}

export function findBrandById(id: string): Brand | undefined {
	return mockBrands.find(b => b.id === id)
}
