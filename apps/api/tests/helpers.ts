import { sql } from 'drizzle-orm'
import app from '../src/index'
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

// biome-ignore lint: test helper, response shape varies per endpoint
export async function getJson(path: string): Promise<{ status: number; body: any }> {
	const res = await app.fetch(new Request(`http://localhost${path}`))
	const body = await res.json()
	return { status: res.status, body }
}

// biome-ignore lint: test helper, response shape varies per endpoint
export async function requestJson(
	path: string,
	init: RequestInit = {}
): Promise<{ status: number; body: any; headers: Headers }> {
	const res = await app.fetch(
		new Request(`http://localhost${path}`, {
			...init,
			headers: { 'Content-Type': 'application/json', ...init.headers }
		})
	)
	const body = await res.json().catch(() => undefined)
	return { status: res.status, body, headers: res.headers }
}

/** Every `set-cookie` header from a response, ready to send back as a single `Cookie` request header. */
export function extractCookieHeader(headers: Headers): string {
	return headers
		.getSetCookie()
		.map(cookie => cookie.split(';')[0])
		.join('; ')
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

/** Separate from resetDatabase() (catalog tables) so auth tests don't disturb catalog test expectations or vice versa. */
export async function resetAuthTables() {
	await db.execute(sql`
		truncate table
			session,
			account,
			verification,
			"user"
		restart identity cascade
	`)
}
