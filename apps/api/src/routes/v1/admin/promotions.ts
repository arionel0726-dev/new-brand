import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthVariables } from '../../../auth/middleware'
import {
	createPromotion,
	getAdminPromotionById,
	getPromotionScope,
	listAdminPromotions,
	updatePromotion,
	type PromotionRow
} from '../../../db/queries/admin-promotions'
import { buildPageMeta, paginationSchema } from '../../../lib/pagination'
import { okWithMeta, ok } from '../../../lib/respond'
import { idParamSchema, validateJson, validateParam, validateQuery } from '../../../lib/validate'
import { AppError } from '../../../middleware/error-handler'

const scopeSchema = z.object({
	productIds: z.array(z.string().uuid()).optional(),
	brandIds: z.array(z.string().uuid()).optional(),
	categoryIds: z.array(z.string().uuid()).optional(),
	excludedProductIds: z.array(z.string().uuid()).optional()
})

const discountFieldsSchema = z
	.object({
		discountType: z.enum(['percentage', 'fixed_amount']),
		percentageValue: z.number().int().min(1).max(100).optional(),
		fixedAmount: z.number().int().positive().optional()
	})
	.refine(
		value =>
			(value.discountType === 'percentage' && value.percentageValue !== undefined && value.fixedAmount === undefined) ||
			(value.discountType === 'fixed_amount' && value.fixedAmount !== undefined && value.percentageValue === undefined),
		{ message: 'percentageValue is required for percentage discounts, fixedAmount for fixed_amount discounts' }
	)

const createPromotionSchema = z
	.object({
		name: z.string().trim().min(1).max(200),
		nameRu: z.string().trim().min(1).nullable().optional(),
		nameRo: z.string().trim().min(1).nullable().optional(),
		maxDiscountAmount: z.number().int().nonnegative().nullable().optional(),
		isActive: z.boolean().optional(),
		startsAt: z.coerce.date().nullable().optional(),
		endsAt: z.coerce.date().nullable().optional(),
		priority: z.number().int().optional(),
		maxTotalRedemptions: z.number().int().positive().nullable().optional(),
		scope: scopeSchema.optional()
	})
	.and(discountFieldsSchema)

const updatePromotionSchema = z.object({
	name: z.string().trim().min(1).max(200).optional(),
	nameRu: z.string().trim().min(1).nullable().optional(),
	nameRo: z.string().trim().min(1).nullable().optional(),
	discountType: z.enum(['percentage', 'fixed_amount']).optional(),
	percentageValue: z.number().int().min(1).max(100).nullable().optional(),
	fixedAmount: z.number().int().positive().nullable().optional(),
	maxDiscountAmount: z.number().int().nonnegative().nullable().optional(),
	isActive: z.boolean().optional(),
	startsAt: z.coerce.date().nullable().optional(),
	endsAt: z.coerce.date().nullable().optional(),
	priority: z.number().int().optional(),
	maxTotalRedemptions: z.number().int().positive().nullable().optional(),
	scope: scopeSchema.optional()
})

const listQuerySchema = paginationSchema.extend({
	isActive: z
		.enum(['true', 'false'])
		.transform(value => value === 'true')
		.optional()
})

async function serializePromotion(promotion: PromotionRow) {
	const scope = await getPromotionScope(promotion.id)
	return {
		id: promotion.id,
		name: promotion.name,
		nameRu: promotion.nameRu,
		nameRo: promotion.nameRo,
		discountType: promotion.discountType,
		percentageValue: promotion.percentageValue,
		fixedAmount: promotion.fixedAmount,
		maxDiscountAmount: promotion.maxDiscountAmount,
		isActive: promotion.isActive,
		startsAt: promotion.startsAt,
		endsAt: promotion.endsAt,
		priority: promotion.priority,
		maxTotalRedemptions: promotion.maxTotalRedemptions,
		// Read-only here - never accepted from the request body (Task 6).
		redemptionCount: promotion.redemptionCount,
		scope,
		createdAt: promotion.createdAt,
		updatedAt: promotion.updatedAt
	}
}

export const adminPromotionsRoute = new Hono<{ Variables: AuthVariables }>()
	.get('/', validateQuery(listQuerySchema), async c => {
		const query = c.req.valid('query')
		const { items, total } = await listAdminPromotions(
			{ page: query.page, limit: query.limit },
			{ isActive: query.isActive }
		)
		const data = await Promise.all(items.map(serializePromotion))
		return okWithMeta(c, data, buildPageMeta({ page: query.page, limit: query.limit }, total))
	})
	.get('/:id', validateParam(idParamSchema), async c => {
		const { id } = c.req.valid('param')
		const promotion = await getAdminPromotionById(id)
		if (!promotion) throw new AppError('Promotion not found', 404, 'promotion_not_found')
		return ok(c, await serializePromotion(promotion))
	})
	.post('/', validateJson(createPromotionSchema), async c => {
		const body = c.req.valid('json')
		const promotion = await createPromotion(body)
		return ok(c, await serializePromotion(promotion), 201)
	})
	.patch('/:id', validateParam(idParamSchema), validateJson(updatePromotionSchema), async c => {
		const { id } = c.req.valid('param')
		const body = c.req.valid('json')
		const promotion = await updatePromotion(id, body)
		if (!promotion) throw new AppError('Promotion not found', 404, 'promotion_not_found')
		return ok(c, await serializePromotion(promotion))
	})
	// Deactivate-only "delete": physical deletion would orphan the historical
	// discount snapshot on any order_item that already used this promotion
	// (enforced at the DB level too - order_items.promotion_id is
	// onDelete: 'restrict').
	.post('/:id/deactivate', validateParam(idParamSchema), async c => {
		const { id } = c.req.valid('param')
		const promotion = await updatePromotion(id, { isActive: false })
		if (!promotion) throw new AppError('Promotion not found', 404, 'promotion_not_found')
		return ok(c, await serializePromotion(promotion))
	})

export type AdminPromotionsRouteType = typeof adminPromotionsRoute
