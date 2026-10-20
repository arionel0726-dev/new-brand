/**
 * Typed extraction of the legacy MySQL catalog tables (Sprint 12 Task 1/7)
 * on top of the generic mysqldump tokenizer (./mysql-dump.ts). Every field
 * name below is taken directly from the real CREATE TABLE definitions in
 * docs/legacy-reference/vizaje_nica_local.sql (the schema-only reference
 * the Sprint 12 spec says to use for interpreting vizaje_catalog_only.sql's
 * columns) - never guessed or inferred from data shape.
 *
 * Rows are looked up by column *name*, not position: mysqldump's column
 * list for a given INSERT statement reflects the table's actual column
 * order at dump time, which this module must not assume matches any
 * hardcoded index.
 */
import { type ParsedInsertStatement, type SqlValue, parseInsertStatements } from './mysql-dump'

function rowsAsRecords(statements: ParsedInsertStatement[]): Record<string, SqlValue>[] {
	const records: Record<string, SqlValue>[] = []
	for (const statement of statements) {
		for (const row of statement.rows) {
			const record: Record<string, SqlValue> = {}
			statement.columns.forEach((col, idx) => {
				record[col] = row[idx]
			})
			records.push(record)
		}
	}
	return records
}

function str(v: SqlValue): string | null {
	if (v === null) return null
	return String(v)
}

function nonEmptyStr(v: SqlValue): string | null {
	const s = str(v)
	if (s === null) return null
	const trimmed = s.trim()
	return trimmed.length > 0 ? trimmed : null
}

function num(v: SqlValue): number | null {
	if (v === null) return null
	if (typeof v === 'number') return v
	const n = Number(v)
	return Number.isFinite(n) ? n : null
}

function bool01(v: SqlValue): boolean {
	return num(v) === 1
}

export type LegacyProduct = {
	id: number
	guid: string | null
	sku: string | null
	titleRu: string | null
	titleRo: string | null
	descRu: string | null
	descRo: string | null
	textRu: string | null
	textRo: string | null
	uriRu: string | null
	uriRo: string | null
	price: number | null
	discountPrice: number | null
	priceWh: number | null
	volume: string | null
	onStock: number | null
	stock: number | null
	isNew: boolean
	categoryId: number | null
	brandId: number | null
	instructionRu: string | null
	instructionRo: string | null
	componentsRu: string | null
	componentsRo: string | null
	sex: string | null
	seoTitleRu: string | null
	seoTitleRo: string | null
	seoDescRu: string | null
	seoDescRo: string | null
	barcode: string | null
	warehouseName: string | null
	isShown: boolean
	createdAt: string | null
	updatedAt: string | null
}

export type LegacyProductVariable = {
	id: number
	productId: number
	sku: string | null
	titleRu: string | null
	titleRo: string | null
	colorRu: string | null
	colorRo: string | null
	colorHex: string | null
	volumeVar: string | null
	dose: string | null
	price: number | null
	discountPrice: string | null
	qty: number | null
	qtyWh: number | null
	priceWh: number | null
	barcode: string | null
	warehouseName: string | null
	isShown: boolean
	sortOrder: number | null
}

export type LegacyBrand = {
	id: number
	guid: string | null
	title: string | null
	uri: string | null
	textRu: string | null
	textRo: string | null
	seoTitleRu: string | null
	seoTitleRo: string | null
	isShown: boolean
	sortOrder: number | null
}

export type LegacyCategory = {
	id: number
	guid: string | null
	parentId: number | null
	titleRu: string | null
	titleRo: string | null
	uriRu: string | null
	uriRo: string | null
	descRu: string | null
	descRo: string | null
	seoTitleRu: string | null
	seoTitleRo: string | null
	isShown: boolean
	sortOrder: number | null
}

export type LegacyProductCategory = {
	id: number
	productId: number
	categoryId: number
}

export type LegacyProductImg = {
	id: number
	productId: number
	img: string | null
	sortOrder: number | null
	isShown: boolean
}

export type LegacyProductVariableImg = {
	id: number
	productId: number
	variableId: number
	img: string | null
	sortOrder: number | null
	isShown: boolean
}

