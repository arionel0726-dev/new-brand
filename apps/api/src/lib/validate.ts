import { zValidator } from '@hono/zod-validator'
import { treeifyError, type ZodType } from 'zod'
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
