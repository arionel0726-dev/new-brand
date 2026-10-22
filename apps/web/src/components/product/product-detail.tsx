'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
	ArrowLeft,
	ArrowRight,
	Check,
	ChevronDown,
	ChevronUp,
	Expand,
	Heart,
	RotateCcw,
	ShieldCheck,
	ShoppingBag,
	Truck,
	X
} from 'lucide-react'
import type { Dictionary } from '@/i18n/get-dictionary'
import type { Locale } from '@/i18n/config'
import type { Brand, Product } from '@/types/catalog'
import type { EditorialCopy } from '@/data/mock/product-details'
import { formatMoney } from '@/lib/catalog/money'
import { useCartStore } from '@/lib/cart-store'
import { cn } from '@/lib/utils'

type ProductDetailProps = {
	product: Product
	brand?: Brand
	locale: Locale
	dict: Dictionary
	editorial: EditorialCopy
}

type DetailSection = 'description' | 'characteristics' | 'application'

export function ProductDetail({ product, brand, locale, dict, editorial }: ProductDetailProps) {
	const [selectedVariantId, setSelectedVariantId] = useState(product.variants[0]?.id ?? '')
	const [selectedImageIndex, setSelectedImageIndex] = useState(0)
	const [isWishlisted, setIsWishlisted] = useState(false)
	const [added, setAdded] = useState(false)
	const [isFullscreen, setIsFullscreen] = useState(false)
	const [isQuickBuyOpen, setIsQuickBuyOpen] = useState(false)
	const [openSection, setOpenSection] = useState<DetailSection | null>('description')
	const addToCart = useCartStore(state => state.add)

	const variant = product.variants.find(item => item.id === selectedVariantId) ?? product.variants[0]
	const image = product.images[selectedImageIndex] ?? product.images[0]
	const name = product.name[locale] ?? product.name.ru
	const inStock = Boolean(variant && variant.quantityOnHand > 0)
	const hasVariants = product.variants.length > 1
	const hasShades = product.variants.some(item => item.colorVar)
	const variantLabel = hasShades ? dict.product.shade : dict.product.volume
	const discountPercent = variant?.compareAtPriceBani
		? Math.round((1 - variant.priceBani / variant.compareAtPriceBani) * 100)
		: null

	useEffect(() => {
		if (!isFullscreen && !isQuickBuyOpen) return

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setIsFullscreen(false)
				setIsQuickBuyOpen(false)
			}
		}

		document.addEventListener('keydown', handleKeyDown)
		const previousOverflow = document.body.style.overflow
		document.body.style.overflow = 'hidden'

		return () => {
			document.removeEventListener('keydown', handleKeyDown)
			document.body.style.overflow = previousOverflow
		}
	}, [isFullscreen, isQuickBuyOpen])

	if (!product.images.length || !variant) {
		return <EmptyProductState dict={dict} locale={locale} />
	}

	function changeImage(direction: 1 | -1) {
		setSelectedImageIndex(current => (current + direction + product.images.length) % product.images.length)
	}

	function selectVariant(variantId: string) {
		setSelectedVariantId(variantId)
		setAdded(false)
	}

	function handleAddToCart() {
		if (!inStock) return
		addToCart(product.id, variant.id)
		setAdded(true)
	}

	const detailSections: Array<{ id: DetailSection; title: string; content: React.ReactNode }> = [
		{
			id: 'description',
			title: dict.product.details,
			content: <p className="max-w-2xl text-sm leading-7 text-ink-muted">{editorial.introduction}</p>
		},
		{
			id: 'characteristics',
			title: dict.product.characteristics,
			content: (
				<ul className="grid gap-3 text-sm text-ink sm:grid-cols-3">
					{editorial.characteristics.map(item => (
						<li key={item} className="flex items-start gap-2">
							<Check className="mt-0.5 size-4 shrink-0 text-brand-accent" aria-hidden />
							<span>{item}</span>
						</li>
					))}
				</ul>
			)
		},
		{
			id: 'application',
			title: dict.product.application,
			content: <p className="max-w-2xl text-sm leading-7 text-ink-muted">{editorial.application}</p>
		}
	]

	return (
		<>
			<section className="mx-auto grid max-w-[1440px] min-w-0 gap-8 px-4 sm:px-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)] lg:gap-14 lg:px-10 xl:px-16">
				<Gallery
					images={product.images}
					name={name}
					selectedImageIndex={selectedImageIndex}
					isFullscreen={isFullscreen}
					setSelectedImageIndex={setSelectedImageIndex}
					setIsFullscreen={setIsFullscreen}
					changeImage={changeImage}
					dict={dict}
				/>

				<div className="min-w-0 lg:sticky lg:top-28 lg:self-start">
					<div className="flex items-start justify-between gap-4">
						<div className="min-w-0">
							{brand && (
								<Link
									href={`/${locale}/brands/${brand.slug}`}
									className="text-[11px] font-medium uppercase tracking-[0.2em] text-brand-accent transition-colors hover:text-ink"
								>
									{brand.name}
								</Link>
							)}
							<h1 className="mt-3 max-w-xl text-[clamp(2rem,5vw,3.6rem)] font-medium leading-[0.98] tracking-[-0.05em] text-ink">
								{name}
							</h1>
							<p className="mt-4 max-w-lg text-sm leading-6 text-ink-muted">{product.description[locale] ?? product.description.ru}</p>
						</div>
						<button
							type="button"
							aria-label={isWishlisted ? dict.product.wishlistRemove : dict.product.wishlistAdd}
							aria-pressed={isWishlisted}
							onClick={() => setIsWishlisted(value => !value)}
							className={cn(
								'flex size-[60px] shrink-0 items-center justify-center border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent',
								isWishlisted ? 'border-brand-accent bg-brand-accent text-white' : 'border-border text-ink hover:border-ink'
							)}
						>
							<Heart className="size-5" fill={isWishlisted ? 'currentColor' : 'none'} aria-hidden />
						</button>
					</div>

					<div className="mt-8 flex items-end gap-3 border-y border-border py-5">
						<span className="text-2xl font-medium tracking-tight text-ink">{formatMoney(variant.priceBani, locale)}</span>
						{variant.compareAtPriceBani && (
							<span className="pb-0.5 text-sm text-ink-muted line-through">{formatMoney(variant.compareAtPriceBani, locale)}</span>
						)}
						{discountPercent && <span className="mb-0.5 bg-promo px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-white">-{discountPercent}%</span>}
					</div>

					<div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
						<span className={cn('flex items-center gap-2 font-medium', inStock ? 'text-ink' : 'text-ink-muted')}>
							<span className={cn('size-2 rounded-full', inStock ? 'bg-brand-accent' : 'bg-border')} aria-hidden />
							{inStock ? dict.product.inStock : dict.product.outOfStock}
						</span>
						{inStock && variant.quantityOnHand <= 5 && <span className="text-ink-muted">{dict.product.stockLeft.replace('{count}', String(variant.quantityOnHand))}</span>}
						<span className="text-ink-muted">{dict.product.productNumber}: {variant.sku}</span>
					</div>

					{hasVariants && (
						<div className="mt-8">
							<div className="flex items-center justify-between gap-4">
								<p className="text-xs font-medium uppercase tracking-[0.16em] text-ink">{variantLabel}</p>
								<span className="text-xs text-ink-muted">{variant.label}</span>
							</div>
							<div className="mt-3 flex flex-wrap gap-2">
								{product.variants.map(item => {
									const selected = item.id === variant.id
									const available = item.quantityOnHand > 0
									return (
										<button
											key={item.id}
											type="button"
											aria-pressed={selected}
											onClick={() => selectVariant(item.id)}
											className={cn(
								'relative min-h-12 min-w-20 border px-4 py-3 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent',
												selected ? 'border-ink bg-ink text-white' : 'border-border text-ink hover:border-ink',
												!available && 'text-ink-muted line-through'
											)}
										>
											{item.label}
											{!available && <span className="ml-1 text-[10px] no-underline">· {dict.product.outOfStock}</span>}
										</button>
									)
								})}
							</div>
						</div>
					)}

					<div className="mt-8 grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.82fr)]">
						<button
							type="button"
							disabled={!inStock}
							onClick={handleAddToCart}
							className="flex min-h-[50px] items-center justify-center gap-2 bg-ink px-5 text-[11px] font-medium uppercase tracking-[0.14em] text-white transition-colors hover:bg-brand-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:cursor-not-allowed disabled:bg-surface-soft disabled:text-ink-muted"
						>
							<ShoppingBag className="size-4" aria-hidden />
							{added ? dict.product.addedToCart : inStock ? dict.product.addToCart : dict.product.outOfStock}
						</button>
						<button
							type="button"
							disabled={!inStock}
							onClick={() => setIsQuickBuyOpen(true)}
							className="min-h-[50px] border border-ink px-5 text-[11px] font-medium uppercase tracking-[0.14em] text-ink transition-colors hover:bg-surface-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent disabled:cursor-not-allowed disabled:border-border disabled:text-ink-muted"
						>
							{dict.product.oneClick}
						</button>
					</div>

					<ServiceNotes dict={dict} />
				</div>
			</section>

			<section className="mx-auto mt-16 max-w-[1440px] border-t border-border px-4 pt-2 sm:px-6 lg:mt-24 lg:px-10 xl:px-16" aria-label={dict.product.details}>
				<div className="divide-y divide-border">
					{detailSections.map(section => {
						const isOpen = openSection === section.id
						return (
							<div key={section.id}>
								<button
									type="button"
									aria-expanded={isOpen}
									onClick={() => setOpenSection(current => (current === section.id ? null : section.id))}
									className="flex min-h-16 w-full items-center justify-between gap-4 py-5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
								>
									<span className="text-sm font-medium uppercase tracking-[0.14em] text-ink">{section.title}</span>
									{isOpen ? <ChevronUp className="size-4 text-ink-muted" aria-hidden /> : <ChevronDown className="size-4 text-ink-muted" aria-hidden />}
								</button>
								{isOpen && <div className="pb-7">{section.content}</div>}
							</div>
						)
					})}
				</div>
			</section>

			<div className="fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-40 border-t border-border bg-white/95 p-3 backdrop-blur md:hidden">
				<div className="mx-auto flex max-w-lg items-center gap-3">
					<div className="min-w-0 flex-1">
						<p className="truncate text-xs text-ink-muted">{name}</p>
						<p className="mt-0.5 text-base font-medium text-ink">{formatMoney(variant.priceBani, locale)}</p>
					</div>
					<button
						type="button"
						disabled={!inStock}
						onClick={handleAddToCart}
						className="flex min-h-[50px] shrink-0 items-center justify-center gap-2 bg-ink px-5 text-[11px] font-medium uppercase tracking-[0.14em] text-white disabled:bg-surface-soft disabled:text-ink-muted"
					>
						<ShoppingBag className="size-4" aria-hidden />
						{added ? dict.product.addedToCart : dict.product.addToCart}
					</button>
				</div>
			</div>

			{isQuickBuyOpen && (
				<div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="quick-buy-title">
					<div className="w-full max-w-md bg-white p-6 shadow-2xl sm:p-8">
						<div className="flex items-start justify-between gap-4">
							<div>
								<p className="text-[11px] font-medium uppercase tracking-[0.2em] text-brand-accent">{dict.brand.name}</p>
								<h2 id="quick-buy-title" className="mt-3 text-2xl font-medium tracking-tight text-ink">{dict.product.oneClickTitle}</h2>
							</div>
							<button type="button" onClick={() => setIsQuickBuyOpen(false)} aria-label={dict.product.close} className="flex size-10 items-center justify-center border border-border text-ink">
								<X className="size-4" aria-hidden />
							</button>
						</div>
						<p className="mt-5 text-sm leading-6 text-ink-muted">{dict.product.oneClickText}</p>
						<div className="mt-6 flex items-center gap-3 border-y border-border py-4 text-sm">
							<div className="size-12 shrink-0 overflow-hidden bg-surface-soft">
								<Image src={image} alt="" width={48} height={48} className="size-full object-cover" />
							</div>
							<div className="min-w-0">
								<p className="truncate font-medium text-ink">{name}</p>
								<p className="mt-1 text-ink-muted">{formatMoney(variant.priceBani, locale)}</p>
							</div>
						</div>
						<button type="button" onClick={() => setIsQuickBuyOpen(false)} className="mt-6 min-h-[50px] w-full bg-ink px-4 text-[11px] font-medium uppercase tracking-[0.14em] text-white transition-colors hover:bg-brand-accent">
							{dict.product.close}
						</button>
					</div>
				</div>
			)}
		</>
	)
}

