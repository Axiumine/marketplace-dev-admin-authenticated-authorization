# marketplace-dev-admin-authenticated-authorization

Token lifecycle for the **platform-operator** tier — `Admin`, the developer/vendor role. Port **4025**,
endpoint `/admin-authenticated-authorization`, one mutation: `refresh`.

No business queries live here; those are in `marketplace-dev-admin-authenticated-resource` (4024). Logout
is not here either — `marketplace-dev-authenticated-logout` (4030) serves all three tiers, because it
deletes sessions by token content and never asks which collection minted them.

## Why so little code is in this repo

Most of this service's body lives in `marketplace-common`, and has since 4.4.0.

The three `*-authenticated-authorization` services were byte-identical apart from a tier constant, a model
and a projection. On 2026-08-07 the shared part moved into `resolveAuthorizationSession`,
`findAccountForSession` and `refreshSessionTokens`, while the three services, three ports and three crash
domains stayed exactly as they were. The survey behind that choice — including the two options that were
rejected and why — is [`docs/decisions/authorization-service-consolidation.md`](https://github.com/Axiumine/fullstack-marketplace-blueprint/blob/main/docs/decisions/authorization-service-consolidation.md) in the parent workspace.

Both directions are closed. The helpers are not to be re-inlined, and the three services are not to be
merged into one: the merge is a decision the user has already taken, against.

## What remains here

This is the thinnest of the three, and the difference is not an omission — it is what makes it the Admin
tier:

- `TIER.admin`, hardcoded at the one `resolveAuthorizationSession` call.
- `tokenInfoAdmin`'s projection: `_id login.email deleted disabled`, nothing else. An operator has no
  onboarding to resume and no `waitApprov`, so the access-token hash is `_id`, `email`, `tier` — full stop.
- `IAdminEmail` is imported from `marketplace-common` rather than declared here. It was an ad-hoc inline
  `interface` in `tokenInfoAdmin.mts` until 4.4.0; a shared reader contract needed it typed in one place.
- `ctx.state.user` is typed `TAuthorizationSession<IRedisDataAdminCommon>` — the helper's own return type,
  not a restatement of it. That is what lets the middleware assign the session with no cast, and what stops
  the context type and the helper drifting apart.

## Related files

| Topic | File |
|---|---|
| rules for agents working in this repo | [`CLAUDE.md`](./CLAUDE.md) |
| git hooks, gate order, node selection | [`REPO.md`](./REPO.md) |
| the whole platform — tiers, ports, terminology | parent [`CLAUDE.md`](./CLAUDE.md) |

## License

GPL-3.0-or-later — see [LICENSE](./LICENSE).
