export type ApiSuccess<T, M = undefined> = {
	success: true
	data: T
	meta?: M
}

export type ApiError = {
	success: false
	error: {
		message: string
		code: string
		details?: unknown
	}
}

export type ApiResponse<T, M = undefined> = ApiSuccess<T, M> | ApiError