export type LegacyStore = {
	id: number
	titleRu: string | null
	titleRo: string | null
	phone: string | null
	coords: string | null
	descRu: string | null
	descRo: string | null
	isShown: boolean
	sortOrder: number | null
}

export type LegacyStoreImg = {
	id: number
	storeId: number
	img: string | null
	sortOrder: number | null
	isShown: boolean
}

export type LegacyProductsMore = {
	productId: number
	relatedId: number
}

export function extractProducts(sql: string): LegacyProduct[] {
	return rowsAsRecords(parseInsertStatements(sql, 'products')).map(r => ({
		id: num(r.id) ?? -1,
		guid: nonEmptyStr(r.GUID),
		sku: nonEmptyStr(r.SKU),
		titleRu: nonEmptyStr(r.titleRU),
		titleRo: nonEmptyStr(r.titleRO),
		descRu: nonEmptyStr(r.descRU),
		descRo: nonEmptyStr(r.descRO),
		textRu: nonEmptyStr(r.textRU),
		textRo: nonEmptyStr(r.textRO),
		uriRu: nonEmptyStr(r.uriRU),
		uriRo: nonEmptyStr(r.uriRO),
		price: num(r.price),
		discountPrice: num(r.discount_price),
		priceWh: num(r.priceWH),
		volume: nonEmptyStr(r.volume),
		onStock: num(r.on_stock),
		stock: num(r.stock),
		isNew: bool01(r.is_new),
		categoryId: num(r.category_id),
		brandId: num(r.brand_id),
		instructionRu: nonEmptyStr(r.instructionRU),
		instructionRo: nonEmptyStr(r.instructionRO),
		componentsRu: nonEmptyStr(r.componentsRU),
		componentsRo: nonEmptyStr(r.componentsRO),
		sex: nonEmptyStr(r.sex),
		seoTitleRu: nonEmptyStr(r.seoTitleRU),
		seoTitleRo: nonEmptyStr(r.seoTitleRO),
		seoDescRu: nonEmptyStr(r.seoDescRU),
		seoDescRo: nonEmptyStr(r.seoDescRO),
		barcode: nonEmptyStr(r.barcode),
		warehouseName: nonEmptyStr(r.WarehouseName),
		isShown: bool01(r.isShown),
		createdAt: str(r.created_at),
		updatedAt: str(r.updated_at)
	}))
}

export function extractProductVariables(sql: string): LegacyProductVariable[] {
	return rowsAsRecords(parseInsertStatements(sql, 'products_variable')).map(r => ({
		id: num(r.id) ?? -1,
		productId: num(r.product_id) ?? -1,
		sku: nonEmptyStr(r.SKU),
		titleRu: nonEmptyStr(r.titleRU),
		titleRo: nonEmptyStr(r.titleRO),
		colorRu: nonEmptyStr(r.colorRU),
		colorRo: nonEmptyStr(r.colorRO),
		colorHex: nonEmptyStr(r.colorHex),
		volumeVar: nonEmptyStr(r.VolumeVar),
		dose: nonEmptyStr(r.dose),
		price: num(r.price),
		discountPrice: nonEmptyStr(r.discount_price),
		qty: num(r.qty),
		qtyWh: num(r.qtyWH),
		priceWh: num(r.priceWH),
		barcode: nonEmptyStr(r.barcode),
		warehouseName: nonEmptyStr(r.WarehouseName),
		isShown: bool01(r.isShown),
		sortOrder: num(r.sorder)
	}))
}

export function extractBrands(sql: string): LegacyBrand[] {
	return rowsAsRecords(parseInsertStatements(sql, 'brands')).map(r => ({
		id: num(r.id) ?? -1,
		guid: nonEmptyStr(r.GUID),
		title: nonEmptyStr(r.title),
		uri: nonEmptyStr(r.uri),
		textRu: nonEmptyStr(r.textRU),
		textRo: nonEmptyStr(r.textRO),
		seoTitleRu: nonEmptyStr(r.seoTitleRU),
		seoTitleRo: nonEmptyStr(r.seoTitleRO),
		isShown: bool01(r.isShown),
		sortOrder: num(r.sorder)
	}))
}

