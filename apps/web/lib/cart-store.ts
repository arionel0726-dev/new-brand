'use client'

import { create } from 'zustand'

/**
 * Mock, client-only cart state (Sprint 11 - no real checkout/order
 * integration). Intentionally not persisted against any backend; a real
 * cart API call replaces this store's actions in a later sprint.
 */
type CartLine = { productId: string; variantId: string; quantity: number }

type CartState = {
	lines: CartLine[]
	add: (productId: string, variantId: string, quantity?: number) => void
	count: () => number
}

export const useCartStore = create<CartState>((set, get) => ({
	lines: [],
	add: (productId, variantId, quantity = 1) =>
		set(state => {
			const existing = state.lines.find(l => l.variantId === variantId)
			if (existing) {
				return { lines: state.lines.map(l => (l.variantId === variantId ? { ...l, quantity: l.quantity + quantity } : l)) }
			}
			return { lines: [...state.lines, { productId, variantId, quantity }] }
		}),
	count: () => get().lines.reduce((sum, l) => sum + l.quantity, 0)
}))
