import type { OrderItemRow, OrderRow } from '../db/queries/orders'
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
		lineTotal: item.lineTotal
	}
}

export function serializeOrder(order: OrderRow, items: OrderItemRow[] | undefined, lang: Locale) {
	return {
		id: order.id,
		orderNumber: order.orderNumber,
		status: order.status,
		currency: order.currency,
		subtotalAmount: order.subtotalAmount,
		discountAmount: order.discountAmount,
		shippingAmount: order.shippingAmount,
		totalAmount: order.totalAmount,
		customerName: order.customerName,
		customerEmail: order.customerEmail,
		customerPhone: order.customerPhone,
		customerNote: order.customerNote,
		// Always null in Sprint 6 - see src/db/schema/orders.ts.
		deliveryMethod: order.deliveryMethod,
		paymentMethod: order.paymentMethod,
		items: items?.map(item => serializeOrderItem(item, lang)),
		createdAt: order.createdAt,
		updatedAt: order.updatedAt,
		cancelledAt: order.cancelledAt
	}
}
