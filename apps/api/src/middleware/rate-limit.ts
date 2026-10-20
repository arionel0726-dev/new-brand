/**
 * A minimal in-memory, fixed-window rate limiter - this project has no
 * Redis/BullMQ (explicitly out of scope), so this is single-instance only
 * and resets on restart or deploy. That's an accepted limitation for an
 * MVP guest-checkout abuse guard, not a distributed rate limiter.
 *
 * Disabled in tests (NODE_ENV === 'test'), the same convention
 * src/auth/config.ts already uses for Better Auth's own rate limiter -
 * the test suite fires many legitimate requests in quick succession from
 * one untraceable in-process client.
 */
import type { Context, MiddlewareHandler } from 'hono'
import { env } from '../config/env'
import { AppError } from './error-handler'

type Bucket = { count: number; resetAt: number }

export function createRateLimiter(options: {
	windowMs: number
	max: number
	keyFor: (c: Context) => string
}): MiddlewareHandler {
	const buckets = new Map<string, Bucket>()

	return async (c, next) => {
		if (env.NODE_ENV === 'test') {
			await next()
			return
		}

		const key = options.keyFor(c)
		const now = Date.now()
		const bucket = buckets.get(key)

		if (!bucket || bucket.resetAt <= now) {
			buckets.set(key, { count: 1, resetAt: now + options.windowMs })
		} else {
			bucket.count += 1
			if (bucket.count > options.max) {
				throw new AppError('Too many requests - please try again later', 429, 'rate_limited')
			}
		}

		await next()
	}
}

export function clientIpFor(c: Context): string {
	return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}