function Gallery({
	images,
	name,
	selectedImageIndex,
	isFullscreen,
	setSelectedImageIndex,
	setIsFullscreen,
	changeImage,
	dict
}: {
	images: string[]
	name: string
	selectedImageIndex: number
	isFullscreen: boolean
	setSelectedImageIndex: (index: number) => void
	setIsFullscreen: (value: boolean) => void
	changeImage: (direction: 1 | -1) => void
	dict: Dictionary
}) {
	const image = images[selectedImageIndex] ?? images[0]

	return (
		<div className="min-w-0">
			<div className="flex gap-3">
				<div className="hidden w-16 shrink-0 flex-col gap-2 lg:flex">
					{images.map((src, index) => (
						<Thumbnail key={src} src={src} index={index} selectedImageIndex={selectedImageIndex} name={name} setSelectedImageIndex={setSelectedImageIndex} />
					))}
				</div>
				<div className="relative min-w-0 flex-1 overflow-hidden bg-image-surface">
					<div className="relative aspect-[4/5] w-full">
						<Image src={image} alt={name} fill priority sizes="(min-width: 1024px) 54vw, 100vw" className="object-cover" />
					</div>
					<div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4 sm:p-5">
						<span className="bg-white/90 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-ink">{dict.product.galleryLabel}</span>
					<button type="button" onClick={() => setIsFullscreen(true)} aria-label={dict.product.openImage} className="pointer-events-auto flex size-10 items-center justify-center bg-white/90 text-ink transition-colors hover:bg-white">
							<Expand className="size-4" aria-hidden />
						</button>
					</div>
					{images.length > 1 && (
						<div className="absolute inset-x-0 bottom-0 flex justify-between p-4 sm:p-5">
							<GalleryButton label={dict.product.previousImage} onClick={() => changeImage(-1)}>
								<ArrowLeft className="size-4" aria-hidden />
							</GalleryButton>
							<GalleryButton label={dict.product.nextImage} onClick={() => changeImage(1)}>
								<ArrowRight className="size-4" aria-hidden />
							</GalleryButton>
						</div>
					)}
				</div>
			</div>

			<div className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
				{images.map((src, index) => (
					<Thumbnail key={src} src={src} index={index} selectedImageIndex={selectedImageIndex} name={name} setSelectedImageIndex={setSelectedImageIndex} />
				))}
			</div>

			{isFullscreen && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/95 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label={dict.product.galleryLabel} onClick={() => setIsFullscreen(false)}>
					<button type="button" onClick={() => setIsFullscreen(false)} aria-label={dict.product.close} className="absolute right-4 top-4 z-10 flex size-12 items-center justify-center rounded-full border border-white/25 text-white sm:right-8 sm:top-8">
						<X className="size-5" aria-hidden />
					</button>
					<div className="relative h-full w-full max-w-5xl" onClick={event => event.stopPropagation()}>
						<Image src={image} alt={name} fill sizes="100vw" className="object-contain" />
					</div>
				</div>
			)}
		</div>
	)
}

