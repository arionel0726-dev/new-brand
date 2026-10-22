'use client'

import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { cn } from 'cn'

/**
 * Shared bottom-sheet / side-drawer primitive built on @base-ui/react's
 * Dialog (focus trap, Escape-to-close, scroll lock, aria wiring already
 * handled) - used for the mobile nav drawer and for catalog filter /
 * variant-picker bottom sheets.
 */

export const SheetRoot = Dialog.Root
export const SheetTrigger = Dialog.Trigger
export const SheetClose = Dialog.Close

type SheetContentProps = React.ComponentProps<typeof Dialog.Popup> & {
	side?: 'bottom' | 'left'
	title: string
	hideTitle?: boolean
}

export function SheetContent({ side = 'bottom', title, hideTitle, className, children, ...props }: SheetContentProps) {
	return (
		<Dialog.Portal>
			<Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 opacity-0 transition-opacity duration-200 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 data-[open]:opacity-100" />
			<Dialog.Popup
				className={cn(
					'fixed z-50 flex flex-col bg-white outline-none transition-transform duration-300 ease-out',
					side === 'bottom' &&
						'inset-x-0 bottom-0 max-h-[85dvh] border-t border-border pb-[env(safe-area-inset-bottom)] data-[starting-style]:translate-y-full data-[ending-style]:translate-y-full',
					side === 'left' &&
						'inset-y-0 left-0 h-dvh w-[min(22rem,88vw)] data-[starting-style]:-translate-x-full data-[ending-style]:-translate-x-full',
					className
				)}
				{...props}
			>
				{side === 'bottom' && <div className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-border" aria-hidden />}
				<div className="flex items-center justify-between border-b border-border px-5 py-4">
					<Dialog.Title className={cn('text-base font-medium text-ink', hideTitle && 'sr-only')}>{title}</Dialog.Title>
					<Dialog.Close
						aria-label="Close"
						className="-m-2 flex size-9 items-center justify-center text-ink transition-colors hover:bg-surface-soft"
					>
						<X className="size-5" aria-hidden />
					</Dialog.Close>
				</div>
				<div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
			</Dialog.Popup>
		</Dialog.Portal>
	)
}
