import { z } from 'zod'

/**
 * Storefront-facing catalog types for Sprint 11's mock fixtures. Shapes are
 * kept consistent with apps/api's Drizzle schema (uuid id, RU/RO fields,
 * price as an integer in MDL bani) so swapping the fixture-backed data
 * layer for the real Hono catalog API later needs minimal change. Warehouse
 * identifiers (WarehouseName, PriceWH) are never exposed here - see
 * docs/vizaje-migration-architecture.md's field-ownership policy.
 */

export const localizedTextSchema = z.object({
	ru: z.string(),
	ro: z.string().nullable()
})
export type LocalizedText = z.infer<typeof localizedTextSchema>

export const categorySchema = z.object({
	id: z.string(),
	slug: z.string(),
	name: localizedTextSchema,
	parentId: z.string().nullable()
})
export type Category = z.infer<typeof categorySchema>

export const brandSchema = z.object({
	id: z.string(),
	slug: z.string(),
	name: z.string(),
	description: localizedTextSchema.nullable(),
	logoUrl: z.string().nullable()
})
export type Brand = z.infer<typeof brandSchema>

export const productVariantSchema = z.object({
	id: z.string(),
	sku: z.string(),
	/** Real legacy field names where a variant was sourced from the 1C feed - see idNom/colorVar/volumeVar below. */
	idNom: z.string().optional(),
	barcode: z.string().nullable(),
	/** Informational variant label shown in the picker, e.g. a shade name/number or a volume. */
	label: z.string(),
	colorVar: z.string().nullable(),
	volumeVar: z.string().nullable(),
	priceBani: z.number().int().positive(),
	compareAtPriceBani: z.number().int().positive().nullable(),
	quantityOnHand: z.number().int().nonnegative(),
	imageUrl: z.string().nullable()
})
export type ProductVariant = z.infer<typeof productVariantSchema>

export const productCategoryGroup = z.enum(['perfume', 'makeup', 'skincare', 'haircare'])
export type ProductCategoryGroup = z.infer<typeof productCategoryGroup>

export const productSchema = z.object({
	id: z.string(),
	/** Legacy VariativeNomenclature group id, e.g. "A10.XXX" - never a sellable SKU. */
	legacyGroupId: z.string().nullable(),
	slug: localizedTextSchema,
	name: localizedTextSchema,
	description: localizedTextSchema,
	brandId: z.string(),
	categoryGroup: productCategoryGroup,
	categoryId: z.string(),
	variants: z.array(productVariantSchema).min(1),
	images: z.array(z.string()).min(1),
	isNew: z.boolean(),
	isHit: z.boolean(),
	seo: z.object({
		titleRu: z.string().nullable(),
		descriptionRu: z.string().nullable()
	}),
	/**
	 * True only for the one fixture verified against real legacy source data
	 * in Sprint 10A.1 (the ANNY A10.XXX group). Every other product in this
	 * mock catalog is invented demo data and must never be presented as a
	 * real business record.
	 */
	sourceConfirmed: z.boolean()
})
export type Product = z.infer<typeof productSchema>

export const storeSchema = z.object({
	id: z.string(),
	city: z.string(),
	name: z.string(),
	address: z.string(),
	hours: z.string(),
	phone: z.string().nullable(),
	lat: z.number(),
	lng: z.number(),
	imageUrl: z.string().nullable(),
	/** Always true for Sprint 11 - see getStores(). Never presented as a real address. */
	isDevFixture: z.literal(true)
})
export type Store = z.infer<typeof storeSchema>

export type SortOption = 'newest' | 'price-asc' | 'price-desc' | 'name-asc'

export type CatalogFilters = {
	categoryGroup?: ProductCategoryGroup
	brandSlug?: string
	minPriceBani?: number
	maxPriceBani?: number
	inStockOnly?: boolean
	sort?: SortOption
	page?: number
	pageSize?: number
}
