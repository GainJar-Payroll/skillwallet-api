# SkillWallet — Session Report

> Single-source handoff document. Generated for the planning agent to consume.
> Covers all work done in the last session, including a critical 1Shot real-API discovery that requires re-architecting the 1Shot integration.

---

## 1. Session Goal

The user wanted three things, in this order:

1. **Standardize the HTTP response structure** — every response in a predictable envelope.
2. **Add simple admin auth** — `x-api-key` header check on write endpoints (skills/executors/installations mutations).
3. **Verify 1Shot works in this env and real flow** — using eth sepolia (11155111) as the test chain. User suggested either a random private key + MetaMask Smart Accounts Kit SDK approach, or direct 1Shot calls without SDK; the user said "just make sure 1Shot is running with our impl this time."

Sub-agent rule (recorded in `CLAUDE.md`): spawned agents must use the parent session's model and provider (`9router/main`, `9router`). Do not mix providers in one task graph.

---

## 2. What Was Built

### 2.1 Response Envelope (RFC-style)

Every HTTP response is wrapped in one of two shapes:

```json
// 2xx
{ "payload": { /* data */ },
  "meta": { "requestId": "uuid", "timestamp": "2026-06-02T15:14:30.901Z" } }

// 4xx/5xx
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "type": "validation",
             "fields": [{ "field": "x", "reason": "y", "code": "z" }] },
  "meta": { "requestId": "uuid", "timestamp": "..." } }
```

**Guarantees**

- Exactly one of `payload` / `error`.
- `meta.requestId` always present, correlates to server logs and `x-request-id` response header.
- Inbound `x-request-id` honored if it matches `^[a-zA-Z0-9_-]{1,128}$`, else UUID v4 generated.
- 5xx + production → generic `"An unexpected error occurred"`. Stack/DB/path/ORM info never leaks in `error.message`.
- `error.code` is one of the typed values in `src/common/errors/error-codes.ts` plus `UNAUTHORIZED` and `INTERNAL_ERROR`.

