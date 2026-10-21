import { sql } from 'drizzle-orm'
import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { brands } from './brands'

export const productStatusEnum = pgEnum('product_status', ['draft', 'active', 'archived'])

export const products = pgTable(
	'products',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'restrict' }),
		slug: text('slug').notNull().unique(),
		nameRu: text('name_ru').notNull(),
		nameRo: text('name_ro').notNull(),
		descriptionRu: text('description_ru'),
		descriptionRo: text('description_ro'),
		// Sprint 12B.1: additive, nullable - observed as real, populated 1C
		// fields (ShortDescriptionRus/MD, InstructionRU/MD, componentsRu/MD,
		// Sprint 12A.3's field audit) with no V2 home until now. No existing
		// row or query is affected.
		shortDescriptionRu: text('short_description_ru'),
		shortDescriptionRo: text('short_description_ro'),
		ingredientsRu: text('ingredients_ru'),
		ingredientsRo: text('ingredients_ro'),
		instructionsRu: text('instructions_ru'),
		instructionsRo: text('instructions_ro'),
		status: productStatusEnum('status').notNull().default('draft'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		index('products_brand_id_idx').on(table.brandId),
		index('products_status_idx').on(table.status)
	]
)
