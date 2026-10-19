import { beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { env } from '../src/config/env'
import { db } from '../src/db/client'
import { user } from '../src/db/schema/auth'
import { requireAuth, requireRole } from '../src/auth/middleware'
import { errorHandler } from '../src/middleware/error-handler'
import { extractCookieHeader, requestJson, resetAuthTables } from './helpers'

beforeEach(async () => {
	await resetAuthTables()
})

const ORIGIN_HEADER = { Origin: env.WEB_ORIGIN }

async function signUp(email: string, password = 'password123', name = 'Test User') {
	return requestJson('/api/auth/sign-up/email', {
		method: 'POST',
		headers: ORIGIN_HEADER,
		body: JSON.stringify({ email, password, name })
	})
}

function signIn(email: string, password: string) {
	return requestJson('/api/auth/sign-in/email', {
		method: 'POST',
		headers: ORIGIN_HEADER,
		body: JSON.stringify({ email, password })
	})
}

describe('registration', () => {
	test('registers a customer with email and password', async () => {
		const { status, body } = await signUp('customer@example.com')

		expect(status).toBe(200)
		expect(body.user.email).toBe('customer@example.com')
		expect(body.user.role).toBe('customer')
		expect(body.token).toBeTruthy()
	})

	test('never exposes the password hash in the response', async () => {
		const { body } = await signUp('customer2@example.com')
		expect(body.user.password).toBeUndefined()
		expect(JSON.stringify(body)).not.toContain('password123')
	})

	test('cannot self-assign the admin or staff role through the public signup request', async () => {
		const { status, body } = await requestJson('/api/auth/sign-up/email', {
			method: 'POST',
			headers: ORIGIN_HEADER,
			body: JSON.stringify({
				email: 'attacker@example.com',
				password: 'password123',
				name: 'Attacker',
				role: 'admin'
			})
		})

		expect(status).toBe(200)
		expect(body.user.role).toBe('customer')

		const [row] = await db.select().from(user).where(eq(user.email, 'attacker@example.com'))
		expect(row.role).toBe('customer')
	})
})

describe('login', () => {
	test('logs in successfully with the correct password', async () => {
		await signUp('login@example.com', 'correct-password')
		const { status, headers } = await signIn('login@example.com', 'correct-password')

		expect(status).toBe(200)
		expect(extractCookieHeader(headers)).toContain('better-auth.session_token=')
	})

	test('rejects an incorrect password', async () => {
		await signUp('login2@example.com', 'correct-password')
		const { status, body } = await signIn('login2@example.com', 'wrong-password')

		expect(status).toBe(401)
		expect(body.code).toBe('INVALID_EMAIL_OR_PASSWORD')
	})
})

describe('session', () => {
	test('returns the current session for an authenticated request', async () => {
		const signUpResult = await signUp('session@example.com')
		const cookie = extractCookieHeader(signUpResult.headers)

		const { status, body } = await requestJson('/api/auth/get-session', {
			headers: { Cookie: cookie }
		})

		expect(status).toBe(200)
		expect(body.user.email).toBe('session@example.com')
		expect(body.session.userId).toBe(body.user.id)
	})

	test('returns no session without a cookie', async () => {
		const { body } = await requestJson('/api/auth/get-session')
		expect(body).toBeNull()
	})
})

describe('logout', () => {
	test('clears the session so it can no longer be retrieved', async () => {
		const signUpResult = await signUp('logout@example.com')
		const cookie = extractCookieHeader(signUpResult.headers)

		const signOutResult = await requestJson('/api/auth/sign-out', {
			method: 'POST',
			headers: { ...ORIGIN_HEADER, Cookie: cookie }
		})
		expect(signOutResult.status).toBe(200)

		const after = await requestJson('/api/auth/get-session', { headers: { Cookie: cookie } })
		expect(after.body).toBeNull()
	})
})

describe('requireAuth / requireRole middleware', () => {
	// A standalone app, never mounted into the real one - this sprint adds no
	// protected catalog-management routes. It only exercises the reusable
	// middleware against the real Better Auth session cookie.
	const protectedApp = new Hono()
	protectedApp.onError(errorHandler)
	protectedApp.get('/whoami', requireAuth, c => c.json({ email: c.get('user').email }))
	protectedApp.get('/admin-only', requireRole('admin'), c => c.json({ email: c.get('user').email }))

	test('denies access without a session cookie', async () => {
		const res = await protectedApp.fetch(new Request('http://localhost/whoami'))
		expect(res.status).toBe(401)
		const body = (await res.json()) as any
		expect(body.error.code).toBe('unauthorized')
	})

	test('allows access with a valid session cookie', async () => {
		const signUpResult = await signUp('guarded@example.com')
		const cookie = extractCookieHeader(signUpResult.headers)

		const res = await protectedApp.fetch(
			new Request('http://localhost/whoami', { headers: { Cookie: cookie } })
		)
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.email).toBe('guarded@example.com')
	})

	test('denies access when the session role does not match', async () => {
		const signUpResult = await signUp('notadmin@example.com')
		const cookie = extractCookieHeader(signUpResult.headers)

		const res = await protectedApp.fetch(
			new Request('http://localhost/admin-only', { headers: { Cookie: cookie } })
		)
		expect(res.status).toBe(403)
		const body = (await res.json()) as any
		expect(body.error.code).toBe('forbidden')
	})

	test('allows access once the role is promoted server-side', async () => {
		const signUpResult = await signUp('promoted@example.com')
		const cookie = extractCookieHeader(signUpResult.headers)

		await db.update(user).set({ role: 'admin' }).where(eq(user.email, 'promoted@example.com'))

		const res = await protectedApp.fetch(
			new Request('http://localhost/admin-only', { headers: { Cookie: cookie } })
		)
		expect(res.status).toBe(200)
	})
})

describe('public catalog API stays unauthenticated', () => {
	test('GET /api/v1/brands works without any session', async () => {
		const { status } = await requestJson('/api/v1/brands')
		expect(status).toBe(200)
	})
})
