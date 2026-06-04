# SkillWallet Core Backend

NestJS backend for a MetaMask-native wallet skill marketplace. Users install "skills" (automated strategies like DCA, veAERO voting) that execute on-chain under explicit, auditable, revocable ERC-7715/7710 permissions.

> **MVP 1 simplification:** One main executor per chain handles ALL skills. Per-adapter executors are not configured.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                              HTTP API                                │
│  /health  /skills  /installations  /permissions  /runtime/run       │
└─────────────────────────────────────────────────────────────────────┘
        │              │              │             │           │
        ▼              ▼              ▼             ▼           ▼
   ┌────────┐   ┌────────────┐  ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ Health │   │  Skills    │  │Installation│ │Permission│ │ Runtime  │
   │ Module │   │  Module    │  │  Module   │ │  Module  │ │  Module  │
   └────────┘   └────────────┘  └──────────┘ └──────────┘ └──────────┘
                     │              │             │           │
                     ▼              ▼             ▼           ▼
              ┌─────────────────────────────────────────────────┐
              │            Mongoose / MongoDB                    │
              │  skills, installations, permissions, attempts,   │
              │  delegations, activity_log, executor_registry    │
              └─────────────────────────────────────────────────┘
                                        │
                                        ▼
              ┌─────────────────────────────────────────────────┐
              │         1Shot Relayer (gas-abstracted)           │
              │  JSON-RPC 2.0 over HTTPS (permissionless)       │
              │  Ed25519-signed webhooks, JWKS-verified         │
              └─────────────────────────────────────────────────┘
```

**Module responsibilities:**

- **Skills** — Marketplace catalog of installable skills. Built-ins seeded on first boot.
- **Installations** — A user's active (or pending) instance of a skill with config, schedule, budget.
- **Permissions** — Compiles a `PermissionManifest` + ERC-7715 `walletRequest` from a user's install request. Stores signed grants + delegations.
- **Executors** — Public registry of one main executor per chain (MVP 1).
- **Runtime** — Scheduler that picks due installations, validates the proposed on-chain action against the policy, and submits to the relayer.
- **Chains** — Per-chain configuration (RPC, addresses, supported features).
- **Health** — DB ping, version, uptime.

---

## Quick Start

### Prerequisites

- **Bun 1.3+** (not Node, not npm)
- **MongoDB** — local or Atlas
- A wallet with a deployed smart account (for end-to-end testing)

### Setup

```bash
# 1. Install dependencies
bun install

# 2. Copy env template and fill in values
cp .env.example .env
# Edit .env — at minimum set MONGODB_URI

# 3. Start dev server (watch mode)
bun run start:dev

# 4. Verify it's up
curl http://localhost:4000/health
```

### Build & Test

```bash
bun run build       # tsc / nest build — must exit 0
bun run lint        # eslint — must exit 0
bun run test        # bun test — 88 tests, 0 fail
bun run typecheck   # tsc --noEmit — must exit 0
```

---

## Environment Variables

| Var                               | Required | Description                                                                                                              |
| --------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `MONGODB_URI`                     | **yes**  | `mongodb://` or `mongodb+srv://` connection string                                                                       |
| `MONGODB_DB_NAME`                 | no       | default `skillwallet`                                                                                                    |
| `NODE_ENV`                        | no       | `development` \| `test` \| `production`                                                                                  |
| `PORT`                            | no       | default `4000`                                                                                                           |
| `ONESHOT_NETWORK`                 | no       | `mainnet` \| `testnet` (default `testnet`). Derives relayer URL + chain ID.                                              |
| `ONESHOT_RELAYER_URL`             | no       | Optional override for the relayer URL (default per network)                                                              |
| `ONESHOT_PAYMENT_TOKEN_ADDRESS`   | no       | ERC-20 token used to pay 1Shot fees. Defaults to USDC on the active chain when unset.                                    |
| `ONESHOT_DESTINATION_URL`         | no       | URL where 1Shot POSTs webhook callbacks (e.g. `https://host/runtime/oneshot/webhook`).                                   |
| `ONESHOT_JWKS_URL`                | no       | Preferred webhook signature verifier. JWKS endpoint (cached 1h, key-id header lookup).                                   |
| `ONESHOT_WEBHOOK_PUBLIC_KEY`      | no       | Fallback webhook verifier when JWKS fails. JWK JSON or base64 32-byte raw Ed25519 public key.                            |
| `ONESHOT_API_KEY`                 | no       | v1 M2M account-level key (for `api.1shotapi.com/v0/...` only; Public Relayer is permissionless)                          |
| `ONESHOT_API_SECRET`              | no       | v1 M2M account-level secret (paired with `ONESHOT_API_KEY`)                                                              |
| `ONESHOT_RELAYER_WALLET`          | no       | EOA that holds the USDC paying 1Shot fees (testnet primary: `0x2c4E85173372AA9fb0F210F91b69aF92f87BE2B2` on eth sepolia) |
| `ONESHOT_TESTNET_CHAIN_ID`        | no       | default `11155111` (eth sepolia). Used as `activeChainId` when `ONESHOT_NETWORK=testnet`                                 |
| `ONESHOT_MAINNET_CHAIN_ID`        | no       | default `8453` (base). Used as `activeChainId` when `ONESHOT_NETWORK=mainnet`                                            |
| **`ADMIN_API_KEY`**               | **yes**  | Random UUID. Sent as `x-api-key` header on admin-only routes.                                                            |

