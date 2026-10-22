import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { discoverFile, discoverLegacySqlDump, discoverProductsFeed, resolveSqlPath, resolveProductsPath, FileResolutionError } from '../src/import/local-file-discovery'

/** Sprint 12B.10 Requirement 2: a real temp directory tree per test, cleaned up afterward - no mocking of fs needed for these pure path checks. */
async function makeRoot(): Promise<string> {
	return mkdtemp(path.join(tmpdir(), 'catalog-workflow-discovery-'))
}

describe('discoverFile', () => {
	test('finds a known candidate path when present', async () => {
		const root = await makeRoot()
		await mkdir(path.join(root, 'docs/legacy-reference'), { recursive: true })
		await writeFile(path.join(root, 'docs/legacy-reference/vizaje_catalog_only.sql'), '-- dump')

		const result = discoverLegacySqlDump([root])
		expect(result.status).toBe('found')
		if (result.status === 'found') {
			expect(result.file.absolutePath).toBe(path.join(root, 'docs/legacy-reference/vizaje_catalog_only.sql'))
			expect(result.file.matchedCandidate).toBe('docs/legacy-reference/vizaje_catalog_only.sql')
		}
		await rm(root, { recursive: true, force: true })
	})

	test('reports not_found, listing every path it searched, when nothing exists', () => {
		const result = discoverFile(['/nonexistent-root-a', '/nonexistent-root-b'], ['foo.sql', 'bar.sql'])
		expect(result.status).toBe('not_found')
		if (result.status === 'not_found') {
			expect(result.searchedCandidates.length).toBe(4)
			expect(result.searchedCandidates).toContain(path.resolve('/nonexistent-root-a', 'foo.sql'))
		}
	})

	test('reports ambiguous, listing every real candidate, when more than one real file matches', async () => {
		const root = await makeRoot()
		await mkdir(path.join(root, 'a'), { recursive: true })
		await mkdir(path.join(root, 'b'), { recursive: true })
		await writeFile(path.join(root, 'a/dump.sql'), '-- one')
		await writeFile(path.join(root, 'b/dump.sql'), '-- two')

		const result = discoverFile([root], ['a/dump.sql', 'b/dump.sql'])
		expect(result.status).toBe('ambiguous')
		if (result.status === 'ambiguous') {
			expect(result.candidates.length).toBe(2)
		}
		await rm(root, { recursive: true, force: true })
	})

	test('the same real file reachable from two search roots is reported once, never as ambiguous', async () => {
		const root = await makeRoot()
		await writeFile(path.join(root, 'dump.sql'), '-- dump')

		// Both "roots" resolve to the exact same absolute file.
		const result = discoverFile([root, root], ['dump.sql'])
		expect(result.status).toBe('found')
		await rm(root, { recursive: true, force: true })
	})

	test('an empty file is never reported as found - a 0-byte file is not a usable dump', async () => {
		const root = await makeRoot()
		await writeFile(path.join(root, 'empty.sql'), '')
		const result = discoverFile([root], ['empty.sql'])
		expect(result.status).toBe('not_found')
		await rm(root, { recursive: true, force: true })
	})

	test('discoverProductsFeed searches the products.json candidate set, independent of the SQL candidate set', async () => {
		const root = await makeRoot()
		await mkdir(path.join(root, 'data/import'), { recursive: true })
		await writeFile(path.join(root, 'data/import/products.json'), '[]')
		const result = discoverProductsFeed([root])
		expect(result.status).toBe('found')
		await rm(root, { recursive: true, force: true })
	})
})

describe('resolveSqlPath / resolveProductsPath', () => {
	test('an explicit path always wins outright - discovery is never even attempted', () => {
		// A root with zero real files - if discovery ran, this would throw.
		const resolved = resolveSqlPath('/explicit/path/to/dump.sql', ['/does-not-exist-anywhere'])
		expect(resolved).toBe('/explicit/path/to/dump.sql')
	})

	test('falls back to discovery and throws a clear, actionable FileResolutionError when nothing is found', () => {
		expect(() => resolveSqlPath(null, ['/does-not-exist-anywhere'])).toThrow(FileResolutionError)
		try {
			resolveSqlPath(null, ['/does-not-exist-anywhere'])
		} catch (error) {
			expect(error).toBeInstanceOf(FileResolutionError)
			expect((error as FileResolutionError).message).toContain('--sql=<path>')
		}
	})

	test('throws a clear, actionable FileResolutionError on ambiguity, naming every candidate', async () => {
		const root = await makeRoot()
		await mkdir(path.join(root, 'data/import'), { recursive: true })
		await mkdir(path.join(root, 'data/legacy'), { recursive: true })
		await writeFile(path.join(root, 'data/import/products.json'), '[]')
		await writeFile(path.join(root, 'data/legacy/products.json'), '[]')

		expect(() => resolveProductsPath(null, [root])).toThrow(FileResolutionError)
		try {
			resolveProductsPath(null, [root])
		} catch (error) {
			expect((error as FileResolutionError).message).toContain('--products=<path>')
			expect((error as FileResolutionError).message).toContain('data/import/products.json'.split('/').pop()!)
		}
		await rm(root, { recursive: true, force: true })
	})
})
