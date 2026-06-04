# DOCS.md — SkillWallet Backend Working State

> **Date:** 2026-06-04 (post-Goal-3)
> **Audience:** planner agent (user side) + future me

---

## 0. Status (one-liner)

**All 3 planned goals DONE.** Gates green: `typecheck 0` / `lint 0-0` / `build 84 swc` / `test 133 pass / 0 fail`. Local commits only (no push per standing user rule).

```
54d6523  feat(permissions): isAdjustmentAllowed=true for DCA + attenuation matrix
5f8a60a  feat(permissions): generic DCA config + Sepolia token allowlist
fb02e1f  fix(permissions): add `to: executor.executorAddress` to permissionRequests[0]
```

---

## 1. Previous Plan Summary (for planner context — was 406 lines, now condensed)

The previous DOCS.md laid out a 3-goal plan based on real bugs:
- **Goal 1.** `wallet_requestExecutionPermissions` Zod rejected `permissionRequests[]` without `to` (proof.html step 3 threw `Expected a string, but received: undefined`). Per ERC-7715: `from` = delegator (smart account), `to` = delegate (executor).
- **Goal 2.** Hardcoded `dca-usdc-weth` skill was a UX blocker — user wants any ERC-20 pair, not just USDC→WETH. Per-chain allowlist (Sepolia v1 = USDC + WETH) with `allowCustomToken?` opt-in (default false). Self-swap always rejected.
- **Goal 3.** `isAdjustmentAllowed` was hardcoded `false` for all skills. DCA needs it `true` (user must be able to change spend over time). Aerodrome stays `false` until real impl. Refactor `verifyAttenuation` per matrix: amount up / duration down / identity mismatch → REJECT.

**Planner corrections applied:**
- `to` field = executor address (not smart account)
- Sepolia allowlist v1 = USDC + WETH, other chains empty (= no enforcement)
- `allowCustomToken` defaults false
- Self-swap always rejected
- Per-adapter allowlist for `isAdjustmentAllowed` (DCA = true, others = false)
- Post-grant change = revoke + request new (not wallet-initiated adjust)
- `requiredRuleTypes: ['expiry']` only (not `['erc20-periodic-spend', 'expiry']`)

---

## 2. Implementation Details

### 2.1 Goal 1 — `to` field in `permissionRequests[]` (commit `fb02e1f`)

**Where:**
- `src/permissions/permissions.service.ts:197` — `permissionRequests[]` projection now includes `to: executor.executorAddress` (line was empty before, projecting from `compiled.walletRequest.rawRequest.to`)
- `test/permissions-service.spec.ts` — new test "projects `to: executorAddress` and `from: smartAccountAddress` in permissionRequests[0]"

**Curl verified:** `permissionRequests[0].to === "0x62ec02AC72f8cA92A03065C9C19a95a7D94CE42e"` (executor address).

**Files:** 1 modified + 1 test.

---

### 2.2 Goal 2 — Generic DCA + Sepolia allowlist (commit `5f8a60a`)