> **Boot behavior:** Missing `MONGODB_URI` or `ADMIN_API_KEY` → crash. Missing `ONESHOT_*` → permissive boot, but the affected endpoint returns typed `NOT_CONFIGURED` when called.

Generate a new admin key:

```bash
python3 -c "import uuid; print(uuid.uuid4())"
```

---

## Response Envelope

Every HTTP response is wrapped in a single, predictable shape.

**Success** — `2xx` responses

```json
{
  "payload": {
    /* the actual response data */
  },
  "meta": {
    "requestId": "9ba10659-97fd-4ea9-8817-bcdaf9c0e8fa",
    "timestamp": "2026-06-02T15:14:30.901Z"
  }
}
```

**Error** — `4xx` / `5xx` responses

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "type": "validation",
    "fields": [{ "field": "amountPerRun", "reason": "must be positive", "code": "invalid_type" }]
  },
  "meta": {
    "requestId": "a0cebe28-db6a-4ed1-ac40-35cd6f7f2d5d",
    "timestamp": "2026-06-02T15:14:31.109Z"
  }
}
```

**Guarantees**

- Exactly one of `payload` or `error` is present per response.
- `meta.requestId` correlates to server logs and the `x-request-id` response header. Honor inbound `x-request-id` if it matches `[a-zA-Z0-9_-]{1,128}`; otherwise a UUID v4 is generated.
- HTTP status code is canonical. The `code` and `type` fields are machine-readable.
- Stack traces, file paths, DB column names, ORM library info, and internal class names are **never** included in `error.message`. In production, 5xx errors return `"An unexpected error occurred"`.
- `error.code` is one of the typed values in `src/common/errors/error-codes.ts` plus `UNAUTHORIZED` (from Nest's `UnauthorizedException`) and `INTERNAL_ERROR` (fallback).

---

## Admin Authentication

Some write endpoints mutate shared state and are gated by a simple `x-api-key` header.

**Protected routes:**

- `POST /skills`, `PATCH /skills/:skillId`
- `POST /executors`, `PATCH /executors/:id`
- `PATCH /installations/:id/status`
- `POST /installations/:id/{pause,resume,revoke}`

**Usage:**

```bash
curl -X POST http://localhost:4000/skills \
  -H "Content-Type: application/json" \
  -H "x-api-key: $ADMIN_API_KEY" \
  -d '{ "skillId": "..." }'
