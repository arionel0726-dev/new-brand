/**
 * Sprint 12B.10 Requirement 6: a pre-write backup of the isolated
 * `beauty_store_test` database, created and validated BEFORE a controlled
 * workflow write is allowed to proceed. This module creates no new
 * destructive-reset capability - the existing fail-closed
 * `resetCatalogTestDatabase` (catalog-slice-rollback.ts) is reused as-is,
 * never loosened, if a rollback is ever needed; this module's only job is
 * "can we restore if something goes wrong", not "how do we clear state".
 *
 * `pg_dump` is invoked with an explicit argv array (never a shell string),
 * which is inherently portable across PowerShell and macOS/bash - see
 * `spawnPgDump`'s doc comment for why this specific invocation shape was
 * chosen over anything shell-specific.
 */
import { mkdir, stat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { assertSafeImportTarget } from './catalog-importer'

export class BackupFailedError extends Error {}

export type SpawnResult = { exitCode: number; stderr: string }
export type SpawnFn = (command: readonly string[]) => Promise<SpawnResult>

/**
 * Default spawn implementation: `Bun.spawn` with an explicit argv array
 * (`[pgDumpPath, databaseUrl, '-f', outFile, ...]`) rather than a shell
 * command string. This is the portable choice - PowerShell and POSIX shells
 * disagree on quoting/escaping rules for a single command string, but both
 * platforms' Bun runtime accepts the same argv array and hands it straight
 * to the OS process-creation call, with no shell interpolation step for
 * either platform to disagree about.
 */
async function defaultSpawn(command: readonly string[]): Promise<SpawnResult> {
	const proc = Bun.spawn([...command], { stdout: 'ignore', stderr: 'pipe' })
	const exitCode = await proc.exited
	const stderr = await new Response(proc.stderr).text()
	return { exitCode, stderr }
}

/** Below this size, a file claiming to be a `pg_dump` backup is treated as untrustworthy rather than valid - a real dump always carries at least pg_dump's own header comments. */
const MIN_BACKUP_BYTES = 80

async function validateBackupFile(outFile: string): Promise<BackupResult> {
	let fileStat: { size: number }
	try {
		fileStat = await stat(outFile)
	} catch {
		throw new BackupFailedError(`pg_dump reported success but no backup file was found at ${outFile} - refusing to proceed without a validated backup.`)
	}
	if (fileStat.size < MIN_BACKUP_BYTES) {
		throw new BackupFailedError(
			`Backup file at ${outFile} is only ${fileStat.size} byte(s) - too small to be a real pg_dump output. Refusing to proceed with an unvalidated backup.`
		)
	}
	const head = (await readFile(outFile, { encoding: 'utf8' })).slice(0, 4096)
	if (!head.includes('PostgreSQL database dump') && !head.trimStart().startsWith('--')) {
		throw new BackupFailedError(
			`Backup file at ${outFile} does not look like valid pg_dump SQL output (no recognizable header). Refusing to proceed with an unvalidated backup.`
		)
	}
	return { path: outFile, sizeBytes: fileStat.size }
}

export type BackupResult = { path: string; sizeBytes: number }

export type CreateDatabaseBackupOptions = {
	/** Defaults to `pg_dump` resolved from PATH. */
	pgDumpPath?: string
	/** Injectable for tests - see module doc comment. Defaults to a real `Bun.spawn` call. */
	spawn?: SpawnFn
}

/**
 * Requirement 6: creates a timestamped `pg_dump` backup of the exact target
 * `databaseUrl` points at, then validates the resulting file actually looks
 * like a real backup before returning. Refuses (via `assertSafeImportTarget`,
 * reused unchanged) to run against anything but the isolated local test
 * database - this is a pre-WRITE safety step for `beauty_store_test`
 * specifically, never a generic backup tool pointed at an arbitrary target.
 *
 * Throws `BackupFailedError` if `pg_dump` is missing from PATH, exits
 * non-zero, or produces a file that fails validation - the caller (the
 * workflow's write path) must treat any such error as "do not proceed with
 * the write", never as a skippable warning.
 */
export async function createDatabaseBackup(
	databaseUrl: string,
	outDir: string,
	options: CreateDatabaseBackupOptions = {}
): Promise<BackupResult> {
	assertSafeImportTarget(databaseUrl)

	const pgDumpPath = options.pgDumpPath ?? 'pg_dump'
	const spawn = options.spawn ?? defaultSpawn

	await mkdir(outDir, { recursive: true })
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
	const outFile = path.join(outDir, `beauty_store_test-${timestamp}.sql`)

	let result: SpawnResult
	try {
		result = await spawn([pgDumpPath, databaseUrl, '-f', outFile, '--no-owner', '--no-privileges'])
	} catch (error) {
		throw new BackupFailedError(
			`Could not launch pg_dump (path: ${JSON.stringify(pgDumpPath)}) - is it installed and on PATH? Underlying error: ${error instanceof Error ? error.message : String(error)}`
		)
	}
	if (result.exitCode !== 0) {
		throw new BackupFailedError(`pg_dump exited with code ${result.exitCode}: ${result.stderr.trim() || '(no stderr output)'}`)
	}

	return validateBackupFile(outFile)
}
