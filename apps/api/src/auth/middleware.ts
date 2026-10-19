import type { Context, MiddlewareHandler } from 'hono'
import { AppError } from '../middleware/error-handler'
import { auth } from './config'
import type { UserRole } from '../db/schema/auth'

export type SessionUser = typeof auth.$Infer.Session.user
export type SessionData = typeof auth.$Infer.Session.session

export type AuthVariables = {
	user: SessionUser
	session: SessionData
}

async function loadSession(c: Context) {
	return auth.api.getSession({ headers: c.req.raw.headers })
}

/** Rejects with 401 unless a valid session cookie is present; otherwise sets `user`/`session` on the context. */
export const requireAuth: MiddlewareHandler<{ Variables: AuthVariables }> = async (c, next) => {
	const result = await loadSession(c)

	if (!result) {
		throw new AppError('Authentication required', 401, 'unauthorized')
	}

	c.set('user', result.user)
	c.set('session', result.session)
	await next()
}

/**
 * Rejects with 401 if unauthenticated, 403 if authenticated but the user's
 * role is not one of `roles`. Stacks on top of what `requireAuth` does -
 * there is no need to apply both to the same route.
 */
export function requireRole(...roles: UserRole[]): MiddlewareHandler<{ Variables: AuthVariables }> {
	return async (c, next) => {
		const result = await loadSession(c)

		if (!result) {
			throw new AppError('Authentication required', 401, 'unauthorized')
		}

		const role = result.user.role as UserRole
		if (!roles.includes(role)) {
			throw new AppError('Insufficient role', 403, 'forbidden')
		}

		c.set('user', result.user)
		c.set('session', result.session)
		await next()
	}
}
