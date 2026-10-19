import { sql } from 'drizzle-orm'
import {
	type AnyPgColumn,
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uuid
} from 'drizzle-orm/pg-core'

export const categories = pgTable(
	'categories',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		// RESTRICT (not SET NULL/CASCADE): deleting a category that still has
		// children must fail explicitly rather than silently promoting them to
		// the root of the tree or deleting them.
		parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, {
			onDelete: 'restrict'
		}),
		slug: text('slug').notNull().unique(),
		nameRu: text('name_ru').notNull(),
		nameRo: text('name_ro').notNull(),
		descriptionRu: text('description_ru'),
		descriptionRo: text('description_ro'),
		// Public catalog only ever shows isActive=true categories; the admin
		// API can list/edit both. Hidden rather than deleted (no physical
		// delete for categories in this sprint).
		isActive: boolean('is_active').notNull().default(true),
		sortOrder: integer('sort_order').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		index('categories_parent_id_idx').on(table.parentId),
		index('categories_is_active_idx').on(table.isActive)
	]
)
