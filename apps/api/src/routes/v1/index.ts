import { Hono } from 'hono'
import type { AuthVariables } from '../../auth/middleware'
import { adminRoute } from './admin'
import { brandsRoute } from './brands'
import { cartRoute } from './cart'
import { categoriesRoute } from './categories'
import { checkoutRoute } from './checkout'
import { ordersRoute } from './orders'
import { productsRoute } from './products'
import { searchRoute } from './search'
import { wishlistRoute } from './wishlist'

export const v1Route = new Hono<{ Variables: AuthVariables }>()
	.route('/brands', brandsRoute)
	.route('/categories', categoriesRoute)
	.route('/products', productsRoute)
	.route('/search', searchRoute)
	.route('/admin', adminRoute)
	.route('/cart', cartRoute)
	.route('/wishlist', wishlistRoute)
	.route('/checkout', checkoutRoute)
	.route('/orders', ordersRoute)

export type V1RouteType = typeof v1Route