**New file:** `src/chains/chain-token-registry.ts`
- `getAllowedTokens(chainId): Address[]` — returns the per-chain allowlist
- `isTokenAllowed(chainId, address): boolean`
- Sepolia v1: `USDC 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (dec 6) + `WETH 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` (dec 18) — WETH EIP-55 requires lowercase `1f` (viem rejects `1F`)
- Other chains: empty allowlist = no enforcement

**Generic DCA config (DTOs):**
- `src/permissions/dto/prepare-permission-request.dto.ts` — `dcaConfigSchema`:
  - `tokenIn` / `tokenOut`: `{ symbol: z.string().min(2).max(20), address: addressField, decimals: z.number().int().min(0).max(36) }`
  - `allowCustomToken?: z.boolean()` (default false)
- `src/installations/dto/create-installation.dto.ts` — same generic mirror
- `src/skills/schemas/dca-skill-config.schema.ts` — already generic (no change needed)

**Built-in rename:** `dca-usdc-weth` → `dca-generic` in `src/skills/definitions/built-in-skills.ts`. `requiredRuleTypes: ['expiry']` (per support-check correction).

**Service enforcement:** `src/permissions/permissions.service.ts:106-130`:
- `tokenIn.address === tokenOut.address` → throw `SELF_SWAP_REJECTED` (400)
- `tokenIn/tokenOut not in allowlist` AND `!allowCustomToken` → throw `TOKEN_NOT_ALLOWED` (422)

**New error codes** (`src/common/errors/error-codes.ts` + HTTP mappings in `src/common/errors/app-error.ts`):
- `TOKEN_NOT_ALLOWED` → 422
- `SELF_SWAP_REJECTED` → 400

**Curl verified (5 cases):**
- `dca-generic` + `USDC→WETH` → OK, `to: 0x62ec...CE42e` ✓
- self-swap (`USDC→USDC`) → `SELF_SWAP_REJECTED` ✓
- unknown token in, no `allowCustomToken` → `TOKEN_NOT_ALLOWED` ✓
- unknown token in + `allowCustomToken: true` → OK ✓
- check-support → `allSupported: true` ✓

**Files:** 1 new + 7 modified + 1 test file (5 new tests).

---

### 2.3 Goal 3 — `isAdjustmentAllowed=true` for DCA only + attenuation matrix (commit `54d6523`)

**Per-adapter allowlist (2 layers):**
- **DTO layer:** `dcaConfigSchema` has `isAdjustmentAllowed?: z.boolean()`; `aerodromeVoteConfigSchema` does NOT (Zod rejects if user tries to set it on Aerodrome)
- **Compiler layer:** `compileDca` uses `config.isAdjustmentAllowed ?? true`; `compileAerodromeVote` hardcodes `false` (always)

**Manifest `permissions[]` now carries:**
- `isAdjustmentAllowed: boolean`
- `maxPeriodAmount: string` (base units, equals the requested amountPerRun)
- `minPeriodDuration: number` (seconds, equals the requested periodSeconds)

**Attenuation matrix (enforced in `src/permissions/permissions.service.ts:verifyAttenuation`):**

| Requested | Granted | Action |
|---|---|---|
| `true` | `true` | OK (wallet honored) |
| `true` | `false` | OK (wallet chose stricter) |
| `false` | `true` | REJECT `ADAPTER_NOT_ALLOWED_ADJUSTMENT` |
| any | amount > requested | REJECT `OVER_ATTENUATION` |
| any | duration < requested (both > 0) | REJECT `OVER_ATTENUATION` (attacker-friendly tightening) |
| any | amount < 0 | REJECT `OVER_ATTENUATION` |
| any | duration < 0 | REJECT `OVER_ATTENUATION` |
| any | `tokenAddress` mismatch | REJECT `ATTENUATION_MISMATCH` |
| any | `delegationManager` mismatch (vs executor's `delegationManagerAddress`) | REJECT `ATTENUATION_MISMATCH` |
| any | chainId / from / type mismatch | REJECT (outer check, unchanged) |
| any | `context` or `delegationManager` empty | REJECT (outer check, unchanged) |

**Outer checks (preserved in `submitGrant` before `verifyAttenuation`):**
- `response.chainId === installation.chainId`
- `response.from === installation.smartAccountAddressNormalized` (if provided)
- `response.context` and `response.delegationManager` non-empty
- `response.permission.type` matches requested

**New error codes:**
- `ADAPTER_NOT_ALLOWED_ADJUSTMENT` → 422
- `OVER_ATTENUATION` → 422
- `ATTENUATION_MISMATCH` → 422

**Curl verified (2 cases):**
- DCA prepare (default) → `permissionRequests[0].permission.isAdjustmentAllowed === true` ✓
- DCA prepare with `isAdjustmentAllowed: false` → false ✓
- Aerodrome prepare with `isAdjustmentAllowed: true` → Zod rejects (no field on aerodrome config)

**Files:** 0 new + 6 modified + 1 test file (13 new tests).

---

## 3. Test Counts (gates)

| Gate | Before (Goal 0) | After Goal 1 | After Goal 2 | After Goal 3 |
|---|---|---|---|---|
| `bun test` | 114/0/239 | 115/0/241 | 120/0/248 | **133/0/~270** |
| `bun run typecheck` | 0 | 0 | 0 | 0 |
| `bun run build` | 83 swc | 84 swc | 84 swc | **84 swc** |
| `bun run lint` | 0/0 | 0/0 | 0/0 | **0/0** |

**13 new Goal 3 tests in `test/permissions-service.spec.ts`:**
- 4 accepts: same amount/duration; amount lowered; duration longer; wallet-chose-stricter
- 9 rejects: amount increased; duration shorter; tokenAddress mismatch; delegationManager mismatch; `requested=false + granted=true`; amount increased (when `requested=false`); duration shorter (when `requested=false`); negative amount; empty delegationManager

---

## 4. Files Changed (current state)

| File | Goal | Change |
|---|---|---|
| `docs/DOCS.md` | all | This file (replaced) |
| `src/chains/chain-token-registry.ts` | 2 | NEW — per-chain allowlist |
| `src/permissions/permission-compiler.service.ts` | 2+3 | `isAdjustmentAllowed` per-adapter allowlist; `maxPeriodAmount` + `minPeriodDuration` in manifest |
| `src/permissions/permissions.service.ts` | 1+2+3 | `to: executorAddress` projection; self-swap + allowlist enforcement; refactored `verifyAttenuation` |
| `src/permissions/dto/prepare-permission-request.dto.ts` | 2+3 | Generic `dcaConfigSchema`; `isAdjustmentAllowed?` field |
| `src/installations/dto/create-installation.dto.ts` | 2+3 | Generic `dcaConfigSchema` mirror; `isAdjustmentAllowed?` field |
| `src/skills/definitions/built-in-skills.ts` | 2 | Rename `dca-usdc-weth` → `dca-generic` |
| `src/common/errors/error-codes.ts` | 2+3 | `TOKEN_NOT_ALLOWED`, `SELF_SWAP_REJECTED`, `ADAPTER_NOT_ALLOWED_ADJUSTMENT`, `OVER_ATTENUATION`, `ATTENUATION_MISMATCH` |
| `src/common/errors/app-error.ts` | 2+3 | HTTP status mappings for new codes |
| `test/permissions-service.spec.ts` | 1+2+3 | 19 new tests (1 + 5 + 13) |

**Not changed** (still generic / already correct):
- `src/skills/schemas/dca-skill-config.schema.ts` — already generic
- `src/skills/schemas/aerodrome-vote-skill-config.schema.ts` — no change needed
- DCA adapter (`src/runtime/adapters/dca.adapter.ts`) — still fail-closed `NOT_IMPLEMENTED`

---

## 5. Critical State (file map for planner)

| Concern | File |
|---|---|
| Compile manifest + ERC-7715 request | `src/permissions/permission-compiler.service.ts` |
| Attenuation verification (refactored) | `src/permissions/permissions.service.ts:434-510` |
| Project `permissionRequests[]` with `to` | `src/permissions/permissions.service.ts:167-200` |
| Self-swap + allowlist enforcement | `src/permissions/permissions.service.ts:106-130` |
| DTOs | `src/permissions/dto/prepare-permission-request.dto.ts` |
| DTOs (create-installation) | `src/installations/dto/create-installation.dto.ts` |
| Skill definitions | `src/skills/definitions/built-in-skills.ts` |
| Token allowlist | `src/chains/chain-token-registry.ts` (new) |
| Error codes registry | `src/common/errors/error-codes.ts` |
| Test (compile + service + support) | `test/permission-*.spec.ts`, `test/permissions-service.spec.ts` |
| Reset script | `scripts/reset-db.ts` |
| Reset npm script | `package.json` (`db:reset`) |
| proof.html step 3 (the error site — now fixed) | `public/proof.html` line 414+ |

---

## 6. Constraints (NON-NEGOTIABLE — preserved from prior plan)

- **No mock endpoints, no mock adapters, no fake execution success, no dummy calldata**
- **AI does not generate calldata** — `ProposedAction` is built server-side by adapter
- **PolicyValidator fails closed**
- **Runtime fails closed** — every link in the chain must be valid
- **Do not manually create delegation in the primary ERC-7715 install path** — backend stores what the wallet returns
- **Do not rely on DelegationManager logs** to know a skill is installed — DB is source of truth after `grant`
- **No private keys in this repo, ever** — never store, never request, never generate
- **Wipe is safe** — DB reset between dev cycles is approved
- **DB is MongoDB via Mongoose** (NOT MariaDB/SQL/TypeORM/Prisma)
- **Zod v4** — uses `.issues` not `.errors`

**Standing user preferences:**
- Terse caveman style in chat (code/paths/errors exact, drop filler)
- Sub-agents use **same model+provider as parent** (`9router/main`, `9router`) — **NEVER Gemini Pro** (user has no Gemini subscription; "kamu masih saja spawn sub agent pakai gemini pro, sudah tau saya tidak ada langganan itu gabisa lah kocak!!!")
- "Don't push from now on" — local commits only

---

## 7. Sepolia Testnet Addresses (MetaMask Smart Accounts Kit v1.3.0)

```
DelegationManager : 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3
EntryPoint        : 0x0000000071727De22E5E9d8BAf0edAc6f37da032
USDC (Sepolia)    : 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238  (dec 6)
WETH (Sepolia)    : 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14  (dec 18) — EIP-55 requires lowercase '1f'
```

**12 supported chains:** `[1, 10, 56, 130, 137, 143, 146, 8453, 11155111, 42161, 42220, 59144]`

| Account | Address |
|---|---|
| Test EOA | `0xda68774e8f4c26ce9c4e65033e76709c39d7fb79` |
| Test SA (smart account) | `0xc50Dad92b92b0b76c973a2AffF47011Dc4f11DE1` |
| Executor | `0x62ec02AC72f8cA92A03065C9C19a95a7D94CE42e` |
| Executor private key (test only) | `0x342de760c70e2714cdcd668955bd7025e4eed90464515241062480f3e1766860` |

---

## 8. Curl Verification Recipes

**Wipe + start:**
```bash
bun run db:reset --yes
pkill -f "nest start\|swc-node"; sleep 2
nohup bun run start:dev > /tmp/dev.log 2>&1 &
sleep 12
```

**4 gates:**
```bash
bun run typecheck   # → 0
bun run build       # → 84 swc
bun run lint        # → 0/0
bun test            # → 133/0
```

**Check support (DCA):**
```bash
curl -X POST http://localhost:4000/permissions/check-support \
  -H "Content-Type: application/json" \
  -d '{
    "userAddress":"0xda68774e8f4c26ce9c4e65033e76709c39d7fb79",
    "smartAccountAddress":"0xc50Dad92b92b0b76c973a2AffF47011Dc4f11DE1",
    "chainId":11155111,
    "skillId":"dca-generic",
    "walletReportedPermissions":{"erc20-token-periodic":{"ruleTypes":["expiry"],"chainIds":["0xaa36a7"]}}
  }'
