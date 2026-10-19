/**
 * Server-side role assignment. This is the only way to grant 'staff' or
 * 'admin' in this project - there is deliberately no HTTP endpoint for it.
 *
 * Usage: bun run auth:set-role -- <email> <customer|staff|admin>
 */
import { eq } from 'drizzle-orm'
import { db, queryClient } from '../db/client'
import { user } from '../db/schema/auth'
import { userRoleEnum, type UserRole } from '../db/schema/auth'

function isUserRole(value: string): value is UserRole {
	return (userRoleEnum as readonly string[]).includes(value)
}

async function main() {
	const [email, role] = process.argv.slice(2)

	if (!email || !role) {
		console.error('Usage: bun run auth:set-role -- <email> <customer|staff|admin>')
		process.exit(1)
	}

	if (!isUserRole(role)) {
		console.error(`Invalid role "${role}". Must be one of: ${userRoleEnum.join(', ')}`)
		process.exit(1)
	}

	const [updated] = await db
		.update(user)
		.set({ role })
		.where(eq(user.email, email))
		.returning({ id: user.id, email: user.email, role: user.role })

	if (!updated) {
		console.error(`No user found with email "${email}"`)
		process.exit(1)
	}

	console.log(`Updated ${updated.email} (${updated.id}) to role "${updated.role}"`)
}

main()
	.then(() => queryClient.end())
	.then(() => process.exit(0))
	.catch(error => {
		console.error('Failed to set role:', error)
		process.exit(1)
	})
