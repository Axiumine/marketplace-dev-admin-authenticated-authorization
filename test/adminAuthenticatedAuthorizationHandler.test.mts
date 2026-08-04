import Keygrip from 'keygrip'
import type { Next } from 'koa'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { IContextAuthenticatedAuthorization } from '../src/lib/auth/IContextAuthenticatedAuthorization.mts'

const hGetAll = vi.fn()
const tokenInfoAdmin = vi.fn()

vi.mock('@axiumine/koa-utils/dataSources/Redis', () => ({ redisClient: { hGetAll } }))
vi.mock('@lib/auth/tokenInfoAdmin.mjs', () => ({ tokenInfoAdmin }))

const { adminAuthenticatedAuthorizationHandler } = await import('../src/lib/auth/adminAuthenticatedAuthorizationHandler.mts')

const keys = new Keygrip(['test-key-1', 'test-key-2'], 'sha512', 'base64')
const REFRESH = '27119032-9043-4a9f-bd4c-9d06fd576290'
// A real 24-hex ObjectId: the handler feeds redData._id straight into new Types.ObjectId().
const OID = '507f1f77bcf86cd799439011'

// Cookie signed the way Koa emits it: value + `.sig` cookie holding the Keygrip signature.
function signedCookie(token = REFRESH) {
	return `refresh_token=${token}; refresh_token.sig=${keys.sign(`refresh_token=${token}`)}`
}

function makeCtx(header: Record<string, string>) {
	return { request: { header }, state: {} } as unknown as IContextAuthenticatedAuthorization
}

/** Redis returns a prototype-less object; the handler spreads it, so mimic that shape. */
function redisSession(_id = OID) {
	return Object.assign(Object.create(null), { _id })
}

describe('adminAuthenticatedAuthorizationHandler', () => {
	let next: Next

	beforeEach(() => {
		hGetAll.mockReset()
		tokenInfoAdmin.mockReset()
		next = vi.fn().mockResolvedValue('next') as unknown as Next
	})

	it('rejects the request without a cookie', async () => {
		const ctx = makeCtx({})

		await expect(adminAuthenticatedAuthorizationHandler(keys)(ctx, next)).rejects.toThrow()
		expect(hGetAll).not.toHaveBeenCalled()
		expect(next).not.toHaveBeenCalled()
	})

	it('rejects a cookie with an invalid signature', async () => {
		const ctx = makeCtx({ cookie: `refresh_token=${REFRESH}; refresh_token.sig=fake-signature` })

		await expect(adminAuthenticatedAuthorizationHandler(keys)(ctx, next)).rejects.toThrow()
		expect(hGetAll).not.toHaveBeenCalled()
	})

	// No onboarding data here, unlike the imprenditore tier: an Admin is created by the platform
	// operator, never onboarded, so state.user carries only _id, email and the refresh token.
	it('builds state.user from the Redis session and the admin record', async () => {
		hGetAll.mockResolvedValueOnce(redisSession())
		tokenInfoAdmin.mockResolvedValueOnce({ login: { email: 'operator@marketplace.test' } })

		const ctx = makeCtx({ cookie: signedCookie() })

		await expect(adminAuthenticatedAuthorizationHandler(keys)(ctx, next)).resolves.toBe('next')

		expect(hGetAll).toHaveBeenCalledExactlyOnceWith(`test:refresh:${REFRESH}`)
		// The id string is turned into an ObjectId before the lookup.
		expect(String(tokenInfoAdmin.mock.calls[0][0])).toBe(OID)
		expect(ctx.state.user).toEqual({
			_id: OID,
			email: 'operator@marketplace.test',
			refreshToken: `refresh:${REFRESH}`
		})
		expect(next).toHaveBeenCalledTimes(1)
	})

	it('propagates the rejection when the admin is disabled, deleted or gone', async () => {
		hGetAll.mockResolvedValueOnce(redisSession())
		tokenInfoAdmin.mockRejectedValueOnce(new Error('unauthorized'))

		const ctx = makeCtx({ cookie: signedCookie() })

		await expect(adminAuthenticatedAuthorizationHandler(keys)(ctx, next)).rejects.toThrow('unauthorized')
		expect(next).not.toHaveBeenCalled()
	})

	it('rejects when the refresh session no longer exists in Redis', async () => {
		hGetAll.mockResolvedValueOnce({})

		const ctx = makeCtx({ cookie: signedCookie() })

		await expect(adminAuthenticatedAuthorizationHandler(keys)(ctx, next)).rejects.toThrow()
		expect(tokenInfoAdmin).not.toHaveBeenCalled()
		expect(next).not.toHaveBeenCalled()
	})

	it('lets a valid x-introspectioncode through an expired session without touching Mongo', async () => {
		hGetAll.mockResolvedValueOnce({})

		const ctx = makeCtx({ cookie: signedCookie(), 'x-introspectioncode': 'test-introspection-code' })

		await expect(adminAuthenticatedAuthorizationHandler(keys)(ctx, next)).resolves.toBe('next')
		expect(tokenInfoAdmin).not.toHaveBeenCalled()
		expect(ctx.state.user).toBeUndefined()
		expect(next).toHaveBeenCalledTimes(1)
	})

	it('ignores a wrong x-introspectioncode', async () => {
		hGetAll.mockResolvedValueOnce({})

		const ctx = makeCtx({ cookie: signedCookie(), 'x-introspectioncode': 'wrong-code' })

		await expect(adminAuthenticatedAuthorizationHandler(keys)(ctx, next)).rejects.toThrow()
	})
})
