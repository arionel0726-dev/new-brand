import type { Product } from '@/types/catalog'

function img(seed: string, n: number) {
	return Array.from({ length: n }, (_, i) => `https://picsum.photos/seed/${seed}-${i}/900/1125`)
}

/**
 * Sprint 11 mock product catalog (12-20 SKUs across Perfume/Makeup/
 * Skincare/Haircare). Every record is invented demo data EXCEPT the Anny
 * nail-polish group below, which reproduces the real A10.XXX fixture
 * verified against legacy sources in Sprint 10A.1
 * (docs/legacy-reference/legacy-feed-samples.json): ID_nom 10568/10516/
 * 10559, ColorVar 396/253/369.50, VolumeVar "15", Barcode
 * 4051761201249/4051761201232/4051761202772, Price 170 (MDL major units ->
 * 17000 bani), Brand "Anny", VariativeName "NAIL POLISH ANNY". PriceWH (85)
 * is a warehouse-only field and is intentionally never exposed here.
 */
export const mockProducts: Product[] = [
	// --- Source-confirmed fixture (Sprint 10A.1 ANNY A10.XXX group) ---
	{
		id: 'product-anny-a10-xxx',
		legacyGroupId: 'A10.XXX',
		slug: { ru: 'anny-nail-polish', ro: 'anny-nail-polish' },
		name: { ru: 'NAIL POLISH ANNY', ro: 'NAIL POLISH ANNY' },
		description: {
			ru: 'Лак для ногтей Anny, объём 15 мл. Насыщенное покрытие, доступно в нескольких оттенках.',
			ro: 'Lac de unghii Anny, volum 15 ml. Acoperire intensă, disponibil în mai multe nuanțe.'
		},
		brandId: 'brand-anny',
		categoryGroup: 'makeup',
		categoryId: 'cat-makeup-nails',
		images: img('anny-nail-polish', 3),
		isNew: false,
		isHit: true,
		seo: { titleRu: null, descriptionRu: null },
		sourceConfirmed: true,
		variants: [
			{
				id: 'variant-anny-10568',
				sku: '10568',
				idNom: '10568',
				barcode: '4051761201249',
				label: '396',
				colorVar: '396',
				volumeVar: '15',
				priceBani: 17000,
				compareAtPriceBani: null,
				quantityOnHand: 0,
				imageUrl: img('anny-nail-polish-396', 1)[0]
			},
			{
				id: 'variant-anny-10516',
				sku: '10516',
				idNom: '10516',
				barcode: '4051761201232',
				label: '253',
				colorVar: '253',
				volumeVar: '15',
				priceBani: 17000,
				compareAtPriceBani: null,
				quantityOnHand: 0,
				imageUrl: img('anny-nail-polish-253', 1)[0]
			},
			{
				id: 'variant-anny-10559',
				sku: '10559',
				idNom: '10559',
				barcode: '4051761202772',
				label: '369.50',
				colorVar: '369.50',
				volumeVar: '15',
				priceBani: 17000,
				compareAtPriceBani: null,
				quantityOnHand: 0,
				imageUrl: img('anny-nail-polish-369-50', 1)[0]
			}
		]
	},

	// --- Invented demo data below (clearly not source-confirmed) ---
	{
		id: 'product-lumeri-noir',
		legacyGroupId: null,
		slug: { ru: 'lumeri-noir-essence', ro: 'lumeri-noir-essence' },
		name: { ru: 'Lumeri Noir Essence', ro: 'Lumeri Noir Essence' },
		description: {
			ru: 'Парфюмерная вода с нотами чёрного перца, кедра и амбры.',
			ro: 'Apă de parfum cu note de piper negru, cedru și chihlimbar.'
		},
		brandId: 'brand-lumeri',
		categoryGroup: 'perfume',
		categoryId: 'cat-perfume-eau-de-parfum',
		images: img('lumeri-noir', 4),
		isNew: true,
		isHit: false,
		seo: { titleRu: null, descriptionRu: null },
		sourceConfirmed: false,
		variants: [
			{
				id: 'variant-lumeri-noir-50',
				sku: 'LUM-NOIR-50',
				barcode: null,
				label: '50 мл',
				colorVar: null,
				volumeVar: '50',
				priceBani: 89000,
				compareAtPriceBani: null,
				quantityOnHand: 14,
				imageUrl: null
			},
			{
				id: 'variant-lumeri-noir-100',
				sku: 'LUM-NOIR-100',
				barcode: null,
				label: '100 мл',
				colorVar: null,
				volumeVar: '100',
				priceBani: 139000,
				compareAtPriceBani: null,
				quantityOnHand: 7,
				imageUrl: null
			}
		]
	},
	{
		id: 'product-lumeri-fleur',
		legacyGroupId: null,
		slug: { ru: 'lumeri-fleur-blanche', ro: 'lumeri-fleur-blanche' },
		name: { ru: 'Lumeri Fleur Blanche', ro: 'Lumeri Fleur Blanche' },
		description: {
			ru: 'Светлый цветочный аромат с жасмином и белым мускусом.',
			ro: 'Parfum floral luminos cu iasomie și mosc alb.'
		},
		brandId: 'brand-lumeri',
		categoryGroup: 'perfume',
		categoryId: 'cat-perfume-eau-de-parfum',
		images: img('lumeri-fleur', 3),
		isNew: false,
		isHit: false,
		seo: { titleRu: null, descriptionRu: null },
		sourceConfirmed: false,
		variants: [
			{
				id: 'variant-lumeri-fleur-50',
				sku: 'LUM-FLEUR-50',
				barcode: null,
				label: '50 мл',
				colorVar: null,
				volumeVar: '50',
				priceBani: 79000,
				compareAtPriceBani: 95000,
				quantityOnHand: 21,
				imageUrl: null
			}
		]
	},
	{
		id: 'product-lumeri-ambre',
		legacyGroupId: null,
		slug: { ru: 'lumeri-ambre-doree', ro: 'lumeri-ambre-doree' },
		name: { ru: 'Lumeri Ambre Dorée', ro: 'Lumeri Ambre Dorée' },
		description: {
			ru: 'Тёплый янтарный аромат с ванилью и сандалом.',
			ro: 'Parfum cald de chihlimbar cu vanilie și santal.'
		},
		brandId: 'brand-lumeri',
		categoryGroup: 'perfume',
		categoryId: 'cat-perfume-eau-de-parfum',
		images: img('lumeri-ambre', 3),
		isNew: false,
		isHit: false,
		seo: { titleRu: null, descriptionRu: null },
		sourceConfirmed: false,
		variants: [
			{
				id: 'variant-lumeri-ambre-100',
				sku: 'LUM-AMBRE-100',
				barcode: null,
				label: '100 мл',
				colorVar: null,
				volumeVar: '100',
				priceBani: 99000,
				compareAtPriceBani: null,
				quantityOnHand: 0,
				imageUrl: null
			}
		]
	},
	{
		id: 'product-velvetine-lipstick',
		legacyGroupId: null,
		slug: { ru: 'velvetine-matte-lipstick', ro: 'velvetine-matte-lipstick' },
		name: { ru: 'Velvetine Matte Lipstick', ro: 'Velvetine Matte Lipstick' },
		description: {
			ru: 'Матовая помада с бархатистым финишем и длительной стойкостью.',
			ro: 'Ruj mat cu finisaj catifelat și rezistență îndelungată.'
		},
		brandId: 'brand-velvetine',
		categoryGroup: 'makeup',
		categoryId: 'cat-makeup-lips',
		images: img('velvetine-lipstick', 3),
		isNew: false,
		isHit: true,
		seo: { titleRu: null, descriptionRu: null },
		sourceConfirmed: false,
		variants: [
			{ id: 'variant-velvetine-rouge', sku: 'VLV-LIP-ROUGE', barcode: null, label: 'Rouge', colorVar: 'Rouge', volumeVar: null, priceBani: 24000, compareAtPriceBani: null, quantityOnHand: 32, imageUrl: null },
			{ id: 'variant-velvetine-nude', sku: 'VLV-LIP-NUDE', barcode: null, label: 'Nude', colorVar: 'Nude', volumeVar: null, priceBani: 24000, compareAtPriceBani: null, quantityOnHand: 18, imageUrl: null },
			{ id: 'variant-velvetine-berry', sku: 'VLV-LIP-BERRY', barcode: null, label: 'Berry', colorVar: 'Berry', volumeVar: null, priceBani: 24000, compareAtPriceBani: null, quantityOnHand: 0, imageUrl: null }
		]
	},
	{
		id: 'product-velvetine-blush',
		legacyGroupId: null,
		slug: { ru: 'velvetine-silk-blush', ro: 'velvetine-silk-blush' },
		name: { ru: 'Velvetine Silk Blush', ro: 'Velvetine Silk Blush' },
		description: {
			ru: 'Компактные румяна с шелковистой текстурой и естественным сиянием.',
			ro: 'Fard de obraz compact cu textură mătăsoasă și strălucire naturală.'
		},
		brandId: 'brand-velvetine',
		categoryGroup: 'makeup',
		categoryId: 'cat-makeup-face',
		images: img('velvetine-blush', 2),
		isNew: true,
		isHit: false,
		seo: { titleRu: null, descriptionRu: null },
		sourceConfirmed: false,
		variants: [
			{ id: 'variant-velvetine-blush-peach', sku: 'VLV-BLS-PEACH', barcode: null, label: 'Peach', colorVar: 'Peach', volumeVar: null, priceBani: 29500, compareAtPriceBani: null, quantityOnHand: 11, imageUrl: null },
			{ id: 'variant-velvetine-blush-rose', sku: 'VLV-BLS-ROSE', barcode: null, label: 'Rose', colorVar: 'Rose', volumeVar: null, priceBani: 29500, compareAtPriceBani: null, quantityOnHand: 9, imageUrl: null }
		]
	},
	{
		id: 'product-matiere-foundation',
		legacyGroupId: null,
		slug: { ru: 'matiere-skin-tint', ro: 'matiere-skin-tint' },
		name: { ru: 'Matière Skin Tint', ro: 'Matière Skin Tint' },
		description: {
			ru: 'Лёгкий тональный флюид с эффектом второй кожи, 6 оттенков.',
			ro: 'Fluid tonal ușor, efect de a doua piele, 6 nuanțe.'
		},
		brandId: 'brand-matiere',
		categoryGroup: 'makeup',
		categoryId: 'cat-makeup-face',
		images: img('matiere-tint', 3),
		isNew: false,
		isHit: false,
		seo: { titleRu: null, descriptionRu: null },
		sourceConfirmed: false,
		variants: [
			{ id: 'variant-matiere-tint-10', sku: 'MAT-TINT-10', barcode: null, label: '10', colorVar: '10', volumeVar: '30', priceBani: 42000, compareAtPriceBani: null, quantityOnHand: 15, imageUrl: null },
			{ id: 'variant-matiere-tint-20', sku: 'MAT-TINT-20', barcode: null, label: '20', colorVar: '20', volumeVar: '30', priceBani: 42000, compareAtPriceBani: null, quantityOnHand: 15, imageUrl: null },
			{ id: 'variant-matiere-tint-30', sku: 'MAT-TINT-30', barcode: null, label: '30', colorVar: '30', volumeVar: '30', priceBani: 42000, compareAtPriceBani: null, quantityOnHand: 4, imageUrl: null }
		]
	},
	{
		id: 'product-matiere-mascara',
		legacyGroupId: null,
		slug: { ru: 'matiere-volume-mascara', ro: 'matiere-volume-mascara' },
		name: { ru: 'Matière Volume Mascara', ro: 'Matière Volume Mascara' },
		description: {
			ru: 'Объёмная тушь для ресниц без комочков, стойкая формула.',
			ro: 'Rimel pentru volum, fără aglomerări, formulă rezistentă.'
		},
		brandId: 'brand-matiere',
		categoryGroup: 'makeup',
		categoryId: 'cat-makeup-face',
		images: img('matiere-mascara', 2),
		isNew: false,
		isHit: true,
		seo: { titleRu: null, descriptionRu: null },
		sourceConfirmed: false,
		variants: [
			{ id: 'variant-matiere-mascara-black', sku: 'MAT-MSC-BLK', barcode: null, label: 'Black', colorVar: 'Black', volumeVar: null, priceBani: 19500, compareAtPriceBani: 23000, quantityOnHand: 40, imageUrl: null }
		]
	},
	{
		id: 'product-claire-serum',
		legacyGroupId: null,
		slug: { ru: 'claire-derme-hydra-serum', ro: 'claire-derme-hydra-serum' },
		name: { ru: 'Claire Derme Hydra Serum', ro: 'Claire Derme Hydra Serum' },
		description: {
			ru: 'Увлажняющая сыворотка с гиалуроновой кислотой для всех типов кожи.',
			ro: 'Ser hidratant cu acid hialuronic pentru toate tipurile de piele.'
		},
		brandId: 'brand-claire-derme',
		categoryGroup: 'skincare',
		categoryId: 'cat-skincare-face',
		images: img('claire-serum', 3),
		isNew: true,
		isHit: true,
		seo: { titleRu: null, descriptionRu: null },
		sourceConfirmed: false,
		variants: [
			{ id: 'variant-claire-serum-30', sku: 'CLD-SER-30', barcode: null, label: '30 мл', colorVar: null, volumeVar: '30', priceBani: 56000, compareAtPriceBani: null, quantityOnHand: 26, imageUrl: null }
		]
	},
	{
		id: 'product-claire-cream',
		legacyGroupId: null,
		slug: { ru: 'claire-derme-night-cream', ro: 'claire-derme-night-cream' },
		name: { ru: 'Claire Derme Night Cream', ro: 'Claire Derme Night Cream' },
		description: {
			ru: 'Восстанавливающий ночной крем с пептидами и церамидами.',
			ro: 'Cremă de noapte regenerantă cu peptide și ceramide.'
		},
		brandId: 'brand-claire-derme',
		categoryGroup: 'skincare',
		categoryId: 'cat-skincare-face',
		images: img('claire-cream', 3),
		isNew: false,
		isHit: false,
		seo: { titleRu: null, descriptionRu: null },
		sourceConfirmed: false,
		variants: [
			{ id: 'variant-claire-cream-50', sku: 'CLD-CRM-50', barcode: null, label: '50 мл', colorVar: null, volumeVar: '50', priceBani: 68000, compareAtPriceBani: 79000, quantityOnHand: 12, imageUrl: null }
		]
	},
	{
		id: 'product-claire-cleanser',
		legacyGroupId: null,
		slug: { ru: 'claire-derme-gentle-cleanser', ro: 'claire-derme-gentle-cleanser' },
		name: { ru: 'Claire Derme Gentle Cleanser', ro: 'Claire Derme Gentle Cleanser' },
		description: {
			ru: 'Мягкий очищающий гель без сульфатов для чувствительной кожи.',
			ro: 'Gel de curățare blând, fără sulfați, pentru piele sensibilă.'
		},
		brandId: 'brand-claire-derme',
		categoryGroup: 'skincare',
		categoryId: 'cat-skincare-face',
		images: img('claire-cleanser', 2),
		isNew: false,
		isHit: false,
		seo: { titleRu: null, descriptionRu: null },
		sourceConfirmed: false,
		variants: [
			{ id: 'variant-claire-cleanser-150', sku: 'CLD-CLN-150', barcode: null, label: '150 мл', colorVar: null, volumeVar: '150', priceBani: 34000, compareAtPriceBani: null, quantityOnHand: 33, imageUrl: null }
		]
	},
	{
		id: 'product-nordhair-shampoo',
		legacyGroupId: null,
		slug: { ru: 'nordhair-birch-shampoo', ro: 'nordhair-birch-shampoo' },
		name: { ru: 'NordHair Birch Shampoo', ro: 'NordHair Birch Shampoo' },
		description: {
			ru: 'Укрепляющий шампунь с экстрактом берёзы для ослабленных волос.',
			ro: 'Șampon fortifiant cu extract de mesteacăn pentru păr fragilizat.'
		},
		brandId: 'brand-nordhair',
		categoryGroup: 'haircare',
		categoryId: 'cat-haircare-shampoo',
		images: img('nordhair-shampoo', 2),
		isNew: false,
		isHit: false,
		seo: { titleRu: null, descriptionRu: null },
		sourceConfirmed: false,
		variants: [
			{ id: 'variant-nordhair-shampoo-250', sku: 'NRD-SHP-250', barcode: null, label: '250 мл', colorVar: null, volumeVar: '250', priceBani: 27500, compareAtPriceBani: null, quantityOnHand: 48, imageUrl: null }
		]
	},
	{
		id: 'product-nordhair-oil',
		legacyGroupId: null,
		slug: { ru: 'nordhair-repair-oil', ro: 'nordhair-repair-oil' },
		name: { ru: 'NordHair Repair Oil', ro: 'NordHair Repair Oil' },
		description: {
			ru: 'Восстанавливающее масло для кончиков волос с аргановым маслом.',
			ro: 'Ulei reparator pentru vârfurile părului, cu ulei de argan.'
		},
		brandId: 'brand-nordhair',
		categoryGroup: 'haircare',
		categoryId: 'cat-haircare-shampoo',
		images: img('nordhair-oil', 2),
		isNew: true,
		isHit: false,
		seo: { titleRu: null, descriptionRu: null },
		sourceConfirmed: false,
		variants: [
			{ id: 'variant-nordhair-oil-100', sku: 'NRD-OIL-100', barcode: null, label: '100 мл', colorVar: null, volumeVar: '100', priceBani: 36500, compareAtPriceBani: null, quantityOnHand: 17, imageUrl: null }
		]
	},
	{
		id: 'product-nordhair-mask',
		legacyGroupId: null,
		slug: { ru: 'nordhair-deep-mask', ro: 'nordhair-deep-mask' },
		name: { ru: 'NordHair Deep Mask', ro: 'NordHair Deep Mask' },
		description: {
			ru: 'Глубоко питающая маска для сухих и повреждённых волос.',
			ro: 'Mască profund hrănitoare pentru păr uscat și deteriorat.'
		},
		brandId: 'brand-nordhair',
		categoryGroup: 'haircare',
		categoryId: 'cat-haircare-shampoo',
		images: img('nordhair-mask', 2),
		isNew: false,
		isHit: true,
		seo: { titleRu: null, descriptionRu: null },
		sourceConfirmed: false,
		variants: [
			{ id: 'variant-nordhair-mask-200', sku: 'NRD-MSK-200', barcode: null, label: '200 мл', colorVar: null, volumeVar: '200', priceBani: 41000, compareAtPriceBani: 48000, quantityOnHand: 0, imageUrl: null }
		]
	}
]
