import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { db } from '../client'
import type { DbOrTx, Tx } from '../tx'
import { generateOrderNumber } from '../../orders/order-number'
import { canTransitionOrderStatus } from '../../orders/status'
import { InsufficientStockError, reserveOrderInventory, releaseOrderInventory } from '../../orders/inventory'
import { computeShipping } from '../../checkout/shipping'
import { AppError } from '../../middleware/error-handler'
import type { Pagination } from '../../lib/pagination'
import { getPaymentProvider, isOnlinePaymentsConfigured } from '../../payments/provider'
import { normalizeCouponCode } from '../../coupons/normalize'
import { redeemCoupon } from '../../coupons/redeem'
import { validateCoupon, type CouponLine } from '../../coupons/validate'
import { computePromotionDiscounts, incrementPromotionRedemption, type LineDiscount } from '../../promotions/pricing'
import { carts, cartItems } from '../schema/carts'
import { inventory } from '../schema/inventory'
import type { PaymentMethod } from '../schema/payment-method'
import {
	orderAccessTokens,
	orderIdempotencyKeys,
	orderItems,
	orderStatusHistory,
	orders
} from '../schema/orders'
import { productPrices } from '../schema/product-prices'
import { productVariants } from '../schema/product-variants'
import { products } from '../schema/products'
import { createPayment } from './payments'

export type OrderRow = typeof orders.$inferSelect
export type OrderItemRow = typeof orderItems.$inferSelect
export type OrderStatusHistoryRow = typeof orderStatusHistory.$inferSelect

export type CartOwnerIdentity =
	| { type: 'user'; userId: string }
	| { type: 'guest'; guestTokenHash: string }

export type CheckoutLine = {
	variantId: string
	productId: string
	productStatus: string
	variantIsActive: boolean
	variantSku: string
	productNameRu: string
	productNameRo: string
	variantNameRu: string | null
	variantNameRo: string | null
	price: number | null
	quantity: number
	quantityOnHand: number | null
	quantityReserved: number | null
}

/**
 * The cart's lines, with everything checkout.preview/order creation need
 * to judge sellability and compute totals - joined with `tx` (not `db`)
 * so it runs inside the caller's own transaction and sees the row lock
 * already taken on the cart. A read-only twin of
 * src/db/queries/cart.ts's getCartItemDetails that exists only because
 * that one is hardcoded to the module-level `db`.
 */
export async function getCheckoutLines(dbOrTx: DbOrTx, cartId: string): Promise<CheckoutLine[]> {
	return dbOrTx
		.select({
			variantId: cartItems.variantId,
			quantity: cartItems.quantity,
			productId: products.id,
			productStatus: products.status,
			productNameRu: products.nameRu,
			productNameRo: products.nameRo,
			variantSku: productVariants.sku,
			variantNameRu: productVariants.nameRu,
			variantNameRo: productVariants.nameRo,
			variantIsActive: productVariants.isActive,
			price: productPrices.price,
			quantityOnHand: inventory.quantityOnHand,
			quantityReserved: inventory.quantityReserved
		})
		.from(cartItems)
		.innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
		.innerJoin(products, eq(products.id, productVariants.productId))
		.leftJoin(productPrices, eq(productPrices.variantId, productVariants.id))
		.leftJoin(inventory, eq(inventory.variantId, productVariants.id))
		.where(eq(cartItems.cartId, cartId))
		.orderBy(asc(cartItems.createdAt))
}

async function selectCartForUpdate(tx: Tx, cartOwner: CartOwnerIdentity) {
	if (cartOwner.type === 'user') {
		const [row] = await tx.select().from(carts).where(eq(carts.userId, cartOwner.userId)).for('update').limit(1)
		return row ?? null
	}
	const [row] = await tx
		.select()
		.from(carts)
		.where(and(eq(carts.guestTokenHash, cartOwner.guestTokenHash), eq(carts.status, 'active')))
		.for('update')
		.limit(1)
	return row ?? null
}