**Status → code mapping**
| Status | `error.code` |
|---|---|
| 400 | `VALIDATION_ERROR` |
| 401 | `UNAUTHORIZED` |
| 403/422 | `POLICY_BLOCKED` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT` |
| 501 | `NOT_IMPLEMENTED` |
| 502 | `RELAYER_ERROR` |
| 503 | `NOT_CONFIGURED` |
| else | `INTERNAL_ERROR` |

### 2.2 Admin Auth (`x-api-key`)

**Protected routes** (all write operations on shared state):

- `POST /skills`, `PATCH /skills/:skillId`
- `POST /executors`, `PATCH /executors/:id`
- `PATCH /installations/:id/status`
- `POST /installations/:id/{pause,resume,revoke}`

**Mechanism**

- `ADMIN_API_KEY` env (required, crashes at boot if missing).
- `AdminAuthGuard` uses `timingSafeEqual` (length-checked, constant-time).
- Global `APP_GUARD` + per-route `@AdminOnly()` metadata = per-route opt-in, no per-controller `@UseGuards`.

**Current key** (in `.env`): `966b9b06-27c0-40ec-ade9-d4c6ed9f683b` (random UUID v4).

**Failure modes**
| Condition | Status | `code` | `message` |
|---|---|---|---|
| header missing | 401 | `UNAUTHORIZED` | `Authentication required` |
| wrong key | 401 | `UNAUTHORIZED` | `Authentication required` |
| server key not set | 500 | `INTERNAL_ERROR` | `An unexpected error occurred` |

### 2.3 1Shot Real-API Discovery (CRITICAL)

When verifying 1Shot end-to-end against the public relayer, the existing implementation was found to be **built against a non-existent API surface**. Three critical bugs were identified and fixed.

**The real 1Shot v2 Public Relayer** (`relayer.1shotapi.com/relayers` or `relayer.1shotapi.dev/relayers` for testnet):

- **Permissionless** JSON-RPC 2.0. No API key required for the public relayer.
- Endpoint pattern: `POST /relayers` (not `POST /relayers/rpc`).
- `relayer_getCapabilities` requires `params: ["<chainId>"]` to return data; empty params returns `{}`.
- `relayer_getFeeData` takes `params: { chainId: "<chainId>", token: "<erc20>" }` (object, not array).
- **Payment is ERC-20 only.** Native token (e.g. `0xEeeeeEe...EEeE` sentinel) is **not** accepted. Default to USDC per chain.
- The `context` field in fee data is a JSON-stringified price-lock quote with embedded signature — pass back on send to lock the quote.

**Real verified response** (eth sepolia 11155111):

```json
{
  "result": {
    "chainId": "11155111",
    "token": {
      "decimals": 6,
      "address": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      "symbol": "USDC",
      "name": "USDC"
    },
    "rate": 2000,
    "minFee": "0.01",
    "expiry": 1780415025,
    "gasPrice": "1339446470",
    "feeCollector": "0xE936e8FAf4A5655469182A49a505055B71C17604",
    "targetAddress": "0x02c9979a75fbdbc3a77485024ab8b6474308591e",
    "context": "{\"chain\":11155111,…,\"signature\":\"…\",\"tokenAddress\":\"…\"}"
  }
}
```

**1Shot has TWO separate APIs** (the user gave credentials for the wrong one for our use case):

1. **Public Relayer** (permissionless JSON-RPC) — what we need. Lives at `relayer.1shotapi.{com,dev}/relayers`. No auth.
2. **v1 M2M** (`api.1shotapi.com/v0/...`) — bearer-token flow with API key + secret → contract-method endpoints. The `qmJmFWeStdcTDvAIx06hKxW4KaqG7Gmm` / `iJ1Emy3dVmmePZPQdHlLrhdVjISbwV2C` creds the user gave are for THIS surface. We do not use this surface.

**Bug fixes applied**:
| Bug | Before | After |
|---|---|---|
| Endpoint URL | `POST /relayers/rpc` (404) | `POST /relayers` (200) |
| `getCapabilities` params | `[]` → empty result | `[chainId]` → real capabilities |
| `getFeeData` params | `[bundle]` (wrong shape) | `{chainId, token}` (real shape) |
| Payment token | `0xEeeeeEe...` native sentinel (invalid) | Defaults to USDC per chain |

**`relayer_getStatus` on the testnet relayer is currently broken** (returns `TypeError: undefined is not an object (evaluating 'hex2.startsWith')`). Status updates come via webhook (`POST /webhooks/oneshot`) which is what we already implement.

---

## 3. Test Results

```
Lint:  0 errors, 0 warnings  (--max-warnings=0)
Build: 75 swc files compiled, 0 errors
Tests: 63 pass / 0 fail
  - response-envelope.spec.ts:  6 tests
  - global-exception-filter.spec.ts: 10 tests
  - admin-auth-guard.spec.ts:  7 tests
  - oneshot-relayer.spec.ts:  20 tests (refactored to match real API)
  - other existing tests:  20 tests
