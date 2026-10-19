import { sql } from 'drizzle-orm'
import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Better Auth's own tables (user/session/account/verification), hand-written
 * to exactly match what its Drizzle adapter expects for a Postgres database
 * with `advanced.database.generateId: 'uuid'` (see src/auth/config.ts) -
 * keeps primary keys consistent with every other table in this project
 * instead of Better Auth's default random-text ids.
 *
 * `role` is the one addition beyond Better Auth's core schema: it is
 * registered with Better Auth as a `user.additionalFields` entry with
 * `input: false`, so the framework itself (not custom code) silently forces
 * every new signup to 'customer' and refuses any client-supplied value.
 */

export const userRoleEnum = ['customer', 'staff', 'admin'] as const
export type UserRole = (typeof userRoleEnum)[number]

export const user = pgTable('user', {
	id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('email_verified').notNull().default(false),
	image: text('image'),
	role: text('role', { enum: userRoleEnum }).notNull().default('customer'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

export const session = pgTable(
	'session',
	{
		id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		token: text('token').notNull().unique(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		userId: uuid('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' })
	},
	table => [index('session_user_id_idx').on(table.userId)]
)

export const account = pgTable(
	'account',
	{
		id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: uuid('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
		refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
		scope: text('scope'),
		// The password hash for the "credential" (email+password) provider.
		// Better Auth hashes it (scrypt by default) - this project never
		// reads, writes, or compares this value directly.
		password: text('password'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [index('account_user_id_idx').on(table.userId)]
)

export const verification = pgTable(
	'verification',
	{
		id: uuid('id').default(sql`gen_random_uuid()`).primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
	},
	table => [index('verification_identifier_idx').on(table.identifier)]
)
