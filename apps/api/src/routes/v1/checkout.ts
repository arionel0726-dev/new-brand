import { Hono } from 'hono'
import { z } from 'zod'
import type { AuthVariables } from '../../auth/middleware'
import { buildCheckoutPreview } from '../../checkout/preview'
import { resolveExistingCart } from '../../cart/resolve'
import { localeSchema } from '../../lib/locale'
import { ok } from '../../lib/respond'
import { validateQuery } from '../../lib/validate'

const previewQuerySchema = z.object({ lang: localeSchema.default('ru') })

export const checkoutRoute = new Hono<{ Variables: AuthVariables }>().post(
	'/preview',
	validateQuery(previewQuerySchema),
	async c => {
		const { lang } = c.req.valid('query')
		const cart = await resolveExistingCart(c)
		const preview = await buildCheckoutPreview(cart, lang)
		return ok(c, preview)
	}
)

export type CheckoutRouteType = typeof checkoutRoute