```

**E2E real-API verification**: `getCapabilities(11155111)` + `getFeeData(...)` against `relayer.1shotapi.dev/relayers` returned real data. Implementation now functional.

---

## 4. Files Changed (complete list)

### New files (response wrapper)

- `src/common/response/envelope.types.ts` — `SuccessEnvelope<T>`, `ErrorEnvelope`, `ErrorBody`, `ErrorFieldDetail`
- `src/common/response/request-id.middleware.ts` — `requestContextStorage` (AsyncLocalStorage) + `x-request-id` header handling
- `src/common/response/response.interceptor.ts` — wraps success; `SKIP_ENVELOPE` / `@SkipEnvelope()` opt-out
- `src/common/response/global-exception.filter.ts` — AppError / Zod v4 (uses `.issues`, fallback `.errors`) / HttpException / Mongoose (name=ValidationError|CastError|MongoServerError|MongoError OR code 11000) / generic
- `src/common/response/response-envelope.module.ts` — registers `APP_INTERCEPTOR` + `APP_FILTER` + middleware for `*`
- `src/common/response/index.ts` — barrel

### New files (admin auth)

- `src/common/auth/admin.guard.ts` — `AdminAuthGuard` + `AdminOnly()` decorator
- `src/common/auth/auth.module.ts` — registers `APP_GUARD`
- `src/common/auth/index.ts` — barrel

### New tests

- `test/response-envelope.spec.ts` (6)
- `test/global-exception-filter.spec.ts` (10)
- `test/admin-auth-guard.spec.ts` (7)

### Modified files

- `src/config/env.schema.ts` — added `ADMIN_API_KEY` (required), 1Shot `ONESHOT_*` fields, `DEFAULT_PAYMENT_TOKEN_BY_CHAIN` map, removed `NATIVE_TOKEN_SENTINEL` (no longer relevant; 1Shot is ERC-20 only)
- `.env` / `.env.example` — new 1Shot block, admin key section, USDC defaults
- `src/app.module.ts` — imports `ResponseEnvelopeModule` + `AuthModule`
- `src/main.ts` — global interceptor + filter via `APP_INTERCEPTOR` / `APP_FILTER` providers
- `src/skills/skills.controller.ts` — `@AdminOnly()` on POST/PATCH
- `src/executors/executors.controller.ts` — `@AdminOnly()` on POST/PATCH
- `src/installations/installations.controller.ts` — `@AdminOnly()` on status/pause/resume/revoke
- `src/runtime/relayers/relayer.interface.ts` — updated `OneShotCapabilities` (per-chain list), `OneShotFeeData` (real shape), `getCapabilities(chainId)` signature
- `src/runtime/relayers/oneshot-relayer.service.ts` — fixed URL (`/relayers` not `/relayers/rpc`), fixed `getCapabilities(chainId)` params, fixed `getFeeData` object params, removed `paymentMode`/`NATIVE_TOKEN_SENTINEL`, added `DEFAULT_PAYMENT_TOKEN_BY_CHAIN` fallback, added public getters `getRelayerWallet()` / `getActiveChainId()` / `getPaymentTokenAddress()`
- `test/oneshot-relayer.spec.ts` — refactored to match real API; 20 tests
- `CLAUDE.md` — added `## Sub-Agent Convention` section (same model+provider as parent)
- `skill-wallet.postman_collection.json` — envelope shape in info block, `xApiKey` collection var, `(admin)` tags + headers, payload-unwrap in test scripts
- `README.md` — new `## Response Envelope` section, new `## Admin Authentication` section, env table updated, 1Shot section rewritten with real-API facts

### Created (this turn)

- `docs/DOCS.md` — this file

---

## 5. Environment State

### `.env` (key 1Shot block)

```env
ONESHOT_NETWORK=testnet
ONESHOT_RELAYER_URL=https://relayer.1shotapi.dev/relayers
ONESHOT_PAYMENT_TOKEN_ADDRESS=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
ONESHOT_DESTINATION_URL=
ONESHOT_JWKS_URL=
ONESHOT_WEBHOOK_PUBLIC_KEY=
ONESHOT_API_KEY=qmJmFWeStdcTDvAIx06hKxW4KaqG7Gmm        # v1 M2M (unused for public relayer)
ONESHOT_API_SECRET=iJ1Emy3dVmmePZPQdHlLrhdVjISbwV2C     # v1 M2M (unused for public relayer)
ONESHOT_RELAYER_WALLET=0x2c4E85173372AA9fb0F210F91b69aF92f87BE2B2
ONESHOT_TESTNET_CHAIN_ID=11155111
ONESHOT_MAINNET_CHAIN_ID=8453
ADMIN_API_KEY=966b9b06-27c0-40ec-ade9-d4c6ed9f683b
```

### 1Shot wallets (per user)

| Chain                  | Address                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| eth mainnet (1)        | `0x2c4E85173372AA9fb0F210F91b69aF92f87BE2B2`                           |
| base mainnet (8453)    | `0x10e5F3354AbD0a16fD079Db8Fa499AcEE9a4637d`                           |
| base sepolia (84532)   | `0x980E15e5ED3A6C7d7B606ed8f338C816Fc043a47`                           |
| eth sepolia (11155111) | `0x2c4E85173372AA9fb0F210F91b69aF92f87BE2B2` (testnet primary, funded) |

### Default USDC per chain (used as fallback for `ONESHOT_PAYMENT_TOKEN_ADDRESS`)

| Chain ID               | USDC                                         |
| ---------------------- | -------------------------------------------- |
| 1 (eth mainnet)        | `0xa0b86991c6218b36c1d19d4a2e9Eb0cE3606eB48` |
| 11155111 (eth sepolia) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| 8453 (base)            | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| 84532 (base sepolia)   | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

### Project conventions

