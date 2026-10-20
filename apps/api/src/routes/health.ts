import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { searchClient } from '../search/client'

export const health = new Hono().get('/', async c => {
	const [database, meilisearch] = await Promise.allSettled([
		db.execute(sql`select 1`),
		searchClient.isHealthy()
	])

	const databaseOk = database.status === 'fulfilled'
	const meilisearchOk = meilisearch.status === 'fulfilled' && meilisearch.value

	// Database is the one dependency nothing in this API can function
	// without - a genuine 503, correct for a load balancer/orchestrator to
	// pull the instance out of rotation on. Meilisearch is not: every
	// catalog/cart/checkout/order write already treats a search-sync
	// failure as non-fatal and keeps serving (see src/search/sync.ts) - so
	// this endpoint must not report the same "take me out of rotation"
	// signal for it. Reporting 503 here when only search is down would
	// contradict that and take the whole storefront offline over search
	// alone (Sprint 9 Task 7).
	const status = databaseOk && meilisearchOk ? 'ok' : databaseOk ? 'degraded' : 'down'

	return c.json(
		{
			status,
			service: 'api',
			dependencies: {
				database: databaseOk ? 'ok' : 'down',
				meilisearch: meilisearchOk ? 'ok' : 'down'
			}
		},
		databaseOk ? 200 : 503
	)
})
