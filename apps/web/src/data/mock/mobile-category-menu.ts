import type { Locale } from '@/i18n/config'

export type MobileCategoryMenuItem = {
	id: string
	labelKey: 'catalog' | 'brands' | 'newArrivals' | 'discounts' | 'flacon' | 'teens' | 'tamagotchi' | 'giftCards' | 'discountUpTo'
	href: (locale: Locale) => string
	visual: 'plain' | 'flacon' | 'flower' | 'tamagotchi' | 'gift' | 'discount'
	trailing?: boolean
}

/**
 * Presentation-only mobile menu entries. Product/category data continues to
 * come from the existing catalog layer; the editorial promo entries are
 * intentionally marked here as mock UI until the API exposes them.
 */
export const mobileCategoryMenuItems: MobileCategoryMenuItem[] = [
	{ id: 'catalog', labelKey: 'catalog', href: locale => `/${locale}/catalog`, visual: 'plain', trailing: true },
	{ id: 'brands', labelKey: 'brands', href: locale => `/${locale}/brands`, visual: 'plain' },
	{ id: 'new-arrivals', labelKey: 'newArrivals', href: locale => `/${locale}/catalog?sort=newest`, visual: 'plain' },
	{ id: 'discounts', labelKey: 'discounts', href: locale => `/${locale}/catalog?discount=1`, visual: 'plain' },
	{ id: 'flacon', labelKey: 'flacon', href: locale => `/${locale}/catalog`, visual: 'flacon' },
	{ id: 'teens', labelKey: 'teens', href: locale => `/${locale}/catalog`, visual: 'flower' },
	{ id: 'tamagotchi', labelKey: 'tamagotchi', href: locale => `/${locale}/catalog`, visual: 'tamagotchi' },
	{ id: 'gift-cards', labelKey: 'giftCards', href: locale => `/${locale}/catalog`, visual: 'gift', trailing: true },
	{ id: 'discount-up-to', labelKey: 'discountUpTo', href: locale => `/${locale}/catalog?discount=1`, visual: 'discount', trailing: true }
]