export function extractCategories(sql: string): LegacyCategory[] {
	return rowsAsRecords(parseInsertStatements(sql, 'categories')).map(r => ({
		id: num(r.id) ?? -1,
		guid: nonEmptyStr(r.GUID),
		parentId: num(r.parent_id),
		titleRu: nonEmptyStr(r.titleRU),
		titleRo: nonEmptyStr(r.titleRO),
		uriRu: nonEmptyStr(r.uriRU),
		uriRo: nonEmptyStr(r.uriRO),
		descRu: nonEmptyStr(r.descRU),
		descRo: nonEmptyStr(r.descRO),
		seoTitleRu: nonEmptyStr(r.seoTitleRU),
		seoTitleRo: nonEmptyStr(r.seoTitleRO),
		isShown: bool01(r.isShown),
		sortOrder: num(r.sorder)
	}))
}

export function extractProductCategories(sql: string): LegacyProductCategory[] {
	return rowsAsRecords(parseInsertStatements(sql, 'product_categories')).map(r => ({
		id: num(r.id) ?? -1,
		productId: num(r.product_id) ?? -1,
		categoryId: num(r.category_id) ?? -1
	}))
}

export function extractProductImgs(sql: string): LegacyProductImg[] {
	return rowsAsRecords(parseInsertStatements(sql, 'products_img')).map(r => ({
		id: num(r.id) ?? -1,
		productId: num(r.product_id) ?? -1,
		img: nonEmptyStr(r.img),
		sortOrder: num(r.sorder),
		isShown: bool01(r.isShown)
	}))
}

export function extractProductVariableImgs(sql: string): LegacyProductVariableImg[] {
	return rowsAsRecords(parseInsertStatements(sql, 'products_variable_img')).map(r => ({
		id: num(r.id) ?? -1,
		productId: num(r.product_id) ?? -1,
		variableId: num(r.variable_id) ?? -1,
		img: nonEmptyStr(r.img),
		sortOrder: num(r.sorder),
		isShown: bool01(r.isShown)
	}))
}

export function extractStores(sql: string): LegacyStore[] {
	return rowsAsRecords(parseInsertStatements(sql, 'stores')).map(r => ({
		id: num(r.id) ?? -1,
		titleRu: nonEmptyStr(r.titleRU),
		titleRo: nonEmptyStr(r.titleRO),
		phone: nonEmptyStr(r.phone),
		coords: nonEmptyStr(r.coords),
		descRu: nonEmptyStr(r.descRU),
		descRo: nonEmptyStr(r.descRO),
		isShown: bool01(r.isShown),
		sortOrder: num(r.sorder)
	}))
}

export function extractStoreImgs(sql: string): LegacyStoreImg[] {
	return rowsAsRecords(parseInsertStatements(sql, 'stores_img')).map(r => ({
		id: num(r.id) ?? -1,
		storeId: num(r.stores_id) ?? -1,
		img: nonEmptyStr(r.img),
		sortOrder: num(r.sorder),
		isShown: bool01(r.isShown)
	}))
}

export function extractProductsMore(sql: string): LegacyProductsMore[] {
	return rowsAsRecords(parseInsertStatements(sql, 'products_more')).map(r => ({
		productId: num(r.product_id) ?? -1,
		relatedId: num(r.related_id) ?? -1
	}))
}

/** Convenience bundle - loads every catalog-relevant table once from the same in-memory SQL string. */
export type LegacyCatalogDump = {
	products: LegacyProduct[]
	productVariables: LegacyProductVariable[]
	brands: LegacyBrand[]
	categories: LegacyCategory[]
	productCategories: LegacyProductCategory[]
	productImgs: LegacyProductImg[]
	productVariableImgs: LegacyProductVariableImg[]
	stores: LegacyStore[]
	storeImgs: LegacyStoreImg[]
	productsMore: LegacyProductsMore[]
}

export function loadLegacyCatalogDump(sql: string): LegacyCatalogDump {
	return {
		products: extractProducts(sql),
		productVariables: extractProductVariables(sql),
		brands: extractBrands(sql),
		categories: extractCategories(sql),
		productCategories: extractProductCategories(sql),
		productImgs: extractProductImgs(sql),
		productVariableImgs: extractProductVariableImgs(sql),
		stores: extractStores(sql),
		storeImgs: extractStoreImgs(sql),
		productsMore: extractProductsMore(sql)
	}
}
