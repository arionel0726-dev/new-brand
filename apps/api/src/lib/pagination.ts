import { z } from 'zod'

export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100

export const paginationSchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE)
})

export type Pagination = z.infer<typeof paginationSchema>

export type PageMeta = {
	page: number
	limit: number
	total: number
	totalPages: number
}

export function buildPageMeta(pagination: Pagination, total: number): PageMeta {
	return {
		page: pagination.page,
		limit: pagination.limit,
		total,
		totalPages: Math.max(1, Math.ceil(total / pagination.limit))
	}
}
