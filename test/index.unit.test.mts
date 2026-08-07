import http from 'node:http'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const captureException = vi.fn()
const captureMessage = vi.fn()
const RedisConnect = vi.fn()
const MongoDBConnect = vi.fn()
const disconnectAllDatabases = vi.fn()

vi.mock('@sentry/node', () => ({ captureException, captureMessage }))
// redisClient is imported transitively by the handler / resolvers; a bare stub is enough
// because the unit project never connects — only start()'s failure path is exercised here.
vi.mock('@axiumine/koa-utils/dataSources/Redis', () => ({ RedisConnect, redisClient: {} }))
vi.mock('@axiumine/koa-utils/dataSources/MongoDB', () => ({ MongoDBConnect }))
vi.mock('@lib/db/disconnectAllDatabases.mjs', () => ({ disconnectAllDatabases }))

const {
	ENDPOINT,
	REQUIRED_ENV_VARS,
	checkRequiredEnv,
	buildValidationRules,
	healthResponse,
	logListening,
	gracefulShutdown,
	onUnhandledRejection,
	onUncaughtException,
	start
} = await import('../src/index.mts')

describe('checkRequiredEnv', () => {
	it('passes when every required variable is set', () => {
		const env = Object.fromEntries(REQUIRED_ENV_VARS.map((k) => [k, 'x']))
		expect(() => checkRequiredEnv(env)).not.toThrow()
	})

	it('throws naming the first missing variable', () => {
		expect(() => checkRequiredEnv({})).toThrow(`Missing required environment variable: ${REQUIRED_ENV_VARS[0]}`)
	})

	/*
	 * Both entries named as literals, because the two tests above cannot see WHICH names the list
	 * carries: the first builds its passing environment out of the list itself, so a corrupted entry
	 * is satisfied by the very stub the corruption produced, and the second only ever reads
	 * REQUIRED_ENV_VARS[0].
	 *
	 * MONGODB_URI — start() calls MongoDBConnect(), so without the guard a missing URI surfaces as a
	 * driver error from inside the try, reported to Sentry and exited 1, instead of one line before
	 * anything connects.
	 * INTROSPECTION_CODE — the service-to-service bypass compares the header against
	 * `${process.env.INTROSPECTION_CODE}`, which stringifies an unset value to 'undefined' and admits
	 * any caller sending that literal string.
	 */
	it('requires MONGODB_URI and INTROSPECTION_CODE by name', () => {
		expect(REQUIRED_ENV_VARS).toContain('MONGODB_URI')
		expect(REQUIRED_ENV_VARS).toContain('INTROSPECTION_CODE')
	})
})

describe('buildValidationRules', () => {
	it('is empty outside production', () => {
		expect(buildValidationRules({ NODE_ENV: 'test' })).toEqual([])
	})

	it('caps depth and blocks introspection in production', () => {
		expect(buildValidationRules({ NODE_ENV: 'production' })).toHaveLength(2)
	})
})

describe('healthResponse', () => {
	it('reports OK with a round-trippable ISO timestamp', () => {
		const res = healthResponse()
		expect(res.status).toBe('OK')
		expect(res.timestamp).toBe(new Date(res.timestamp).toISOString())
	})
})

describe('logListening', () => {
	let info: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		captureMessage.mockReset()
		info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
	})
	afterEach(() => {
		info.mockRestore()
		vi.unstubAllEnvs()
	})

	it('logs to the console only, outside production', () => {
		logListening({ NODE_ENV: 'test', PORT: '4029' })
		expect(info).toHaveBeenCalledExactlyOnceWith(`Serving http://*:4029${ENDPOINT} for test.`)
		expect(captureMessage).not.toHaveBeenCalled()
	})

	it('also mirrors the banner to Sentry in production, naming no single host', () => {
		logListening({ NODE_ENV: 'production', PORT: '80' })
		// There is no HOSTNAME to report: the server binds every interface, so the banner names
		// the address as `*` instead of printing a specific (and always-wrong) host.
		const expected = `Serving http://*:80${ENDPOINT} for production.`
		expect(captureMessage).toHaveBeenCalledExactlyOnceWith(expected, 'info')
		expect(info).toHaveBeenCalledExactlyOnceWith(expected)
	})

	// This is the path production actually takes: start() calls logListening() with NO
	// arguments at all, so the function falls back to process.env. Every prior test in this
	// block passed an explicit env object, which is a path the application never exercises —
	// that gap is exactly how `HOSTNAME` stayed dead in the banner after it was removed from
	// REQUIRED_ENV_VARS and the env template: the explicit-argument tests never noticed.
	it('falls back to process.env when called with no arguments, as production does', () => {
		vi.stubEnv('NODE_ENV', 'production')
		vi.stubEnv('PORT', '4025')

		logListening()

		const expected = `Serving http://*:4025${ENDPOINT} for production.`
		expect(info).toHaveBeenCalledExactlyOnceWith(expected)
		expect(captureMessage).toHaveBeenCalledExactlyOnceWith(expected, 'info')
	})
})

