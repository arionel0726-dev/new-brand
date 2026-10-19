import { asc, eq } from 'drizzle-orm'
import { db } from '../client'
import { inventory } from '../schema/inventory'
import { productPrices } from '../schema/product-prices'
import { productVariants } from '../schema/product-variants'

export type VariantRow = typeof productVariants.$inferSelect
export type PriceRow = typeof productPrices.$inferSelect
export type InventoryRow = typeof inventory.$inferSelect

export type VariantWithStock = VariantRow & {
	price: number | null
	compareAtPrice: number | null
	currency: string | null
	quantityOnHand: number | null
	quantityReserved: number | null
}

function variantWithStockQuery() {
	return db
		.select({
			id: productVariants.id,
			productId: productVariants.productId,
			sku: productVariants.sku,
			barcode: productVariants.barcode,
			nameRu: productVariants.nameRu,
			nameRo: productVariants.nameRo,
			isActive: productVariants.isActive,
			sortOrder: productVariants.sortOrder,
			createdAt: productVariants.createdAt,
			updatedAt: productVariants.updatedAt,
			price: productPrices.price,
			compareAtPrice: productPrices.compareAtPrice,
			currency: productPrices.currency,
			quantityOnHand: inventory.quantityOnHand,
			quantityReserved: inventory.quantityReserved
		})
		.from(productVariants)
		.leftJoin(productPrices, eq(productPrices.variantId, productVariants.id))
		.leftJoin(inventory, eq(inventory.variantId, productVariants.id))
}

/** All variants for a product - active and inactive, priced and unpriced alike (unlike the public API). */
export async function listVariantsForProduct(productId: string): Promise<VariantWithStock[]> {
	return variantWithStockQuery()
		.where(eq(productVariants.productId, productId))
		.orderBy(asc(productVariants.sortOrder), asc(productVariants.createdAt))
}

export async function getVariantWithStockById(id: string): Promise<VariantWithStock | null> {
	const [row] = await variantWithStockQuery().where(eq(productVariants.id, id)).limit(1)
	return row ?? null
}

export async function getVariantById(id: string): Promise<VariantRow | null> {
	const [row] = await db.select().from(productVariants).where(eq(productVariants.id, id)).limit(1)
	return row ?? null
}

export type CreateVariantInput = {
	sku: string
	barcode?: string | null
	nameRu?: string | null
	nameRo?: string | null
	isActive?: boolean
	sortOrder?: number
}

export async function createVariantForProduct(
	productId: string,
	input: CreateVariantInput
): Promise<VariantRow> {
	const [row] = await db
		.insert(productVariants)
		.values({ productId, ...input })
		.returning()
	return row
}

export type UpdateVariantInput = Partial<CreateVariantInput>

export async function updateVariant(
	id: string,
	input: UpdateVariantInput
): Promise<VariantRow | null> {
	const [row] = await db
		.update(productVariants)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(productVariants.id, id))
		.returning()
	return row ?? null
}

export type UpsertPriceInput = {
	price: number
	compareAtPrice?: number | null
	currency?: string
}

export async function upsertVariantPrice(
	variantId: string,
	input: UpsertPriceInput
): Promise<PriceRow> {
	const values = { variantId, ...input }
	const [row] = await db
		.insert(productPrices)
		.values(values)
		.onConflictDoUpdate({
			target: productPrices.variantId,
			set: { ...input, updatedAt: new Date() }
		})
		.returning()
	return row
}

/**
 * Sets quantityOnHand only - quantityReserved is never writable from this
 * endpoint (it stays whatever it already was, 0 by default; reservation
 * will be driven by the future order system). The DB CHECK constraint
 * (quantity_reserved <= quantity_on_hand) is what actually stops the stock
 * from being set below what's already reserved - it surfaces as a clean
 * 400 via the centralized error handler rather than needing a duplicate
 * check here.
 */
export async function upsertVariantInventory(
	variantId: string,
	quantityOnHand: number
): Promise<InventoryRow> {
	const [row] = await db
		.insert(inventory)
		.values({ variantId, quantityOnHand })
		.onConflictDoUpdate({
			target: inventory.variantId,
			set: { quantityOnHand, updatedAt: new Date() }
		})
		.returning()
	return row
}
