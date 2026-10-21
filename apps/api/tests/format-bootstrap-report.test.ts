import { describe, expect, test } from 'bun:test'
import { formatSkippedUnits } from '../src/import/format-bootstrap-report'
import type { BootstrapUnitOutcome } from '../src/import/brand-category-bootstrap'

/**
 * Sprint 12B.3.1 follow-up: the real local dry-run on Windows (exit 0, zero
 * Postgres writes) reported only "93/94 brands planned, 1 empty_title" /
 * "119/127 categories planned, 7 invalid_parent, 1 parent_not_resolved" -
 * the CLI never printed which legacy row each count referred to, even
 * though bootstrapBrands/bootstrapCategories already compute that detail
 * per unit. These tests pin the report's actual shape, not just "it runs".
 */

function skippedUnit(overrides: Partial<BootstrapUnitOutcome<'brand'>> & { legacyId: number }): BootstrapUnitOutcome<'brand'> {
	return {
		kind: 'brand',
		legacyName: '',
		legacyParentId: null,
		action: 'skipped',
		note: '',
		...overrides
	}
}

function createdUnit(id: number, name: string): BootstrapUnitOutcome<'brand'> {
	return { kind: 'brand', legacyId: id, legacyName: name, legacyParentId: null, action: 'created', note: '' }
}

function updatedUnit(id: number, name: string): BootstrapUnitOutcome<'brand'> {
	return { kind: 'brand', legacyId: id, legacyName: name, legacyParentId: null, action: 'updated', note: '' }
}

describe('formatSkippedUnits', () => {
	test('reports no-skips explicitly rather than printing an empty section', () => {
		const lines = formatSkippedUnits('brands', [createdUnit(1, 'Anny')])
		expect(lines).toContain('None - every brands in the dump resolved.')
		expect(lines.join('\n')).not.toContain('legacyId=1')
	})

	test('a skipped unit prints legacyId, legacyName, legacyParentId, skipReason and referencingProductCount', () => {
		const unit = skippedUnit({
			legacyId: 50,
			legacyName: '',
			legacyParentId: null,
			skipReason: 'empty_title',
			referencingProductCount: 7
		})
		const lines = formatSkippedUnits('brands', [unit])
		const row = lines.find(l => l.startsWith('legacyId=50'))
		expect(row).toBeDefined()
		expect(row).toContain('legacyName=""')
		expect(row).toContain('legacyParentId=null')
		expect(row).toContain('skipReason=empty_title')
		expect(row).toContain('referencingProductCount=7')
	})

	test('referencingProductCount reads as "not checked", never "0", when the caller never supplied a cross-reference map', () => {
		const unit = skippedUnit({ legacyId: 51, skipReason: 'empty_title' })
		const lines = formatSkippedUnits('brands', [unit])
		const row = lines.find(l => l.startsWith('legacyId=51'))!
		expect(row).toContain('referencingProductCount=not checked')
		expect(row).not.toContain('referencingProductCount=0')
	})

	test('a skipDetail is printed as an indented follow-up line, not folded into the summary row', () => {
		const unit = skippedUnit({
			legacyId: 60,
			legacyParentId: 999,
			skipReason: 'invalid_parent',
			skipDetail: 'parent_id 999 does not exist in the dump'
		})
		const lines = formatSkippedUnits('categories', [unit])
		expect(lines).toContain('  detail: parent_id 999 does not exist in the dump')
	})

	test('only skipped units appear - created/updated rows are never printed, even mixed in the same batch', () => {
		const units: BootstrapUnitOutcome<'brand'>[] = [
			createdUnit(1, 'Anny'),
			updatedUnit(2, 'Vichy'),
			skippedUnit({ legacyId: 3, skipReason: 'empty_title' })
		]
		const lines = formatSkippedUnits('brands', units)
		const text = lines.join('\n')
		expect(text).toContain('legacyId=3')
		expect(text).not.toContain('legacyId=1')
		expect(text).not.toContain('legacyId=2')
	})
})
