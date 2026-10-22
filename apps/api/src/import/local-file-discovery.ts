/**
 * Sprint 12B.10 Requirement 2: automatic discovery of the two local-only
 * legacy input files (`vizaje_catalog_only.sql`, `products.json`) in known
 * project directories, so the unified workflow command does not require the
 * user to type `--sql=...`/`--products=...` on every single invocation.
 *
 * Pure and read-only: only `existsSync`/`statSync` against the filesystem,
 * never reads file contents, never guesses silently. An explicit `--sql`/
 * `--products` flag on the CLI always overrides discovery entirely - this
 * module is never consulted when the caller already knows the path.
 */
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

export type DiscoveredFile = { absolutePath: string; matchedCandidate: string }

export type DiscoveryResult =
	| { status: 'found'; file: DiscoveredFile }
	| { status: 'ambiguous'; candidates: DiscoveredFile[] }
	| { status: 'not_found'; searchedCandidates: string[] }

/**
 * Candidate paths relative to a search root, checked in order. These include
 * the real paths the user has already confirmed on their machines (Sprint
 * 12B.9: `docs/legacy-reference/vizaje_catalog_only.sql`, `data/import/products.json`;
 * Sprint 12B.10.2, macOS: `docs/import/products.json`), plus reasonable
 * siblings/variants worth checking automatically before asking the user to
 * type a path by hand.
 */
export const DEFAULT_SQL_DUMP_CANDIDATES: readonly string[] = [
	'docs/legacy-reference/vizaje_catalog_only.sql',
	'docs/legacy-reference/vizaje_catalog.sql',
	'docs/legacy-reference/legacy_dump.sql',
	'legacy/vizaje_catalog_only.sql',
	'data/legacy/vizaje_catalog_only.sql',
	'data/import/vizaje_catalog_only.sql'
]

export const DEFAULT_PRODUCTS_FEED_CANDIDATES: readonly string[] = [
	'data/import/products.json',
	'docs/import/products.json',
	'data/legacy/products.json',
	'import/products.json',
	'docs/legacy-reference/products.json'
]

function isNonEmptyFile(absolutePath: string): boolean {
	try {
		const stat = statSync(absolutePath)
		return stat.isFile() && stat.size > 0
	} catch {
		return false
	}
}

/**
 * Searches every (root, candidate) combination, in root order then candidate
 * order, and returns every real file found - deduplicated by resolved
 * absolute path, since the same file is very commonly reachable from more
 * than one search root (e.g. repo root and an identical cwd) and that must
 * never be reported as "two candidates".
 */
export function discoverFile(searchRoots: readonly string[], candidateRelPaths: readonly string[]): DiscoveryResult {
	const found = new Map<string, DiscoveredFile>()
	const searchedCandidates: string[] = []

	for (const root of searchRoots) {
		for (const candidate of candidateRelPaths) {
			const absolutePath = path.resolve(root, candidate)
			searchedCandidates.push(absolutePath)
			if (!found.has(absolutePath) && isNonEmptyFile(absolutePath)) {
				found.set(absolutePath, { absolutePath, matchedCandidate: candidate })
			}
		}
	}

	const files = [...found.values()]
	if (files.length === 0) return { status: 'not_found', searchedCandidates }
	if (files.length === 1) return { status: 'found', file: files[0]! }
	return { status: 'ambiguous', candidates: files }
}

/** Requirement 2: discover the legacy MySQL SQL dump. */
export function discoverLegacySqlDump(searchRoots: readonly string[]): DiscoveryResult {
	return discoverFile(searchRoots, DEFAULT_SQL_DUMP_CANDIDATES)
}

/** Requirement 2: discover the 1C `products.json` feed. */
export function discoverProductsFeed(searchRoots: readonly string[]): DiscoveryResult {
	return discoverFile(searchRoots, DEFAULT_PRODUCTS_FEED_CANDIDATES)
}

/**
 * Resolves the SQL/products paths the workflow should actually use: an
 * explicit flag always wins outright (discovery is never even attempted for
 * that file); otherwise falls back to discovery and throws a clear,
 * actionable error for `not_found`/`ambiguous` rather than silently guessing.
 */
export class FileResolutionError extends Error {
	constructor(
		public readonly kind: 'sql' | 'products',
		public readonly result: DiscoveryResult
	) {
		super(FileResolutionError.messageFor(kind, result))
	}

	private static messageFor(kind: 'sql' | 'products', result: DiscoveryResult): string {
		const flag = kind === 'sql' ? '--sql' : '--products'
		if (result.status === 'not_found') {
			return (
				`Could not auto-discover the ${kind === 'sql' ? 'legacy SQL dump' : '1C products.json feed'} in any known local directory ` +
				`(searched: ${result.searchedCandidates.join(', ')}). Pass ${flag}=<path> explicitly.`
			)
		}
		if (result.status === 'ambiguous') {
			return (
				`Found ${result.candidates.length} possible ${kind === 'sql' ? 'legacy SQL dump' : '1C products.json feed'} files and cannot pick one automatically: ` +
				`${result.candidates.map((c: DiscoveredFile) => c.absolutePath).join(', ')}. Pass ${flag}=<path> explicitly to disambiguate.`
			)
		}
		return `Unexpected discovery result for ${kind}.`
	}
}

export function resolveSqlPath(explicitPath: string | null, searchRoots: readonly string[]): string {
	if (explicitPath) return explicitPath
	const result = discoverLegacySqlDump(searchRoots)
	if (result.status !== 'found') throw new FileResolutionError('sql', result)
	return result.file.absolutePath
}

export function resolveProductsPath(explicitPath: string | null, searchRoots: readonly string[]): string {
	if (explicitPath) return explicitPath
	const result = discoverProductsFeed(searchRoots)
	if (result.status !== 'found') throw new FileResolutionError('products', result)
	return result.file.absolutePath
}
