/**
 * Sprint 12B.10 Requirement 3: shells out to `drizzle-kit check` - a
 * read-only, diagnostic-only command (it compares the project's migration
 * snapshots for drift/collisions; it never applies, generates, or pushes a
 * migration) - and reports whether migrations are current, without ever
 * invoking anything that could write to the database.
 *
 * Invoked via an explicit argv array (never a shell string), the same
 * portable shape `catalog-migration-backup.ts` uses for `pg_dump` - see
 * that module's doc comment for why.
 */
export type SpawnFn = (command: readonly string[], options: { cwd: string }) => Promise<{ exitCode: number; stdout: string; stderr: string }>

async function defaultSpawn(command: readonly string[], options: { cwd: string }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn([...command], { cwd: options.cwd, stdout: 'pipe', stderr: 'pipe' })
	const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
	return { exitCode, stdout, stderr }
}

export type MigrationCheckResult = { ok: boolean; raw: string }

/**
 * Runs `bunx drizzle-kit check` in `cwd` (defaults to this package's own
 * directory, where drizzle.config.ts lives) and reports its result. A
 * non-zero exit or any output naming drift/conflicts is reported as
 * `ok: false`; `drizzle-kit check`'s own text is always preserved verbatim
 * in `raw` for the caller to show the user, rather than being re-summarized
 * and potentially losing detail.
 */
export async function checkDrizzleMigrations(options: { cwd?: string; spawn?: SpawnFn } = {}): Promise<MigrationCheckResult> {
	const cwd = options.cwd ?? import.meta.dir.replace(/\/src\/import$/, '')
	const spawn = options.spawn ?? defaultSpawn
	let result: { exitCode: number; stdout: string; stderr: string }
	try {
		result = await spawn(['bunx', 'drizzle-kit', 'check'], { cwd })
	} catch (error) {
		return { ok: false, raw: `Could not run drizzle-kit check: ${error instanceof Error ? error.message : String(error)}` }
	}
	const output = `${result.stdout}${result.stderr}`.trim()
	const ok = result.exitCode === 0 && !/conflict|drift|error/i.test(output.replace(/Everything's fine/i, ''))
	return { ok, raw: output || `drizzle-kit check exited with code ${result.exitCode} and no output` }
}
