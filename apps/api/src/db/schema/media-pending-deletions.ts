import { sql } from 'drizzle-orm'
import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * A minimal retry queue for R2 object deletions that failed (or haven't been
 * attempted yet) - not a general job queue, just enough bookkeeping that a
 * failed delete is never silently treated as done. Rows are created when:
 * - an admin deletes a product_images row and the matching R2 delete fails, or
 * - /complete rejects an uploaded object (bad type/size) and the immediate
 *   best-effort delete of the orphaned object fails.
 * `bun run media:cleanup` sweeps this table; a row is removed once its
 * delete finally succeeds.
 */
export const mediaPendingDeletions = pgTable('media_pending_deletions', {
	id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
	objectKey: text('object_key').notNull().unique(),
	reason: text('reason').notNull(),
	attempts: integer('attempts').notNull().default(0),
	lastError: text('last_error'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true })
})
