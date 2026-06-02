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
bun run test        # bun test — 50 tests
```

---

## Environment Variables

| Var | Required | Description |
|---|---|---|
| `MONGODB_URI` | **yes** | `mongodb://` or `mongodb+srv://` connection string |
| `MONGODB_DB_NAME` | no | default `skillwallet` |
| `NODE_ENV` | no | `development` \| `test` \| `production` |
| `PORT` | no | default `4000` |
| `DEFAULT_CHAIN_ID` | no | default `8453` (Base) |
| `BASE_RPC_URL` | no | required for on-chain reads/writes |
| `BASE_DELEGATION_MANAGER_ADDRESS` | no | ERC-7710 DelegationManager on Base |
| **`BASE_EXECUTOR_ADDRESS`** | no | **Single main executor on Base (MVP 1). Handles ALL skills.** |
| `BASE_USDC_ADDRESS` | no | used by built-in DCA skill |
| `BASE_WETH_ADDRESS` | no | used by built-in DCA skill |
| `BASE_SWAP_ROUTER_ADDRESS` | no | DEX router for DCA |
| `ONESHOT_NETWORK` | no | `mainnet` \| `testnet` (default `testnet`). Derives relayer URL. |
| `ONESHOT_RELAYER_URL` | no | Optional override for the relayer URL |
| `ONESHOT_PAYMENT_TOKEN_ADDRESS` | no | ERC-20 token used to pay 1Shot fees (USDC by default) |
| `ONESHOT_DESTINATION_URL` | no | Webhook URL 1Shot POSTs status updates to |
| `ONESHOT_JWKS_URL` | no | JWKS endpoint for Ed25519 webhook signature verification |
| `ONESHOT_WEBHOOK_PUBLIC_KEY` | no | Fallback Ed25519 public key (JWK JSON or base64 raw 32 bytes) |

> **Boot behavior:** Missing `MONGODB_URI` → crash. Missing `ONESHOT_*` or `BASE_EXECUTOR_ADDRESS` → permissive boot, but the affected endpoint returns typed `NOT_CONFIGURED` when called.

---

## MVP 1: One Main Executor Per Chain

**Design:** For MVP 1, there is **one executor address per chain**. It handles ALL skills. The executor registry is keyed by `chainId` only, not by adapter.

```ts
// env.schema.ts
BASE_EXECUTOR_ADDRESS=0xYourExecutorOnBase

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

| Entity | Purpose | Collection |
|---|---|---|
| `SkillDefinition` | Marketplace template (DCA, Aerodrome Vote, …) | `skill_definitions` |
| `SkillInstallation` | A user's active instance with config, schedule, budget | `skill_installations` |
| `PermissionManifest` | SkillWallet's normalized, signed app-level policy | `permission_manifests` |
| `WalletPermissionRequestRecord` | ERC-7715 request stored for wallet | `wallet_permission_requests` |
| `WalletPermissionGrantRecord` | Wallet's approval result | `wallet_permission_grants` |
| `DelegationRecord` | ERC-7710 delegation derived from grant | `delegation_records` |
| `ExecutionAttempt` | Every run attempt with full status chain | `execution_attempts` |
| `ActivityLog` | Audit trail for all state changes | `activity_log` |
| `ExecutorRegistry` | One main executor per chain (MVP 1) | `executor_registry` |

---

## ERC-7715 / ERC-7710 vs `PermissionManifest`

```
┌──────────────────────────────────────────────────────────────────────┐
│  User installs skill                                                 │
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
│        - chainId, from, to, expiry, permission{type, data}           │
│     3. Hash: manifestHash, requestHash (stable for identical input)  │
└──────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  User signs in wallet/Snap                                           │
│  → POST /permissions/grant with { context, delegationManager, …}     │
│     1. Persist WalletPermissionGrantRecord (raw + normalized)        │
│     2. Persist DelegationRecord (ERC-7710) if context + manager     │
│     3. Activate SkillInstallation                                    │
└──────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Scheduler picks due installation → RunnerService                    │
│     1. Adapter.buildAction → ProposedAction (server-side, no AI)     │
│     2. PolicyValidatorService.validate → ok? blocked? (fail-closed)  │
│     3. Relayer.relayDelegatedExecution → 1Shot                       │
└──────────────────────────────────────────────────────────────────────┘
```

**Why both layers?**
- `PermissionManifest` is **SkillWallet's app-level policy** — what's allowed, what's forbidden, and how it's enforced (`backend-policy` vs `wallet-permission`).
- `walletRequest` is the **ERC-7715 standard** the wallet understands — it gets the actual on-chain caveat (e.g. `erc20-token-periodic` with periodAmount, periodDuration, startTime).
- A successful runtime execution requires BOTH to pass: the manifest is validated server-side, and the wallet enforces the on-chain caveat.

---

## Forbidden Actions → Positive Rules

`forbiddenActions` is descriptive. Every forbidden action is backed by a **positive rule** that actually blocks execution:

| Forbidden action | Backed by |
|---|---|
| "Transfer funds to arbitrary addresses" | `allowed-target` rule + `rule.no-transfer` policy |
| "Approve unlimited token allowance" | `rule.no-unlimited-approval` + `no-unlimited-approval` rule |
| "Use unknown routers" | `allowed-target` rule pinning the router address |
| "Swap into unknown tokens" | `fixed-token-in` + `fixed-token-out` rules |
| "Withdraw funds to executor" | `fixed-recipient` rule pinning the smart account |
| "Spend more than 10 USDC/week" | `erc20-periodic-spend` rule with periodAmount + periodDuration |

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

The backend talks to 1Shot v2 — a **permissionless JSON-RPC API** (no API key, no HMAC). The service is always wired; if `ONESHOT_PAYMENT_TOKEN_ADDRESS` or `ONESHOT_DESTINATION_URL` is missing, the affected endpoint returns typed `NOT_CONFIGURED`.

**Network selection.** `ONESHOT_NETWORK` is `mainnet` or `testnet` (default `testnet`). The relayer URL is derived from this:

| Network | URL |
|---|---|
| `mainnet` | `https://relayer.1shotapi.com/relayers` |
| `testnet` | `https://relayer.1shotapi.dev/relayers` |

