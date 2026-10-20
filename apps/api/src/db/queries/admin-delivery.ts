import { asc, eq } from 'drizzle-orm'
import { db } from '../client'
import { deliveryZones, pickupLocations } from '../schema/delivery'

export type DeliveryZoneRow = typeof deliveryZones.$inferSelect
export type PickupLocationRow = typeof pickupLocations.$inferSelect

export type CreateDeliveryZoneInput = {
	code: string
	nameRu: string
	nameRo: string
	isActive?: boolean
	feeAmount: number
	minOrderAmount?: number | null
	freeThresholdAmount?: number | null
	sortOrder?: number
}
export type UpdateDeliveryZoneInput = Partial<CreateDeliveryZoneInput>

export async function listAllDeliveryZones(): Promise<DeliveryZoneRow[]> {
	return db.select().from(deliveryZones).orderBy(asc(deliveryZones.sortOrder), asc(deliveryZones.nameRu))
}

export async function getDeliveryZoneById(id: string): Promise<DeliveryZoneRow | null> {
	const [row] = await db.select().from(deliveryZones).where(eq(deliveryZones.id, id)).limit(1)
	return row ?? null
}

export async function createDeliveryZone(input: CreateDeliveryZoneInput): Promise<DeliveryZoneRow> {
	const [row] = await db.insert(deliveryZones).values(input).returning()
	return row
}

export async function updateDeliveryZone(id: string, input: UpdateDeliveryZoneInput): Promise<DeliveryZoneRow | null> {
	const [row] = await db.update(deliveryZones).set(input).where(eq(deliveryZones.id, id)).returning()
	return row ?? null
}

export type CreatePickupLocationInput = {
	code: string
	nameRu: string
	nameRo: string
	address: string
	isActive?: boolean
	sortOrder?: number
}
export type UpdatePickupLocationInput = Partial<CreatePickupLocationInput>

export async function listAllPickupLocations(): Promise<PickupLocationRow[]> {
	return db.select().from(pickupLocations).orderBy(asc(pickupLocations.sortOrder), asc(pickupLocations.nameRu))
}

export async function getPickupLocationById(id: string): Promise<PickupLocationRow | null> {
	const [row] = await db.select().from(pickupLocations).where(eq(pickupLocations.id, id)).limit(1)
	return row ?? null
}

export async function createPickupLocation(input: CreatePickupLocationInput): Promise<PickupLocationRow> {
	const [row] = await db.insert(pickupLocations).values(input).returning()
	return row
}

export async function updatePickupLocation(
	id: string,
	input: UpdatePickupLocationInput
): Promise<PickupLocationRow | null> {
	const [row] = await db.update(pickupLocations).set(input).where(eq(pickupLocations.id, id)).returning()
	return row ?? null
}
