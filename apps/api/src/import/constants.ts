import type { externalEntityTypeEnum, externalSourceSystemEnum } from '../db/schema/external-entity-mappings'
import type { importFeedTypeEnum } from '../db/schema/import-runs'

/**
 * The single allowlist this whole import subsystem is built around
 * (Sprint 10A Task 2). Re-exported as plain arrays (not just the pgEnum
 * objects) so Zod schemas and CLI argument parsing can validate against
 * the exact same list the database itself enforces, without importing
 * Drizzle's pg-core machinery into a pure parsing module.
 */
export const SOURCE_SYSTEMS = ['legacy_mysql', '1c'] as const
export type SourceSystem = (typeof SOURCE_SYSTEMS)[number]

export const ENTITY_TYPES = [
	'product',
	'product_variant',
	'brand',
	'category',
	'nomenclature',
	'nomenclature_group'
] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

export const FEED_TYPES = ['products', 'pricevn', 'jobvn_seo'] as const
export type FeedType = (typeof FEED_TYPES)[number]

// Compile-time proof the plain arrays above never silently drift from the
// actual database enums - if someone adds a value to one and not the
// other, this file fails to typecheck.
type _SourceSystemMatchesEnum = SourceSystem extends (typeof externalSourceSystemEnum.enumValues)[number]
	? (typeof externalSourceSystemEnum.enumValues)[number] extends SourceSystem
		? true
		: never
	: never
type _EntityTypeMatchesEnum = EntityType extends (typeof externalEntityTypeEnum.enumValues)[number]
	? (typeof externalEntityTypeEnum.enumValues)[number] extends EntityType
		? true
		: never
	: never
type _FeedTypeMatchesEnum = FeedType extends (typeof importFeedTypeEnum.enumValues)[number]
	? (typeof importFeedTypeEnum.enumValues)[number] extends FeedType
		? true
		: never
	: never
const _check: [_SourceSystemMatchesEnum, _EntityTypeMatchesEnum, _FeedTypeMatchesEnum] = [true, true, true]
void _check