```

**Failure modes (all return the standard error envelope):**

| Condition                         | Status | `error.code`     | `error.message`                |
| --------------------------------- | ------ | ---------------- | ------------------------------ |
| `x-api-key` header missing        | 401    | `UNAUTHORIZED`   | `Authentication required`      |
| `x-api-key` wrong                 | 401    | `UNAUTHORIZED`   | `Authentication required`      |
| `ADMIN_API_KEY` not set on server | 500    | `INTERNAL_ERROR` | `An unexpected error occurred` |

The check is `timingSafeEqual` against the configured key (same-length, constant-time). Prefix attacks are rejected by the length check.

The Postman collection ships an `xApiKey` collection variable that flows from `ADMIN_API_KEY` in `.env` into the `x-api-key` header on every (admin) request.

---

---

## MVP 1: One Main Executor Per Chain

**Design:** For MVP 1, there is **one executor address per chain**. It handles ALL skills. The executor registry is keyed by `chainId` only, not by adapter.

```ts
// executors.service.ts
const executor = await this.executorModel.findOne({ chainId, status: 'active' });
```

The `adapter` field in `executor_registry` is kept as optional metadata (default `'multi'`) for future extensibility — if you later need specialized executors per skill, you can add them without a schema migration. For MVP 1, all skills use the same main executor.

**To add the main executor on first boot:**

```bash
POST /executors
{
  "chainId": 8453,
  "executorAddress": "0x...",
  "delegationManagerAddress": "0x..."
}
```

---

## Domain Model

| Entity                          | Purpose                                                | Collection                   |
| ------------------------------- | ------------------------------------------------------ | ---------------------------- |
| `SkillDefinition`               | Marketplace template (DCA, Aerodrome Vote, …)          | `skill_definitions`          |
| `SkillInstallation`             | A user's active instance with config, schedule, budget | `skill_installations`        |
| `PermissionManifest`            | SkillWallet's normalized, signed app-level policy      | `permission_manifests`       |
| `WalletPermissionRequestRecord` | ERC-7715 request stored for wallet                     | `wallet_permission_requests` |
| `WalletPermissionGrantRecord`   | Wallet's approval result                               | `wallet_permission_grants`   |
| `DelegationRecord`              | ERC-7710 delegation derived from grant                 | `delegation_records`         |
| `ExecutionAttempt`              | Every run attempt with full status chain               | `execution_attempts`         |
| `ActivityLog`                   | Audit trail for all state changes                      | `activity_log`               |
| `ExecutorRegistry`              | One main executor per chain (MVP 1)                    | `executor_registry`          |

---

## ERC-7715 / ERC-7710 vs `PermissionManifest`

```
┌──────────────────────────────────────────────────────────────────────┐
│  User installs skill                                                 │
└──────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  POST /permissions/check-support (optional, pre-flight)              │
│  → PermissionSupportCheckerService                                   │
│     Compares wallet reported permissions against skill's             │
│     permissionRequirements[]. Returns matched[] + missing[] + checkId│
└──────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  POST /permissions/prepare                                           │
│  → PermissionCompilerService                                         │
│     1. Build PermissionManifest (SkillWallet app-level policy)      │
│        - allowedActions / forbiddenActions (descriptive)             │
│        - allowedTargets / allowedSelectors / allowedTokens           │
│        - rules[] with enforcement: wallet-permission | backend-policy│
│        - validAfter / validUntil                                     │
│     2. Build ERC-7715 walletRequest (wallet standard)                │
│        - chainId, from, permission{type, isAdjustmentAllowed, data}  │
│        - rules[] (erc20-periodic-spend, expiry, etc.)                 │
│     3. Persist installation (status='pending_permission')            │
│     4. Returns permissionRequests[] ready for wallet_request…        │
└──────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  User signs in wallet/Snap                                           │
│  wallet_requestExecutionPermissions(permissionRequests)              │
│  → wallet returns PermissionResponse[] with:                        │
│     - context, delegationManager, permission, rules, dependencies    │
└──────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  POST /permissions/grant with permissionResponses[]                  │
│     1. Verify attenuation: isAdjustmentAllowed=false;                │
│        periodAmount/periodDuration ≤ requested; type/chainId match   │
│     2. Persist WalletPermissionGrantRecord (raw + normalized)        │
│     3. Persist DelegationRecord (ERC-7710) per response             │
│     4. Set status='active' (or 'dependencies_pending' if deps)      │
└──────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  POST /permissions/dependencies/report (if any deps)                 │
│     - Marks each dep as pending/deploying/deployed                   │
│     - When all deployed: status='active'                             │
└──────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Scheduler picks due installation → RunnerService                    │
│     1. checkFailClosed() — fail if any of: status, grant, responses, │
│        context, delegationManager, chainId match, expiry, delegation,│
│        dependencies are missing/invalid                              │
│     2. Adapter.buildAction → ProposedAction (server-side, no AI)     │
│     3. PolicyValidatorService.validate → ok? blocked? (fail-closed)  │
│     4. buildBundle() uses granted context + delegationManager        │
│     5. Relayer.relayDelegatedExecution → 1Shot                       │
└──────────────────────────────────────────────────────────────────────┘
```

**Why both layers?**

- `PermissionManifest` is **SkillWallet's app-level policy** — what's allowed, what's forbidden, and how it's enforced (`backend-policy` vs `wallet-permission`).
- `walletRequest` is the **ERC-7715 standard** the wallet understands — it gets the actual on-chain caveat (e.g. `erc20-token-periodic` with periodAmount, periodDuration, startTime).
- A successful runtime execution requires BOTH to pass: the manifest is validated server-side, and the wallet enforces the on-chain caveat.

---

## Permission Endpoints (v2 ERC-7715-first)

| Method | Path                                              | Purpose                                                                 |
| ------ | ------------------------------------------------- | ----------------------------------------------------------------------- |
| `POST` | `/permissions/check-support`                      | Pre-flight: does the wallet support the skill's `permissionRequirements[]`? Returns `{ matched[], missing[], checkId }`. |
| `POST` | `/permissions/prepare`                            | Build `PermissionManifest` + ERC-7715 `walletRequest`. Persists installation (status=`pending_permission`). Returns `{ permissionRequests[] }` ready for `wallet_requestExecutionPermissions`. |
| `POST` | `/permissions/grant`                              | Submit `permissionResponses[]` from wallet. Verifies attenuation (`isAdjustmentAllowed=false`, `periodAmount` ≤ requested, `type` + `chainId` match). Persists grant + delegation. Activates installation (or `dependencies_pending` if deps). |
| `POST` | `/permissions/dependencies/report`                | Mark dependencies as `pending`/`deploying`/`deployed`/`failed`. Auto-activates installation when all deployed. |
| `POST` | `/permissions/revoke`                             | Revoke permission + cascade to `DelegationRecord` (status=`revoked`). Calls `wallet_revokeExecutionPermission` from the client first. |
| `GET`  | `/permissions/granted/:installationId`            | Read installation + grant + delegation by installationId.               |

**Body for `POST /permissions/grant`:**

```jsonc
{
  "installationId": "inst_…",
  "permissionResponses": [
    {
      "chainId": 11155111,
      "from": "0x…smartAccount…",
      "permission": {
        "type": "erc20-token-periodic",
        "isAdjustmentAllowed": false,
        "data": {
          "tokenAddress": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
          "periodAmount": "10000000",
          "periodDuration": 604800,
          "startTime": 1700000000
        }
      },
      "rules": [{ "type": "erc20-periodic-spend", "data": {…} }],
      "context": "0x…",
      "delegationManager": "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3",
      "dependencies": []
    }
  ]
}
```

**Attenuation rules enforced server-side:**

- `permissionResponses[].permission.isAdjustmentAllowed === true` → reject
- `permissionResponses[].permission.type` must match requested type
- `permissionResponses[].chainId` must match installation `chainId`
- `periodAmount` (when `type=erc20-token-periodic`) must be ≤ requested
- `periodDuration` must be ≤ requested
- `context` + `delegationManager` must be non-empty
- `permissionResponses[].from` must match `smartAccountAddress` (if provided)

**Skill `permissionRequirements[]`** (per-chain, on `SkillDefinition`):

```ts
{
  chainId: 11155111,
  permissionType: 'erc20-token-periodic',
  requiredRuleTypes: ['erc20-periodic-spend', 'expiry'],
}
```

## Forbidden Actions → Positive Rules

`forbiddenActions` is descriptive. Every forbidden action is backed by a **positive rule** that actually blocks execution:

| Forbidden action                        | Backed by                                                      |
| --------------------------------------- | -------------------------------------------------------------- |
| "Transfer funds to arbitrary addresses" | `allowed-target` rule + `rule.no-transfer` policy              |
| "Approve unlimited token allowance"     | `rule.no-unlimited-approval` + `no-unlimited-approval` rule    |
| "Use unknown routers"                   | `allowed-target` rule pinning the router address               |
| "Swap into unknown tokens"              | `fixed-token-in` + `fixed-token-out` rules                     |
| "Withdraw funds to executor"            | `fixed-recipient` rule pinning the smart account               |
| "Spend more than 10 USDC/week"          | `erc20-periodic-spend` rule with periodAmount + periodDuration |

**Enforcement honesty:** The `enforcement` field on each rule states where it is enforced:

- `wallet-permission` — enforced onchain by the wallet (ERC-7715 caveat)
- `onchain-caveat` — enforced by a contract caveat
- `backend-policy` — enforced by `PolicyValidatorService` (fail-closed)
- `ui-warning` — shown to user, not blocking

The API response never claims `forbiddenActions` are onchain-enforced unless the corresponding `enforcement` says so.

---

## Adding a New Skill

1. Append to `src/skills/definitions/built-in-skills.ts`:
   ```ts
   {
     skillId: 'my-new-skill',
     slug: 'my-new-skill',
     name: 'My New Skill',
     description: '...',
     adapter: 'my-new-adapter',           // matches your adapter key
     status: 'live',                       // or 'adapter-ready' for staging
     supportedChains: [8453],
     defaultChainId: 8453,
     aiMode: 'none',                       // or 'optional' / 'required'
     permissionTemplate: { type: 'skillwallet.permission.v1', defaultSelectors: [], defaultTokens: [] },
     pricing: { type: 'fixed-duration', options: [...] },
     defaultSchedule: { type: 'recurring', frequency: 'weekly', timezone: 'UTC' },
     metadata: { icon: 'my-icon', tags: [...], riskLevel: 'medium' },
   }
   ```
2. Create an adapter at `src/runtime/adapters/my-new-adapter.adapter.ts`:
   - `kind` = `'my-new-adapter'`
   - `checkTrigger({ installation, now })` — returns `{ shouldRun, reason? }`
   - `buildAction({ installation, now })` — returns `{ proposedAction }`. **Server-side only. Never AI-generated calldata.**
3. Register the adapter in `src/runtime/adapters/adapter-registry.service.ts`.
4. Compile path in `src/permissions/permission-compiler.service.ts` (mirror `compileDca` / `compileAerodromeVote`).
5. Add permission manifest rules + ERC-7715 raw request shape in the compiler.
6. Restart — built-ins are upserted on boot (`upsertBuiltIn`).

No schema migration needed. The `builtInSkills` array is the extension point.

---

## Why AI Does Not Generate Calldata

AI is used only for **explanation** (e.g. "why this veAERO pool"), never for constructing on-chain calldata.

**Reasoning:**

1. **Determinism** — AI outputs are non-deterministic. Calldata must be byte-exact.
2. **Auditability** — Users grant permissions against a specific, signed manifest. AI-generated calldata at runtime would be a different action than what was approved.
3. **Safety** — A prompt injection in the AI's context (e.g. a malicious pool name) could craft a swap that drains funds.
4. **Policy validation** — The server-side `PolicyValidatorService` validates the proposed action against the manifest. If the proposal is AI-generated, the manifest can't pre-validate it.

**Where AI may be used:**

- `aiMode: 'optional'` skills (e.g. Aerodrome vote optimizer) can use AI to **explain** a vote decision to the user. The AI never proposes the calldata — that's done by the deterministic strategy in `buildAction`.

---

## Snap Integration Plan

The MetaMask Snap is the **signing surface** for ERC-7715 permissions and the **client** that watches for execution attempts.

**Flow:**

1. Front-end calls `POST /permissions/prepare` → gets `walletRequest`.
2. Front-end passes `walletRequest` to the Snap.
3. Snap calls `wallet_requestExecutionPermissions` on the wallet.
4. User reviews the manifest in Snap UI (allowedActions, forbiddenActions, rules with enforcement).
5. User signs in wallet (gasless via delegation).
6. Snap returns `{ context, delegationManager, expiresAt, normalizedPermissions }` to the front-end.
7. Front-end calls `POST /permissions/grant` with the grant payload.
8. Backend stores the grant + delegation; activates the installation.
9. Scheduler picks it up; runner submits to relayer; user is notified via Snap push or front-end poll.

**Snap is out of scope for this backend.** The backend exposes the same APIs regardless of how the grant was obtained (Snap, mobile wallet, extension, etc.).

---

## 1Shot Relayer

The backend talks to 1Shot v2 — a **permissionless JSON-RPC API** at `https://relayer.1shotapi.{com,dev}/relayers`. The Public Relayer endpoint accepts requests without auth; the account-level `ONESHOT_API_KEY` + `ONESHOT_API_SECRET` are kept around for the v1 M2M contract-method API (`api.1shotapi.com/v0/...`) which uses a different bearer-token flow. The service is always wired; if the payment token is not configured and no default exists for the active chain, the affected endpoint returns typed `NOT_CONFIGURED`.

