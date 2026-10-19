import { z } from 'zod'

const envSchema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
	PORT: z.coerce.number().int().positive().default(3001),
	DATABASE_URL: z.url(),
	MEILI_HOST: z.url(),
	MEILI_MASTER_KEY: z.string().min(1),
	WEB_ORIGIN: z.url().default('http://localhost:3000')
})

export type Env = z.infer<typeof envSchema>

function loadEnv(): Env {
	const parsed = envSchema.safeParse(process.env)

	if (!parsed.success) {
		console.error('Invalid environment configuration:', z.treeifyError(parsed.error))
		throw new Error('Invalid environment configuration')
	}

	return parsed.data
}

export const env = loadEnv()
