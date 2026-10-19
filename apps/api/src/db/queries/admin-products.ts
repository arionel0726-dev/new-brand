import { and, asc, count, eq } from 'drizzle-orm'
import { db } from '../client'
import { productCategories } from '../schema/product-categories'
import { productPrices } from '../schema/product-prices'
import { productVariants } from '../schema/product-variants'
import { products, type productStatusEnum } from '../schema/products'
import type { Pagination } from '../../lib/pagination'
import { AppError } from '../../middleware/error-handler'

export type ProductRow = typeof products.$inferSelect
export type ProductStatus = (typeof productStatusEnum.enumValues)[number]

export type AdminProductListFilters = {
	status?: ProductStatus
	brandId?: string
}

function buildFilters(filters: AdminProductListFilters) {
	const conditions = []
	if (filters.status) conditions.push(eq(products.status, filters.status))
	if (filters.brandId) conditions.push(eq(products.brandId, filters.brandId))
	return conditions.length > 0 ? and(...conditions) : undefined
}

export async function listAdminProducts(pagination: Pagination, filters: AdminProductListFilters) {
	const where = buildFilters(filters)

	const [items, totalRows] = await Promise.all([
		db
			.select()
			.from(products)
			.where(where)
			.orderBy(asc(products.createdAt))
			.limit(pagination.limit)
			.offset((pagination.page - 1) * pagination.limit),
		db.select({ count: count() }).from(products).where(where)
	])

	return { items, total: totalRows[0]?.count ?? 0 }
}

export async function getAdminProductById(
	id: string
): Promise<{ product: ProductRow; categoryIds: string[] } | null> {
	const [product] = await db.select().from(products).where(eq(products.id, id)).limit(1)
	if (!product) return null

	const categoryRows = await db
		.select({ categoryId: productCategories.categoryId })
		.from(productCategories)
		.where(eq(productCategories.productId, id))

	return { product, categoryIds: categoryRows.map(row => row.categoryId) }
}

export type CreateProductInput = {
	brandId?: string | null
	slug: string
	nameRu: string
	nameRo: string
	descriptionRu?: string | null
	descriptionRo?: string | null
	categoryIds?: string[]
}

/** New products always start as 'draft', regardless of anything a client might send - there is no way to create a product already published. */
export async function createProduct(
	input: CreateProductInput
): Promise<{ product: ProductRow; categoryIds: string[] }> {
	const { categoryIds, ...productFields } = input

	return db.transaction(async tx => {
		const [product] = await tx
			.insert(products)
			.values({ ...productFields, status: 'draft' })
			.returning()

		if (categoryIds && categoryIds.length > 0) {
			await tx
				.insert(productCategories)
				.values(categoryIds.map(categoryId => ({ productId: product.id, categoryId })))
		}

		return { product, categoryIds: categoryIds ?? [] }
	})
}

/** The reasons (if any) a product currently cannot be transitioned to 'active'. Empty = ready to publish. */
function computeBlockers(
	product: Pick<ProductRow, 'nameRu' | 'nameRo' | 'slug' | 'brandId'>,
	categoryCount: number,
	hasSellableVariant: boolean
): string[] {
	const blockers: string[] = []
	if (!product.nameRu.trim()) blockers.push('missing_name_ru')
	if (!product.nameRo.trim()) blockers.push('missing_name_ro')
	if (!product.slug.trim()) blockers.push('missing_slug')
	if (!product.brandId) blockers.push('missing_brand')
	if (categoryCount === 0) blockers.push('missing_categories')
	if (!hasSellableVariant) blockers.push('missing_sellable_variant')
	return blockers
}

export type UpdateProductInput = Partial<CreateProductInput> & { status?: ProductStatus }

/**
 * Applies field/category changes and an optional status transition in a
 * single transaction - if the status is moving to 'active' and the product
 * isn't ready (see computeBlockers), the whole update (including any field
 * and category changes bundled into the same request) is rolled back rather
 * than partially applied.
 */
export async function updateProduct(
	id: string,
	input: UpdateProductInput
): Promise<{ product: ProductRow; categoryIds: string[] } | null> {
	return db.transaction(async tx => {
		const [existing] = await tx.select().from(products).where(eq(products.id, id)).limit(1)
		if (!existing) return null

		const { categoryIds, status, ...fields } = input

		if (Object.keys(fields).length > 0) {
			await tx
				.update(products)
				.set({ ...fields, updatedAt: new Date() })
				.where(eq(products.id, id))
		}

		if (categoryIds !== undefined) {
			await tx.delete(productCategories).where(eq(productCategories.productId, id))
			if (categoryIds.length > 0) {
				await tx
					.insert(productCategories)
					.values(categoryIds.map(categoryId => ({ productId: id, categoryId })))
			}
		}

		if (status !== undefined && status !== existing.status) {
			if (status === 'active') {
				const [current] = await tx.select().from(products).where(eq(products.id, id)).limit(1)
				const categoryCountRows = await tx
					.select({ count: count() })
					.from(productCategories)
					.where(eq(productCategories.productId, id))
				const [sellableVariant] = await tx
					.select({ id: productVariants.id })
					.from(productVariants)
					.innerJoin(productPrices, eq(productPrices.variantId, productVariants.id))
					.where(and(eq(productVariants.productId, id), eq(productVariants.isActive, true)))
					.limit(1)

				const blockers = computeBlockers(
					current,
					categoryCountRows[0]?.count ?? 0,
					Boolean(sellableVariant)
				)
				if (blockers.length > 0) {
					throw new AppError('Product is not ready to publish', 422, 'publish_not_ready', {
						blockers
					})
				}
			}

			await tx
				.update(products)
				.set({ status, updatedAt: new Date() })
				.where(eq(products.id, id))
		}

		const [updated] = await tx.select().from(products).where(eq(products.id, id)).limit(1)
		const categoryRows = await tx
			.select({ categoryId: productCategories.categoryId })
			.from(productCategories)
			.where(eq(productCategories.productId, id))

		return { product: updated, categoryIds: categoryRows.map(row => row.categoryId) }
	})
}
