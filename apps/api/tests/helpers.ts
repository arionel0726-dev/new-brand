import { sql } from 'drizzle-orm'
import { db } from '../src/db/client'

if (!process.env.DATABASE_URL?.includes('test')) {
	throw new Error(
		'Refusing to run tests: DATABASE_URL must point to a database with "test" in its name'
	)
}

// Drizzle query builders are thenables, not native Promises, so `expect(...).rejects`
// needs them wrapped before it will recognize them as a promise.
export function toPromise<T>(thenable: PromiseLike<T>): Promise<T> {
	return Promise.resolve(thenable)
}

export async function resetDatabase() {
	await db.execute(sql`
		truncate table
			inventory,
			product_prices,
			product_categories,
			product_images,
			product_variants,
			products,
			categories,
			brands
		restart identity cascade
	`)
}