describe('gracefulShutdown', () => {
	beforeEach(() => {
		captureMessage.mockReset()
		disconnectAllDatabases.mockReset()
	})

	it('drains Apollo, closes the server and disconnects with code 0', async () => {
		const apolloServer = { stop: vi.fn().mockResolvedValue(undefined) }
		const httpServer = { close: vi.fn((cb: () => void) => cb()) }

		await gracefulShutdown('SIGTERM', apolloServer as never, httpServer as never)

		expect(captureMessage).toHaveBeenCalledWith('SIGTERM received, shutting down gracefully...')
		expect(apolloServer.stop).toHaveBeenCalledTimes(1)
		expect(disconnectAllDatabases).toHaveBeenCalledWith(0)
	})
})

describe('process handlers', () => {
	let exit: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		captureException.mockReset()
		exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
	})
	afterEach(() => exit.mockRestore())

	it('onUnhandledRejection reports the reason and exits 1', () => {
		const reason = new Error('boom')
		onUnhandledRejection(reason)
		expect(captureException).toHaveBeenCalledWith(reason)
		expect(exit).toHaveBeenCalledWith(1)
	})

	it('onUncaughtException reports the error and exits 1', () => {
		const error = new Error('kaboom')
		onUncaughtException(error)
		expect(captureException).toHaveBeenCalledWith(error)
		expect(exit).toHaveBeenCalledWith(1)
	})
})

describe('start (failure path)', () => {
	let errorLog: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		captureException.mockReset()
		disconnectAllDatabases.mockReset()
		RedisConnect.mockReset()
		MongoDBConnect.mockReset().mockResolvedValue(undefined)
		for (const k of REQUIRED_ENV_VARS) vi.stubEnv(k, 'x')
		errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
	})
	afterEach(() => {
		errorLog.mockRestore()
		vi.unstubAllEnvs()
	})

	it('reports to Sentry and disconnects with code 1 when Redis fails to connect', async () => {
		const error = new Error('redis boom')
		RedisConnect.mockRejectedValueOnce(error)

		await start()

		expect(RedisConnect).toHaveBeenCalledTimes(1)
		expect(captureException).toHaveBeenCalledWith(error)
		expect(disconnectAllDatabases).toHaveBeenCalledWith(1)
	})

	// Both datasources are opened by the same Promise.all, so MongoDB's rejection has to be
	// covered separately — Redis resolving is not enough to prove the catch handles either side.
	it('reports to Sentry and disconnects with code 1 when MongoDB fails to connect', async () => {
		const error = new Error('mongo boom')
		RedisConnect.mockResolvedValueOnce(undefined)
		MongoDBConnect.mockRejectedValueOnce(error)

		await start()

		expect(captureException).toHaveBeenCalledWith(error)
		expect(disconnectAllDatabases).toHaveBeenCalledWith(1)
	})
})

describe('start (success path)', () => {
	let listenSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		captureException.mockReset()
		RedisConnect.mockReset().mockResolvedValue(undefined)
		MongoDBConnect.mockReset().mockResolvedValue(undefined)
		for (const k of REQUIRED_ENV_VARS) vi.stubEnv(k, 'x')
		// listen() itself is stubbed out below, so PORT can stay the same placeholder as every
		// other required var — no socket is ever really opened by this test.
		listenSpy = vi.spyOn(http.Server.prototype, 'listen').mockImplementation(function (this: http.Server, ...args: unknown[]) {
			const callback = args.find((arg): arg is () => void => typeof arg === 'function')
			callback?.()

			return this
		})
	})
	afterEach(() => {
		listenSpy.mockRestore()
		vi.unstubAllEnvs()
	})

	it('passes only { port }, never a host, to listen — binding every interface on purpose', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		const server = await start()

		// The whole point of the fix this asserts: no `host`/`hostname` key travels into listen()
		// at all. Node silently ignores an unrecognised option, so a regression here would not
		// throw — this exact-shape check is the only thing that would catch it, and it is also
		// what kills mutants on this call (a mutated options object would fail the match).
		expect(listenSpy).toHaveBeenCalledExactlyOnceWith({ port: process.env.PORT }, expect.any(Function))

		await server?.apolloServer.stop()
		info.mockRestore()
	})
})