async function insertOrderWithUniqueNumber(
	tx: Tx,
	values: Omit<typeof orders.$inferInsert, 'orderNumber'>
): Promise<OrderRow> {
	for (let attempt = 0; attempt < 5; attempt++) {
		const [row] = await tx
			.insert(orders)
			.values({ ...values, orderNumber: generateOrderNumber() })
			.onConflictDoNothing({ target: orders.orderNumber })
			.returning()
		if (row) return row
	}
	throw new AppError('Failed to generate a unique order number', 500, 'internal_error')
}

function hashOrderAccessToken(token: string): string {
	return createHash('sha256').update(token).digest('hex')
}

/** Guest-only: an authenticated customer's session is already proof enough of ownership. Returns the raw token - only its hash is ever persisted. */
export async function createOrderAccessToken(tx: Tx, orderId: string): Promise<string> {
	const token = randomBytes(32).toString('base64url')
	await tx.insert(orderAccessTokens).values({ orderId, tokenHash: hashOrderAccessToken(token) })
	return token
}

/** Constant-time comparison - this is a bearer secret, so even the time taken to reject a wrong guess shouldn't leak information. */
export async function verifyOrderAccessToken(orderId: string, rawToken: string): Promise<boolean> {
	const [row] = await db.select().from(orderAccessTokens).where(eq(orderAccessTokens.orderId, orderId)).limit(1)
	if (!row) return false
	const candidate = Buffer.from(hashOrderAccessToken(rawToken))
	const stored = Buffer.from(row.tokenHash)
	if (candidate.length !== stored.length) return false
	return timingSafeEqual(candidate, stored)
}

export type DeliveryInput =
	| { method: 'pickup'; pickupLocationId: string }
	| {
			method: 'courier'
			deliveryZoneId: string
			recipientName: string
			recipientPhone: string
			city: string
			street: string
			house: string
			apartment: string | null
			notes: string | null
	  }

export type CreateOrderInput = {
	identityKey: string
	idempotencyKey: string
	requestHash: string
	cartOwner: CartOwnerIdentity
	customer: { name: string; email: string; phone: string; note: string | null }
	delivery: DeliveryInput
	paymentMethod: PaymentMethod
	/** The coupon code the shopper selected at checkout, if any - re-validated and redeemed from scratch here, never trusted from an earlier apply-coupon preview. */
	couponCode: string | null
}

export type CreateOrderResult =
	| { outcome: 'created'; order: OrderRow; accessToken: string | null }
	| { outcome: 'replayed'; order: OrderRow }

/**
 * The whole of Task 5 and Task 6: one transaction that claims the
 * idempotency key, locks and validates the cart, reserves stock, and
 * writes the order - or, on a legitimate replay, returns the order that a
 * prior call (by this same identity, with this same key and request body)
 * already created, without touching inventory again.
 *
 * Concurrency: a second request racing on the same (identityKey,
 * idempotencyKey) blocks on the unique index until the first commits or
 * rolls back (ordinary Postgres unique-constraint behavior under
 * concurrent inserts) - so there is never a window where two requests
 * both believe they're the one creating the order.
 */
