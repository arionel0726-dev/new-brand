export default function ProductLoading() {
	return (
		<div className="mx-auto max-w-[1440px] animate-pulse px-4 pb-24 pt-6 sm:px-6 lg:px-10 lg:pt-10 xl:px-16" aria-label="Loading">
			<div className="h-3 w-44 bg-surface-soft" />
			<div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)] lg:gap-14">
				<div className="aspect-[4/5] bg-surface-soft" />
				<div className="space-y-6 pt-2">
					<div className="h-3 w-24 bg-surface-soft" />
					<div className="h-16 max-w-md bg-surface-soft" />
					<div className="h-10 w-36 bg-surface-soft" />
					<div className="h-14 w-full bg-surface-soft" />
					<div className="h-14 w-full bg-surface-soft" />
				</div>
			</div>
		</div>
	)
}