> **14-phase hardening done.** All gates green: `build` 0 errors, `lint` 0/0, `typecheck` 0 errors, `bun test` 88 pass / 0 fail. See [EIP-7710 Bundle Hardening (14-phase)](#eip-7710-bundle-hardening-14-phase) below.

**Network + chain selection.** `ONESHOT_NETWORK` is `mainnet` or `testnet` (default `testnet`). Both the relayer URL and the active chain ID are derived from this:

| Network   | Relayer URL                             | Active chain ID                                               |
| --------- | --------------------------------------- | ------------------------------------------------------------- |
| `mainnet` | `https://relayer.1shotapi.com/relayers` | `ONESHOT_MAINNET_CHAIN_ID` (default `8453` = Base)            |
| `testnet` | `https://relayer.1shotapi.dev/relayers` | `ONESHOT_TESTNET_CHAIN_ID` (default `11155111` = eth sepolia) |

The runner reads `getActiveChainId()` to know which chain to target. Override the URL with `ONESHOT_RELAYER_URL` if you need to point at a custom deployment.

**Payment model.** 1Shot charges fees in an **accepted ERC-20 per chain** (no native-token support). Discover accepted tokens via `relayer_getCapabilities [chainId]`. When `ONESHOT_PAYMENT_TOKEN_ADDRESS` is unset, the service defaults to USDC on the active chain:

| Chain                  | USDC (default)                               |
| ---------------------- | -------------------------------------------- |
| eth mainnet (1)        | `0xa0b86991c6218b36c1d19d4a2e9Eb0cE3606eB48` |
| eth sepolia (11155111) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| base (8453)            | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| base sepolia (84532)   | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

The EOA funding the USDC fees is configured via `ONESHOT_RELAYER_WALLET` (testnet primary: `0x2c4E85173372AA9fb0F210F91b69aF92f87BE2B2` on eth sepolia, has faucet funds).

**Real verified round-trip (eth sepolia):**

```jsonc
// POST https://relayer.1shotapi.dev/relayers
// {"jsonrpc":"2.0","id":"…","method":"relayer_getFeeData","params":{"chainId":"11155111","token":"0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"}}
{
  "result": {
    "chainId": "11155111",
    "token": {
      "decimals": 6,
      "address": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      "symbol": "USDC",
      "name": "USDC",
    },
    "rate": 2000,
    "minFee": "0.01",
    "expiry": 1780415025,
    "gasPrice": "1339446477",
    "feeCollector": "0xE936e8FAf4A5655469182A49a505055B71C17604",
    "targetAddress": "0x02c9979a75fbdbc3a77485024ab8b6474308591e",
    "context": "{…JSON-stringified price-lock quote with signature…}",
  },
}
```

**JSON-RPC methods (1:1 wire mapping).** All requests are `POST {relayerUrl}/rpc` with a standard JSON-RPC 2.0 envelope.

| Method                                      | Purpose                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `relayer_getCapabilities`                   | Discover supported networks / methods / features                       |
| `relayer_getFeeData`                        | Estimate fee (paymentToken + requiredPaymentAmount + gas) for a bundle |
| `relayer_estimate7710Transaction`           | Estimate outcome of an EIP-7710 bundle (single chain)                  |
| `relayer_estimate7710TransactionMultichain` | Same, multichain                                                       |
| `relayer_send7710Transaction`               | Submit an EIP-7710 bundle (single chain)                               |
| `relayer_send7710TransactionMultichain`     | Same, multichain                                                       |
| `relayer_sendTransaction`                   | Submit a raw tx (no delegation)                                        |
| `relayer_sendTransactionMultichain`         | Same, multichain                                                       |
| `relayer_getStatus`                         | Poll task status by `taskId`                                           |

**EIP-7710 bundle shape (single-chain).** The runner builds this and calls `relayer_send7710Transaction`:

```jsonc
{
  "chainId": 8453,
  "transactions": [
    {
      "permissionContext": "0x…",
      "executions": [{ "target": "0x…", "callData": "0x…", "value": "0x0" }],
    },
  ],
  "authorizationList": [
    /* EIP-7702 */
  ],
  "context": "0x…",
  "taskId": "uuid",
  "destinationUrl": "https://your-host/webhooks/oneshot",
}
```

**Status codes** (numeric, returned by 1Shot + on the webhook):

| Code | Name      | Meaning                     |
| ---- | --------- | --------------------------- |
| 100  | pending   | accepted, not yet on-chain  |
| 110  | submitted | tx broadcast                |
| 200  | confirmed | tx mined                    |
| 400  | rejected  | pre-chain validation failed |
| 500  | reverted  | tx reverted on-chain        |

**Error codes** (EIP-1193-shaped, returned in JSON-RPC `error.code`):

| Code | Mapped to `AppError` | Meaning                                  |
| ---- | -------------------- | ---------------------------------------- |
| 4200 | `VALIDATION_ERROR`   | invalid params                           |
| 4202 | `NOT_FOUND`          | resource not found (e.g. unknown taskId) |
| 4204 | `RELAYER_ERROR`      | request rejected                         |
| 4210 | `RELAYER_ERROR`      | user rejected                            |
| 4211 | `RELAYER_ERROR`      | insufficient funds                       |

**Webhooks.** 1Shot POSTs `POST /webhooks/oneshot` with an Ed25519-signed body. The verifier resolves the public key from one of two sources (in order):

1. **JWKS** at `ONESHOT_JWKS_URL` (preferred) — cached for 1 hour, keys looked up by `key-id` header.
2. **Static fallback** `ONESHOT_WEBHOOK_PUBLIC_KEY` — a JWK JSON object or a base64-encoded 32-byte raw Ed25519 public key.

The controller verifies the signature over the **raw request body** (captured in `main.ts` via the express `verify` hook), looks up the matching `ExecutionAttempt` by `relay.taskId`, and patches `statusCode` / `txHash` / `errorCode` / `errorMessage` in place.

**`RelayRecord` (v2).** Embedded on every `ExecutionAttempt` that submitted a bundle:

```ts
{
  provider: '1shot',
  taskId: '…',
  statusCode: 100 | 110 | 200 | 400 | 500,
  status: 'pending' | 'submitted' | 'confirmed' | 'rejected' | 'reverted',
  targetAddress: '0x…',        // smart account or DelegationManager
  paymentToken: '0x…',         // USDC on the relevant chain
  requiredPaymentAmount: '…',   // atomic units, base-10 string
  context: '0x…',              // opaque 1Shot context
  txHash?: '0x…',
  errorCode?: 4200 | 4202 | 4204 | 4210 | 4211,
  errorMessage?: '…',
  externalStatusUrl?: '…'
}
```

**`POST /webhooks/oneshot` is the only way the relayer pushes back.** Until the webhook lands, the runner can still poll `relayer_getStatus` via `getRelayStatus(taskId)`.

---

## EIP-7710 Bundle Hardening (14-phase)

The 1Shot integration was hardened in a 14-phase pass from "capability discovery works" to "real signed EIP-7710 bundle can be estimated, sent, tracked, persisted." All four gates green:

- `bun run build` — 77 swc files, 0 errors
- `bun run lint` — 0 errors / 0 warnings
- `bun run typecheck` — 0 errors
- `bun test` — **88 pass / 0 fail / 183 expect() calls**

**What's in the box:**

- `OneShotBundleValidator` — shape + capabilities + context checks; rejects bundles containing `privateKey` / `priv_key` at the whole-bundle level
- `OneShotRelayerService` — object-params wire shape, `relayer_send7710Transaction` / `relayer_estimate7710Transaction` / `relayer_getStatus`; 6 typed 1Shot error codes (4001 / 4200 / 4202 / 4204 / 4210 / 4211) mapped to `AppError`
- Runner: **estimate-before-send**; verifies target + payment unchanged at relay time; fails closed on `EXPIRED_ONESHOT_CONTEXT` / `MISSING_ONESHOT_CONTEXT`
- Webhook controller `POST /runtime/oneshot/webhook` — Ed25519-signed body verification, taskId correlation, `relay.taskId` → `ExecutionAttempt` patch, ActivityLog write
- `RelayRecord` carries `quoteContext` / `requiredPaymentAmountEstimate` / `method` for audit
- **DCA fail-closed** — `DcaAdapter.buildAction()` throws `NOT_IMPLEMENTED`; no fake swap calldata
- `scripts/oneshot-sepolia-proof.ts` — dev-only, requires `DEV_SEPOLIA_PRIVATE_KEY` env var (66-char 0x-prefixed), `process.exit(1)` if missing; never imported by backend

**OpenRPC-exact method names** (from `https://1shotapi.com/openrpc/openrpc.json`):

| Method                                      | Params                                  |
| ------------------------------------------- | --------------------------------------- |
| `relayer_getCapabilities`                   | `[chainId, ...]`                        |
| `relayer_getFeeData`                        | `{chainId, token}`                      |
| `relayer_sendTransaction`                   | `{chainId, payment, to, data, ...}`     |
| `relayer_send7710Transaction`               | `{chainId, transactions[], ...}`        |
| `relayer_send7710TransactionMultichain`     | `[{chainId, transactions[], ...}, ...]` |
| `relayer_estimate7710Transaction`           | `{chainId, transactions[], ...}`        |
| `relayer_estimate7710TransactionMultichain` | `[{chainId, transactions[], ...}, ...]` |
| `relayer_getStatus`                         | `{id, logs}`                            |

**Webhook event → status code mapping:**

| Event pattern                              | Status | ActivityLog type      |
| ------------------------------------------ | ------ | --------------------- |
| `*Reverted*`                               | 500    | `execution.failed`    |
| `*Rejected*`                               | 400    | `execution.failed`    |
| `*Submitted*`                              | 110    | `execution.relayed`   |
| `*Success*` / `*Confirmed*` (status `0x1`) | 200    | `execution.confirmed` |
| `*Success*` / `*Confirmed*` (status `0x0`) | 500    | `execution.failed`    |
| fallback                                   | 100    | `execution.relayed`   |

---

## Real MetaMask Smart Accounts Kit + 1Shot Proof (HTML page)

Dev-only browser page proving end-to-end that the SkillWallet backend + 1Shot v2 can carry a real signed EIP-7710 delegation from the user's MetaMask all the way to a relayer submission. **No Pimlico, no bundler, no paymaster, no mocks.**

### How to run

```bash
bun run start:dev
# then open http://localhost:4000/proof
```

The page connects to your real MetaMask on Sepolia (11155111). Click through the 9 sections in order. Every artifact prints to a `<pre>` block; nothing is hidden.

### Page flow (9 sections)

| #   | Action                   | What it proves                                                                                                          |
| --- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | Load skills              | `GET /skills` works + marketplace returns 2 built-in skills                                                             |
| 2   | Connect MetaMask         | `window.ethereum` available + Sepolia chain switch                                                                      |
| 3   | Create smart account     | `@metamask/smart-accounts-kit` `toMetaMaskSmartAccount` w/ `Implementation.Hybrid` works in the browser                 |
| 4   | Verify DelegationManager | SDK `environment.DelegationManager` matches on-chain contract code; `eip712Domain()` returns valid name/version/chainId |
| 5   | 1Shot capabilities + fee | Backend proxy (`POST /proof/relayer`) returns real `targetAddress` + `feeCollector` + `rate`/`minFee`/`expiry` for USDC |
| 6   | Build + sign delegation  | `createDelegation` + `signDelegation` triggers MetaMask popup; signed delegation encodes to `permissionContext`         |
| 7   | Estimate                 | `relayer_estimate7710Transaction` accepts the bundle and returns `requiredPaymentAmount`                                |
| 8   | Send                     | `relayer_send7710Transaction` returns real `taskId`                                                                     |
| 9   | Poll status              | `relayer_getStatus` walks the chain 100 → 110 → 200 (or 400/500)                                                        |

### Architecture

```
Browser (real MetaMask extension)
    │
    │  importmap → esm.sh (viem, @metamask/smart-accounts-kit, @metamask/delegation-abis)
    │
    ├── GET  /skills                (SkillWallet backend, same origin)
    ├── POST /proof/relayer         (whitelisted JSON-RPC proxy to 1Shot)
    │      └── 1ShotRelayerService  (relayer.1shotapi.dev/relayers)
    └── POST /runtime/oneshot/webhook  (where 1Shot will POST the callback)
```

### Backend proof surface

| Route                   | Purpose                                                                                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET  /proof`           | Serves `public/proof.html` (single-page UI)                                                                                                                                                          |
| `GET  /proof/style.css` | Serves `public/proof.css`                                                                                                                                                                            |
| `POST /proof/relayer`   | JSON-RPC proxy. Method whitelist: `relayer_getCapabilities`, `relayer_getFeeData`, `relayer_estimate7710Transaction`, `relayer_send7710Transaction`, `relayer_getStatus`. Anything else returns 400. |

The proxy exists for two reasons: (1) avoids CORS on direct 1Shot calls; (2) keeps one place to add server-side auth / rate limiting later. The proxy forwards to the existing `OneShotRelayerService` — no new relayer code.

### File layout

```
public/
  proof.html          ← single page, importmap, 9 sections
  proof.css           ← minimal styling (header accent, focus-visible, hover transitions, status pills)
src/runtime/proof/
  proof.controller.ts ← GET /proof, GET /proof/style.css, POST /proof/relayer
  proof.module.ts     ← imports RuntimeModule (so the proxy can talk to OneShotRelayerService)
test/
  proof-controller.spec.ts ← 9 tests: HTML serves, CSS serves, 5 whitelisted proxy methods, 2 rejections
```

### Failure honesty (no fake success)

- Estimating a bundle with an unsigned/invalid delegation → 1Shot returns `success: false` and the page prints the error. No fallback.
- Sending a bundle with insufficient USDC in `ONESHOT_RELAYER_WALLET` → 1Shot returns 4200 (`ONESHOT_INSUFFICIENT_PAYMENT`). Page prints it.
- Smart account is counterfactual until first on-chain call — first relay will deploy it, paying gas from the 1Shot-fee-funded flow.
- Any 1Shot error code (4001 / 4200 / 4202 / 4204 / 4210 / 4211) surfaces in the page as a typed `error` object. No silent fallbacks.

### What this does NOT prove

- **Production signer flow** — the page uses MetaMask as the signer. The backend runtime still assumes signing happens outside (KMS/signer future work).
- **Smart account deployment sponsored by a separate funder** — the workshop pattern (funder EOA deploys Alice's smart account via Pimlico) is intentionally NOT used here. The 1Shot flow deploys the smart account on first relay, paid by the 1Shot USDC fee context.
- **DCA end-to-end** — the DCA adapter is still fail-closed (`NOT_IMPLEMENTED` in MVP 1). The page only exercises the delegation-redemption path, not the strategy code.

---

## Current Limitations

1. **No executor key custody** — The backend never holds executor private keys. The executor signs UserOps externally (out of scope). Backend only stores the delegation and the unsigned `relayPayload`.
2. **No rate limiting** — guard planned but not wired.
3. **No multi-tenant isolation** — single deployment, single DB.
4. **Built-in skills are 2** — DCA (live), Aerodrome Vote (adapter-ready, not yet enabled for installation). Adding more is just appending to `builtInSkills`.
5. **No retry/backoff for relayer failures** — the runner records the failure and schedules the next attempt; a dead-letter queue is planned.

---

## Architecture Decisions

- **No mocks, no fake success** — All paths return typed errors when config is missing. The runner records real outcomes; the relayer is the source of truth for execution.
- **Runtime fails closed** — If the policy validator, relayer, or any link in the chain errors, the attempt is marked `failed` / `blocked` and never silently succeeds.
- **No private keys in this repo, ever** — `CLAUDE.md` enforces this. Executor signing is a separate concern.
- **`builtInSkills` is the single source of truth for the catalog** — the DB upserts from it on first boot. Manual DB edits are overwritten on next boot unless `allowOverwriteBuiltIn: true` is passed.
- **Adapter pattern over hard-coded skills** — the `AdapterRegistryService` resolves by `kind`, so new skills don't need changes to the runner, scheduler, or policy validator.

---

## License

TBD
