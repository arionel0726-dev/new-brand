import { zValidator } from '@hono/zod-validator'
import { treeifyError, z, type ZodType } from 'zod'
import { AppError } from '../middleware/error-handler'

export function validateQuery<T extends ZodType>(schema: T) {
	return zValidator('query', schema, result => {
		if (!result.success) {
			throw new AppError(
				'Invalid query parameters',
				400,
				'validation_error',
				treeifyError(result.error)
			)
		}
	})
}

export function validateJson<T extends ZodType>(schema: T) {
	return zValidator('json', schema, result => {
		if (!result.success) {
			throw new AppError('Invalid request body', 400, 'validation_error', treeifyError(result.error))
		}
	})
}

export function validateParam<T extends ZodType>(schema: T) {
	return zValidator('param', schema, result => {
		if (!result.success) {
			throw new AppError(
				'Invalid path parameter',
				400,
				'validation_error',
				treeifyError(result.error)
			)
		}
	})
}

/** Shared `:id` param shape for admin routes - every primary key in this project is a UUID. */
export const idParamSchema = z.object({ id: z.uuid() })
