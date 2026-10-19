import { sql } from 'drizzle-orm'
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const brands = pgTable('brands', {
	id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
	slug: text('slug').notNull().unique(),
	nameRu: text('name_ru').notNull(),
	nameRo: text('name_ro').notNull(),
	descriptionRu: text('description_ru'),
	descriptionRo: text('description_ro'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})
