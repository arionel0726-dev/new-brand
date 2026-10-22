import { z } from 'zod'

const envSchema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
	PORT: z.coerce.number().int().positive().default(3001),
	DATABASE_URL: z.url(),
	// Sprint 12B.11: the catalog-workflow CLI's WRITE path (and, when set,
	// its read-only analysis path too, so the preview reflects the same
	// database a matching write will target) prefers this over DATABASE_URL
	// when present, so a developer's regular DATABASE_URL can stay pointed
	// at their own local dev database (e.g. `beauty_store_dev`) for
	// everything else the app does, while catalog migration write/analysis
	// runs always target the isolated `beauty_store_test` database without
	// any manual DATABASE_URL override in the shell. Never used for anything
	// outside the catalog-workflow CLI.
	CATALOG_TEST_DATABASE_URL: z.url().optional(),
	MEILI_HOST: z.url(),
	MEILI_MASTER_KEY: z.string().min(1),
	WEB_ORIGIN: z.url().default('http://localhost:3000'),
	BETTER_AUTH_SECRET: z
		.string()
		.min(32, 'BETTER_AUTH_SECRET must be at least 32 characters (e.g. `openssl rand -hex 32`)'),
	BETTER_AUTH_URL: z.url().default('http://localhost:3001'),
	// R2 is an optional integration: the app must boot and the catalog must
	// keep working with none of these set. Media upload endpoints check
	// isR2Configured() themselves and return a clean config error instead.
	R2_ACCOUNT_ID: z.string().min(1).optional(),
	R2_ACCESS_KEY_ID: z.string().min(1).optional(),
	R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
	R2_BUCKET: z.string().min(1).optional(),
	R2_PUBLIC_URL: z.url().optional()
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
