import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthVariables } from '../../../auth/middleware'
import {
	createCoupon,
	getAdminCouponById,
	getCouponScope,
	listAdminCoupons,
	updateCoupon,
	type CouponRow
} from '../../../db/queries/admin-coupons'
import { buildPageMeta, paginationSchema } from '../../../lib/pagination'
import { okWithMeta, ok } from '../../../lib/respond'
import { idParamSchema, validateJson, validateParam, validateQuery } from '../../../lib/validate'
import { AppError } from '../../../middleware/error-handler'

const scopeSchema = z.object({
	productIds: z.array(z.string().uuid()).optional(),
	brandIds: z.array(z.string().uuid()).optional(),
	categoryIds: z.array(z.string().uuid()).optional()
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

const createCouponSchema = z
	.object({
		code: z.string().trim().min(1).max(64),
		isActive: z.boolean().optional(),
		startsAt: z.coerce.date().nullable().optional(),
		endsAt: z.coerce.date().nullable().optional(),
		minOrderAmount: z.number().int().nonnegative().nullable().optional(),
		maxTotalUses: z.number().int().positive().nullable().optional(),
		maxUsesPerCustomer: z.number().int().positive().nullable().optional(),
		scope: scopeSchema.optional()
	})
	.and(discountFieldsSchema)

const updateCouponSchema = z.object({
	code: z.string().trim().min(1).max(64).optional(),
	discountType: z.enum(['percentage', 'fixed_amount']).optional(),
	percentageValue: z.number().int().min(1).max(100).nullable().optional(),
	fixedAmount: z.number().int().positive().nullable().optional(),
	isActive: z.boolean().optional(),
	startsAt: z.coerce.date().nullable().optional(),
	endsAt: z.coerce.date().nullable().optional(),
	minOrderAmount: z.number().int().nonnegative().nullable().optional(),
	maxTotalUses: z.number().int().positive().nullable().optional(),
	maxUsesPerCustomer: z.number().int().positive().nullable().optional(),
	scope: scopeSchema.optional()
})

const listQuerySchema = paginationSchema.extend({
	isActive: z
		.enum(['true', 'false'])
		.transform(value => value === 'true')
		.optional()
})

async function serializeCoupon(coupon: CouponRow) {
	const scope = await getCouponScope(coupon.id)
	return {
		id: coupon.id,
		code: coupon.code,
		discountType: coupon.discountType,
		percentageValue: coupon.percentageValue,
		fixedAmount: coupon.fixedAmount,
		isActive: coupon.isActive,
		startsAt: coupon.startsAt,
		endsAt: coupon.endsAt,
		minOrderAmount: coupon.minOrderAmount,
		maxTotalUses: coupon.maxTotalUses,
		// Read-only here - never accepted from the request body (Task 6).
		usesCount: coupon.usesCount,
		maxUsesPerCustomer: coupon.maxUsesPerCustomer,
		scope,
		createdAt: coupon.createdAt,
		updatedAt: coupon.updatedAt
	}
}

export const adminCouponsRoute = new Hono<{ Variables: AuthVariables }>()
	.get('/', validateQuery(listQuerySchema), async c => {
		const query = c.req.valid('query')
		const { items, total } = await listAdminCoupons(
			{ page: query.page, limit: query.limit },
			{ isActive: query.isActive }
		)
		const data = await Promise.all(items.map(serializeCoupon))
		return okWithMeta(c, data, buildPageMeta({ page: query.page, limit: query.limit }, total))
	})
	.get('/:id', validateParam(idParamSchema), async c => {
		const { id } = c.req.valid('param')
		const coupon = await getAdminCouponById(id)
		if (!coupon) throw new AppError('Coupon not found', 404, 'coupon_not_found')
		return ok(c, await serializeCoupon(coupon))
	})
	.post('/', validateJson(createCouponSchema), async c => {
		const body = c.req.valid('json')
		const coupon = await createCoupon(body)
		return ok(c, await serializeCoupon(coupon), 201)
	})
	.patch('/:id', validateParam(idParamSchema), validateJson(updateCouponSchema), async c => {
		const { id } = c.req.valid('param')
		const body = c.req.valid('json')
		const coupon = await updateCoupon(id, body)
		if (!coupon) throw new AppError('Coupon not found', 404, 'coupon_not_found')
		return ok(c, await serializeCoupon(coupon))
	})
	// Deactivate-only "delete" - see src/routes/v1/admin/promotions.ts for why
	// (coupon_redemptions.coupon_id is onDelete: 'restrict' for the same reason).
	.post('/:id/deactivate', validateParam(idParamSchema), async c => {
		const { id } = c.req.valid('param')
		const coupon = await updateCoupon(id, { isActive: false })
		if (!coupon) throw new AppError('Coupon not found', 404, 'coupon_not_found')
		return ok(c, await serializeCoupon(coupon))
	})

export type AdminCouponsRouteType = typeof adminCouponsRoute
