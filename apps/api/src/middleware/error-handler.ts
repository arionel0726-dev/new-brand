import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ApiError } from '../types/api'

export class AppError extends Error {
	status: number
	code: string
	details?: unknown

	constructor(message: string, status = 500, code = 'internal_error', details?: unknown) {
		super(message)
		this.status = status
		this.code = code
		this.details = details
	}
}

export function errorHandler(err: Error, c: Context) {
	if (err instanceof AppError) {
		const body: ApiError = {
			success: false,
			error: {
				message: err.message,
				code: err.code,
				...(err.details !== undefined ? { details: err.details } : {})
			}
		}
		return c.json(body, err.status as 400 | 404 | 409 | 422 | 500 | 503)
	}

	if (err instanceof HTTPException) {
		const body: ApiError = {
			success: false,
			error: { message: err.message, code: 'http_exception' }
		}
		return c.json(body, err.status)
	}

	console.error(err)

	const body: ApiError = {
		success: false,
		error: { message: 'Internal server error', code: 'internal_error' }
	}
	return c.json(body, 500)
}