- **Package manager**: Bun (not npm/yarn/pnpm)
- **Test runner**: `bun test`
- **TypeScript strict** — no `as any`, `@ts-ignore`, `@ts-expect-error`
- **Zod** for runtime validation (v4 — uses `.issues` not `.errors`)
- **Mongoose** for MongoDB
- **viem** for EVM helpers
- **pino** for structured logs
- **dotenv** not needed (Bun auto-loads `.env`)
- **Required env at boot**: `MONGODB_URI` and `ADMIN_API_KEY`. Missing → crash.
- **No private keys stored anywhere.** Executor signing is out-of-scope for this backend.
- **Runtime fails closed.** Policy validator, relayer errors → attempt marked `failed`/`blocked`.

---

## 6. Critical State for Planning Agent

### 6.1 What's done (do NOT re-build)

- Response envelope: types, middleware, interceptor, filter, module, tests
- Admin auth: guard, decorator, module, tests
- 1Shot relayer service: now calls the real public API correctly (URL, params, payment model)
- 1Shot end-to-end verified against the real relayer on eth sepolia
- Postman collection + README + CLAUDE.md updated

### 6.2 What's NOT done (planning-agent scope)

- **On-chain E2E test.** The relayer-side wiring is verified, but a full end-to-end test that submits a real EIP-7702 + EIP-7710 bundle to the chain is not done. This requires:
  1. MetaMask Smart Accounts Kit (`@metamask/smart-accounts-kit`) for EIP-7702 authorization + delegation signing
  2. A funded wallet (the user has USDC on eth sepolia)
  3. A real executor contract deployed
  4. Integration with the policy validator
- **Bundle shape validation.** The runner builds a 7710 bundle and calls `relayer_send7710Transaction`. The wire shape for this is documented in the 1Shot quickstart but not yet verified against the real endpoint.
- **`context` quote-locking on send.** `getFeeData` returns a `context` (signed quote). This should be passed to `send7710Transaction` to lock the price. Not yet implemented in our service.
- **Mongoose webhook updates** — the 1Shot webhook updates `ExecutionAttempt` by `relay.taskId`. Need to verify the field names match.
- **Multichain bundle** — `relayer_send7710TransactionMultichain` is implemented as a 1:1 wire passthrough, not yet exercised.
- **Rate limiting** — mentioned as a TODO in README § Current Limitations, not implemented.
- **Dead-letter queue for retried failures** — README TODO, not implemented.

### 6.3 Known issues

- `relayer_getStatus` on `relayer.1shotapi.dev` currently returns a TypeError on bad taskIds. Webhook is the working path.
- `compiledFromManifestHash` has a duplicate-index warning on `WalletPermissionRequestRecord` (pre-existing, not in scope of this session).
- The `ONESHOT_DESTINATION_URL` is now **truly optional** in `.env` — the `OneShotRelayerService` no longer throws `NOT_CONFIGURED` when it's missing. Bundle `destinationUrl` takes priority over env; if both empty, the send proceeds and a warn log fires; 1Shot will accept the bundle but no webhook callback lands — poll `relayer_getStatus` instead. For local development where you want the actual webhook callback (1Shot requires HTTPS), run `cloudflared tunnel --url http://localhost:4000` (no signup) and paste the printed `https://…trycloudflare.com` URL into `ONESHOT_DESTINATION_URL` or into the page bundle's `destinationUrl`.
- `WebhookSignatureVerifier` warns on boot if `ONESHOT_JWKS_URL` / `ONESHOT_WEBHOOK_PUBLIC_KEY` unset. Not blocking, but webhooks won't authenticate.

### 6.4 User preferences (stick to these)

- **Terse caveman style** for chat. Drop articles, filler, hedging. Fragments OK. Code/paths/errors exact.
- **Caveman style suspended for**: security warnings, irreversible confirmations, multi-step ordered sequences.
- **Sub-agent spawn = same model + provider as parent** (`9router/main`, `9router`). Documented in `CLAUDE.md`.
- **No mocks, no fake success.** All paths return typed errors when config is missing.
- **Runtime fails closed.**
- **AI does not generate calldata.** ProposedAction is built server-side by adapter.
- **PolicyValidator fails closed.**
- **Never expose internal env values in responses.**
- **1Shot payment model is ERC-20 (USDC), not native.** User initially thought native was default — clarified by the real-API call.
- **Test chain = eth sepolia (11155111)** for any 1Shot work going forward.

### 6.5 Commands the user expects

- `bun run lint` — must exit 0 (max-warnings 0)
- `bun run build` — must exit 0
- `bun test` — must pass
- `bun run start:dev` — dev server w/ watch
- Smoke test of 1Shot: see `/tmp/verify-e2e.ts` (re-creatable from §2.3)

