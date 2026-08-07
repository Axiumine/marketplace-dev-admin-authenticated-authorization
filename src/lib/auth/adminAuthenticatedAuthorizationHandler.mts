import { redisClient } from '@axiumine/koa-utils/dataSources/Redis'
import { IContextRefresh } from '@axiumine/koa-utils/graphQL/schema/context/IContextRefresh'
import { verifySignedRefreshToken } from '@axiumine/koa-utils/koa/middleware/authenticatedAuthorizationHandler/verifySignedRefreshToken'
import { IContextAuthenticatedAuthorization } from '@lib/auth/IContextAuthenticatedAuthorization.mjs'
import { tokenInfoAdmin } from '@lib/auth/tokenInfoAdmin.mjs'
import { IRedisDataAdminCommon } from '@thedoctorweb_agency/marketplace-common/others/Redis/IRedisDataAdminCommon'
import { resolveAuthorizationSession } from '@thedoctorweb_agency/marketplace-common/others/resolveAuthorizationSession'
import { TIER } from '@thedoctorweb_agency/marketplace-common/others/Tier'
import * as dotenv from 'dotenv'
import Keygrip from 'keygrip'
import { Next } from 'koa'

dotenv.config()

/******************
 * receives the refresh token, which carries only the user's _id — not everything the access token holds!
 *
 * The lookup, the tier assertion, the introspection bypass and the shape of the session are shared with
 * the shop-owner and customer authorization services and live in `resolveAuthorizationSession`. What
 * stays here is the only part that is genuinely this tier's: which collection the `_id` is read from.
 * An operator's session carries the email and nothing else — no onboarding step, because an operator is
 * created by another operator rather than walked through a signup.
 */

export const adminAuthenticatedAuthorizationHandler =
	(keys: Keygrip) => async (ctx: IContextAuthenticatedAuthorization, next: Next) => {
		const refreshToken = verifySignedRefreshToken(ctx as unknown as IContextRefresh, keys)

		const session = await resolveAuthorizationSession<IRedisDataAdminCommon>({
			store: redisClient,
			refreshToken,
			tier: TIER.admin,
			// By the time this value is read, verifySignedRefreshToken(ctx, keys) above has already run
			// to completion without throwing. It reads `ctx.request.header?.cookie` and throws
			// throwPreconditionFailedNoAuthCookie() whenever that is undefined — which happens whenever
			// ctx.request.header itself is null/undefined (the optional chaining there short-circuits)
			// or merely lacks a `cookie` property. So every input that reaches this line has already
			// proven ctx.request.header to be a defined, non-null object; the `?.` here can never
			// observe it be otherwise.
			// Stryker disable next-line OptionalChaining: header proven defined above, see argument.
			introspectionCode: ctx.request.header?.['x-introspectioncode'],
			readSessionData: async (_id) => {
				const admin = await tokenInfoAdmin(_id)

				return { email: admin.login.email }
			}
		})

		// `null` means the session had expired and the request carried a valid introspection code, so it
		// goes through with no `ctx.state.user` at all — a service-to-service call has no account behind it.
		if (session !== null) ctx.state.user = session

		return next()
	}
