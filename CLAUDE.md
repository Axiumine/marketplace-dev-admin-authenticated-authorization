# marketplace-dev-admin-authenticated-authorization

Backend svc 6 of 9. Admin tier, authorization concern. Port 4025, endpoint
`/admin-authenticated-authorization`. One mutation: `refresh`. Business queries →
`marketplace-dev-admin-authenticated-resource` (4024). Logout → `marketplace-dev-authenticated-logout`
(4030), all three tiers.

**Read parent first** — [`../../../CLAUDE.md`](https://github.com/Axiumine/fullstack-marketplace-blueprint/blob/main/CLAUDE.md)
Tier/concern split, port table, terminology, auth model live there. Not here.

| Need | File |
|---|---|
| what this svc is, why so little code lives here | [`README.md`](./README.md) |
| hook internals, gate order, node selection, mutation-gate cost | [`REPO.md`](./REPO.md) |
| why the three authz svcs stay three | parent [`docs/decisions/authorization-service-consolidation.md`](https://github.com/Axiumine/fullstack-marketplace-blueprint/blob/main/docs/decisions/authorization-service-consolidation.md) |
| GitNexus rules, registry name | [`AGENTS.md`](./AGENTS.md) |

## ⚠️ Hard rules

- **Never commit on `main`.** Branch first: `git switch -c <type>/<slug>`. Merge = user decision alone.
  Merged → delete branch with `-d` only, never `-D`.
- **No remote. Push-on-request** — no `git push` unless the user asked for it in that message.
- **Never lower a coverage or mutation threshold, and never remove a gate.** A threshold miss gets a
  missing test written, not a lowered number. Bypasses (`SKIP_QODANA=1`, `--no-verify`) are gate
  removals: use only when the user says so.
- **Never run the mutation gate by hand.** `yarn test:mutation` is hook-only — `pre-push` calls it and
  nothing else does, not to check a change and not on one file. To reproduce a survivor, apply the
  mutant by hand in the source and run `yarn test` instead.
- **Do not re-inline `marketplace-common`'s authorization helpers, and do not merge the three
  `*-authenticated-authorization` services into one.** Both are decisions the user has already taken,
  against — survey and rejected alternatives in the decision doc above.
- Tabs, not spaces — eslint + prettier both enforce. English only: identifiers, comments, fixtures,
  no exception.
- Run `impact({target, repo: "marketplace-dev-admin-authenticated-authorization"})` before editing a
  symbol, and `detect_changes()` before committing — `repo:` is mandatory, always a `marketplace*`
  registry name. Full GitNexus rules: [`AGENTS.md`](./AGENTS.md).