---

## 7. Open Questions (for the planning agent to answer)

1. **On-chain E2E test** — what's the minimal scaffold? SDK init, signer setup, bundle assembly, send flow?
2. **Executor contract** — does the user have one deployed? If not, the planning agent needs to design a minimal one or use a reference implementation.
3. **`context` quote-locking on send** — is the relayer's `context` stable enough to cache, or should it be re-fetched per send?
4. **Webhook `destinationUrl`** — should the backend expose via ngrok/cloudflare-tunnel during dev, or set up a public URL?
5. **Multichain support** — is MVP 1 strictly single-chain, or do we need multichain from day 1?
6. **Signer for EIP-7702** — is the user going to use a local keypair for dev, or MetaMask Flask, or a remote signer? The relayer EOA holds USDC; the user EOA holds the smart account.

---

## 8. Verification Snapshot

Last run:

- Lint: `0 errors, 0 warnings`
- Build: `Successfully compiled: 75 files with swc`
- Tests: `63 pass / 0 fail`
- 1Shot E2E: `getCapabilities(11155111)` + `getFeeData(...)` against real relayer — **works**

```
✓ POST /relayers, params: ["11155111"] → real USDC capability
✓ POST /relayers, params: {chainId: "11155111", token: "0x1c7D..."} → real fee quote
✗ POST /relayers/rpc → 404 (was: my old code; now: removed)
✗ Native token sentinel → invalid (was: my old default; now: defaults to USDC)
```

---

## 9. Sub-Agent Note

Per the user, sub-agents must use the same model+provider as the parent session. The parent session is `9router/main` (provider `9router`). Any task agent should be spawned with:

```ts
task((subagent_type = '...'), (run_in_background = true), (load_skills = []), (prompt = '...'));
// where the model defaults to parent (no override)
```

This is enforced by the `## Sub-Agent Convention` section in `CLAUDE.md`.

---

## 10. File Map for the Planning Agent

| Concern                          | File                                                         |
| -------------------------------- | ------------------------------------------------------------ |
| Response envelope types          | `src/common/response/envelope.types.ts`                      |
| Request ID middleware            | `src/common/response/request-id.middleware.ts`               |
| Response interceptor             | `src/common/response/response.interceptor.ts`                |
| Global exception filter          | `src/common/response/global-exception.filter.ts`             |
| Envelope module                  | `src/common/response/response-envelope.module.ts`            |
| Admin guard + decorator          | `src/common/auth/admin.guard.ts`                             |
| Auth module                      | `src/common/auth/auth.module.ts`                             |
| 1Shot relayer interface          | `src/runtime/relayers/relayer.interface.ts`                  |
| 1Shot relayer service (real API) | `src/runtime/relayers/oneshot-relayer.service.ts`            |
| Webhook signature verifier       | `src/runtime/relayers/webhook-signature-verifier.service.ts` |
| Webhook controller               | `src/runtime/relayers/oneshot-webhook.controller.ts`         |
| Env schema                       | `src/config/env.schema.ts`                                   |
| Env validation                   | `src/config/env.module.ts`                                   |
| App bootstrap                    | `src/main.ts`                                                |
| App module                       | `src/app.module.ts`                                          |
| All tests                        | `test/*.spec.ts`                                             |
| Postman collection               | `skill-wallet.postman_collection.json`                       |
| README                           | `README.md`                                                  |
| Project agent instructions       | `CLAUDE.md`                                                  |
| This report                      | `docs/DOCS.md`                                               |

---

## 11. 14-Phase Hardening (1Shot real signed flow)

Follow-up session that took the 1Shot integration from "capability discovery + fee quote works" to "real signed EIP-7710 bundle can be estimated, sent, tracked, persisted" with strict typed errors, no fake success, no silent fallback, fail-closed DCA.

