import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthVariables } from '../../../auth/middleware'
import {
	getVariantById,
	getVariantWithStockById,
	updateVariant,
	upsertVariantInventory,
	upsertVariantPrice,
	type VariantWithStock
} from '../../../db/queries/admin-variants'
import { ok } from '../../../lib/respond'
import { idParamSchema, validateJson, validateParam } from '../../../lib/validate'
import { AppError } from '../../../middleware/error-handler'
import { syncProductToIndex } from '../../../search/sync'

const updateVariantSchema = z.object({
	sku: z.string().min(1).max(100).optional(),
	barcode: z.string().min(1).max(100).nullable().optional(),
	nameRu: z.string().nullable().optional(),
	nameRo: z.string().nullable().optional(),
	isActive: z.boolean().optional(),
	sortOrder: z.number().int().optional()
})

const setPriceSchema = z.object({
	price: z.number().int().min(0),
	compareAtPrice: z.number().int().min(0).nullable().optional(),
	currency: z.literal('MDL').optional()
})

const setInventorySchema = z.object({
	quantityOnHand: z.number().int().min(0)
})

function serializeVariant(variant: VariantWithStock) {
	return {
		id: variant.id,
		productId: variant.productId,
		sku: variant.sku,
		barcode: variant.barcode,
		nameRu: variant.nameRu,
		nameRo: variant.nameRo,
		isActive: variant.isActive,
		sortOrder: variant.sortOrder,
		price: variant.price,
		compareAtPrice: variant.compareAtPrice,
		currency: variant.currency,
		quantityOnHand: variant.quantityOnHand,
		quantityReserved: variant.quantityReserved,
		createdAt: variant.createdAt,
		updatedAt: variant.updatedAt
	}
}

async function syncAfterWrite(productId: string) {
	const outcome = await syncProductToIndex(productId)
	if (outcome.status === 'error') {
		console.error(`[admin] search sync failed for product ${productId}:`, outcome.message)
	}
}

export const adminVariantsRoute = new Hono<{ Variables: AuthVariables }>()
	.get('/:id', validateParam(idParamSchema), async c => {
		const { id } = c.req.valid('param')
		const variant = await getVariantWithStockById(id)
		if (!variant) throw new AppError('Variant not found', 404, 'variant_not_found')
		return ok(c, serializeVariant(variant))
	})
	.patch('/:id', validateParam(idParamSchema), validateJson(updateVariantSchema), async c => {
		const { id } = c.req.valid('param')
		const body = c.req.valid('json')

		const existing = await getVariantById(id)
		if (!existing) throw new AppError('Variant not found', 404, 'variant_not_found')

		await updateVariant(id, body)
		await syncAfterWrite(existing.productId)

		const variant = await getVariantWithStockById(id)
		return ok(c, serializeVariant(variant!))
	})
	.put('/:id/price', validateParam(idParamSchema), validateJson(setPriceSchema), async c => {
		const { id } = c.req.valid('param')
		const body = c.req.valid('json')

		const existing = await getVariantById(id)
		if (!existing) throw new AppError('Variant not found', 404, 'variant_not_found')

		await upsertVariantPrice(id, body)
		await syncAfterWrite(existing.productId)

		const variant = await getVariantWithStockById(id)
		return ok(c, serializeVariant(variant!))
	})
	.put('/:id/inventory', validateParam(idParamSchema), validateJson(setInventorySchema), async c => {
		const { id } = c.req.valid('param')
		const { quantityOnHand } = c.req.valid('json')

		const existing = await getVariantById(id)
		if (!existing) throw new AppError('Variant not found', 404, 'variant_not_found')

		await upsertVariantInventory(id, quantityOnHand)
		await syncAfterWrite(existing.productId)

		const variant = await getVariantWithStockById(id)
		return ok(c, serializeVariant(variant!))
	})

export type AdminVariantsRouteType = typeof adminVariantsRoute
