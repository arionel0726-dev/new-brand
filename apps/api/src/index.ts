import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auth } from './auth/config'
import { env } from './config/env'
import { errorHandler } from './middleware/error-handler'
import { health } from './routes/health'
import { v1Route } from './routes/v1'

const app = new Hono()

app.use(
	'/api/*',
	cors({
		// A single, specific origin - not a wildcard - and credentials
		// enabled so the browser will actually send/receive the session cookie.
		origin: env.WEB_ORIGIN,
		credentials: true
	})
)

app.onError(errorHandler)

// Better Auth owns everything under /api/auth/* (sign-up, sign-in, sign-out,
// get-session, ...). It is not wrapped in the catalog's success/error JSON
// envelope - it is a separate, independently-versioned surface by design.
app.on(['POST', 'GET'], '/api/auth/*', c => auth.handler(c.req.raw))

const routes = app.route('/api/health', health).route('/api/v1', v1Route)

export type AppType = typeof routes

export default {
	port: env.PORT,
	fetch: app.fetch
}