Override with `ONESHOT_RELAYER_URL` if you need to point at a custom deployment.

**JSON-RPC methods (1:1 wire mapping).** All requests are `POST {relayerUrl}/rpc` with a standard JSON-RPC 2.0 envelope.

| Method | Purpose |
|---|---|
| `relayer_getCapabilities` | Discover supported networks / methods / features |
| `relayer_getFeeData` | Estimate fee (paymentToken + requiredPaymentAmount + gas) for a bundle |
| `relayer_estimate7710Transaction` | Estimate outcome of an EIP-7710 bundle (single chain) |
| `relayer_estimate7710TransactionMultichain` | Same, multichain |
| `relayer_send7710Transaction` | Submit an EIP-7710 bundle (single chain) |
| `relayer_send7710TransactionMultichain` | Same, multichain |
| `relayer_sendTransaction` | Submit a raw tx (no delegation) |
| `relayer_sendTransactionMultichain` | Same, multichain |
| `relayer_getStatus` | Poll task status by `taskId` |

**EIP-7710 bundle shape (single-chain).** The runner builds this and calls `relayer_send7710Transaction`:

```jsonc
{
  "chainId": 8453,
  "transactions": [
    {
      "permissionContext": "0x…",
      "executions": [{ "target": "0x…", "callData": "0x…", "value": "0x0" }]
    }
  ],
  "authorizationList": [/* EIP-7702 */],
  "context": "0x…",
  "taskId": "uuid",
  "destinationUrl": "https://your-host/webhooks/oneshot"
}
```

**Status codes** (numeric, returned by 1Shot + on the webhook):

| Code | Name | Meaning |
|---|---|---|
| 100 | pending | accepted, not yet on-chain |
| 110 | submitted | tx broadcast |
| 200 | confirmed | tx mined |
| 400 | rejected | pre-chain validation failed |
| 500 | reverted | tx reverted on-chain |

**Error codes** (EIP-1193-shaped, returned in JSON-RPC `error.code`):

| Code | Mapped to `AppError` | Meaning |
|---|---|---|
| 4200 | `VALIDATION_ERROR` | invalid params |
| 4202 | `NOT_FOUND` | resource not found (e.g. unknown taskId) |
| 4204 | `RELAYER_ERROR` | request rejected |
| 4210 | `RELAYER_ERROR` | user rejected |
| 4211 | `RELAYER_ERROR` | insufficient funds |

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
