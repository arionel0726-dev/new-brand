import { sql } from 'drizzle-orm'
import { foreignKey, index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { user } from './auth'
import { productImages } from './product-images'
import { productVariants } from './product-variants'
import { products } from './products'

/**
 * A two-step upload's server-side state, kept in Postgres (not memory) so it
 * survives a restart and works across multiple API instances - there is no
 * separate job queue or worker here, just a row this request and the later
 * /complete request both read.
 *
 * 'pending' -> 'completed' (object verified, product_images row created) or
 * 'rejected' (verification failed; object_key queued in
 * media_pending_deletions for cleanup). Once out of 'pending' the row is
 * terminal - that's what makes re-confirming a no-op/conflict rather than
 * creating a second image.
 */
export const mediaUploadStatusEnum = pgEnum('media_upload_status', [
	'pending',
	'completed',
	'rejected'
])

export const mediaUploads = pgTable(
	'media_uploads',
	{
		id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
		objectKey: text('object_key').notNull().unique(),
		productId: uuid('product_id')
			.notNull()
			.references(() => products.id, { onDelete: 'cascade' }),
		variantId: uuid('variant_id'),
		fileName: text('file_name').notNull(),
		mimeType: text('mime_type').notNull(),
		// What the client declared at init time - never trusted on its own;
		// /complete re-checks the real object in R2 against this and the
		// hard 10MB ceiling.
		declaredFileSize: integer('declared_file_size').notNull(),
		status: mediaUploadStatusEnum('status').notNull().default('pending'),
		// Who initiated the upload - /complete requires the confirming
		// request to be the same staff/admin user.
		createdBy: uuid('created_by')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		completedAt: timestamp('completed_at', { withTimezone: true }),
		imageId: uuid('image_id').references(() => productImages.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	table => [
		index('media_uploads_product_id_idx').on(table.productId),
		index('media_uploads_created_by_idx').on(table.createdBy),
		// Same composite-FK pattern as product_images: rejects a variantId
		// that doesn't belong to productId, while a null variantId (product-
		// level image) skips the check entirely under MATCH SIMPLE.
		foreignKey({
			columns: [table.variantId, table.productId],
			foreignColumns: [productVariants.id, productVariants.productId],
			name: 'media_uploads_variant_product_fk'
		}).onDelete('cascade')
	]
)
