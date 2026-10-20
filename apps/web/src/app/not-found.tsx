import Link from 'next/link'
import { defaultLocale } from '@/i18n/config'

/**
 * Root-level 404 - used when the request never resolves into a valid
 * [locale] segment at all (e.g. an unsupported locale code). A valid-locale
 * 404 (unknown product/brand slug) is handled by [locale]/not-found.tsx
 * instead, so it still renders with the Header/Footer and localized copy.
 */
export default function RootNotFound() {
	return (
		<html lang="ru">
			<body className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-white px-4 text-center">
				<h1 className="text-xl font-medium text-ink">404</h1>
				<p className="text-sm text-ink-muted">Страница не найдена</p>
				<Link href={`/${defaultLocale}`} className="text-sm text-ink underline underline-offset-4">
					На главную
				</Link>
			</body>
		</html>
	)
}
