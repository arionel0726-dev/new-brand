/** Max units of a single variant in one cart line. Mirrored by a DB check constraint on cart_items.quantity - see src/db/schema/carts.ts. */
export const MAX_CART_ITEM_QUANTITY = 99
