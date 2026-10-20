import Link from 'next/link'
import { defaultLocale } from '@/i18n/config'

/**
 * 404 for a valid locale segment with an unresolved route beneath it (e.g.
 * an unknown product/brand slug). Renders inside the [locale] layout, so
 * Header/Footer and <html lang> still reflect the current locale.
 */
export default function LocaleNotFound() {
	return (
		<div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
			<h1 className="text-xl font-medium text-ink">404</h1>
			<p className="text-sm text-ink-muted">Страница не найдена / Pagina nu a fost găsită</p>
			<Link href={`/${defaultLocale}`} className="text-sm text-ink underline underline-offset-4">
				На главную
			</Link>
		</div>
	)
}
