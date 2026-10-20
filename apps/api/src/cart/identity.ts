/**
 * Who a cart request belongs to - a logged-in customer, or a guest
 * identified only by a random token in an HttpOnly cookie. Never trusts a
 * client-supplied user id or cart id; the session cookie (Better Auth) or
 * the guest cookie are the only two sources of identity a cart route reads.
 */
import { randomBytes, createHash } from 'node:crypto'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { auth } from '../auth/config'
import { env } from '../config/env'

export const GUEST_CART_COOKIE = 'guest_cart_token'
const GUEST_TOKEN_BYTES = 32
const GUEST_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days

export function generateGuestToken(): string {
	return randomBytes(GUEST_TOKEN_BYTES).toString('base64url')
}

/** The cart table only ever stores this hash - never the raw token. */
export function hashGuestToken(token: string): string {
	return createHash('sha256').update(token).digest('hex')
}

export function setGuestCartCookie(c: Context, token: string) {
	setCookie(c, GUEST_CART_COOKIE, token, {
		httpOnly: true,
		secure: env.NODE_ENV === 'production',
		sameSite: 'Lax',
		path: '/',
		maxAge: GUEST_COOKIE_MAX_AGE_SECONDS
	})
}

export function clearGuestCartCookie(c: Context) {
	deleteCookie(c, GUEST_CART_COOKIE, { path: '/' })
}

export type RequestIdentity =
	| { type: 'user'; userId: string }
	| { type: 'guest'; token: string | null }

/** Session takes priority - a signed-in request is never treated as a guest, even if a stale guest cookie is also present. */
export async function resolveIdentity(c: Context): Promise<RequestIdentity> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (session) {
		return { type: 'user', userId: session.user.id }
	}
	return { type: 'guest', token: getCookie(c, GUEST_CART_COOKIE) ?? null }
}
