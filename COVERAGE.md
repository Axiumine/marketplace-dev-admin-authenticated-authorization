# Test quality policy — 100% coverage **and** 100% mutation score, no exceptions

This service requires **100% test coverage on every metric** — statements, branches,
functions, and lines — **and a 100% Stryker mutation score**. Both are hard gates, not targets.

They answer different questions, which is why both exist:

| Gate | Question it answers |
|---|---|
| coverage | did a test *execute* this line? |
| mutation | would a test *fail* if this line were wrong? |

100% coverage with weak assertions is the normal failure mode, and it is invisible to the
coverage number. Mutation testing is what falsifies it: Stryker rewrites `src/` one small
change at a time (`false` → `true`, a string → `""`, `?.` → `.`) and re-runs the suite. A
mutant that *survives* is an edit no test noticed.

## The rule

If coverage is below 100% on any metric, the fix is one of:

1. **Add the missing tests** for the uncovered lines / branches / functions.
2. **Delete the code** if it is unreachable or dead.

If the mutation score is below 100%, the fix is one of:

1. **Strengthen the assertion** that should have caught the mutant.
2. **Delete the code** if the mutant proves the branch is dead.
3. **Document an equivalent mutant** with `// Stryker disable next-line <Mutator>: <why>` —
   only when the mutated code provably cannot behave differently on any reachable input.

**Never** lower a threshold to make a run pass. The thresholds are the specification;
red means the work is not done, not that the number is wrong.

## Where it is enforced

| Layer | File | What it does |
|---|---|---|
| Local test run | `vitest.config.mts` → `test.coverage.thresholds` | `yarn test:cov` exits non-zero if any metric < 100% |
| Coverage file audit | `scripts/coverage-audit.mjs` | the same `yarn test:cov` exits non-zero if a source file `coverage.include` gates is absent from the report and unnamed |
| Local mutation run | `stryker.config.mjs` → `thresholds.break` | `yarn test:mutation` exits non-zero if the score < 100 |
| Qodana scan gate | `qodana.yaml` → `failureConditions.testCoverageThresholds` (`total`/`fresh` = 100) | `./qodana.sh` fails the scan if coverage < 100% |
| Git `pre-commit` | `.githooks/pre-commit` | blocks the commit if `yarn test:cov` **or** the Qodana scan fails |
| Git `pre-push` | `.githooks/pre-push` | blocks the push if `yarn lint:check`, `yarn test:cov`, `yarn test:mutation` **or** the Qodana scan fails |

The three coverage layers read the same coverage run (vitest, v8 provider, lcov →
`coverage/lcov.info`, `coverage.include` over `src/**/*.mts`). Change coverage
config in `vitest.config.mts` only. Qodana has no mutation gate — `pre-push` is the
only one.

⚠️ **`coverage.include` is the whole reason those thresholds mean anything.** The
v8 provider reports only the files a test actually `import`-ed, so without it a
source file no suite loads is *absent* from the report rather than listed at 0%,
and 100% of a denominator that excludes it passes (`RISK_REGISTER` R07). The glob
names every shipped source file, so a new one is force-listed at 0% and takes the
run red until it has a test. `all: true` and `extension: ['.mts']` sat either side
of it until 2026-09-06 and did nothing at all: vitest 4 removed both from
`CoverageOptions`, and an unchecked spread swallowed them without a warning. Do not
bring either back — `all` is not a synonym for `include`.

⚠️ **A percentage is only as good as its denominator, and
`scripts/coverage-audit.mjs` is what checks the denominator.** `yarn test:cov` runs
it straight after vitest: it takes every git-tracked file `coverage.include` gates,
subtracts the files `coverage/lcov.info` actually contains, and fails unless what
is left matches `coverage-exempt.txt` exactly. This repo exempts nothing, so it
ships no `coverage-exempt.txt` and any file missing from the report fails the run —
that absence is a file the 100% threshold said nothing about (`RISK_REGISTER` R07).
A repo that genuinely needs one adds the file, one exact path per line with the
reason it can never be tested. Exemptions are exact paths, never globs — a glob
would exempt the next file dropped beside the named one, in silence, with the run
still green, which is the failure the gate exists to catch. **Never widen a
`coverage.exclude` entry to make a red run green:** give the file a test, or name
it with the reason it can never have one.

Both hooks run the scan on purpose. `git merge --no-ff` never fires `pre-commit` —
git runs that hook for `git commit` only — so the merge commit, the one revision
that reaches `origin`, is the single commit no pre-commit scan ever sees. And
Qodana Cloud files each report under the branch it ran on, so a repo scanned only
at commit time never produces a `main`-tagged report to baseline against. Each hook
hands `qodana.sh` `SKIP_TESTS=1`, reusing the `coverage/lcov.info` its own coverage
step just wrote rather than letting the script regenerate it with a test run whose
failure it swallows. `SKIP_QODANA=1` skips the scan alone; the coverage and
mutation gates stay.

## Two projects, one coverage report

`vitest.config.mts` defines two projects; `yarn test:cov` runs both and aggregates coverage:

