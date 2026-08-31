import { redisClient } from '@axiumine/koa-utils/dataSources/Redis'
import { IContextRefresh } from '@axiumine/koa-utils/graphQL/schema/context/IContextRefresh'
import { verifySignedRefreshToken } from '@axiumine/koa-utils/koa/middleware/authenticatedAuthorizationHandler/verifySignedRefreshToken'
import { IRedisDataAdminCommon } from '@axiumine/marketplace-common/others/Redis/IRedisDataAdminCommon'
import { guardRefreshAttempt } from '@axiumine/marketplace-common/others/refreshRateLimit'
import { resolveAuthorizationSession } from '@axiumine/marketplace-common/others/resolveAuthorizationSession'
import { TIER } from '@axiumine/marketplace-common/others/Tier'
import { IContextAuthenticatedAuthorization } from '@lib/auth/IContextAuthenticatedAuthorization.mjs'
import { tokenInfoAdmin } from '@lib/auth/tokenInfoAdmin.mjs'
import * as dotenv from 'dotenv'
import Keygrip from 'keygrip'
import { Next } from 'koa'

dotenv.config()

/******************
 * receives the refresh token, which carries only the user's _id — not everything the access token holds!
 *
 * The lookup, the tier assertion and the shape of the session are shared with the shop-owner and
 * customer authorization services and live in `resolveAuthorizationSession`. What
 * stays here is the only part that is genuinely this tier's: which collection the `_id` is read from.
 * An admin's session carries the email and nothing else — no onboarding step, because an admin is
 * created by another admin rather than walked through a signup.
 */

export const adminAuthenticatedAuthorizationHandler =
	(keys: Keygrip) => async (ctx: IContextAuthenticatedAuthorization, next: Next) => {
		const refreshToken = verifySignedRefreshToken(ctx as unknown as IContextRefresh, keys)

		// ⚠️ **Before the session read, and that is the whole point**. This is the only limiter that
		// ever meters a token resolving to nothing — garbage, expired, tombstoned — because the per-family one
		// is never reached by a token that names no family. Twenty attempts a minute per token; the signature
		// has already been checked above, so a caller with no valid cookie never gets this far either.
		await guardRefreshAttempt(redisClient, refreshToken)

		ctx.state.user = await resolveAuthorizationSession<IRedisDataAdminCommon>({
			store: redisClient,
			refreshToken,
			tier: TIER.admin,
			readSessionData: async (_id) => {
				const admin = await tokenInfoAdmin(_id)

				return { email: admin.login.email }
			}
		})

		return next()
	}
