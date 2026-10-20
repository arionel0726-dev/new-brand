import { Hono } from 'hono'
import type { AuthVariables } from '../../../auth/middleware'
import { requireRole } from '../../../auth/middleware'
import { adminBrandsRoute } from './brands'
import { adminCategoriesRoute } from './categories'
import { adminDeliveryZonesRoute, adminPickupLocationsRoute } from './delivery'
import { adminImagesRoute } from './images'
import { adminMediaRoute } from './media'
import { adminOrdersRoute } from './orders'
import { adminProductsRoute } from './products'
import { adminVariantsRoute } from './variants'

/**
 * Everything under /api/v1/admin requires an authenticated session with role
 * 'staff' or 'admin' - checked server-side via the existing requireRole
 * middleware, applied once here rather than per-route. There is no separate
 * authorization system for the admin API; it reuses Sprint 3's Better Auth
 * session + role exactly as-is.
 *
 * Chained as a single expression (not separate `adminRoute.route(...)`
 * statements) so Hono's RPC type inference actually accumulates every
 * mounted sub-route - splitting it across statements silently freezes the
 * exported type at whatever `new Hono()` alone would be.
 */
export const adminRoute = new Hono<{ Variables: AuthVariables }>()
	.use('*', requireRole('staff', 'admin'))
	.route('/brands', adminBrandsRoute)
	.route('/categories', adminCategoriesRoute)
	.route('/products', adminProductsRoute)
	.route('/variants', adminVariantsRoute)
	.route('/media', adminMediaRoute)
	.route('/images', adminImagesRoute)
	.route('/delivery-zones', adminDeliveryZonesRoute)
	.route('/pickup-locations', adminPickupLocationsRoute)
	.route('/orders', adminOrdersRoute)

export type AdminRouteType = typeof adminRoute
