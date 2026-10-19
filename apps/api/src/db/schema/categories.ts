import { sql } from 'drizzle-orm'
import { type AnyPgColumn, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const categories = pgTable(
	'categories',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, {
			onDelete: 'set null'
		}),
		slug: text('slug').notNull().unique(),
		nameRu: text('name_ru').notNull(),
		nameRo: text('name_ro').notNull(),
		descriptionRu: text('description_ru'),
		descriptionRo: text('description_ro'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [index('categories_parent_id_idx').on(table.parentId)]
)