| Project | Files | Datasources | Purpose |
|---|---|---|---|
| `unit` | `test/*.test.mts` | mocked | pure logic, error paths, prod branches — fast, offline |
| `integration` | `test/integration/*.itest.mts` | **real Redis cluster + real MongoDB** | boots the server via `start()` and drives it over HTTP |

Unlike the logout service, this one opens **both** datasources (`Promise.all([RedisConnect(),
MongoDBConnect()])`), because the refresh gate reads the session from Redis and then loads the
`admin` from MongoDB. The integration project uses the `REDIS_*` / `MONGODB_URI` values
from `.env` (loaded by the sources' own `dotenv.config()`). It overrides only the keyspace prefix
(`REDIS_KEY=marketplaceDev:itest:adminAuthenticatedAuthorization:`, this service's own slice of the
ACL-allowed `marketplaceDev:itest:` namespace, isolated from the other six services' suites) and
`PORT=0` (ephemeral).
Run just one side with `yarn test:unit` / `yarn test:integration`.

Consequence: the coverage gate — and therefore `pre-push` and `./qodana.sh` — needs both the
Redis cluster and MongoDB reachable. That is intentional: 100% here means the server was really
booted and really talked to both, not that a mock returned the expected value.

**The integration suite never writes to MongoDB.** It seeds and deletes its own Redis keys inside
the isolated namespace, and reaches MongoDB only through reads that are expected to miss (a
session pointing at an `_id` that matches no admin). Seeding a real `admin` would
mean writing to the dev database and satisfying its full `$jsonSchema` validator; the happy path
of the `refresh` resolver is covered by the unit project instead.

## Enabling the hook

The `pre-push` hook lives in `.githooks/` (tracked in git). It is activated by:

```bash
git config core.hooksPath .githooks
```

The `prepare` script in `package.json` runs this automatically on `yarn install`, so a
fresh clone is gated after the first install. To verify:

```bash
git config --get core.hooksPath   # -> .githooks
```

## Server boot and Sentry init are covered — do not exclude them

`src/index.mts` (Koa/Apollo wiring, routing, shutdown) and `src/instrument.mts` (Sentry
init) reach 100% through the **integration** project, which boots the real server and hits
`/admin-authenticated-authorization`, `/health`, and an unknown path over HTTP. They are **not**
`v8 ignore`d and must stay that way — the only `v8 ignore` block is the entrypoint tail of
`index.mts` (the `if (NODE_ENV !== 'test')` bootstrap that registers signal handlers and calls
`start()`), which cannot run under the test process without killing the worker via
`process.exit`. Every function it wires (`start`, `gracefulShutdown`, `onUnhandledRejection`,
`onUncaughtException`) is exercised directly by tests, so the ignored block contains only the
wiring, no logic.

## Mutation testing — what is mutated, and what is not

`yarn test:mutation` runs Stryker (`stryker.config.mjs`) with the **vitest** runner over
`vitest.mutation.config.mts`. Two deliberate scope decisions, each of which would otherwise
show up as permanent survivors:

| Setting | Why |
|---|---|
| runs the **`unit` project only** | Stryker re-runs the suite once per mutant. Pointing that at `test/integration/*.itest.mts` would hit the real Redis cluster AND the real MongoDB hundreds of times per mutant — that cost comes from hitting real infrastructure at all, not from the namespace being shared; each service's integration suite has its own `marketplaceDev:itest:adminAuthenticatedAuthorization:` slice, and `fileParallelism: false` still serialises the files within it. Unit tests mock both datasources, so mutant runs stay hermetic and parallel. |
| `!src/index.mts`, `!src/instrument.mts`, `!src/graphQLApi/schema/types/**` | `index.mts`'s `createServer()` wiring and the success path of `start()` are only exercised by `test/integration/index.itest.mts`, which this run deliberately does not execute (see above); mutating them would only produce `NoCoverage` noise. `instrument.mts` is the Sentry bootstrap, run once at import time — mutants in its `Sentry.init({...})` call arguments survive regardless of what `test/instrument.test.mts` asserts, since that assertion runs after the (already-mutated) call already happened. GraphQL type declarations are literal SDL with no branches. All three stay gated by the 100% coverage requirement instead. |

`ignoreStatic` used to be set here too, on the theory that a mutant in module-load-only code (the
`MutationsApi`/`QueriesApi` object literals in `mutations.mts`/`queries.mts`, the `description`
string literals in `mutations/refresh.mts`/`queries/helloRefresh.mts`, the exported handler arrow
in `adminAuthenticatedAuthorizationHandler.mts`) is unkillable because the module is already in the
ESM registry by the time Stryker flips the active mutant. That was wrong — an attribution
artifact, not a real limitation — and dropping the flag proved it: all 11 mutants it had been
hiding came back, and every one of them was killable. (`types/**` stays excluded from `mutate`
below regardless — literal SDL with no branches — so `Hello2Type`/`RefreshType` were never part of
this count either way.) See "Static mutants are not unkillable" below for what actually made the
11 killable.

Everything else — the Koa auth middleware, the `refresh` resolver, the DB teardown — is fully
mutated. Current state: **every tested mutant killed, 0 survived**, score 100.00, ~35 s. The
instrumented total moves with the source, so read it off the run rather than from here.

### Static mutants are not unkillable

Dropping `ignoreStatic` reopened 11 mutants in `test/schema.test.mts`'s targets. On the first honest
run **6 of the 11 survived** and the other 5 were killed immediately with no test changes, giving a
mutation score of 90.32% — that is 56 killed out of 62 tested, and 56/62 is where the 90.32% comes
from. (An earlier revision of this paragraph said all 11 survived, which cannot be squared with
either the arithmetic or the breakdown below.) None of the 6 were actually unkillable:

- **`description: 'refresh token'` / `description: 'helloRefresh'` → `''`** (2 mutants, in
  `mutations/refresh.mts` and `queries/helloRefresh.mts`): these string literals are read at
  runtime, not just at import time, and the suite simply never asserted `.description` on either
  field. Adding `expect(helloRefresh.description).toBe('helloRefresh')` and
  `expect(fields.refresh.description).toBe('refresh token')` killed both — a plain missing
  assertion, nothing to do with static/dynamic.
- **The `MutationsApi`/`QueriesApi` object literal collapsing to `{}`, and their `name` string
  collapsing to `''`** (4 mutants, in `mutations.mts`/`queries.mts`): `new GraphQLObjectType({})`
  throws `Must provide name.` at construction — genuinely a module-load-time effect. The fix in
  the background brief (dynamic `import()` instead of a top-level one) was the right first move
  but not sufficient on its own: importing inside a `beforeAll` still reports Survived, because a
  `beforeAll` throw fails the whole suite once and Vitest marks every dependent test "skipped"
  (no result) rather than "failed" — and Stryker's vitest runner only counts tests with a result,
  so a skipped-not-failed suite looks like no failure at all. Moving the same dynamic `import()`
  into a `beforeEach` fixed it: a `beforeEach` throw fails *each* test that runs it, individually,
  with its own result, and Stryker attributes that correctly. Verified by direct A/B run against
  the same mutation (`mutations.mts`'s config forced to `{}`): `beforeAll` → Survived,
  `beforeEach` → killed. See `test/schema.test.mts` for the comment recording this.
- The remaining 5 of the 11 reopened mutants (the whole-object-literal collapse of `export const
  refresh = {...}` and `export const helloRefresh = {...}`, the `fields: {}` collapse in both
  `mutations.mts` and `queries.mts`, and an `ArrowFunction` mutant on
  `adminAuthenticatedAuthorizationHandler`'s exported arrow) were already killed on the very first
  run after dropping `ignoreStatic`, with no test changes at all. Each is read through a call made
  *inside* a test body — `refresh.resolve(...)`, `helloRefresh.resolve()`, `.getFields()`, the
  handler invoked as middleware — so the mismatch surfaces during test execution regardless of
  whether the import at the top of the file is static or dynamic. Only a mutant that changes
  *construction itself* (throws before the module finishes evaluating) needs the `beforeEach` fix;
  a mutant whose effect is only visible through a later method call does not.

The lesson generalises: "static" in Stryker's sense (module-load-time) does not mean unkillable —
it means the *test* has to observe the effect from inside a test body/hook that Vitest reports
per-test, not from a module-level `import` at the top of the file.

### Equivalent mutants

Three mutants are annotated in `src/` with `// Stryker disable next-line`, each above a comment
carrying the reachability argument, and all three are in one file:

- `mutations/refresh.mts` — the initial `let status = false` and the two dead-store `= ''`
  resets in the `catch` block (`refreshToken = accessToken = ''` and the later `accessToken =
  ''`). All three are unobservable because `tryCatchRethrow(e)`, the last call in that `catch`
  block, always throws — every one of its own branches (`throwIfMongoErr`'s two cases, the
  `GraphQLError` branch, and the final `else`) ends in `throw`. So the `catch` block never falls
  through to the `return` at the bottom of the resolver: `status` is only ever read after
  `status = true` overwrote it on the success path, and `refreshToken`/`accessToken` are never
  read again once reassigned inside `catch`.

Do not add to this list without the same kind of argument. "I could not think of a test" is not
an equivalence proof.

### Writing tests that kill

The existing suite already avoids the weakest pattern (`await expect(...).rejects.toThrow()`
with no message/shape check) almost everywhere — `adminAuthenticatedAuthorizationHandler.test.mts`
and `tokenInfoAdmin.test.mts` assert `toHaveBeenCalledExactlyOnceWith(...)` with the exact Redis
key / projection / argument shape, and `refresh.test.mts` asserts the exact rotated keys, TTLs and
rollback calls. That specificity is what kept the baseline mutation score at 92.59% instead of
much lower: only the three `refresh.mts` dead stores survived, and all three turned out to be
genuinely equivalent rather than missing assertions.

## Running it

```bash
yarn test:cov       # coverage + threshold check (the source of truth)
yarn test:mutation  # Stryker; report at reports/mutation/mutation.html
./qodana.sh         # full Qodana Ultimate scan, incl. the 100% coverage gate
```

`git push` runs the first two, in that order, and blocks on either.
