import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { defaultLocale, locales } from '@/i18n/config'

/**
 * Prefixes every locale-less path with the default locale (ru). An
 * unsupported locale segment is left alone - the [locale] layout itself
 * calls notFound() for it, which is how Next.js renders a real 404 instead
 * of a redirect loop.
 */
export function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl

	const pathnameHasLocale = locales.some(locale => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`))
	if (pathnameHasLocale) return NextResponse.next()

	const url = request.nextUrl.clone()
	url.pathname = `/${defaultLocale}${pathname}`
	return NextResponse.redirect(url)
}

export const config = {
	matcher: ['/((?!_next|api|.*\\..*).*)']
}
