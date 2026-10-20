import type { Category, ProductCategoryGroup } from '@/types/catalog'

export const mockCategories: Category[] = [
	{ id: 'cat-perfume', slug: 'perfume', name: { ru: 'Парфюмерия', ro: 'Parfumerie' }, parentId: null },
	{ id: 'cat-perfume-eau-de-parfum', slug: 'eau-de-parfum', name: { ru: 'Парфюмерная вода', ro: 'Apă de parfum' }, parentId: 'cat-perfume' },
	{ id: 'cat-makeup', slug: 'makeup', name: { ru: 'Макияж', ro: 'Machiaj' }, parentId: null },
	{ id: 'cat-makeup-nails', slug: 'nails', name: { ru: 'Ногти', ro: 'Unghii' }, parentId: 'cat-makeup' },
	{ id: 'cat-makeup-face', slug: 'face', name: { ru: 'Лицо', ro: 'Față' }, parentId: 'cat-makeup' },
	{ id: 'cat-makeup-lips', slug: 'lips', name: { ru: 'Губы', ro: 'Buze' }, parentId: 'cat-makeup' },
	{ id: 'cat-skincare', slug: 'skincare', name: { ru: 'Уход за кожей', ro: 'Îngrijirea pielii' }, parentId: null },
	{ id: 'cat-skincare-face', slug: 'face-care', name: { ru: 'Уход за лицом', ro: 'Îngrijire facială' }, parentId: 'cat-skincare' },
	{ id: 'cat-haircare', slug: 'haircare', name: { ru: 'Уход за волосами', ro: 'Îngrijirea părului' }, parentId: null },
	{ id: 'cat-haircare-shampoo', slug: 'shampoo', name: { ru: 'Шампуни', ro: 'Șampoane' }, parentId: 'cat-haircare' }
]

export const categoryGroupToRootId: Record<ProductCategoryGroup, string> = {
	perfume: 'cat-perfume',
	makeup: 'cat-makeup',
	skincare: 'cat-skincare',
	haircare: 'cat-haircare'
}

export function findCategoryById(id: string): Category | undefined {
	return mockCategories.find(c => c.id === id)
}

export function findCategoryBySlug(slug: string): Category | undefined {
	return mockCategories.find(c => c.slug === slug)
}
