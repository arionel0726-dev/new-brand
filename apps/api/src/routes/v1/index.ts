import { Hono } from 'hono'
import type { AuthVariables } from '../../auth/middleware'
import { adminRoute } from './admin'
import { brandsRoute } from './brands'
import { categoriesRoute } from './categories'
import { productsRoute } from './products'
import { searchRoute } from './search'

export const v1Route = new Hono<{ Variables: AuthVariables }>()
	.route('/brands', brandsRoute)
	.route('/categories', categoriesRoute)
	.route('/products', productsRoute)
	.route('/search', searchRoute)
	.route('/admin', adminRoute)

export type V1RouteType = typeof v1Route
