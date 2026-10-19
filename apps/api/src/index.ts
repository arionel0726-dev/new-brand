import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { env } from './config/env'
import { errorHandler } from './middleware/error-handler'
import { health } from './routes/health'
import { v1Route } from './routes/v1'

const app = new Hono()

app.use(
	'/api/*',
	cors({
		origin: env.WEB_ORIGIN
	})
)

app.onError(errorHandler)

const routes = app.route('/api/health', health).route('/api/v1', v1Route)

export type AppType = typeof routes

export default {
	port: env.PORT,
	fetch: app.fetch
}
