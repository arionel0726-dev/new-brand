import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from '../db/client'
import { env } from '../config/env'
import * as authSchema from '../db/schema/auth'

/**
 * Better Auth instance: handles registration, login, logout, session
 * issuance/verification and (not yet wired to an email provider, see
 * emailVerification/sendResetPassword below) email verification and
 * password reset tokens. Password hashing, session tokens and cookies are
 * entirely Better Auth's own mechanisms - nothing here re-implements them.
 */
export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: 'pg',
		schema: authSchema
	}),
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.BETTER_AUTH_URL,
	// A specific, single origin - never a wildcard - both for Better Auth's
	// own CSRF origin check and (separately) for the Hono CORS middleware.
	trustedOrigins: [env.WEB_ORIGIN],
	emailAndPassword: {
		enabled: true,
		minPasswordLength: 8,
		maxPasswordLength: 128,
		// No email provider is wired up yet (Sprint 3 scope), so sign-in
		// cannot be gated on a verification email nobody will ever receive.
		requireEmailVerification: false,
		sendResetPassword: async ({ user, url }) => {
			console.warn(
				`[auth] No email provider configured - password reset link for ${user.email} not sent: ${url}`
			)
		}
	},
	emailVerification: {
		sendVerificationEmail: async ({ user, url }) => {
			console.warn(
				`[auth] No email provider configured - verification link for ${user.email} not sent: ${url}`
			)
		}
	},
	// Brute-force protection: Better Auth applies a stricter built-in rule
	// (3 requests / 10s per IP+path) to /sign-in, /sign-up, /change-password
	// and /change-email regardless of the general window/max below. Off in
	// tests: the integration test suite makes many legitimate sign-up/sign-in
	// calls in quick succession from the same (untraceable, in-process)
	// client, which would otherwise trip this after only 3 calls.
	rateLimit: {
		enabled: env.NODE_ENV !== 'test',
		window: 60,
		max: 60
	},
	advanced: {
		database: {
			// UUIDs, consistent with every other primary key in this project.
			generateId: 'uuid'
		},
		// Explicit rather than left to auto-detection from NODE_ENV/baseURL:
		// plain HTTP in development, `Secure` cookies once deployed behind HTTPS.
		useSecureCookies: env.NODE_ENV === 'production'
	},
	user: {
		additionalFields: {
			role: {
				type: 'string',
				// input: false => Better Auth itself ignores/refuses any
				// client-supplied value for this field; defaultValue below is
				// what every public registration actually gets. There is no
				// public request path that can set 'staff' or 'admin'.
				input: false,
				defaultValue: 'customer'
			}
		}
	}
})

export type Auth = typeof auth
