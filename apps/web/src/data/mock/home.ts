import type { ProductCategoryGroup } from '@/types/catalog'

/**
 * Local mock config for homepage sections. Figures here (free-delivery
 * threshold, hero copy) are placeholders for a real merchandising config -
 * never presented as a live promotional offer.
 */
export const freeDeliveryThresholdBani = 50000

export const heroSlides = [
	{
		id: 'hero-new-season',
		eyebrow: { ru: 'Новая коллекция', ro: 'Colecție nouă' },
		title: { ru: 'Красота в деталях', ro: 'Frumusețea stă în detalii' },
		subtitle: {
			ru: 'Парфюмерия, макияж и уход — тщательно отобранные бренды.',
			ro: 'Parfumerie, machiaj și îngrijire — branduri atent selectate.'
		},
		imageUrl: 'https://picsum.photos/seed/hero-1/1200/1500',
		href: { ru: '/ru/catalog', ro: '/ro/catalog' }
	},
	{
		id: 'hero-skincare',
		eyebrow: { ru: 'Уход за кожей', ro: 'Îngrijirea pielii' },
		title: { ru: 'Ритуал для кожи', ro: 'Un ritual pentru piele' },
		subtitle: {
			ru: 'Сыворотки и кремы для ежедневного ухода.',
			ro: 'Seruri și creme pentru îngrijirea zilnică.'
		},
		imageUrl: 'https://picsum.photos/seed/hero-2/1200/1500',
		href: { ru: '/ru/catalog?category=skincare', ro: '/ro/catalog?category=skincare' }
	}
] as const

export const featuredCategoryGroups: ProductCategoryGroup[] = ['perfume', 'makeup', 'skincare', 'haircare']
