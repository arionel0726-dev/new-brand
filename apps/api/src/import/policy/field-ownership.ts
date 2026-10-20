/**
 * Declarative field-ownership policy (Sprint 10A Task 7). This module is
 * the *only* place that decides whether an incoming feed value is allowed
 * to overwrite a V2 field - every classification below is a
 * recommendation from this sprint's spec, not a confirmed business rule,
 * and is expected to change as the real legacy data and the store owner's
 * actual preferences become known. Changing a field's owner here changes
 * every importer's behavior for that field automatically; nothing in the
 * importer itself should ever hardcode "always overwrite X" or "never
 * touch Y" - it must always go through resolveFieldValue below.
 */
export type FieldOwner = 'feed' | 'website' | 'unresolved'

export type FieldPolicyEntry = {
	owner: FieldOwner
	/** Why this classification, and how confident it is - always surfaced in docs/vizaje-migration-architecture.md verbatim. */
	note: string
}

export type FieldKey =
	| 'externalNomenclatureIdentity'
	| 'basePrice'
	| 'stockSnapshot'
	| 'barcode'
	| 'nomenclatureMetadata'
	| 'images'
	| 'curatedDescription'
	| 'seoMetadata'
	| 'merchandising'
	| 'manualVisibility'
	| 'titleRuRo'
	| 'ingredientsInstructions'
	| 'categoryMapping'
	| 'promotionalReferencePrice'
	| 'variantGroupNaming'

/**
 * Initial classification (Task 7's "suggested initial classification").
 * 1C/feed-owned and website-managed entries are this sprint's confirmed
 * recommendation; everything marked 'unresolved' is explicitly listed in
 * the task as not yet decided and defaults to the safest behavior
 * (preserve existing, emit a conflict) until the store owner resolves it.
 */
export const PRODUCT_FIELD_OWNERSHIP_POLICY: Record<FieldKey, FieldPolicyEntry> = {
	externalNomenclatureIdentity: {
		owner: 'feed',
		note: 'ID_nom / VariativeNomenclature identity - the feed is definitionally authoritative for its own identifiers.'
	},
	basePrice: {
		owner: 'feed',
		note: 'Recommended, not yet confirmed as a production rule - and regardless, Sprint 10A does not import production prices at all (see Task 9 restrictions). Recorded here for when price sync is eventually scoped.'
	},
	stockSnapshot: {
		owner: 'feed',
		note: 'Recommended, not yet confirmed - and, like basePrice, out of scope for any writes this sprint.'
	},
	barcode: { owner: 'feed', note: '1C is the natural source of truth for a scannable barcode.' },
	nomenclatureMetadata: {
		owner: 'feed',
		note: 'ColorVar/VolumeVar and similar 1C-derived variant attributes.'
	},
	images: { owner: 'website', note: 'Product photography is curated through the existing admin media pipeline, never overwritten by a feed.' },
	curatedDescription: { owner: 'website', note: 'Marketing copy written for the V2 storefront.' },
	seoMetadata: { owner: 'website', note: 'SEO metadata curated on the V2 side - see also the unresolved JobVN SEO feed question below.' },
	merchandising: { owner: 'website', note: 'Collections, sort order, and similar V2-only merchandising concepts with no legacy equivalent.' },
	manualVisibility: { owner: 'website', note: 'A product\'s publish/draft/archived state on V2 is a storefront decision, never flipped by an import.' },
	titleRuRo: {
		owner: 'unresolved',
		note: 'Unresolved (Task 7): the products feed confirmed this sprint has no per-product/variant name field at all (only VariativeName, a group-level name) - see src/import/normalize/products.ts. Whether RU/RO titles ever come from a feed, and from which one, is undecided.'
	},
	ingredientsInstructions: { owner: 'unresolved', note: 'Unresolved (Task 7) - no confirmed source field.' },
	categoryMapping: { owner: 'unresolved', note: 'Unresolved (Task 7) - no confirmed legacy category feed/table was inspected this sprint.' },
	promotionalReferencePrice: {
		owner: 'unresolved',
		note: 'Unresolved (Task 7) - which observed price (PriceWH? DiscountPrice?) should ever populate V2\'s compare_at_price, if any, is undecided. Also out of scope for any writes this sprint regardless.'
	},
	variantGroupNaming: {
		owner: 'unresolved',
		note: 'Unresolved (Task 7) - whether VariativeName should ever become the V2 product\'s own title, or stay purely an internal grouping label, is undecided.'
	}
}

export type FieldResolution =
	| { action: 'apply'; value: string | number | null }
	| { action: 'preserve'; reason: 'website_managed' | 'unresolved_policy' | 'blank_would_overwrite_curated_value' }

/**
 * The one function every importer must call before writing any V2 field
 * from feed data (Task 7). Never bypassed by field-specific logic
 * elsewhere - that is what keeps "change the policy" a one-line edit to
 * the table above instead of a code change scattered across the importer.
 */
export function resolveFieldValue(
	fieldKey: FieldKey,
	input: { incoming: string | number | null; existing: string | number | null }
): FieldResolution {
	const owner = PRODUCT_FIELD_OWNERSHIP_POLICY[fieldKey].owner

	if (owner === 'website') {
		return { action: 'preserve', reason: 'website_managed' }
	}
	if (owner === 'unresolved') {
		return { action: 'preserve', reason: 'unresolved_policy' }
	}

	// owner === 'feed'
	const incomingIsBlank = input.incoming === null || (typeof input.incoming === 'string' && input.incoming.trim().length === 0)
	const existingIsNonBlank =
		input.existing !== null && !(typeof input.existing === 'string' && input.existing.trim().length === 0)
	if (incomingIsBlank && existingIsNonBlank) {
		return { action: 'preserve', reason: 'blank_would_overwrite_curated_value' }
	}

	return { action: 'apply', value: input.incoming }
}