function Thumbnail({ src, index, selectedImageIndex, name, setSelectedImageIndex }: { src: string; index: number; selectedImageIndex: number; name: string; setSelectedImageIndex: (index: number) => void }) {
	return (
		<button
			type="button"
			aria-label={`${name} ${index + 1}`}
			aria-pressed={index === selectedImageIndex}
			onClick={() => setSelectedImageIndex(index)}
			className={cn('relative size-16 shrink-0 overflow-hidden bg-image-surface transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent sm:size-20 lg:size-16', index === selectedImageIndex ? 'opacity-100 ring-1 ring-ink ring-offset-2' : 'opacity-60 hover:opacity-100')}
		>
			<Image src={src} alt="" fill sizes="80px" className="object-cover" />
		</button>
	)
}

function GalleryButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
	return (
		<button type="button" aria-label={label} onClick={onClick} className="flex size-10 items-center justify-center bg-white/90 text-ink transition-colors hover:bg-white">
			{children}
		</button>
	)
}

function ServiceNotes({ dict }: { dict: Dictionary }) {
	return (
		<div className="mt-8 grid grid-cols-3 border-y border-border py-5">
			<ServiceNote icon={<Truck className="size-4" aria-hidden />} title={dict.product.delivery} text={dict.product.deliveryText} />
			<ServiceNote icon={<ShieldCheck className="size-4" aria-hidden />} title={dict.product.payment} text={dict.product.paymentText} />
			<ServiceNote icon={<RotateCcw className="size-4" aria-hidden />} title={dict.product.returns} text={dict.product.returnsText} />
		</div>
	)
}

function ServiceNote({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
	return (
		<div className="flex min-w-0 flex-col gap-2 border-r border-border px-3 first:pl-0 last:border-0 last:pr-0 sm:px-4">
			<div className="text-brand-accent">{icon}</div>
			<p className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink">{title}</p>
			<p className="text-[11px] leading-4 text-ink-muted">{text}</p>
		</div>
	)
}

function EmptyProductState({ dict, locale }: { dict: Dictionary; locale: Locale }) {
	return (
		<div className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center px-6 py-20 text-center">
			<p className="text-[11px] font-medium uppercase tracking-[0.2em] text-brand-accent">{dict.brand.name}</p>
			<h1 className="mt-4 text-3xl font-medium tracking-tight text-ink">{dict.product.emptyTitle}</h1>
			<p className="mt-3 text-sm leading-6 text-ink-muted">{dict.product.emptyText}</p>
		<Link href={`/${locale}/catalog`} className="mt-7 inline-flex min-h-[50px] items-center bg-ink px-5 text-[11px] font-medium uppercase tracking-[0.14em] text-white">
				{dict.product.backToCatalog}
			</Link>
		</div>
	)
}
