import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../config/env'
import * as schema from './schema'

export const queryClient = postgres(env.DATABASE_URL)

export const db = drizzle(queryClient, { schema })

export type Database = typeof db

/**
 * Sprint 12B.11: builds a SEPARATE client bound to an explicit URL, instead
 * of the app-wide singleton above (which is bound to `env.DATABASE_URL` at
 * module load and never changes). The catalog-workflow CLI uses this when
 * `CATALOG_TEST_DATABASE_URL` (or an explicit `--database-url`) differs from
 * `DATABASE_URL`, so the queries it runs actually go to the database its own
 * preflight check validated - never a validated-one-URL/queried-another
 * mismatch.
 */
export function createDbClient(databaseUrl: string): { db: Database; queryClient: ReturnType<typeof postgres> } {
	const client = postgres(databaseUrl)
	return { db: drizzle(client, { schema }) as Database, queryClient: client }
}
