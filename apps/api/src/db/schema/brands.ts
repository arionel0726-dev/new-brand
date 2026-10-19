import { sql } from 'drizzle-orm'
import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const brands = pgTable(
	'brands',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		slug: text('slug').notNull().unique(),
		nameRu: text('name_ru').notNull(),
		nameRo: text('name_ro').notNull(),
		descriptionRu: text('description_ru'),
		descriptionRo: text('description_ro'),
		// Public catalog only ever shows isActive=true brands; the admin API
		// can list/edit both. Hidden rather than deleted (no physical delete
		// for brands in this sprint).
		isActive: boolean('is_active').notNull().default(true),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [index('brands_is_active_idx').on(table.isActive)]
)
