import type { Context } from 'hono'
import type { ApiSuccess } from '../types/api'

export function ok<T>(c: Context, data: T, status: 200 | 201 = 200) {
	const body: ApiSuccess<T> = { success: true, data }
	return c.json(body, status)
}

export function okWithMeta<T, M>(c: Context, data: T, meta: M, status: 200 | 201 = 200) {
	const body: ApiSuccess<T, M> = { success: true, data, meta }
	return c.json(body, status)
}
