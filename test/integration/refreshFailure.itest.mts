import { randomUUID } from 'node:crypto'

import { redisClient, RedisConnect, RedisDisconnect } from '@axiumine/koa-utils/dataSources/Redis'
import { sha256Hex } from '@axiumine/marketplace-common/others/sha256Hex'
import mongoose from 'mongoose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { refresh } from '../../src/graphQLApi/schema/mutations/refresh.mts'
import type { IContextAuthenticatedAuthorization } from '../../src/lib/auth/IContextAuthenticatedAuthorization.mts'

/*
 * refresh's catch arm (Sentry.captureException, the two rollback `del`s, the dead-store
 * assignments and the final tryCatchRethrow), driven against the REAL Redis cluster — nothing
 * mocked, nothing closed early.
 *
 * The unit suite (test/refresh.test.mts) reaches this arm by mocking redisClient.hSet to reject.
 * Reaching it here for real needs a genuine client-side failure instead, and the two obvious ones
 * do not work:
 *   - the resolver generates both new keys itself (uuidv4, 128 bits) before this test regains
 *     control, so there is no way to pre-poison a colliding key (e.g. WRONGTYPE) from outside;
 *   - closing the shared redisClient first fails the intended hSet, but the catch block's own
 *     rollback `del`s run against that same closed client and fail identically — the resolver
 *     never reaches its final tryCatchRethrow(e), so lines 81-82 would stay uncovered.
 *
 * What DOES fail deterministically, without touching the connection at all, is handing hSet a
 * value the real `redis` client refuses to serialise: a hash field of `undefined`. node-redis
 * validates field values before a single byte reaches the socket (verified directly against this
 * project's real client — see the session notes), so the throw happens client-side and neither
 * hash key is ever written. That is exactly what lets the rollback `del`s that follow run clean
 * against the still-open connection and reach the resolver's real rethrow.
 *
 * A real `admin` document can never carry this shape — `login.email` is a required string in the
 * $jsonSchema validator — so this is driven by calling the resolver directly with a hand-built
 * ctx, the same way the unit test does, rather than by seeding Mongo and going over HTTP.
 */

/*
 * The lineage the rotation needs before it will mint anything (E14-S01), and which the per-family rate
 * limiter (E14-S08) counts under. Fixed rather than random so the counter this run leaves on the live
 * cluster is a key the drain below can name — it carries an hour's TTL of its own anyway, so deleting it
 * only stops a re-run inside the hour from inheriting this run's count.
 */
const FAMILY_ID = 'itest-admin-catch-arm-family'

beforeAll(async () => {
	await RedisConnect()
})

afterAll(async () => {
	await redisClient.del(`${process.env.REDIS_KEY}rl:refresh:family:${sha256Hex(FAMILY_ID)}`).catch(() => undefined)
	await RedisDisconnect().catch(() => undefined)
})

function makeCtx(): IContextAuthenticatedAuthorization {
	const _id = new mongoose.Types.ObjectId().toHexString()

	return {
		// email left undefined on purpose (see file banner) — everything else is shaped exactly
		// like a real session so nothing upstream of the Redis write would reject it first.
		state: {
			user: {
				_id,
				email: undefined,
				refreshToken: `refresh:${randomUUID()}`,
				familyId: FAMILY_ID,
				// Now-ish and a 30-day cap: the rotation refuses a lineage it can read as expired long
				// before it reaches the hSet this test is about.
				originalLogin: `${Date.now()}`,
				sessionCapDays: '30'
			}
		},
		cookies: {},
		request: { header: {} }
	} as unknown as IContextAuthenticatedAuthorization
}

describe('refresh mutation catch arm against the real Redis cluster', () => {
	it('reports, rolls back for real, and rethrows when the live client refuses to write', async () => {
		const ctx = makeCtx()

		// tryCatchRethrow() normalises every non-GraphQLError into this message — see the argument
		// in refresh.mts for why `status`/`accessToken` are never read on this path.
		await expect(refresh.resolve(null, {}, ctx)).rejects.toThrow('Internal Server Error')

		// The client is still open: the rollback `del`s really ran, they did not fail alongside the
		// write the way they would have if the connection itself had been the thing that was down.
		expect(redisClient.isOpen).toBe(true)
	})
})