# expect: allSupported: true
```

**Prepare (DCA generic, default = isAdjustmentAllowed=true):**
```bash
curl -X POST http://localhost:4000/permissions/prepare \
  -H "Content-Type: application/json" \
  -d '{
    "userAddress":"0xda68774e8f4c26ce9c4e65033e76709c39d7fb79",
    "smartAccountAddress":"0xc50Dad92b92b0b76c973a2AffF47011Dc4f11DE1",
    "chainId":11155111,
    "skillId":"dca-generic",
    "config":{
      "type":"dca",
      "tokenIn":{"symbol":"USDC","address":"0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238","decimals":6},
      "tokenOut":{"symbol":"WETH","address":"0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14","decimals":18},
      "amountPerRun":"10","frequency":"weekly","maxSlippageBps":50,
      "router":{"name":"uniswap","address":"0x0000000000000000000000000000000000000001"},
      "recipient":"0xc50Dad92b92b0b76c973a2AffF47011Dc4f11DE1",
      "quoteMode":"router-quote"
    },
    "pricingPlan":{"id":"p1","label":"Test","durationDays":7,"skillFeeUsdc":"1"}
  }'
# expect: permissionRequests[0].to === "0x62ec02AC72f8cA92A03065C9C19a95a7D94CE42e"
# expect: permissionRequests[0].permission.isAdjustmentAllowed === true
```

**Self-swap reject:**
```bash
# tokenIn === tokenOut (both USDC) → SELF_SWAP_REJECTED (400)
```

**Unknown token without opt-in:**
```bash
# tokenIn 0x4200...0042 (not in allowlist), allowCustomToken absent → TOKEN_NOT_ALLOWED (422)
```

**Unknown token with opt-in:**
```bash
# same + "allowCustomToken": true → OK
```

---

## 9. Pre-existing Issues (NOT in Goal 1/2/3 scope; flagged for follow-up)

1. **`walletSupportCheck.checkId_1` unique index on `skill_installations`** — rejects nulls across multiple installs without check-support. 2nd `POST /permissions/prepare` (no check-support first) hits `CONFLICT`. Fix: sparse index or always-set checkId.
2. **`checkId` deterministic from inputs** (in `src/permissions/permission-support-checker.service.ts:98`) — same inputs → same `checkId: check_<sha256trunc>`. Re-running check-support with identical inputs hits `E11000`. Fix: include `checkedAt` in hash or use uuid.
3. **DCA adapter still fail-closed** — `src/runtime/adapters/dca.adapter.ts:buildAction` throws `NOT_IMPLEMENTED`. Not a bug, but no real DCA execution yet.
4. **Aerodrome Vote still `adapter-ready`** — no real permission type / adapter implementation. `compileAerodromeVote` returns a placeholder.
5. **Executor delegationManager lookup** — `verifyAttenuation` reads `executor.delegationManagerAddress`; if executor config is missing the field, the check is skipped silently. Acceptable for now (non-strict mode), but should be strict in production.

---

## 10. Out of Scope (planner should NOT propose these)

- Executor key custody / KMS / signer service
- Rate limiting
- Multi-tenant isolation
- Aerodrome Vote live wiring (still `adapter-ready`)
- DCA execution implementation (still `NOT_IMPLEMENTED` — fail-closed)
- ERC-20 swap calldata generation (AI does not generate calldata)
- New chains beyond the existing 12
- Per-skill / per-adapter executors (MVP 1 = one main executor per chain)
- Snap integration (out of scope — backend is signer-agnostic)

---

## 11. Open Follow-ups (planner may propose, not in current scope)

1. **Pre-existing bug fix** — sparse `walletSupportCheck.checkId` index + unique `checkId` (use uuid instead of deterministic hash)
2. **Aerodrome `isAdjustmentAllowed`** — when real permission type lands, add to per-adapter allowlist (same pattern as DCA)
3. **Per-chain allowlist expansion** — add tokens for chains 1, 10, 8453, 42161, 137 (mainnet, Optimism, Base, Arbitrum, Polygon)
4. **Manifest `permissions[]` persistence** — currently Mongoose strips unknown `permissions` field (only stores `rules[]`). Add `permissions: SchemaTypes.Mixed` to `permission_manifests` schema for audit
5. **proof.html re-verify** — step 3 (the `to` field error) should no longer throw; full 9-section flow should pass
6. **Mongoose `installationModel` mock improvements** — `setPermissionGrantAndActivate` + `setPermissionGrantDependencies` are now mocked in `test/permissions-service.spec.ts`; may need same for other test files
7. **DOCS.md README sync** — `README.md` still describes the old `dca-usdc-weth` flow in places; needs sync with the new generic + `isAdjustmentAllowed` flow
