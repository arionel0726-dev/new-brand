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

type PostgresErrorLike = {
	code: string
	constraint_name?: string
	table_name?: string
	column_name?: string
	detail?: string
}

function isPostgresErrorLike(value: unknown): value is PostgresErrorLike {
	return (
		typeof value === 'object' &&
		value !== null &&
		'code' in value &&
		typeof (value as { code: unknown }).code === 'string'
	)
}

/**
 * Drizzle wraps every driver error in a DrizzleQueryError whose `.cause` is
 * the raw postgres.js PostgresError - never thrown directly, so `err` here
 * is typically that wrapper. Unwrap one level to find a Postgres SQLSTATE
 * code, without otherwise caring what threw it.
 */
function findPostgresError(err: unknown): PostgresErrorLike | null {
	if (isPostgresErrorLike(err)) return err
	if (err instanceof Error && 'cause' in err && isPostgresErrorLike(err.cause)) return err.cause
	return null
}

/**
 * Maps a small, known set of Postgres constraint-violation SQLSTATEs to a
 * clean AppError instead of letting the raw driver error (query text, table
 * and column names, parameter values) reach the client. Anything else falls
 * through to the generic 500 handler below.
 */
function mapDatabaseError(pgError: PostgresErrorLike): AppError | null {
	switch (pgError.code) {
		case '23505': // unique_violation
			return new AppError(
				pgError.constraint_name
					? `A record with this ${pgError.column_name ?? 'value'} already exists`
					: 'This record already exists',
				409,
				'conflict',
				{ constraint: pgError.constraint_name }
			)
		case '23503': // foreign_key_violation
			return new AppError('Referenced record does not exist', 422, 'invalid_reference', {
				constraint: pgError.constraint_name
			})
		case '23514': // check_violation
			return new AppError('Value violates a database constraint', 400, 'validation_error', {
				constraint: pgError.constraint_name
			})
		default:
			return null
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

	const pgError = findPostgresError(err)
	if (pgError) {
		const mapped = mapDatabaseError(pgError)
		if (mapped) {
			console.error(`[db] ${pgError.code} on constraint "${pgError.constraint_name}":`, err.message)
			return errorHandler(mapped, c)
		}
	}

	console.error(err)

	const body: ApiError = {
		success: false,
		error: { message: 'Internal server error', code: 'internal_error' }
	}
	return c.json(body, 500)
}
