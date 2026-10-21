/**
 * Pure argument parsing for cli/catalog-slice-import.ts, split out the same
 * way format-bootstrap-report.ts is split from cli/brand-category-bootstrap.ts:
 * every file under import/cli/ calls its own main() unconditionally at
 * module load, so nothing there can be imported directly by a test. This
 * module has no side effects on import and is safe to unit test.
 */
export type SliceCliArgs = {
	sql: string | null
	products: string | null
	legacyProductIds: number[] | null
	brandIds: number[] | null
	legacyCategoryIds: number[] | null
	auto: boolean
	write: boolean
	confirmSlice: string | null
}

export function parseIdList(raw: string): number[] {
	return raw
		.split(',')
		.map(s => s.trim())
		.filter(s => s.length > 0)
		.map(s => {
			const n = Number(s)
			if (!Number.isInteger(n)) throw new Error(`Invalid id in list: ${JSON.stringify(s)}`)
			return n
		})
}

export function parseSliceCliArgs(argv: string[]): SliceCliArgs {
	const args: SliceCliArgs = {
		sql: null,
		products: null,
		legacyProductIds: null,
		brandIds: null,
		legacyCategoryIds: null,
		auto: false,
		write: false,
		confirmSlice: null
	}
	for (const arg of argv) {
		if (arg.startsWith('--sql=')) args.sql = arg.slice('--sql='.length)
		else if (arg.startsWith('--products=')) args.products = arg.slice('--products='.length)
		else if (arg.startsWith('--legacy-product-ids=')) args.legacyProductIds = parseIdList(arg.slice('--legacy-product-ids='.length))
		else if (arg.startsWith('--brand-ids=')) args.brandIds = parseIdList(arg.slice('--brand-ids='.length))
		else if (arg.startsWith('--legacy-category-ids=')) args.legacyCategoryIds = parseIdList(arg.slice('--legacy-category-ids='.length))
		else if (arg === '--auto') args.auto = true
		else if (arg === '--write') args.write = true
		else if (arg.startsWith('--confirm-slice=')) args.confirmSlice = arg.slice('--confirm-slice='.length)
	}
	return args
}