| #   | Phase                                                  | Status | Result                                                                                                                                                  |
| --- | ------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Read OpenRPC spec + EIP-7710 quickstart + webhooks     | done   | Authoritative shapes cached                                                                                                                             |
| 2   | Add 14 typed `ErrorCode` values + `statusByCode`        | done   | `src/common/errors/error-codes.ts` (26 codes total)                                                                                                     |
| 3   | Rewrite `relayer.interface.ts` (OpenRPC-exact types)   | done   | `OneShotCapabilities`, `OneShotFeeData`, `OneShotEstimateResult`, `MultichainBundle7710Entry`, etc.                                                       |
| 4   | Rewrite `oneshot-relayer.service.ts`                   | done   | Object-params wire shape, `normalizeStatus`, error-code mapping 4001/4200/4202/4204/4210/4211 → AppError                                                  |
| 5   | Create `oneshot-bundle-validator.ts`                   | done   | Shape + capabilities + context checks; `ensureNoPrivateKeys(bundle, 'bundle')` at whole-bundle level                                                    |
| 6   | Add `quoteContext` / `requiredPaymentAmountEstimate` / `method` to `RelayRecord` | done | `src/runtime/schemas/execution-attempt.schema.ts`                                                                                                       |
| 7   | Add `ExecutionAttemptsService.attachQuoteContext()`    | done   | Persist signed price-lock quote at send-time for audit                                                                                                  |
| 8   | Refactor runner to estimate-before-send                | done   | Estimate → verify target/payment unchanged → relay. Fails closed on `EXPIRED_ONESHOT_CONTEXT` / `MISSING_ONESHOT_CONTEXT`                              |
| 9   | Refactor `oneshot-webhook.controller.ts`               | done   | `POST /runtime/oneshot/webhook`, Ed25519 verify via relayer service, taskId correlation, status-code mapping, ActivityLog entry                          |
| 10  | `scripts/oneshot-sepolia-proof.ts`                     | done   | Dev-only; requires `DEV_SEPOLIA_PRIVATE_KEY` (66-char 0x-prefixed), fail-loud `process.exit(1)` if missing; uses viem + relayer_* methods + status poll |
| 11  | DCA fail-closed verification                           | done   | `DcaAdapter.buildAction()` throws `ErrorCode.NOT_IMPLEMENTED` — no fake swap calldata                                                                   |
| 12  | Tests for validator + DCA + webhook                    | done   | 3 new test files: `oneshot-bundle-validator.spec.ts` (16 tests), `dca-adapter.spec.ts`, `oneshot-webhook-controller.spec.ts` (real Ed25519)             |
| 13  | README + DOCS update                                   | done   | This section + README 1Shot section reflects real OpenRPC + webhook spec                                                                                 |
| 14  | Final verification                                     | done   | `bun run build` 0 errors, `bun run lint` 0/0, `bun run typecheck` 0 errors, `bun test` 88 pass / 0 fail / 183 expect() calls                            |

**Final gates:**

- `bun run build` — 77 swc files, 0 errors
- `bun run lint` — 0 errors, 0 warnings (`--max-warnings=0`)
- `bun run typecheck` — 0 errors
- `bun test` — **88 pass, 0 fail, 183 expect() calls, 9 test files**

