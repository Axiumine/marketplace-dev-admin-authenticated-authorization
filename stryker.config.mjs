/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
	testRunner: 'vitest',
	vitest: {
		configFile: 'vitest.mutation.config.mts'
	},
	coverageAnalysis: 'perTest',
	// ignoreStatic used to be on here, on the theory that a mutant in module-load-only
	// code (the GraphQL type/field declarations) is unkillable because the module is
	// already in the ESM registry by the time Stryker flips the active mutant. That
	// was a misreading of an attribution artifact, not a real limitation: when the
	// module under test is imported at the top of the test file, a mutant that throws
	// (or changes a value read at import time) does so during Vitest's file-collection
	// phase, before any test runs, so Stryker cannot attribute the failure to a test
	// and reports Survived even though the suite plainly breaks. The fix is importing
	// the module under test dynamically inside the test body instead of at the top of
	// the file, which lets Stryker see the failure land inside a test. See
	// test/schema.test.mts and COVERAGE.md.
	reporters: ['clear-text', 'progress', 'html'],
	/**
	 * 28 workers on a 32-thread box. The `4` this replaces was never measured anywhere — the same literal
	 * sat in all nine Stryker configs on the platform, frontend included, where dropping it
	 * cut 59 minutes to 18.
	 *
	 * Measured here, 66 mutants, machine otherwise idle:
	 *
	 *   concurrency 4  → 35s
	 *   concurrency 28 → 34s
	 *
	 * Near enough to a tie, and kept anyway: at this size the run is all fixed cost — sandbox
	 * creation, vitest boot, the dry run — so the extra workers neither help nor hurt. Uniform across
	 * the platform beats a per-repo number that measures nothing.
	 *
	 * ⚠️ "It still scored 100" is **not** what justified this, and must not justify the next change. A
	 * starved worker misses a deadline, its test fails, and Stryker records the mutant as *killed* —
	 * overload inflates the score, so 100 at any concurrency is consistent with a gate that has quietly
	 * stopped checking. At the break threshold there is no headroom for the number to show it.
	 *
	 * What was compared instead is the set of non-killed mutants, where load surfaces first: both runs
	 * ended on the same 4 Ignored, the same files, lines and mutators — identical sets, not equal
	 * counts.
	 * Re-measure that way before touching this.
	 */
	concurrency: 28,
	timeoutMS: 60000,
	// Mutation score is a push gate — see COVERAGE.md. `break` fails the run (exit 1)
	// below this score, which is what the pre-push hook keys off. Raise it as tests
	// improve; never lower it to make a run pass.
	thresholds: { high: 100, low: 95, break: 100 },
	/**
	 * Scan and coverage output, copied into the sandbox for no reason. Stryker's always-ignored list
	 * covers only `node_modules`, `.git`, `/reports`, `*.tsbuildinfo`, `/stryker.log` and `.stryker-tmp`
	 * — `ignorePatterns` itself defaults to empty, and `.qodana/` here runs to tens of megabytes.
	 *
	 * It is not only wasted copying. `disableTypeChecks: true` resolves to the glob
	 * `**\/*.{js,ts,jsx,tsx,html,vue,mjs,mts,cts,cjs}` matched with `dot: true`, so it descends into
	 * dotted directories, and every run logged a `ParseError` trying to strip `@ts-` directives out of
	 * Qodana's own `thirdPartySoftwareList.html`. Stryker swallows that error and carries on, so the
	 * gate stayed green while printing a stack trace nobody could act on.
	 *
	 * Neither directory is an input to any test: both are gitignored build output.
	 */
	ignorePatterns: ['.qodana', 'coverage'],
	mutate: [
		'src/**/*.mts',
		// Server wiring. test/index.unit.test.mts does unit-test several of its exports
		// directly — checkRequiredEnv, buildValidationRules, healthResponse, logListening,
		// gracefulShutdown, onUnhandledRejection/onUncaughtException, and the two failure
		// branches of start() (RedisConnect/MongoDBConnect rejecting) — but createServer()
		// (the actual Koa/Apollo wiring and the three-way `ctx.path === ENDPOINT / '/health'
		// / else` dispatch) and the success path of start() (the real httpServer.listen) are
		// only exercised by test/integration/index.itest.mts, which this run deliberately
		// does NOT execute — see the header of vitest.mutation.config.mts. Mutating those
		// parts here would only produce NoCoverage mutants: noise, not signal. Rather than
		// split the file at function granularity, index.mts stays gated by the 100%
		// line/branch coverage requirement (unit + integration together) instead.
		'!src/index.mts',
		// Sentry bootstrap, imported via `node --import` as a side-effect-only module.
		// test/instrument.test.mts does unit-test it (the Sentry.init() call shape and the
		// insecure-https request() override both have real assertions), but the module-level
		// `Sentry.init({ dsn: process.env.DSN, ... })` call runs once at import time, before
		// Stryker's active-mutant flag is set for that test run — the same ESM-module-already-
		// loaded effect ignoreStatic targets below, just not caught by that flag because the
		// call has a side effect (registering with the SDK) rather than being a pure literal.
		// Verified empirically: with this file included, `dsn: process.env.DSN -> ""` and
		// similar mutants in the Sentry.init() call arguments report Survived even though
		// nothing in the module's runtime logic actually changed for either test.
		'!src/instrument.mts',
		// GraphQL type declarations: literal SDL and field wiring, no branches.
		'!src/graphQLApi/schema/types/**'
	]
}
