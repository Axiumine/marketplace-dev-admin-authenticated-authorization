import { redisClient } from '@axiumine/koa-utils/dataSources/Redis'
import { IContextRefresh } from '@axiumine/koa-utils/graphQL/schema/context/IContextRefresh'
import { throwRefreshTokenExpiredOrDeleted } from '@axiumine/koa-utils/graphQL/throw/throwRefreshTokenExpiredOrDeleted'
import { verifySignedRefreshToken } from '@axiumine/koa-utils/koa/middleware/authenticatedAuthorizationHandler/verifySignedRefreshToken'
import { IContextAuthenticatedAuthorization } from '@lib/auth/IContextAuthenticatedAuthorization.mjs'
import { tokenInfoAdmin } from '@lib/auth/tokenInfoAdmin.mjs'
import { IRedisDataAdmin } from '@thedoctorweb_agency/marketplace-common/others/Redis/IRedisDataAdmin'
import * as dotenv from 'dotenv'
import Keygrip from 'keygrip'
import { Next } from 'koa'
import { Types } from 'mongoose'

dotenv.config()

/******************
 * riceve il token di refresh che possiede solo _id dell'utente, non tutte le info salvate nell'access token !
 */

export const adminAuthenticatedAuthorizationHandler =
	(keys: Keygrip) => async (ctx: IContextAuthenticatedAuthorization, next: Next) => {
		// console.log('[authorizationHandler] ')

		/***************************
		 * CLIENT: Invia opaque token
		 * - in authorization: ctx.request.header.authorization =  'Bearer TOKEN_HERE
		 * - in cookie: ctx.request.header.cookie = nome_cookie=TOKEN_HERE
		 */
		/*
    console.log('[authorizationAuthApiHandlerWt]')
    if (typeof ctx.request.header?.operation !== 'undefined') {
    const operationName = ctx.request.header.operation
    console.log('[authorizationHandler] operationName: ', operationName)
    }*/

		const refreshTokenRedis = verifySignedRefreshToken(ctx as unknown as IContextRefresh, keys)
		const redSession = await redisClient.hGetAll(`${process.env.REDIS_KEY}${refreshTokenRedis}`)
		if (Object.keys(redSession).length !== 0) {
			const redData = { ...redSession } // For safety, Redis return an object without the default Object.prototype  in its prototype chain.

			/***************************
			 * get info for access_token
			 */
			const uId = redData._id
			const uIdObj = new Types.ObjectId(uId)
			const admin = await tokenInfoAdmin(uIdObj)

			// this BE only save data to Redis, so we prepare ctx.state.user for Redis
			const tokenData: IRedisDataAdmin = {
				_id: uId,
				email: admin.login.email
			}

			ctx.state.user = {
				...tokenData,
				refreshToken: refreshTokenRedis
			}
		} else {
			// By the time control reaches this branch, verifySignedRefreshToken(ctx, keys) above has
			// already run to completion without throwing. It reads `ctx.request.header?.cookie` and
			// throws throwPreconditionFailedNoAuthCookie() whenever that is undefined — which happens
			// whenever ctx.request.header itself is null/undefined (the optional chaining there
			// short-circuits) or merely lacks a `cookie` property. So every input that reaches this
			// branch has already proven ctx.request.header to be a defined, non-null object; the `?.`
			// here can never observe it be otherwise. (Written as its own statement, rather than
			// inline in the `if` test below, so the Stryker disable comment attaches to the right node.)
			// Stryker disable next-line OptionalChaining: header proven defined above, see argument.
			const introspectionCode = ctx.request.header?.['x-introspectioncode']
			if (introspectionCode !== `${process.env.INTROSPECTION_CODE}`) {
				throw throwRefreshTokenExpiredOrDeleted()
			}
		} // else return next()

		return next()
	}
