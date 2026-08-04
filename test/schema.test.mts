import { graphql, GraphQLBoolean, GraphQLNonNull, GraphQLObjectType, GraphQLSchema, GraphQLString } from 'graphql'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// MutationsApi pulls in the refresh resolver, which imports the Redis datasource at module load.
// This file only asserts schema shape, so the client is stubbed rather than instantiated.
vi.mock('@axiumine/koa-utils/dataSources/Redis', () => ({ redisClient: {} }))

// Imported dynamically, inside beforeEach, rather than at the top of the file: mutations.mts and
// queries.mts build their GraphQLObjectType at module-load time, so a mutant that corrupts that
// call (an empty config object, an empty `name`) throws immediately, during the import itself. A
// top-level `import` would make that throw happen during Vitest's file-collection phase, before
// any test runs — Stryker cannot attribute a collection-time crash to a test and reports the
// mutant Survived even though the whole suite would plainly fail to load.
//
// beforeEach, not beforeAll: a throw inside beforeAll fails the whole suite once and every
// dependent test is reported "skipped" (no result), which Stryker's vitest runner also treats as
// no failure — the mutant still reports Survived. A throw inside beforeEach instead fails each
// test that runs it individually, each with its own result, which Stryker does attribute as a
// kill. Verified empirically against this exact mutation (mutations.mts's config collapsed to
// `{}`): beforeAll -> vitest reports the file as 1 failed suite with every test skipped, and
// Stryker still marks it Survived; beforeEach -> vitest reports each test as failed on its own,
// and Stryker marks it killed. The re-import is cheap: the ESM module registry caches it after
// the first `await import(...)`, so every test after the first just resolves the cached module.
let MutationsApi: (typeof import('../src/graphQLApi/schema/mutations.mts'))['default']
let QueriesApi: (typeof import('../src/graphQLApi/schema/queries.mts'))['default']
let helloRefresh: (typeof import('../src/graphQLApi/schema/queries/helloRefresh.mts'))['helloRefresh']
let Hello2Type: (typeof import('../src/graphQLApi/schema/types/Hello2Type.mts'))['default']
let RefreshType: (typeof import('../src/graphQLApi/schema/types/RefreshType.mts'))['RefreshType']

beforeEach(async () => {
	;({ default: MutationsApi } = await import('../src/graphQLApi/schema/mutations.mts'))
	;({ default: QueriesApi } = await import('../src/graphQLApi/schema/queries.mts'))
	;({ helloRefresh } = await import('../src/graphQLApi/schema/queries/helloRefresh.mts'))
	;({ default: Hello2Type } = await import('../src/graphQLApi/schema/types/Hello2Type.mts'))
	;({ RefreshType } = await import('../src/graphQLApi/schema/types/RefreshType.mts'))
})

describe('Hello2Type', () => {
	it('exposes only the txt field, a non-nullable String', () => {
		const fields = Hello2Type.getFields()

		expect(Hello2Type.name).toBe('Hello2Type')
		expect(Object.keys(fields)).toEqual(['txt'])
		expect(fields.txt.type).toBeInstanceOf(GraphQLNonNull)
		expect((fields.txt.type as GraphQLNonNull<typeof GraphQLString>).ofType).toBe(GraphQLString)
	})
})

describe('RefreshType', () => {
	it('exposes a non-nullable status and accessToken', () => {
		const fields = RefreshType.getFields()

		expect(RefreshType.name).toBe('RefreshType')
		expect(Object.keys(fields)).toEqual(['status', 'accessToken'])
		expect((fields.status.type as GraphQLNonNull<typeof GraphQLBoolean>).ofType).toBe(GraphQLBoolean)
		expect((fields.accessToken.type as GraphQLNonNull<typeof GraphQLString>).ofType).toBe(GraphQLString)
	})
})

describe('queries.helloRefresh', () => {
	it('is of non-nullable Hello2Type, described for introspection', () => {
		expect(helloRefresh.description).toBe('helloRefresh')
		expect(helloRefresh.type).toBeInstanceOf(GraphQLNonNull)
		expect((helloRefresh.type as GraphQLNonNull<GraphQLObjectType>).ofType).toBe(Hello2Type)
	})

	it('resolves the greeting text', () => {
		expect(helloRefresh.resolve()).toEqual({ txt: 'Hello from helloRefresh' })
	})
})

describe('QueriesApi', () => {
	it('mounts helloRefresh as its only field', () => {
		expect(QueriesApi.name).toBe('QueriesApi')
		expect(Object.keys(QueriesApi.getFields())).toEqual(['helloRefresh'])
	})

	it('runs the query end-to-end', async () => {
		const result = await graphql({
			schema: new GraphQLSchema({ query: QueriesApi }),
			source: '{ helloRefresh { txt } }'
		})

		expect(result.errors).toBeUndefined()
		expect(result.data).toEqual({ helloRefresh: { txt: 'Hello from helloRefresh' } })
	})
})

describe('MutationsApi', () => {
	it('mounts refresh as its only field, of non-nullable RefreshType, described for introspection', () => {
		const fields = MutationsApi.getFields()

		expect(MutationsApi.name).toBe('MutationsApi')
		expect(Object.keys(fields)).toEqual(['refresh'])
		expect(fields.refresh.description).toBe('refresh token')
		expect((fields.refresh.type as GraphQLNonNull<GraphQLObjectType>).ofType).toBe(RefreshType)
	})
})
