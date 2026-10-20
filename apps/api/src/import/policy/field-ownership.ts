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
 * Classification as of Sprint 10A.1 Task 7, now grounded in the real
 * `vizaje_nica_local.sql`, `legacy-feed-samples.json`, and
 * `workapp-1c-observed-contract.md` (see docs/legacy-reference/) rather
 * than Sprint 10A's field-list-only guesses. Every note below says
 * exactly what evidence backs it; 'unresolved' entries are still
 * genuinely unresolved, not just unconfirmed, and default to the safest
 * behavior (preserve existing, emit a conflict).
 */
export const PRODUCT_FIELD_OWNERSHIP_POLICY: Record<FieldKey, FieldPolicyEntry> = {
	externalNomenclatureIdentity: {
		owner: 'feed',
		note: 'Confirmed: ID_nom / VariativeNomenclature are the feed\'s own identifiers (legacy_feed-samples.json); products.GUID stores ID_nom (vizaje-legacy-discovery.md section 3). The feed is definitionally authoritative for its own identifiers.'
	},
	basePrice: {
		owner: 'feed',
		note: 'Confirmed field names: Price/PriceWH (products.json, pricevn.json samples), DiscountPrice (pricevn.json). Confirmed legacy MySQL destination types are inconsistent and risky: products.price/priceWH are float, products_variable.discount_price is varchar(32) (a plain string, not numeric) - a real legacy data-quality signal, not a V2 design choice. Still out of scope for any writes this sprint (Task 9 restrictions) regardless of ownership.'
	},
	stockSnapshot: {
		owner: 'feed',
		note: 'Confirmed field: QuantityBalance (products.json sample, value 0 for every ANNY variant). WarehouseName is also confirmed present but is feed *metadata*, never a stock quantity or a location - do not conflate the two. Still out of scope for any writes this sprint.'
	},
	barcode: {
		owner: 'feed',
		note: 'Confirmed both sides: Barcode in the feed (e.g. "4051761201249") and products.barcode/products_variable.barcode in MySQL (varchar(256), nullable, no uniqueness constraint in either table - do not assume barcode uniqueness).'
	},
	nomenclatureMetadata: {
		owner: 'feed',
		note: 'Confirmed fields: ColorVar, VolumeVar, Sex, and a Brand *name string* (e.g. "Anny") - all present in the real products.json sample. Brand here is a display string, not yet a resolved V2 brand id; matching it is a dry-run/normalization concern (reported as unmatched_brand), never assumed reliable on its own.'
	},
	images: { owner: 'website', note: 'products_img/products_variable_img exist in legacy MySQL with no GUID/feed-key column at all - confirmed to be a locally-managed back-office concern (vizaje-legacy-discovery.md section 6), matching V2\'s existing admin media/R2 pipeline. Never overwritten by a feed.' },
	curatedDescription: { owner: 'website', note: 'products.textRU/textRO (long-form content) are distinct from the short ShortDescriptionRus seen in the JobVN sample (see titleRuRo below) - kept website-owned as the safer default. Note legacy\'s own Import::import() reportedly overwrites this from the feed on every run (vizaje-legacy-discovery.md section 3); V2 deliberately does not copy that behavior without an explicit decision.' },
	seoMetadata: {
		owner: 'feed',
		note: 'CORRECTED in Sprint 10A.1 (was "website" in Sprint 10A): the JobVN feed confirmed carries SeoHeaderRU/SeoDescriptionRU (legacy-feed-samples.json), and workapp-1c-observed-contract.md + vizaje-legacy-discovery.md both confirm Import::update_seo() writes these into products.seoTitleRU/seoDescRU from this exact feed. So the feed genuinely is a real source for SEO fields - but the existing blank-value guard (see resolveFieldValue below) still applies: a blank incoming SeoHeaderRU/SeoDescriptionRU (both empty strings in the ID_nom 10568 sample) must never erase a nonblank curated value (Task 4\'s explicit instruction). No RO SEO field was observed in the JobVN sample at all, despite products/brands/categories all having seoTitleRO/seoDescRO columns - RO SEO source is unresolved (see docs).'
	},
	merchandising: { owner: 'website', note: 'home_categories/home_brand_sections/home_product_items (confirmed MySQL tables) have no feed/GUID column at all - confirmed locally-managed, no legacy equivalent in any feed.' },
	manualVisibility: { owner: 'website', note: 'products.isShown is a plain tinyint with no feed counterpart in any of the three samples - a product\'s publish/draft/archived state on V2 remains a storefront decision, never flipped by an import.' },
	titleRuRo: {
		owner: 'unresolved',
		note: 'Still unresolved, but now with real evidence: products.titleRU/titleRO/titleEN exist in MySQL (confirmed columns) and are the actual display titles - but no confirmed 1C feed field maps directly to an individual product/variant title. The only name-shaped feed field is VariativeName, which names a *group*, not an individual item (see src/import/normalize/products.ts), and ShortDescriptionRus (JobVN), which is a *description*, not a title - used only as an explicitly-flagged, non-authoritative fallback. Also confirmed: legacy\'s own Import::import() unconditionally overwrites titleRU/RO (and other non-price fields) from the feed on every run (vizaje-legacy-discovery.md section 3, "Импорт может перезаписывать ручные изменения") - V2 must not blindly copy that risk; this is exactly why titleRuRo stays unresolved rather than being reclassified "feed" by default.'
	},
	ingredientsInstructions: {
		owner: 'unresolved',
		note: 'Partially confirmed: MySQL destination columns exist (products.instructionRU/RO/EN, componentsRU/RO/EN) and vizaje-legacy-discovery.md states the legacy importer updates them from the feed - but no instruction/components field name appears in any of the three supplied samples. Destination confirmed, source field name NOT confirmed.'
	},
	categoryMapping: {
		owner: 'unresolved',
		note: 'Partially confirmed: product_categories is a real many-to-many junction table in MySQL (product_id, category_id, UNIQUE(product_id, category_id)) - structurally a near-exact match for V2\'s own product_categories table. categories.GUID is a confirmed column but has NO index at all (not even non-unique) in the supplied schema, and no category-bearing feed field was present in any of the three samples. Matching strategy (by GUID vs by name) is still undecided and no legacy category feed was inspected.'
	},
	promotionalReferencePrice: {
		owner: 'unresolved',
		note: 'Confirmed fields exist (DiscountPrice in pricevn.json, discount_price in MySQL products/products_variable) but every sample DiscountPrice is 0, which is ambiguous between "no active discount" and "a genuine zero price" - cannot be resolved from the supplied samples alone. Also out of scope for any writes this sprint regardless (Task 4 restriction: no real price synchronization).'
	},
	variantGroupNaming: {
		owner: 'unresolved',
		note: 'Evidence now supports VariativeName as a reasonable *working* parent-product title (confirmed via the real ANNY group: "NAIL POLISH ANNY" shared by ID_nom 10568/10516/10559) and src/import/normalize/products.ts already uses it that way by default. Still unresolved whether this should become the *permanent, curated* V2 title (vs. a pure internal grouping label later replaced by a MySQL-sourced title) - that decision belongs to the store owner, not this importer.'
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