**Key wire-shape corrections from spec (vs. the previous turn's understanding):**

- `relayer_send7710Transaction` / `relayer_estimate7710Transaction` take **object** params, not array
- `relayer_send7710TransactionMultichain` takes `{transactions: [...innerObjects...]}` (each inner w/ own chainId) — multichain is an array of per-chain blocks
- `relayer_getStatus` takes `{id, logs}` not `[taskId]`
- Bundle execution uses `data` (not `callData`)
- Bundle `permissionContext` is `OneShotDelegation[]` (not string)

**1Shot error codes corrected (per `https://1shotapi.com/docs/relayer/get-started/error-handling`):**

| Code | Meaning                  | Mapped to                  |
| ---- | ------------------------ | -------------------------- |
| 4001 | UserRejectedRequest      | `ONESHOT_RPC_ERROR`        |
| 4200 | InsufficientPayment      | `ONESHOT_INSUFFICIENT_PAYMENT` |
| 4202 | UnsupportedPaymentToken  | `ONESHOT_PAYMENT_TOKEN_UNSUPPORTED` |
| 4204 | QuoteExpired             | `ONESHOT_QUOTE_EXPIRED`    |
| 4210 | InvalidAuthorizationList | `ONESHOT_INVALID_AUTHORIZATION` |
| 4211 | SimulationFailed         | `ONESHOT_SIMULATION_FAILED` |

**Webhook event → status code mapping (controller):**

| Event pattern             | Status code | ActivityLog type       |
| ------------------------- | ----------- | ---------------------- |
| `*Reverted*`              | 500         | `execution.failed`     |
| `*Rejected*`              | 400         | `execution.failed`     |
| `*Submitted*`             | 110         | `execution.relayed`    |
| `*Success*` / `*Confirmed*` w/ `receipt.status !== 0x0` | 200 | `execution.confirmed` |
| `*Success*` / `*Confirmed*` w/ `receipt.status === 0x0` | 500 | `execution.failed` |
| fallback                  | 100         | `execution.relayed`    |

**Security / non-negotiables preserved:**

- No private keys stored or requested
- `scripts/oneshot-sepolia-proof.ts` requires `DEV_SEPOLIA_PRIVATE_KEY` env var; never imported by backend
- DCA fail-closed (no fake calldata)
- Validator rejects bundles w/ `privateKey` / `priv_key` anywhere
- All DTOs preserve `raw` field for audit
- No mock relay success in tests


---

## 3. Real MetaMask Smart Accounts Kit + 1Shot proof (HTML page)

User pivoted the dev-only proof from a Node CLI script to a single HTML page that runs the user's real MetaMask extension through the SkillWallet backend + 1Shot v2. **No Pimlico, no bundler, no paymaster, no mocks.**

### 3.1 Page surface

| Route                    | Backend file                                | Purpose                                       |
| ------------------------ | ------------------------------------------- | --------------------------------------------- |
| `GET  /proof`            | `src/runtime/proof/proof.controller.ts`     | Serves `public/proof.html` (single-page UI)   |
| `GET  /proof/style.css`  | same controller                             | Serves `public/proof.css`                     |
| `POST /proof/relayer`    | same controller                             | Whitelisted JSON-RPC proxy to `OneShotRelayerService` |

### 3.2 Page flow (9 sections, in order)

1. **Load skills** → `GET /skills` → renders marketplace. Each card has a **"Use this skill"** button that triggers the per-skill sign-delegation flow (step 6 was moved into this card).
2. **Connect MetaMask** → `window.ethereum` + `wallet_switchEthereumChain` to Sepolia
3. **Create smart account** → `toMetaMaskSmartAccount({ implementation: Implementation.Hybrid, signer: { walletClient } })` — signer MUST be `WalletSignerConfig` so the SDK routes `signMessage`/`signTypedData` through EIP-1193
4. **Verify DelegationManager** → compare SDK `environment.DelegationManager` w/ on-chain `eip712Domain()` (name, version, chainId)
5. **1Shot caps + fee** → `relayer_getCapabilities` + `relayer_getFeeData` for USDC
6. **Fetch installed skills** → `GET /installations?userAddress=<EOA>&chainId=11155111` (shows what the backend already has on record for the user)
7. **Estimate** → `relayer_estimate7710Transaction(bundle)` → `requiredPaymentAmount` (bundle built from the per-skill signed delegation)
8. **Send** → `relayer_send7710Transaction(bundle)` → `taskId`
9. **Poll status** → `relayer_getStatus` every 5s, max 12 polls

#### Per-skill card sign-delegation (inside step 1)

When the user clicks **"Use this skill"** on a card:

- Reads per-skill config from the `SKILL_CONFIG` map (target / value / callData / scope / description)
- Resolves the call `target` to `state.smartAccount.address` (self) so the SDK's strict `addCaveat('allowedTargets', …)` accepts a real, checksummed address
- Builds the delegation: `from: <SA>`, `to: <1Shot targetAddress>`, `scope: { type: 'nativeTokenTransferAmount', maxAmount: 0n }` (camelCase — the SDK enum's string value), `caveats: [allowedTargets([SA])]`
- Calls `smartAccount.signDelegation({ delegation })` — triggers MetaMask popup
- Encodes `permissionContext`, `mode: ExecutionMode.SingleDefault`, `executionCalldata` (encodeExecutionCalldata with the per-skill target/value/callData)
- Encodes `redeemCalldata = encodeFunctionData(redeemDelegations, [[permissionContext], [mode], [executionCalldata]])`
- Commits to `state` (replacing any prior per-skill state); `state.currentSkillId` tracks the active skill
- Card `<pre>` shows: `user` (EOA), `smartAccount` (SA), `delegate` (1Shot targetAddress), `recipient` (self), `target` (per-skill, SA), `value`, `callData`, `scope`, `permissionContext`, `redeemCalldata`

Steps 7-9 reuse the per-skill bundle. `buildBundle()` validates `state.currentSkillId` is set before building; the bundle's `memo` carries the skill id (`skillwallet-proof: skill=dca-usdc-weth`).

### 3.3 Bundle shape built by the page

```jsonc
{
  "chainId": 11155111,
  "transactions": [
    {
      "permissionContext": [{ "delegate": "<1Shot targetAddress>", "delegator": "<Alice SA>", "authority": "<DelegationManager>", "caveats": [...], "salt": "0x...", "signature": "0x..." }],
      "executions": [
        {
          "target": "<DelegationManager>",
          "value": "0x0",
          "data": "encodeFunctionData(redeemDelegations, [[permissionContext], [mode], [executionCalldata]])"
        }
      ]
    }
  ],
  "authorizationList": [],
  "context": "<1Shot feeData.context>",
  "taskId": "uuid",
  "destinationUrl": "http://localhost:4000/runtime/oneshot/webhook",
  "memo": "skillwallet-proof: skill=<skillId>"
}
```

### 3.4 Failure honesty (no fake success)

| Failure mode                        | What page shows                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `relayer_estimate7710Transaction` returns `success: false` | `<pre>` shows raw 1Shot error + the full bundle. Page does NOT auto-send. |
| Insufficient USDC in funder EOA     | 1Shot 4200 → page shows `ONESHOT_INSUFFICIENT_PAYMENT` typed error                             |
| Smart account not yet deployed      | First on-chain call deploys it. Bundle builds counterfactually; relay pays gas via 1Shot USDC. |
| Quote expired (default 5 min)       | 1Shot 4204 → page shows `EXPIRED_ONESHOT_CONTEXT` (the page uses a fresh quote per attempt).   |
| MetaMask user rejects signature     | Page shows `Missing signature data` from `signDelegation()`. No silent fallback.              |

### 3.5 File layout

```
public/
  proof.html          ← 1 page, importmap, 9 sections
  proof.css           ← minimal styling: header accent, focus-visible, hover, status pills
src/runtime/proof/
  proof.controller.ts ← GET /proof, GET /proof/style.css, POST /proof/relayer
  proof.module.ts     ← imports RuntimeModule
test/
  proof-controller.spec.ts ← 9 tests
```

### 3.6 New tests added (this turn)

`test/proof-controller.spec.ts` — 9 tests, 20 expect() calls:

| # | Test                                                  | Asserts                                              |
| - | ----------------------------------------------------- | ---------------------------------------------------- |
| 1 | serves HTML page on GET /proof                        | `send()` called with HTML containing `importmap`     |
| 2 | rejects proxy without method                          | `BadRequestException`                                |
| 3 | rejects non-whitelisted relayer methods               | e.g. `relayer_sendTransaction` → 400                 |
| 4 | forwards `relayer_getCapabilities`                    | `getCapabilities` called                             |
| 5 | forwards `relayer_getFeeData`                         | `getFeeData` called w/ chainId                       |
| 6 | forwards `relayer_estimate7710Transaction`            | `estimate7710Transaction` called                     |
| 7 | forwards `relayer_send7710Transaction`                | `send7710Transaction` called                         |
| 8 | forwards `relayer_getStatus`                         | `getStatus` called w/ id                             |
| 9 | rejects `relayer_getStatus` without id                | `BadRequestException`                                |

### 3.7 Gate status after this turn

- `bun run build` — **79 swc files, 0 errors**
- `bun run lint` — **0 errors / 0 warnings**
- `bun run typecheck` — **0 errors**
- `bun test` — **104 pass / 0 fail / 223 expect() calls / 10 files** (was 88 pass / 9 files at start of session; +16 tests across `proof-controller.spec.ts` (9 unit + 6 real-HTTP) and `oneshot-relayer.spec.ts` (2 webhook-flexibility: warns-and-proceeds + bundle-overrides-env))

### 3.8 What this does NOT prove

- **Production signer flow** — page uses MetaMask as the signer. Backend runtime still assumes signing happens outside.
- **Funder-sponsored smart-account deploy** — the workshop Pimlico path is intentionally NOT used here. 1Shot deploys the smart account on first relay, paid from the 1Shot USDC fee context.
- **DCA end-to-end** — `DcaAdapter.buildAction()` still throws `NOT_IMPLEMENTED`. The page only exercises the delegation-redemption path.
