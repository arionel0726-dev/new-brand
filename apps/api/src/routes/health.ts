import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { searchClient } from '../search/client'

export const health = new Hono().get('/', async c => {
	const [database, meilisearch] = await Promise.allSettled([
		db.execute(sql`select 1`),
		searchClient.isHealthy()
	])

	const status =
		database.status === 'fulfilled' && meilisearch.status === 'fulfilled' && meilisearch.value
			? 'ok'
			: 'degraded'

	return c.json(
		{
			status,
			service: 'api',
			dependencies: {
				database: database.status === 'fulfilled' ? 'ok' : 'down',
				meilisearch: meilisearch.status === 'fulfilled' && meilisearch.value ? 'ok' : 'down'
			}
		},
		status === 'ok' ? 200 : 503
	)
})
