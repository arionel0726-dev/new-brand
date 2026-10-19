import { Meilisearch } from 'meilisearch'
import { env } from '../config/env'

export const searchClient = new Meilisearch({
	host: env.MEILI_HOST,
	apiKey: env.MEILI_MASTER_KEY
})
