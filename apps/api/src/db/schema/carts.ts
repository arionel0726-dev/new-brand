import { sql } from 'drizzle-orm'
import {
	check,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uuid
} from 'drizzle-orm/pg-core'
import { user } from './auth'
import { productVariants } from './product-variants'

// 'merged' exists for forward compatibility (e.g. keeping a record instead of
// deleting on merge later) but this sprint always deletes a guest cart once
// its items have been merged into a user's cart - see
// src/db/queries/cart.ts's mergeGuestCartIntoUserCart.
export const cartStatusEnum = pgEnum('cart_status', ['active', 'merged'])

export const carts = pgTable(
	'carts',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		// Exactly one of userId/guestTokenHash is ever set - enforced below.
		userId: uuid('user_id')
			.unique()
			.references(() => user.id, { onDelete: 'cascade' }),
		// sha256 of the random token issued in the guest cart's HttpOnly cookie.
		// The raw token is never stored - only ever sent to the browser.
		guestTokenHash: text('guest_token_hash').unique(),
		status: cartStatusEnum('status').notNull().default('active'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		check(
			'carts_exactly_one_owner_check',
			sql`(${table.userId} is not null) <> (${table.guestTokenHash} is not null)`
		)
	]
)

export const cartItems = pgTable(
	'cart_items',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		cartId: uuid('cart_id')
			.notNull()
			.references(() => carts.id, { onDelete: 'cascade' }),
		variantId: uuid('variant_id')
			.notNull()
			.references(() => productVariants.id, { onDelete: 'cascade' }),
		quantity: integer('quantity').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		index('cart_items_cart_id_idx').on(table.cartId),
		unique('cart_items_cart_id_variant_id_unique').on(table.cartId, table.variantId),
		check('cart_items_quantity_positive_check', sql`${table.quantity} > 0`),
		// Mirrors MAX_CART_ITEM_QUANTITY in src/cart/constants.ts - a DB-level
		// backstop, not the source of truth (that's the app constant).
		check('cart_items_quantity_max_check', sql`${table.quantity} <= 99`)
	]
)
