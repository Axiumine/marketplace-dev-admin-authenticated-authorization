import { redisClient } from '@axiumine/koa-utils/dataSources/Redis'
import { setLoginCookies } from '@axiumine/koa-utils/lib/setLoginCookies'
import {
	accessTokenExpiry,
	generateAccessToken,
	generateRefreshToken,
	REFRESH_TOKEN_EXPIRY
} from '@axiumine/koa-utils/lib/tokens'
import { tryCatchRethrow } from '@axiumine/koa-utils/lib/tryCatchRethrow'
import { IContextAuthenticatedAuthorization } from '@lib/auth/IContextAuthenticatedAuthorization.mjs'
import { RefreshType } from '@ptypes/RefreshType.mjs'
import * as Sentry from '@sentry/node'
import * as dotenv from 'dotenv'
import { GraphQLError, GraphQLNonNull } from 'graphql'

dotenv.config()

export const refresh = {
	description: 'refresh token',
	type: new GraphQLNonNull(RefreshType),
	async resolve(_: unknown, {}, ctx: IContextAuthenticatedAuthorization) {
		// tryCatchRethrow(e) below (line 67) always throws: throwIfMongoErr's two branches each
		// throw, and tryCatchRethrow's own remaining branches do too (`throw throwGraphQLError(...)`
		// for a GraphQLError, `throw throwInternalError()` for anything else). So the catch block
		// never falls through to `return { status, accessToken }` below — that return is reached
		// only via the try block completing, at which point `status = true` (line 60) has already
		// overwritten this initial value. No reachable input observes `status` as false.
		// Stryker disable next-line BooleanLiteral: overwritten on every reachable path, see argument above.
		let status = false // default

		// holds the refresh token; the access token has already expired

		// legge dal db le info da mettere nell'Access Token -
		// not needed for now: only the userId carried by the current refresh token is read

		// genera i 2 nuovi token
		let accessToken = generateAccessToken()
		let refreshToken = generateRefreshToken()
		const keyAccess = `${process.env.REDIS_KEY}access:${accessToken}`
		const keyRefresh = `${process.env.REDIS_KEY}refresh:${refreshToken}`

		let accessTokenData = ctx.state.user
		const oldRefresh = ctx.state.user.refreshToken
		// @ts-expect-error delete refresh
		delete accessTokenData.refreshToken

		//const refreshTokeNData: IRefreshDataWt = { _id: accessTokenData._id }
		const refreshTokenData = { _id: accessTokenData._id }

		try {
			// Store session in Redis
			await Promise.all([
				redisClient.hSet(keyAccess, accessTokenData as unknown as Record<string, string>),
				redisClient.hSet(keyRefresh, refreshTokenData as unknown as Record<string, string>)
			])

			// se expiry
			const accTokenExp = accessTokenExpiry()

			await Promise.all([redisClient.expire(keyAccess, accTokenExp), redisClient.expire(keyRefresh, REFRESH_TOKEN_EXPIRY)])

			setLoginCookies(ctx, refreshToken)

			// delete the refresh token this call was made with
			await redisClient.del(`${process.env.REDIS_KEY}${oldRefresh}`)

			status = true
		} catch (e) {
			Sentry.captureException(e)
			// Dead store: tryCatchRethrow(e) at the bottom of this catch block always throws (see
			// the argument above `let status = false`), so this catch block never reaches the
			// `return` at the bottom of the resolver. Nothing ever reads refreshToken/accessToken
			// after this assignment.
			// Stryker disable next-line StringLiteral: value is never read, catch always rethrows below.
			refreshToken = accessToken = ''
			// delete keys
			await Promise.all([redisClient.del(keyAccess), redisClient.del(keyRefresh)])
			// Same dead-store argument as the assignment above: tryCatchRethrow(e) two lines down
			// always throws before this value is ever read.
			// Stryker disable next-line StringLiteral: value is never read, catch always rethrows below.
			accessToken = ''
			tryCatchRethrow(e as GraphQLError | Error)
		}

		return {
			status,
			accessToken
		}
	}
}
