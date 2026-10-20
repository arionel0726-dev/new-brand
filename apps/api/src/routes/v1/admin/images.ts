import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthVariables } from '../../../auth/middleware'
import {
	deleteImage,
	getImageById,
	updateImage,
	type ImageRow
} from '../../../db/queries/admin-images'
import { getVariantById } from '../../../db/queries/admin-variants'
import { ok } from '../../../lib/respond'
import { idParamSchema, validateJson, validateParam } from '../../../lib/validate'
import { AppError } from '../../../middleware/error-handler'
import { deleteObjectOrQueueCleanup } from './media'

const updateImageSchema = z.object({
	altRu: z.string().nullable().optional(),
	altRo: z.string().nullable().optional(),
	variantId: z.uuid().nullable().optional(),
	sortOrder: z.number().int().optional()
})

function serializeImage(image: ImageRow) {
	return {
		id: image.id,
		productId: image.productId,
		variantId: image.variantId,
		url: image.url,
		mimeType: image.mimeType,
		fileSize: image.fileSize,
		width: image.width,
		height: image.height,
		altRu: image.altRu,
		altRo: image.altRo,
		sortOrder: image.sortOrder,
		createdAt: image.createdAt
	}
}

export const adminImagesRoute = new Hono<{ Variables: AuthVariables }>()
	.patch('/:id', validateParam(idParamSchema), validateJson(updateImageSchema), async c => {
		const { id } = c.req.valid('param')
		const body = c.req.valid('json')

		const existing = await getImageById(id)
		if (!existing) throw new AppError('Image not found', 404, 'image_not_found')

		if (body.variantId) {
			const variant = await getVariantById(body.variantId)
			if (!variant) throw new AppError('Variant not found', 404, 'variant_not_found')
			if (variant.productId !== existing.productId) {
				throw new AppError(
					'Variant does not belong to the given image\'s product',
					400,
					'variant_product_mismatch'
				)
			}
		}

		const image = await updateImage(id, body)
		if (!image) throw new AppError('Image not found', 404, 'image_not_found')

		return ok(c, serializeImage(image))
	})
	.delete('/:id', validateParam(idParamSchema), async c => {
		const { id } = c.req.valid('param')

		const image = await deleteImage(id)
		if (!image) throw new AppError('Image not found', 404, 'image_not_found')

		if (image.objectKey) {
			await deleteObjectOrQueueCleanup(image.objectKey, 'image_deleted')
		}

		return ok(c, { id: image.id })
	})

export type AdminImagesRouteType = typeof adminImagesRoute
