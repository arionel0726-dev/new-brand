import { describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { db } from '../src/db/client'
import './helpers'

describe('PostgreSQL connection', () => {
	test('can run a query against the database', async () => {
		const result = await db.execute(sql`select 1 as value`)
		expect(result[0]?.value).toBe(1)
	})
})
