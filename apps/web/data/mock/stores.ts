import type { Store } from '@/types/catalog'

/**
 * Development-only fixture locations. Sprint 11's spec explicitly forbids
 * inventing real VIZAJE-NICA store coordinates/addresses - every record
 * here is isDevFixture: true and must be rendered with a visible "not a
 * real address" notice (see stores page / stores.devDataNotice copy).
 */
export const mockStores: Store[] = [
	{
		id: 'store-dev-centru',
		city: 'Chișinău',
		name: 'VIZAJE-NICA — Centru (demo)',
		address: 'Fixture address — demonstration data only',
		hours: 'Пн–Вс 10:00–20:00',
		phone: null,
		lat: 47.0245,
		lng: 28.8322,
		imageUrl: null,
		isDevFixture: true
	},
	{
		id: 'store-dev-botanica',
		city: 'Chișinău',
		name: 'VIZAJE-NICA — Botanica (demo)',
		address: 'Fixture address — demonstration data only',
		hours: 'Пн–Вс 10:00–20:00',
		phone: null,
		lat: 46.9774,
		lng: 28.8396,
		imageUrl: null,
		isDevFixture: true
	},
	{
		id: 'store-dev-balti',
		city: 'Bălți',
		name: 'VIZAJE-NICA — Bălți (demo)',
		address: 'Fixture address — demonstration data only',
		hours: 'Пн–Сб 09:00–19:00',
		phone: null,
		lat: 47.7619,
		lng: 27.9294,
		imageUrl: null,
		isDevFixture: true
	}
]
