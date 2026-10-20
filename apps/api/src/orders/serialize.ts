import type { OrderItemRow, OrderRow } from '../db/queries/orders'
import type { PaymentRow } from '../db/queries/payments'
import { localize, type Locale } from '../lib/locale'

export function serializeOrderItem(item: OrderItemRow, lang: Locale) {
	return {
		id: item.id,
		productId: item.productId,
		variantId: item.variantId,
		sku: item.skuSnapshot,
		productName: localize(lang, item.productNameRuSnapshot, item.productNameRoSnapshot),
		variantName: localize(lang, item.variantNameRuSnapshot, item.variantNameRoSnapshot),
		quantity: item.quantity,
		unitPrice: item.unitPrice,
		lineTotal: item.lineTotal,
		promotionId: item.promotionId,
		discountAmount: item.discountAmount,
		netLineTotal: item.lineTotal - item.discountAmount
	}
}

export function serializePayment(payment: PaymentRow) {
	return {
		id: payment.id,
		method: payment.method,
		status: payment.status,
		amount: payment.amount,
		refundedAmount: payment.refundedAmount,
		currency: payment.currency,
		provider: payment.provider,
		createdAt: payment.createdAt,
		updatedAt: payment.updatedAt
	}
}

function serializeDelivery(order: OrderRow) {
	if (order.deliveryMethod === 'pickup') {
		return { method: 'pickup' as const, pickupLocationId: order.pickupLocationId }
	}
	if (order.deliveryMethod === 'courier') {
		return {
			method: 'courier' as const,
			deliveryZoneId: order.deliveryZoneId,
			recipientName: order.recipientName,
			recipientPhone: order.recipientPhone,
			city: order.deliveryCity,
			street: order.deliveryStreet,
			house: order.deliveryHouse,
			apartment: order.deliveryApartment,
			notes: order.deliveryNotes
		}
	}
	// A Sprint 6 order, created before delivery existed - still readable.
	return null
}

export function serializeOrder(
	order: OrderRow,
	items: OrderItemRow[] | undefined,
	lang: Locale,
	payments?: PaymentRow[]
) {
	return {
		id: order.id,
		orderNumber: order.orderNumber,
		status: order.status,
		currency: order.currency,
		subtotalAmount: order.subtotalAmount,
		discountAmount: order.discountAmount,
		promotionDiscountAmount: order.promotionDiscountAmount,
		couponDiscountAmount: order.couponDiscountAmount,
		couponCode: order.couponCodeSnapshot,
		shippingAmount: order.shippingAmount,
		totalAmount: order.totalAmount,
		customerName: order.customerName,
		customerEmail: order.customerEmail,
		customerPhone: order.customerPhone,
		customerNote: order.customerNote,
		paymentMethod: order.paymentMethod,
		delivery: serializeDelivery(order),
		payments: payments?.map(serializePayment),
		items: items?.map(item => serializeOrderItem(item, lang)),
		createdAt: order.createdAt,
		updatedAt: order.updatedAt,
		cancelledAt: order.cancelledAt
	}
}
