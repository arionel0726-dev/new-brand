import { describe, expect, test } from 'bun:test'
import app from '../src/index'
import './helpers'

describe('health endpoint', () => {
	test('responds with the api status and dependency checks', async () => {
		const res = await app.fetch(new Request('http://localhost/api/health'))
		const body = (await res.json()) as {
			status: string
			service: string
			dependencies: { database: string; meilisearch: string }
		}

		expect([200, 503]).toContain(res.status)
		expect(body.service).toBe('api')
		expect(body.dependencies.database).toBe('ok')
	})

	// Sprint 9 Task 7: the HTTP status must track the database only - a
	// search-only outage is "degraded" (still 200), never 503, because
	// every write path already treats a Meilisearch failure as non-fatal
	// (src/search/sync.ts) and the rest of the API keeps working without it.
	test('a database-only dependency check always drives the HTTP status, not Meilisearch', async () => {
		const res = await app.fetch(new Request('http://localhost/api/health'))
		const body = (await res.json()) as { status: string; dependencies: { database: string; meilisearch: string } }

		expect(res.status).toBe(body.dependencies.database === 'ok' ? 200 : 503)
		if (body.dependencies.database === 'ok' && body.dependencies.meilisearch !== 'ok') {
			expect(body.status).toBe('degraded')
			expect(res.status).toBe(200)
		}
	})
})
