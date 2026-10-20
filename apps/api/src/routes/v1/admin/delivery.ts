import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthVariables } from '../../../auth/middleware'
import {
	createDeliveryZone,
	createPickupLocation,
	getDeliveryZoneById,
	getPickupLocationById,
	listAllDeliveryZones,
	listAllPickupLocations,
	updateDeliveryZone,
	updatePickupLocation,
	type DeliveryZoneRow,
	type PickupLocationRow
} from '../../../db/queries/admin-delivery'
import { ok } from '../../../lib/respond'
import { idParamSchema, validateJson, validateParam } from '../../../lib/validate'
import { AppError } from '../../../middleware/error-handler'

const codeSchema = z
	.string()
	.min(1)
	.max(100)
	.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'code must be lowercase, numbers and single hyphens only')

const createZoneSchema = z.object({
	code: codeSchema,
	nameRu: z.string().min(1).max(200),
	nameRo: z.string().min(1).max(200),
	isActive: z.boolean().optional(),
	// This sprint never invents a real fee - staff enter the actual business figure.
	feeAmount: z.number().int().min(0),
	minOrderAmount: z.number().int().min(0).nullable().optional(),
	freeThresholdAmount: z.number().int().min(0).nullable().optional(),
	sortOrder: z.number().int().optional()
})
const updateZoneSchema = createZoneSchema.partial()

const createPickupSchema = z.object({
	code: codeSchema,
	nameRu: z.string().min(1).max(200),
	nameRo: z.string().min(1).max(200),
	// A real staff-entered address - never a hardcoded/invented one.
	address: z.string().min(1).max(500),
	isActive: z.boolean().optional(),
	sortOrder: z.number().int().optional()
})
const updatePickupSchema = createPickupSchema.partial()

function serializeZone(zone: DeliveryZoneRow) {
	return {
		id: zone.id,
		code: zone.code,
		nameRu: zone.nameRu,
		nameRo: zone.nameRo,
		isActive: zone.isActive,
		feeAmount: zone.feeAmount,
		minOrderAmount: zone.minOrderAmount,
		freeThresholdAmount: zone.freeThresholdAmount,
		sortOrder: zone.sortOrder,
		createdAt: zone.createdAt,
		updatedAt: zone.updatedAt
	}
}

function serializePickupLocation(location: PickupLocationRow) {
	return {
		id: location.id,
		code: location.code,
		nameRu: location.nameRu,
		nameRo: location.nameRo,
		address: location.address,
		isActive: location.isActive,
		sortOrder: location.sortOrder,
		createdAt: location.createdAt,
		updatedAt: location.updatedAt
	}
}

export const adminDeliveryZonesRoute = new Hono<{ Variables: AuthVariables }>()
	.get('/', async c => {
		const zones = await listAllDeliveryZones()
		return ok(c, zones.map(serializeZone))
	})
	.get('/:id', validateParam(idParamSchema), async c => {
		const { id } = c.req.valid('param')
		const zone = await getDeliveryZoneById(id)
		if (!zone) throw new AppError('Delivery zone not found', 404, 'delivery_zone_not_found')
		return ok(c, serializeZone(zone))
	})
	.post('/', validateJson(createZoneSchema), async c => {
		const body = c.req.valid('json')
		const zone = await createDeliveryZone(body)
		return ok(c, serializeZone(zone), 201)
	})
	.patch('/:id', validateParam(idParamSchema), validateJson(updateZoneSchema), async c => {
		const { id } = c.req.valid('param')
		const body = c.req.valid('json')
		const zone = await updateDeliveryZone(id, body)
		if (!zone) throw new AppError('Delivery zone not found', 404, 'delivery_zone_not_found')
		return ok(c, serializeZone(zone))
	})

export const adminPickupLocationsRoute = new Hono<{ Variables: AuthVariables }>()
	.get('/', async c => {
		const locations = await listAllPickupLocations()
		return ok(c, locations.map(serializePickupLocation))
	})
	.get('/:id', validateParam(idParamSchema), async c => {
		const { id } = c.req.valid('param')
		const location = await getPickupLocationById(id)
		if (!location) throw new AppError('Pickup location not found', 404, 'pickup_location_not_found')
		return ok(c, serializePickupLocation(location))
	})
	.post('/', validateJson(createPickupSchema), async c => {
		const body = c.req.valid('json')
		const location = await createPickupLocation(body)
		return ok(c, serializePickupLocation(location), 201)
	})
	.patch('/:id', validateParam(idParamSchema), validateJson(updatePickupSchema), async c => {
		const { id } = c.req.valid('param')
		const body = c.req.valid('json')
		const location = await updatePickupLocation(id, body)
		if (!location) throw new AppError('Pickup location not found', 404, 'pickup_location_not_found')
		return ok(c, serializePickupLocation(location))
	})

export type AdminDeliveryZonesRouteType = typeof adminDeliveryZonesRoute
export type AdminPickupLocationsRouteType = typeof adminPickupLocationsRoute
