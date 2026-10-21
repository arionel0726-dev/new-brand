import { sql } from 'drizzle-orm'
import { boolean, check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { products } from './products'

/**
 * Sprint 12B.1 - the redirect-history mechanism the legacy importer never
 * had. Forensic audit §8.3 (CONFIRMED): legacy `update_url()`/`url_chech()`
 * mutate `uri*` directly with no record of the prior value, and an old
 * numeric or title-SKU URL that no longer matches `products.uri$lang`
 * 404s with no fallback. This table exists so V2 can do the opposite: keep
 * every slug a product has ever had, resolve any of them, and redirect
 * instead of 404ing.
 *
 * `products.slug` stays the single source of "the current canonical
 * slug" for every existing read path - this table is additive, consulted
 * only when a direct lookup on `products.slug` misses, to attempt an
 * alias/redirect resolution before actually 404ing.
 */
export const productSlugAliases = pgTable(
	'product_slug_aliases',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		productId: uuid('product_id')
			.notNull()
			.references(() => products.id, { onDelete: 'cascade' }),
		locale: text('locale').notNull(),
		slug: text('slug').notNull(),
		// Exactly one canonical row per (productId, locale) is an
		// application-layer invariant (same deferred choice as
		// product_variant_barcodes.isPrimary) - not enforced here as a DB
		// constraint this sprint.
		isCanonical: boolean('is_canonical').notNull().default(false),
		// Audit trail only: 'legacy_numeric_uri' | 'legacy_title_sku_uri' | 'v2_generated' | ...
		source: text('source'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		index('product_slug_aliases_product_id_idx').on(table.productId),
		// A slug resolves to exactly one product within a locale, globally,
		// forever - this is what makes a redirect a redirect and not a
		// collision.
		unique('product_slug_aliases_locale_slug_unique').on(table.locale, table.slug),
		check('product_slug_aliases_locale_check', sql`${table.locale} in ('ru', 'ro')`)
	]
)
