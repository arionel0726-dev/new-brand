import Link from 'next/link'
import type { Dictionary } from '@/i18n/get-dictionary'
import type { Locale } from '@/i18n/config'

type FooterProps = {
	locale: Locale
	dict: Dictionary
}

const COPYRIGHT_YEAR = 2026

/**
 * Config-driven footer. No invented phone numbers, addresses, social URLs,
 * or policies - sections without verified real data render a visible
 * "to be confirmed" placeholder instead of fabricated content.
 */
export function Footer({ locale, dict }: FooterProps) {
	return (
		<footer className="border-t border-footer bg-footer text-white">
			<div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-5 py-10 sm:grid-cols-4 sm:px-6 sm:py-14">
				<FooterColumn title={dict.footer.company}>
					<FooterLink href={`/${locale}`} label={dict.footer.aboutUs} />
					<FooterLink href={`/${locale}/stores`} label={dict.footer.stores} />
				</FooterColumn>
				<FooterColumn title={dict.footer.support}>
					<FooterLink href={`/${locale}/support/delivery`} label={dict.footer.delivery} />
					<FooterLink href={`/${locale}/support/payment`} label={dict.footer.payment} />
					<FooterLink href={`/${locale}/support/returns`} label={dict.footer.returns} />
				</FooterColumn>
				<FooterColumn title={dict.footer.contacts}>
					<span className="text-sm text-white/60">{dict.footer.contactsPlaceholder}</span>
				</FooterColumn>
				<FooterColumn title={dict.footer.legal}>
					<FooterLink href={`/${locale}/legal/terms`} label={dict.footer.terms} />
					<FooterLink href={`/${locale}/legal/privacy`} label={dict.footer.privacy} />
				</FooterColumn>
			</div>
			<div className="border-t border-white/15 px-5 py-5 sm:px-6">
				<p className="text-xs text-white/60">{dict.footer.socialPlaceholder}</p>
				<p className="mt-3 text-xs text-white/60">
					{/* Fixed, not new Date() - cacheComponents prerendering forbids a live clock read here; a request-time footer isn't worth losing static rendering for. */}
					© {COPYRIGHT_YEAR} {dict.brand.name}. {dict.footer.rights}.
				</p>
			</div>
		</footer>
	)
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-2.5">
			<h2 className="text-xs font-medium uppercase tracking-wide text-white">{title}</h2>
			<div className="flex flex-col gap-2">{children}</div>
		</div>
	)
}

function FooterLink({ href, label }: { href: string; label: string }) {
	return (
		<Link href={href} className="text-sm text-white/70 transition-colors hover:text-white">
			{label}
		</Link>
	)
}
