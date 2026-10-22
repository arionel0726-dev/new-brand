import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { env } from '../src/config/env'
import { createDatabaseBackup, BackupFailedError, type SpawnFn } from '../src/import/catalog-migration-backup'
import { UnsafeImportTargetError } from '../src/import/catalog-importer'

if (!process.env.DATABASE_URL?.includes('test')) {
	throw new Error('Refusing to run tests: DATABASE_URL must point to a database with "test" in its name')
}

async function makeOutDir(): Promise<string> {
	return mkdtemp(path.join(tmpdir(), 'catalog-workflow-backup-'))
}

describe('createDatabaseBackup: target safety', () => {
	test('refuses against a non-test-database target before ever invoking pg_dump', async () => {
		const outDir = await makeOutDir()
		const spawnCalls: unknown[] = []
		const spawn: SpawnFn = async command => {
			spawnCalls.push(command)
			return { exitCode: 0, stderr: '' }
		}
		await expect(createDatabaseBackup('postgres://localhost/production', outDir, { spawn })).rejects.toBeInstanceOf(UnsafeImportTargetError)
		expect(spawnCalls.length).toBe(0)
		await rm(outDir, { recursive: true, force: true })
	})
})

describe('createDatabaseBackup: failure paths (stubbed pg_dump - proving the orchestration refuses correctly)', () => {
	test('refuses when pg_dump cannot be launched at all (e.g. missing from PATH)', async () => {
		const outDir = await makeOutDir()
		const spawn: SpawnFn = async () => {
			throw new Error('spawn pg_dump ENOENT')
		}
		await expect(createDatabaseBackup(env.DATABASE_URL, outDir, { spawn })).rejects.toBeInstanceOf(BackupFailedError)
		await rm(outDir, { recursive: true, force: true })
	})

	test('refuses when pg_dump exits non-zero', async () => {
		const outDir = await makeOutDir()
		const spawn: SpawnFn = async () => ({ exitCode: 1, stderr: 'pg_dump: error: connection refused' })
		let caught: unknown
		try {
			await createDatabaseBackup(env.DATABASE_URL, outDir, { spawn })
		} catch (error) {
			caught = error
		}
		expect(caught).toBeInstanceOf(BackupFailedError)
		expect((caught as BackupFailedError).message).toContain('connection refused')
		await rm(outDir, { recursive: true, force: true })
	})

	test('refuses when pg_dump reports success but never actually wrote a file', async () => {
		const outDir = await makeOutDir()
		// Exit 0, but never actually touches the -f output path.
		const spawn: SpawnFn = async () => ({ exitCode: 0, stderr: '' })
		await expect(createDatabaseBackup(env.DATABASE_URL, outDir, { spawn })).rejects.toBeInstanceOf(BackupFailedError)
		await rm(outDir, { recursive: true, force: true })
	})

	test('refuses when the written file is suspiciously small / not a real dump', async () => {
		const outDir = await makeOutDir()
		const spawn: SpawnFn = async command => {
			const outFile = command[3] as string
			await Bun.write(outFile, 'x')
			return { exitCode: 0, stderr: '' }
		}
		let caught: unknown
		try {
			await createDatabaseBackup(env.DATABASE_URL, outDir, { spawn })
		} catch (error) {
			caught = error
		}
		expect(caught).toBeInstanceOf(BackupFailedError)
		expect((caught as BackupFailedError).message).toContain('too small')
		await rm(outDir, { recursive: true, force: true })
	})

	test('refuses when the written file does not look like pg_dump SQL output at all', async () => {
		const outDir = await makeOutDir()
		const spawn: SpawnFn = async command => {
			const outFile = command[3] as string
			await Bun.write(outFile, 'x'.repeat(200))
			return { exitCode: 0, stderr: '' }
		}
		let caught: unknown
		try {
			await createDatabaseBackup(env.DATABASE_URL, outDir, { spawn })
		} catch (error) {
			caught = error
		}
		expect(caught).toBeInstanceOf(BackupFailedError)
		expect((caught as BackupFailedError).message).toContain('does not look like valid pg_dump')
		await rm(outDir, { recursive: true, force: true })
	})
})

describe('createDatabaseBackup: success path against the real local pg_dump', () => {
	// pg_dump IS present on PATH in this sandbox (confirmed: `pg_dump (PostgreSQL) 16.15`),
	// so this test exercises the REAL default spawn implementation against the
	// real isolated beauty_store_test database - not a stub - to actually prove
	// end-to-end backup creation works, not just the refusal paths above.
	test('creates and validates a real backup of beauty_store_test', async () => {
		const outDir = await makeOutDir()
		const result = await createDatabaseBackup(env.DATABASE_URL, outDir)
		expect(result.sizeBytes).toBeGreaterThan(80)
		const content = await readFile(result.path, 'utf8')
		expect(content).toContain('PostgreSQL database dump')
		await rm(outDir, { recursive: true, force: true })
	}, 30000)
})
