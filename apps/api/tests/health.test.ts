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
})
