import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { db, queryClient } from './client'

async function main() {
	await migrate(db, { migrationsFolder: './drizzle' })
	await queryClient.end()
	console.log('Migrations applied successfully')
}

main().catch(error => {
	console.error('Migration failed:', error)
	process.exit(1)
})
