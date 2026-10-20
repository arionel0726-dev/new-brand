import { notFound } from 'next/navigation'
import { AlertTriangle, MapPin, Clock } from 'lucide-react'
import { isLocale } from '@/i18n/config'
import { getDictionary } from '@/i18n/get-dictionary'
import { getStores } from '@/lib/catalog/data'

/**
 * List-only stores page (no map API dependency). A map is deliberately not
 * wired up this sprint - the spec allows MapLibre later, but the fixture
 * locations here are development-only and explicitly must not be presented
 * as real, so a list with a visible notice is the safer default until real
 * store data exists.
 */
export default async function StoresPage({ params }: PageProps<'/[locale]/stores'>) {
	const { locale } = await params
	if (!isLocale(locale)) notFound()

	const [dict, stores] = await Promise.all([getDictionary(locale), getStores()])

	return (
		<div className="px-4 py-6 sm:px-6">
			<h1 className="text-xl font-medium text-ink">{dict.stores.title}</h1>

			<div className="mt-4 flex items-start gap-2 rounded-md bg-surface-soft px-3.5 py-3 text-sm text-ink-muted">
				<AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
				<p>{dict.stores.devDataNotice}</p>
			</div>

			<ul className="mt-6 flex flex-col divide-y divide-border border-t border-border">
				{stores.map(store => (
					<li key={store.id} className="flex flex-col gap-1.5 py-5">
						<span className="text-base font-medium text-ink">{store.name}</span>
						<span className="flex items-center gap-1.5 text-sm text-ink-muted">
							<MapPin className="size-4 shrink-0" aria-hidden />
							{store.address}
						</span>
						<span className="flex items-center gap-1.5 text-sm text-ink-muted">
							<Clock className="size-4 shrink-0" aria-hidden />
							{store.hours}
						</span>
					</li>
				))}
			</ul>
		</div>
	)
}