export async function createOrderFromCart(input: CreateOrderInput): Promise<CreateOrderResult> {
	return db.transaction(async tx => {
		const [claimed] = await tx
			.insert(orderIdempotencyKeys)
			.values({
				identityKey: input.identityKey,
				idempotencyKey: input.idempotencyKey,
				requestHash: input.requestHash
			})
			.onConflictDoNothing({
				target: [orderIdempotencyKeys.identityKey, orderIdempotencyKeys.idempotencyKey]
			})
			.returning()

		if (!claimed) {
			const [existing] = await tx
				.select()
				.from(orderIdempotencyKeys)
				.where(
					and(
						eq(orderIdempotencyKeys.identityKey, input.identityKey),
						eq(orderIdempotencyKeys.idempotencyKey, input.idempotencyKey)
					)
				)
				.limit(1)
			if (!existing) {
				throw new AppError('Failed to process idempotency key', 500, 'internal_error')
			}
			if (existing.requestHash !== input.requestHash) {
				throw new AppError(
					'This idempotency key was already used with a different request',
					409,
					'idempotency_key_conflict'
				)
			}
			if (!existing.orderId) {
				// Unreachable in practice: a blocked insert only unblocks after the
				// owning transaction commits (orderId already set) or rolls back
				// (in which case this insert would have succeeded, not conflicted).
				throw new AppError('This order is still being created - try again shortly', 409, 'order_creation_in_progress')
			}
			const [order] = await tx.select().from(orders).where(eq(orders.id, existing.orderId)).limit(1)
			if (!order) {
				throw new AppError('Failed to load the previously created order', 500, 'internal_error')
			}
			return { outcome: 'replayed', order }
		}

		// Rejected before touching the cart or inventory at all - online
		// payments are unavailable until a real provider is implemented and
		// configured (Task 4). This is defense-in-depth: the route layer
		// rejects 'online' first, and UnavailableOnlineProvider itself would
		// also refuse below either way.
		if (input.paymentMethod === 'online' && !isOnlinePaymentsConfigured()) {
			throw new AppError('Online payment is not currently available', 422, 'online_payment_unavailable')
		}

		const cart = await selectCartForUpdate(tx, input.cartOwner)
		if (!cart) {
			throw new AppError('Your cart is empty', 422, 'cart_empty')
		}

		const lines = await getCheckoutLines(tx, cart.id)
		if (lines.length === 0) {
			throw new AppError('Your cart is empty', 422, 'cart_empty')
		}

		for (const line of lines) {
			if (line.productStatus !== 'active' || !line.variantIsActive || line.price === null) {
				throw new AppError(
					'One or more items in your cart are no longer available',
					422,
					'variant_not_available',
					{ variantId: line.variantId }
				)
			}
		}

		try {
			await reserveOrderInventory(
				tx,
				lines.map(line => ({ variantId: line.variantId, quantity: line.quantity }))
			)
		} catch (error) {
			if (error instanceof InsufficientStockError) {
				throw new AppError('Insufficient stock for one or more items', 409, 'insufficient_stock', {
					variantId: error.variantId
				})
			}
			throw error
		}

		const subtotalAmount = lines.reduce((sum, line) => sum + (line.price ?? 0) * line.quantity, 0)
		const userId = input.cartOwner.type === 'user' ? input.cartOwner.userId : null

		// Recomputed fresh, inside this same transaction, from the lines just
		// locked and validated above - never trusts an earlier checkout
		// preview or apply-coupon response (Task 5).
		const promotionDiscounts = await computePromotionDiscounts(
			tx,
			lines.map(line => ({
				variantId: line.variantId,
				productId: line.productId,
				unitPrice: line.price as number,
				quantity: line.quantity
			}))
		)

		// A promotion can be exhausted by a concurrent order between the
		// read-only pass above and this claim; per documented policy
		// (incrementPromotionRedemption), losing that race just drops this
		// line's discount rather than failing checkout.
		const claimedPromotions = new Map<string, boolean>()
		for (const discount of promotionDiscounts.values()) {
			if (!discount.promotionId || claimedPromotions.has(discount.promotionId)) continue
			claimedPromotions.set(discount.promotionId, await incrementPromotionRedemption(tx, discount.promotionId))
		}
		const appliedDiscounts = new Map<string, LineDiscount>()
		for (const [variantId, discount] of promotionDiscounts) {
			const claimed = discount.promotionId ? (claimedPromotions.get(discount.promotionId) ?? false) : false
			appliedDiscounts.set(
				variantId,
				claimed ? discount : { variantId, promotionId: null, discountAmount: 0 }
			)
		}

		const promotionDiscountTotal = [...appliedDiscounts.values()].reduce((sum, d) => sum + d.discountAmount, 0)
		const discountedSubtotal = subtotalAmount - promotionDiscountTotal

		let couponId: string | null = null
		let couponCodeSnapshot: string | null = null
		let couponDiscountAmount = 0
		if (input.couponCode) {
			const couponLines: CouponLine[] = lines.map(line => ({
				variantId: line.variantId,
				productId: line.productId,
				netAmount: (line.price as number) * line.quantity - (appliedDiscounts.get(line.variantId)?.discountAmount ?? 0)
			}))
			const result = await validateCoupon(tx, input.couponCode, {
				subtotalAmount: discountedSubtotal,
				lines: couponLines,
				userId
			})
			if (!result.ok) {
				throw new AppError(result.message, 422, result.code, {
					...(result.minOrderAmount !== undefined ? { minOrderAmount: result.minOrderAmount } : {})
				})
			}
			couponId = result.coupon.id
			couponCodeSnapshot = normalizeCouponCode(input.couponCode)
			couponDiscountAmount = result.discountAmount
		}

		const discountAmount = promotionDiscountTotal + couponDiscountAmount
		// Shipping's free-threshold comparison uses the subtotal after *every*
		// applicable discount - promotions and coupon alike (Task 5).
		const eligibleSubtotalForShipping = discountedSubtotal - couponDiscountAmount

		// Recomputed here, inside this same transaction, from the eligible
		// subtotal just computed above - a shipping-quote response the client
		// holds from an earlier call is never trusted (Task 3).
		const shippingSelection =
			input.delivery.method === 'pickup'
				? ({ method: 'pickup', pickupLocationId: input.delivery.pickupLocationId } as const)
				: ({ method: 'courier', deliveryZoneId: input.delivery.deliveryZoneId } as const)
		const shipping = await computeShipping(tx, shippingSelection, eligibleSubtotalForShipping)
		if (!shipping.ok) {
			throw new AppError(shipping.message, 422, shipping.code, { minOrderAmount: shipping.minOrderAmount })
		}

		const shippingAmount = shipping.fee
		const totalAmount = subtotalAmount - discountAmount + shippingAmount

		const order = await insertOrderWithUniqueNumber(tx, {
			userId,
			status: 'pending',
			subtotalAmount,
			discountAmount,
			promotionDiscountAmount: promotionDiscountTotal,
			couponDiscountAmount,
			couponId,
			couponCodeSnapshot,
			shippingAmount,
			totalAmount,
			customerName: input.customer.name,
			customerEmail: input.customer.email,
			customerPhone: input.customer.phone,
			customerNote: input.customer.note,
			deliveryMethod: input.delivery.method,
			paymentMethod: input.paymentMethod,
			...(input.delivery.method === 'pickup'
				? { pickupLocationId: input.delivery.pickupLocationId }
				: {
						deliveryZoneId: input.delivery.deliveryZoneId,
						recipientName: input.delivery.recipientName,
						recipientPhone: input.delivery.recipientPhone,
						deliveryCity: input.delivery.city,
						deliveryStreet: input.delivery.street,
						deliveryHouse: input.delivery.house,
						deliveryApartment: input.delivery.apartment,
						deliveryNotes: input.delivery.notes
					})
		})

		// Atomic with order creation (Task 5): claimed only now that the order
		// row exists, inside this same transaction - a retried/replayed
		// request never reaches here twice (the idempotency claim above
		// already returned 'replayed' before any of this runs), and losing
		// the race here rolls back the whole order, inventory reservation
		// included.
		if (couponId) {
			const redemption = await redeemCoupon(tx, couponId, userId, order.id, couponDiscountAmount)
			if (!redemption.ok) {
				throw new AppError(
					redemption.code === 'coupon_usage_limit_reached'
						? 'This coupon has reached its usage limit.'
						: 'You have already used this coupon the maximum number of times.',
					409,
					redemption.code
				)
			}
		}

		const provider = getPaymentProvider(input.paymentMethod)
		const initiated = await provider.initiatePayment({
			orderId: order.id,
			amount: totalAmount,
			currency: 'MDL'
		})
		await createPayment(tx, {
			orderId: order.id,
			method: input.paymentMethod,
			amount: totalAmount,
			provider: provider.code,
			externalReference: initiated.externalReference
		})

		await tx.insert(orderItems).values(
			lines.map(line => {
				const discount = appliedDiscounts.get(line.variantId)
				return {
					orderId: order.id,
					productId: line.productId,
					variantId: line.variantId,
					skuSnapshot: line.variantSku,
					productNameRuSnapshot: line.productNameRu,
					productNameRoSnapshot: line.productNameRo,
					variantNameRuSnapshot: line.variantNameRu,
					variantNameRoSnapshot: line.variantNameRo,
					quantity: line.quantity,
					unitPrice: line.price as number,
					lineTotal: (line.price as number) * line.quantity,
					promotionId: discount?.promotionId ?? null,
					discountAmount: discount?.discountAmount ?? 0
				}
			})
		)

		await tx.insert(orderStatusHistory).values({
			orderId: order.id,
			fromStatus: null,
			toStatus: 'pending',
			changedBy: input.cartOwner.type === 'user' ? input.cartOwner.userId : null,
			reason: 'Order created from cart'
		})

		let accessToken: string | null = null
		if (input.cartOwner.type === 'guest') {
			accessToken = await createOrderAccessToken(tx, order.id)
		}

		await tx
			.update(orderIdempotencyKeys)
			.set({ orderId: order.id })
			.where(eq(orderIdempotencyKeys.id, claimed.id))

		// Checkout spends the cart - cascades to its cart_items. The owner's
		// next GET /cart simply gets a brand-new, empty one (same pattern
		// Sprint 5's guest-cart merge already uses).
		await tx.delete(carts).where(eq(carts.id, cart.id))

		return { outcome: 'created', order, accessToken }
	})
}

