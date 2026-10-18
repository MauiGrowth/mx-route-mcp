# Design decisions

Why the server is built the way it is. If you change one of these, update the entry in the same pull request.

**Source of truth.** The tool list is derived from `https://api.mxroute.com/openapi.yaml` (OpenAPI 3.0.3, v1.0.0), not from the human docs page, which is a Scalar viewer that renders client-side. The spec has 43 operations; there are 43 tools. `spec/operations.json` records the operation list, `npm run check:spec` diffs the live document against it and against the registered tools, and CI runs it weekly. That catches added and removed operations only; changed fields, limits or response shapes are not detected (the whole document is not snapshotted). GitHub pauses scheduled workflows after 60 days without repository activity.

**One tool per operation, not a few "smart" tools.** Predictable mapping (tool name ⇄ HTTP call), small per-tool schemas, and MCP clients can gate each tool separately. The cost is a long tool list; `MXROUTE_TOOLSETS` and `MXROUTE_READ_ONLY` exist to trim it.

**Declarative tools (`tool({operation, input})`).** A tool names its API operation; path parameters are filled from same-named arguments and every other argument becomes the JSON body. This makes "the tool says it does X but sends Y" structurally hard, and a table-driven test calls every tool and asserts the method, path and body it produced.

**TypeScript + `@modelcontextprotocol/sdk` + zod, stdio only.** The reference stack, so contributors recognise it. `engines.node >= 20`: the SDK itself runs on 18, but Node 18 is end-of-life, so the CI matrix is 20/22/24 and the declared floor matches what is tested. No HTTP/SSE transport: the server holds an API key, and a network-reachable server would need its own authentication story.

**Credentials in environment variables, validated lazily.** The server starts and lists tools without credentials (so registries and inspectors can introspect it) and returns a clear error naming the missing variables on first use. Options (`MXROUTE_READ_ONLY`, `MXROUTE_TOOLSETS`) are validated eagerly and strictly because a typo there would silently change which tools exist: `MXROUTE_READ_ONLY=ture` is a startup error, not "writes enabled" (a safety switch must fail closed).

**Impersonation via `MXROUTE_USERNAME=reseller|user`, no per-call override.** Matches the API's own model (it is just the `X-Username` header). A per-call `act_as` argument would let a model pivot to any of a reseller's users mid-conversation; one server entry per target keeps that decision with the human.

**MCP annotations are derived from the HTTP method, then overridden deliberately.** GET = read-only; DELETE = destructive; POST creates = non-destructive, non-idempotent. Rule: destructive = deletes data, overwrites a password irrecoverably, interrupts service, or changes a setting that can make mail be discarded. Overrides to `destructive: true`: `set_mail_hosting_status` (disabling stops mail handling), `set_catch_all` (`blackhole` discards mail), `update_spam_settings` (the auto-delete threshold), `update_email_account` and `update_reseller_user` (can overwrite a password irrecoverably), `suspend_reseller_user` (interrupts service). `create_forwarder` stays non-destructive although `:blackhole:` discards mail to that one new alias: marking every forwarder creation destructive would train users to click through prompts, so the description and README call out `:blackhole:` instead. `test/tools.test.mjs` pins the destructive and non-idempotent sets so a change is always deliberate. Every destructive tool's description ends with a generated "confirm with the user" note, because some clients drop server instructions. `destructiveHint` defaults to *true* in the MCP spec when omitted, so non-destructive writes set it to `false` explicitly.

**Client hardening.**
- Every path segment goes through `encodeURIComponent`, and `.`/`..` are rejected: `encodeURIComponent("..")` is `".."`, so a "domain" of `..` would otherwise normalise `/domains/..` into `/` and reach other endpoints.
- `redirect: "manual"`: `fetch` forwards custom headers such as `X-API-Key` on cross-origin redirects, so a redirect would leak the key.
- `MXROUTE_API_URL` must be HTTPS (loopback excepted) and must not embed credentials, a query string or a fragment.
- 204 is handled without JSON parsing; `/quota` and `/quota/email` are not wrapped in `{success, data}` per the spec, so unwrapping is conditional.
- No automatic retry: write endpoints are rate-limited to 60/min and not all are idempotent, so a blind retry can double-apply. A 429 is reported with `Retry-After` and the model decides.
- Responses pass through `redact()`, which masks string fields named like `password`, `passwd`, `passphrase`, `api_key`, `secret` or `token`. The documented schemas contain none; it is insurance against an unexpected echo. A bare `key` is deliberately not masked (the verification key is public and must be shown).
- API-supplied error text is flattened to one line and capped at 500 characters before it reaches the model.
- A timeout or dropped connection on a non-GET says the change may or may not have been applied, since a blind retry of a non-idempotent write can double-apply it.
- Credentials must be printable ASCII with no spaces: anything else makes `fetch` throw a header error that would otherwise surface as a misleading "could not reach the API".

**Numbers or `"unlimited"`.** Package limits and reseller user quotas are strings in the API (`"unlimited"` is meaningful) but models naturally send numbers; the tools accept both and stringify. Mailbox `quota` and `limit` are integers in the API and stay integers. The shapes are deliberately not shared because the same field name means different things (`quota` is MB on a mailbox and user, GB on a package).

**Tool arguments are strict.** The input schemas are `z.object(...).strict()`: a misspelled optional argument (`quotta: 5000`) would otherwise be dropped and the call would succeed with defaults. Mailbox/alias names reject `@` and `/`, domain names reject URLs, `@` and spaces, package names follow the documented character set: the model gets an immediate, specific error instead of an upstream 4xx (or, worse, an odd success).

**Server instructions are built from the registered tools**, so a read-only or filtered server never tells the model to call a tool that does not exist.

**Tests never touch MXroute.** Tests that hit a real mail account would be unsafe to run in CI, so they spawn the built server over stdio and use a local mock API. `npm run smoke:live` (read-only server, prints counts and field names only) is the opt-in check against a real account.

## Known limitations and ideas

- Write tools, reseller success paths and impersonation are verified against the spec and the mock API only; see *Project status* in the README.
- Optional arguments sent as `null` are rejected (`.optional()` accepts omission, not `null`). Some hosts emit `null` for omitted fields; if that shows up in the wild, accept `.nullish()` on optional inputs and strip `null`s in `runTool` before building the body. Not done because `nullish` adds `anyOf` to every optional field's JSON Schema, which hurts client compatibility more than it helps until the problem is observed.
- Number-or-`"unlimited"` fields advertise `anyOf` in their JSON Schema. Models send numbers, so the alternative would be rejecting them.
- No response-size cap: very large mailbox lists are returned in full.
- Possible later: `outputSchema` for the typed responses; an opt-in `MXROUTE_CONFIRM_DELETES` guard for clients that ignore `destructiveHint`; Windows in the CI matrix; publishing to npm and the MCP registry.
