import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonArrayStreamError, readJsonArrayFileBounded, streamJsonArrayFile } from '../src/import/parsers/json-array-stream'

async function withTempFile(contents: string, fn: (path: string) => Promise<void>) {
	const dir = await mkdtemp(join(tmpdir(), 'json-array-stream-test-'))
	const path = join(dir, `${randomUUID()}.json`)
	await Bun.write(path, contents)
	try {
		await fn(path)
	} finally {
		await rm(dir, { recursive: true, force: true })
	}
}

describe('streamJsonArrayFile', () => {
	test('yields each element of a simple flat array in order', async () => {
		await withTempFile(JSON.stringify([{ a: 1 }, { a: 2 }, { a: 3 }]), async path => {
			const out: unknown[] = []
			for await (const el of streamJsonArrayFile(path)) out.push(el)
			expect(out).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }])
		})
	})

	test('handles an empty array', async () => {
		await withTempFile('[]', async path => {
			const out: unknown[] = []
			for await (const el of streamJsonArrayFile(path)) out.push(el)
			expect(out).toEqual([])
		})
	})

	test('handles escaped quotes, backslashes, and embedded commas/braces inside string values', async () => {
		const records = [
			{ ID_nom: '1', Note: 'He said \\"hello, world\\" and left' },
			{ ID_nom: '2', Note: 'Path: C:\\\\Users\\\\test, (parenthetical) {braces}' }
		]
		await withTempFile(JSON.stringify(records), async path => {
			const out: unknown[] = []
			for await (const el of streamJsonArrayFile(path)) out.push(el)
			expect(out).toEqual(records)
		})
	})

	test('handles Unicode (Cyrillic, Romanian diacritics) correctly, including when it spans a decode boundary', async () => {
		const records = [
			{ ID_nom: '1', titleRu: 'Лак для ногтей ANNY' },
			{ ID_nom: '2', titleRo: 'Lac de unghii cu diacritice ăâîșț' }
		]
		await withTempFile(JSON.stringify(records), async path => {
			const out: unknown[] = []
			for await (const el of streamJsonArrayFile(path)) out.push(el)
			expect(out).toEqual(records)
		})
	})

	test('handles nested objects/arrays inside an element without losing the top-level boundary', async () => {
		const records = [{ ID_nom: '1', tags: ['a', 'b', { nested: true }] }, { ID_nom: '2', tags: [] }]
		await withTempFile(JSON.stringify(records), async path => {
			const out: unknown[] = []
			for await (const el of streamJsonArrayFile(path)) out.push(el)
			expect(out).toEqual(records)
		})
	})

	test('handles leading/trailing whitespace around the array', async () => {
		await withTempFile('  \n\t [ {"a":1} , {"a":2} ] \n', async path => {
			const out: unknown[] = []
			for await (const el of streamJsonArrayFile(path)) out.push(el)
			expect(out).toEqual([{ a: 1 }, { a: 2 }])
		})
	})

	test('rejects a top-level object (the {"products": [...]} wrapper shape is not supported by this streaming parser)', async () => {
		await withTempFile(JSON.stringify({ products: [{ a: 1 }] }), async path => {
			await expect(async () => {
				for await (const _el of streamJsonArrayFile(path)) {
					/* noop */
				}
			}).toThrow(JsonArrayStreamError)
		})
	})

	test('rejects a missing file', async () => {
		await expect(async () => {
			for await (const _el of streamJsonArrayFile('/nonexistent/path/does-not-exist.json')) {
				/* noop */
			}
		}).toThrow(JsonArrayStreamError)
	})

	test('correctly parses a large-ish synthetic fixture (bounded-memory processing, Task 3)', async () => {
		const records = Array.from({ length: 5000 }, (_, i) => ({
			ID_nom: String(10000 + i),
			Brand: i % 7 === 0 ? null : `Brand${i % 50}`,
			Barcode: `${4000000000000 + i}`,
			ColorVar: i % 3 === 0 ? `${i % 10}` : null,
			VariativeNomenclature: i % 11 === 0 ? `GRP.${i % 10}` : null,
			Price: 100 + (i % 500),
			PriceWH: 50 + (i % 250),
			QuantityBalance: i % 20,
			titleRu: `Тестовый товар номер ${i} со спецсимволами: "кавычки", запятые, скобки ()`
		}))
		await withTempFile(JSON.stringify(records), async path => {
			const out: unknown[] = []
			for await (const el of streamJsonArrayFile(path)) out.push(el)
			expect(out).toHaveLength(5000)
			expect(out[0]).toEqual(records[0])
			expect(out[4999]).toEqual(records[4999])
		})
	})
})

describe('readJsonArrayFileBounded', () => {
	test('collects the full streamed array', async () => {
		await withTempFile(JSON.stringify([{ a: 1 }, { a: 2 }]), async path => {
			const out = await readJsonArrayFileBounded(path)
			expect(out).toEqual([{ a: 1 }, { a: 2 }])
		})
	})
})
