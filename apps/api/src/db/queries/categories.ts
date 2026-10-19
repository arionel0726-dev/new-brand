import { asc, eq } from 'drizzle-orm'
import { db } from '../client'
import { categories } from '../schema/categories'

export type CategoryRow = typeof categories.$inferSelect

export type CategoryNode = CategoryRow & { children: CategoryNode[] }

// The catalog's category tree is small enough (a handful of levels, not a
// general-purpose CMS taxonomy) that fetching it flat once and assembling the
// tree/descendant lookups in memory is simpler and just as correct as a
// recursive SQL CTE, without the extra query complexity.
//
// `activeOnly` lets the public API show only isActive categories while the
// admin API (which needs to list/edit disabled ones too) omits it. Filtering
// here, before buildCategoryTree/collectDescendantIds ever see the rows,
// is enough: an inactive category's still-active children are simply
// orphaned to the root rather than appearing under a hidden parent.
export async function fetchAllCategories(options: { activeOnly?: boolean } = {}): Promise<CategoryRow[]> {
	const query = db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.nameRu))
	if (options.activeOnly) {
		return query.where(eq(categories.isActive, true))
	}
	return query
}

export function buildCategoryTree(rows: CategoryRow[]): CategoryNode[] {
	const nodesById = new Map<string, CategoryNode>()
	for (const row of rows) {
		nodesById.set(row.id, { ...row, children: [] })
	}

	const roots: CategoryNode[] = []
	for (const node of nodesById.values()) {
		if (node.parentId && nodesById.has(node.parentId)) {
			nodesById.get(node.parentId)!.children.push(node)
		} else {
			roots.push(node)
		}
	}

	return roots
}

export function findChildren(rows: CategoryRow[], parentId: string): CategoryRow[] {
	return rows.filter(row => row.parentId === parentId)
}

/** The category itself plus every descendant id, for "include subcategories" filtering. */
export function collectDescendantIds(rows: CategoryRow[], rootId: string): string[] {
	const byParent = new Map<string, string[]>()
	for (const row of rows) {
		if (!row.parentId) continue
		const siblings = byParent.get(row.parentId) ?? []
		siblings.push(row.id)
		byParent.set(row.parentId, siblings)
	}

	const result: string[] = [rootId]
	const queue = [rootId]
	while (queue.length > 0) {
		const current = queue.shift()!
		const children = byParent.get(current) ?? []
		for (const childId of children) {
			result.push(childId)
			queue.push(childId)
		}
	}

	return result
}
