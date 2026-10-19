import { Hono } from 'hono'
import { brandsRoute } from './brands'
import { categoriesRoute } from './categories'
import { productsRoute } from './products'
import { searchRoute } from './search'

export const v1Route = new Hono()
	.route('/brands', brandsRoute)
	.route('/categories', categoriesRoute)
	.route('/products', productsRoute)
	.route('/search', searchRoute)

export type V1RouteType = typeof v1Route
