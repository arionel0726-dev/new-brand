import { sql } from 'drizzle-orm'
import { check, index, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

/**
 * Sprint 10A, Task 2 - the only place a legacy (MySQL) or 1C identifier is
 * ever recorded. V2's own tables (products, product_variants, brands,
 * categories, ...) never grow an inline `external_id`/`legacy_id` column -
 * every external identity lives here instead, keyed by (source_system,
 * entity_type, external_id) -> this system's own UUID. That is deliberate:
 * it lets one internal entity carry identities from more than one source
 * system (a product can have both a legacy_mysql id and a 1c nomenclature
 * id) without ever widening a core catalog table, and it means a second
 * source system (or a second legacy MySQL table nobody has described yet)
 * never requires a schema change to `products` itself.
 *
 * An explicit allowlist (not a free-text column) for both source_system and
 * entity_type - see ./external-entity-mapping-types.ts - because accepting
 * any string here would make a typo'd source name ("legacy-mysql" vs
 * "legacy_mysql") silently create a second, disconnected identity space
 * instead of failing loudly.
 */
export const externalSourceSystemEnum = pgEnum('external_source_system', ['legacy_mysql', '1c'])

export const externalEntityTypeEnum = pgEnum('external_entity_type', [
	// A legacy_mysql products.id or a V2-side parent product.
	'product',
	// A legacy_mysql products_variable.id or a V2-side sellable variant.
	'product_variant',
	'brand',
	'category',
	// An individual 1C nomenclature record (ID_nom) - per the confirmed
	// legacy findings, this is the thing that becomes a V2 product_variant,
	// not a V2 product, when it belongs to a variant group.
	'nomenclature',
	// A 1C VariativeNomenclature group identifier - becomes a V2 product
	// (the parent of every nomenclature record sharing the same group).
	'nomenclature_group'
])

export const externalEntityMappings = pgTable(
	'external_entity_mappings',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		sourceSystem: externalSourceSystemEnum('source_system').notNull(),
		entityType: externalEntityTypeEnum('entity_type').notNull(),
		// The source's own identifier, as text regardless of its native type
		// (legacy_mysql ids are integers, 1C ids may be strings) - normalized
		// to a non-empty trimmed string by the application layer, never by a
		// database trigger, so normalization stays visible/testable in
		// src/import/mappings.ts rather than hidden in SQL.
		externalId: text('external_id').notNull(),
		// This system's own UUID for whatever table entityType names -
		// deliberately not a typed FK to any specific table (entityType
		// decides which table internalId belongs to), since a single FK
		// column can't point at five different tables. Referential integrity
		// for internalId is enforced in application code
		// (src/import/mappings.ts), not the database, for this table only.
		internalId: uuid('internal_id').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		// The one hard guarantee the database itself enforces (Task 2): the
		// same external record is never mapped twice under the same source
		// and entity type. A *different* source/entity_type combination
		// mapping to the same-looking value (e.g. legacy_mysql/product/4582
		// vs 1c/nomenclature/10568) is a completely separate row by design -
		// never merged just because the digits match.
		unique('external_entity_mappings_source_entity_external_unique').on(
			table.sourceSystem,
			table.entityType,
			table.externalId
		),
		index('external_entity_mappings_internal_id_idx').on(table.internalId),
		index('external_entity_mappings_lookup_idx').on(table.sourceSystem, table.entityType, table.internalId),
		check('external_entity_mappings_external_id_non_empty_check', sql`length(trim(${table.externalId})) > 0`)
	]
)
