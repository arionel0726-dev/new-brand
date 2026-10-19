import { beforeEach, describe, expect, test } from 'bun:test'
import { createSessionAs, requestJson, resetAuthTables, resetDatabase } from './helpers'

beforeEach(async () => {
	await resetDatabase()
	await resetAuthTables()
})

describe('admin route protection', () => {
	test('rejects an unauthenticated request with 401', async () => {
		const { status, body } = await requestJson('/api/v1/admin/brands')
		expect(status).toBe(401)
		expect(body.error.code).toBe('unauthorized')
	})

	test('rejects a customer with 403', async () => {
		const { cookie } = await createSessionAs('customer')
		const { status, body } = await requestJson('/api/v1/admin/brands', {
			headers: { Cookie: cookie }
		})
		expect(status).toBe(403)
		expect(body.error.code).toBe('forbidden')
	})

	test('allows a staff session', async () => {
		const { cookie } = await createSessionAs('staff')
		const { status } = await requestJson('/api/v1/admin/brands', { headers: { Cookie: cookie } })
		expect(status).toBe(200)
	})

	test('allows an admin session', async () => {
		const { cookie } = await createSessionAs('admin')
		const { status } = await requestJson('/api/v1/admin/brands', { headers: { Cookie: cookie } })
		expect(status).toBe(200)
	})

	test('the public catalog stays reachable without any session', async () => {
		const { status } = await requestJson('/api/v1/brands')
		expect(status).toBe(200)
	})
})

describe('admin brands CRUD', () => {
	test('staff can create a brand', async () => {
		const { cookie } = await createSessionAs('staff')
		const { status, body } = await requestJson('/api/v1/admin/brands', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ slug: 'nivea', nameRu: 'Нивея', nameRo: 'Nivea' })
		})

		expect(status).toBe(201)
		expect(body.data.slug).toBe('nivea')
		expect(body.data.isActive).toBe(true)
		expect(body.data.sortOrder).toBe(0)
	})

	test('rejects a duplicate slug with a clean 409, not a raw SQL error', async () => {
		const { cookie } = await createSessionAs('staff')
		await requestJson('/api/v1/admin/brands', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ slug: 'nivea', nameRu: 'Нивея', nameRo: 'Nivea' })
		})

		const { status, body } = await requestJson('/api/v1/admin/brands', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ slug: 'nivea', nameRu: 'Дубликат', nameRo: 'Duplicat' })
		})

		expect(status).toBe(409)
		expect(body.error.code).toBe('conflict')
		expect(JSON.stringify(body)).not.toMatch(/PostgresError|constraint.*violates|23505/i)
	})

	test('staff can edit a brand, including deactivating it', async () => {
		const { cookie } = await createSessionAs('staff')
		const created = await requestJson('/api/v1/admin/brands', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify({ slug: 'avon', nameRu: 'Эйвон', nameRo: 'Avon' })
		})

		const { status, body } = await requestJson(`/api/v1/admin/brands/${created.body.data.id}`, {
			method: 'PATCH',
			headers: { Cookie: cookie },
			body: JSON.stringify({ isActive: false, sortOrder: 5 })
		})

		expect(status).toBe(200)
		expect(body.data.isActive).toBe(false)
		expect(body.data.sortOrder).toBe(5)
		expect(body.data.nameRu).toBe('Эйвон') // untouched fields survive a partial update

		const publicList = await requestJson('/api/v1/brands')
		expect(publicList.body.data.map((b: { slug: string }) => b.slug)).not.toContain('avon')
	})

	test('404s for an unknown brand id', async () => {
		const { cookie } = await createSessionAs('admin')
		const { status } = await requestJson(
			'/api/v1/admin/brands/00000000-0000-0000-0000-000000000000',
			{ headers: { Cookie: cookie } }
		)
		expect(status).toBe(404)
	})
})

describe('admin categories CRUD and hierarchy protection', () => {
	async function createCategory(cookie: string, body: Record<string, unknown>) {
		return requestJson('/api/v1/admin/categories', {
			method: 'POST',
			headers: { Cookie: cookie },
			body: JSON.stringify(body)
		})
	}

	test('creates a nested category', async () => {
		const { cookie } = await createSessionAs('staff')
		const parent = await createCategory(cookie, {
			slug: 'skincare',
			nameRu: 'Уход',
			nameRo: 'Ingrijire'
		})
		const child = await createCategory(cookie, {
			slug: 'face',
			parentId: parent.body.data.id,
			nameRu: 'Лицо',
			nameRo: 'Fata'
		})

		expect(child.status).toBe(201)
		expect(child.body.data.parentId).toBe(parent.body.data.id)
	})

	test('rejects a category being set as its own parent', async () => {
		const { cookie } = await createSessionAs('staff')
		const category = await createCategory(cookie, {
			slug: 'makeup',
			nameRu: 'Макияж',
			nameRo: 'Machiaj'
		})

		const { status, body } = await requestJson(
			`/api/v1/admin/categories/${category.body.data.id}`,
			{
				method: 'PATCH',
				headers: { Cookie: cookie },
				body: JSON.stringify({ parentId: category.body.data.id })
			}
		)

		expect(status).toBe(400)
		expect(body.error.code).toBe('invalid_parent')
	})

	test('rejects a deeper cyclic hierarchy (grandchild becoming its own ancestor)', async () => {
		const { cookie } = await createSessionAs('staff')
		const a = await createCategory(cookie, { slug: 'a', nameRu: 'A', nameRo: 'A' })
		const b = await createCategory(cookie, {
			slug: 'b',
			parentId: a.body.data.id,
			nameRu: 'B',
			nameRo: 'B'
		})
		const c = await createCategory(cookie, {
			slug: 'c',
			parentId: b.body.data.id,
			nameRu: 'C',
			nameRo: 'C'
		})

		// a -> b -> c already exists; making a's parent = c would close the loop.
		const { status, body } = await requestJson(`/api/v1/admin/categories/${a.body.data.id}`, {
			method: 'PATCH',
			headers: { Cookie: cookie },
			body: JSON.stringify({ parentId: c.body.data.id })
		})

		expect(status).toBe(400)
		expect(body.error.code).toBe('cyclic_category_hierarchy')
	})

	test('allows a valid re-parent that does not create a cycle', async () => {
		const { cookie } = await createSessionAs('staff')
		const a = await createCategory(cookie, { slug: 'root-a', nameRu: 'A', nameRo: 'A' })
		const b = await createCategory(cookie, { slug: 'root-b', nameRu: 'B', nameRo: 'B' })

		const { status, body } = await requestJson(`/api/v1/admin/categories/${b.body.data.id}`, {
			method: 'PATCH',
			headers: { Cookie: cookie },
			body: JSON.stringify({ parentId: a.body.data.id })
		})

		expect(status).toBe(200)
		expect(body.data.parentId).toBe(a.body.data.id)
	})

	test('deactivated categories disappear from the public tree', async () => {
		const { cookie } = await createSessionAs('staff')
		const category = await createCategory(cookie, {
			slug: 'seasonal',
			nameRu: 'Сезонное',
			nameRo: 'Sezonier'
		})

		await requestJson(`/api/v1/admin/categories/${category.body.data.id}`, {
			method: 'PATCH',
			headers: { Cookie: cookie },
			body: JSON.stringify({ isActive: false })
		})

		const publicTree = await requestJson('/api/v1/categories')
		expect(publicTree.body.data.map((cat: { slug: string }) => cat.slug)).not.toContain('seasonal')
	})
})