export async function getOrderById(orderId: string): Promise<OrderRow | null> {
	const [row] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1)
	return row ?? null
}

export async function getOrderItemsForOrder(orderId: string): Promise<OrderItemRow[]> {
	return db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.createdAt))
}

export async function getOrderStatusHistoryForOrder(orderId: string): Promise<OrderStatusHistoryRow[]> {
	return db
		.select()
		.from(orderStatusHistory)
		.where(eq(orderStatusHistory.orderId, orderId))
		.orderBy(asc(orderStatusHistory.createdAt))
}

export async function listOrdersForUser(
	userId: string,
	pagination: Pagination
): Promise<{ items: OrderRow[]; total: number }> {
	const [items, totalRows] = await Promise.all([
		db
			.select()
			.from(orders)
			.where(eq(orders.userId, userId))
			.orderBy(desc(orders.createdAt), desc(orders.id))
			.limit(pagination.limit)
			.offset((pagination.page - 1) * pagination.limit),
		db.select({ count: sql<number>`count(*)::int` }).from(orders).where(eq(orders.userId, userId))
	])
	return { items, total: totalRows[0]?.count ?? 0 }
}

/**
 * The only self-service status transition in this sprint
 * (pending -> cancelled). The conditional UPDATE's WHERE clause is what
 * actually makes a repeat cancel a no-op (409, not a double release): a
 * second call finds status already 'cancelled', not 'pending', and
 * updates zero rows.
 */
export async function cancelPendingOrder(
	orderId: string,
	actorUserId: string | null,
	reason: string
): Promise<OrderRow> {
	if (!canTransitionOrderStatus('pending', 'cancelled')) {
		throw new AppError('Cancellation is not a valid transition', 500, 'internal_error')
	}

	return db.transaction(async tx => {
		const [updated] = await tx
			.update(orders)
			.set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
			.where(and(eq(orders.id, orderId), eq(orders.status, 'pending')))
			.returning()
		if (!updated) {
			throw new AppError(
				'Only a pending order can be cancelled by its customer',
				409,
				'order_not_cancellable'
			)
		}

		await releaseOrderInventory(tx, orderId)
		await tx.insert(orderStatusHistory).values({
			orderId,
			fromStatus: 'pending',
			toStatus: 'cancelled',
			changedBy: actorUserId,
			reason
		})

		return updated
	})
}
