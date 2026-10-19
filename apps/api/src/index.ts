import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

app.use(
	'/api/*',
	cors({
		origin: 'http://localhost:3000'
	})
)

const routes = app.get('/api/health', c => {
	return c.json({
		status: 'ok',
		service: 'api'
	})
})

export type AppType = typeof routes

export default {
	port: 3001,
	fetch: app.fetch
}
