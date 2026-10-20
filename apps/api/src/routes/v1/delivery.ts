import { Hono } from 'hono'
import { asc, eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { deliveryZones, pickupLocations } from '../../db/schema/delivery'
import { ok } from '../../lib/respond'

/** Public, active-only views of staff-configured delivery options - a shopper needs these ids to call checkout/shipping-quote or POST /orders. */
export const deliveryRoute = new Hono()
	.get('/zones', async c => {
		const rows = await db
			.select()
			.from(deliveryZones)
			.where(eq(deliveryZones.isActive, true))
			.orderBy(asc(deliveryZones.sortOrder), asc(deliveryZones.nameRu))

		return ok(
			c,
			rows.map(zone => ({
				id: zone.id,
				code: zone.code,
				nameRu: zone.nameRu,
				nameRo: zone.nameRo,
				feeAmount: zone.feeAmount,
				minOrderAmount: zone.minOrderAmount,
				freeThresholdAmount: zone.freeThresholdAmount
			}))
		)
	})
	.get('/pickup-locations', async c => {
		const rows = await db
			.select()
			.from(pickupLocations)
			.where(eq(pickupLocations.isActive, true))
			.orderBy(asc(pickupLocations.sortOrder), asc(pickupLocations.nameRu))

		return ok(
			c,
			rows.map(location => ({
				id: location.id,
				code: location.code,
				nameRu: location.nameRu,
				nameRo: location.nameRo,
				address: location.address
			}))
		)
	})

export type DeliveryRouteType = typeof deliveryRoute
