import { asc, eq } from 'drizzle-orm'
import { db } from '../client'
import { productImages } from '../schema/product-images'

export type ImageRow = typeof productImages.$inferSelect

export type CreateImageInput = {
	productId: string
	variantId?: string | null
	url: string
	objectKey?: string | null
	mimeType?: string | null
	fileSize?: number | null
	width?: number | null
	height?: number | null
	altRu?: string | null
	altRo?: string | null
	sortOrder?: number
}

export async function createImage(input: CreateImageInput): Promise<ImageRow> {
	const [row] = await db.insert(productImages).values(input).returning()
	return row
}

export async function listImagesForProduct(productId: string): Promise<ImageRow[]> {
	return db
		.select()
		.from(productImages)
		.where(eq(productImages.productId, productId))
		.orderBy(asc(productImages.sortOrder), asc(productImages.createdAt))
}

export async function getImageById(id: string): Promise<ImageRow | null> {
	const [row] = await db.select().from(productImages).where(eq(productImages.id, id)).limit(1)
	return row ?? null
}

export type UpdateImageInput = {
	altRu?: string | null
	altRo?: string | null
	variantId?: string | null
	sortOrder?: number
}

export async function updateImage(id: string, input: UpdateImageInput): Promise<ImageRow | null> {
	const [row] = await db.update(productImages).set(input).where(eq(productImages.id, id)).returning()
	return row ?? null
}

/** Returns the deleted row (so the caller has its objectKey for the R2 cleanup step) or null if it didn't exist. */
export async function deleteImage(id: string): Promise<ImageRow | null> {
	const [row] = await db.delete(productImages).where(eq(productImages.id, id)).returning()
	return row ?? null
}

/**
 * Sets sortOrder = position in `orderedImageIds` for every one of them, in a
 * single transaction. Validates every id actually belongs to `productId`
 * first so one product's reorder request can't silently touch another
 * product's images.
 */
export async function reorderImages(productId: string, orderedImageIds: string[]): Promise<void> {
	await db.transaction(async tx => {
		const rows = await tx
			.select({ id: productImages.id })
			.from(productImages)
			.where(eq(productImages.productId, productId))

		const validIds = new Set(rows.map(row => row.id))
		const requestedIds = new Set(orderedImageIds)

		if (
			orderedImageIds.length !== validIds.size ||
			![...requestedIds].every(id => validIds.has(id))
		) {
			throw new Error('ORDER_MISMATCH')
		}

		await Promise.all(
			orderedImageIds.map((id, index) =>
				tx.update(productImages).set({ sortOrder: index }).where(eq(productImages.id, id))
			)
		)
	})
}
