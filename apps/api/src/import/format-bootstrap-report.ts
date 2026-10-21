/**
 * Pure formatting for the brand/category bootstrap CLI's skipped-unit
 * report (Sprint 12B.3.1 follow-up). Kept separate from
 * cli/brand-category-bootstrap.ts - every file under import/cli/ calls its
 * own main() unconditionally at module load, so nothing there can be
 * imported directly by a test. This module has no side effects on import
 * and is safe to unit test.
 */
import type { BootstrapUnitOutcome } from './brand-category-bootstrap'

/**
 * Returns the lines the CLI should print for one kind's skipped units -
 * only the skipped ones, never the successfully created/updated rows,
 * so a 94-brand or 127-category dump doesn't bury the handful of rows
 * that actually need a human decision.
 */
export function formatSkippedUnits(label: string, units: BootstrapUnitOutcome<'brand' | 'category'>[]): string[] {
	const skipped = units.filter(u => u.action === 'skipped')
	const lines: string[] = [`=== Skipped ${label} ===`]

	if (skipped.length === 0) {
		lines.push(`None - every ${label.toLowerCase()} in the dump resolved.`)
		return lines
	}

	for (const unit of skipped) {
		const parts = [
			`legacyId=${unit.legacyId}`,
			`legacyName=${JSON.stringify(unit.legacyName)}`,
			`legacyParentId=${unit.legacyParentId ?? 'null'}`,
			`skipReason=${unit.skipReason ?? 'unknown'}`,
			`referencingProductCount=${unit.referencingProductCount ?? 'not checked'}`
		]
		// Sprint 12B.3.2 Requirement 3: only printed for categories (brands have
		// no secondary/junction-table membership concept) and only when the
		// caller actually supplied the per-source maps - otherwise this stays
		// silent rather than printing two more "not checked" fields nobody asked for.
		if (unit.kind === 'category' && (unit.referencingProductCountPrimary !== undefined || unit.referencingProductCountSecondary !== undefined)) {
			parts.push(`referencingProductCountPrimary=${unit.referencingProductCountPrimary ?? 'not checked'}`)
			parts.push(`referencingProductCountSecondary=${unit.referencingProductCountSecondary ?? 'not checked'}`)
		}
		lines.push(parts.join(' | '))
		if (unit.skipDetail) lines.push(`  detail: ${unit.skipDetail}`)
	}

	return lines
}
