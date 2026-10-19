import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { env } from './config/env'
import { errorHandler } from './middleware/error-handler'
import { health } from './routes/health'

const app = new Hono()

app.use(
	'/api/*',
	cors({
		origin: env.WEB_ORIGIN
	})
)

app.onError(errorHandler)

const routes = app.route('/api/health', health)

export type AppType = typeof routes

export default {
	port: env.PORT,
	fetch: app.fetch
}
