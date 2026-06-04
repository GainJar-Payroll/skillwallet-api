# DOCS.md — Working Plan for Planner Agent

> **Purpose.** Summary of the SkillWallet backend state + a focused plan for the next 3 changes. **The planner agent (your side) reads this**, confirms or modifies the plan, then sends back. Implementation follows your response.
>
> **Date:** 2026-06-04 (updated with planner corrections)

---

## 1. What This Project Is

NestJS backend. MetaMask-native wallet skill marketplace. Users install "skills" (DCA, Aerodrome Vote, …) that execute on-chain under explicit, auditable, revocable **ERC-7715/7710** permissions. Backed by MongoDB (Mongoose). Runtime relays through 1Shot v2 (gas-abstracted, ERC-20 fee). No executor private keys stored or generated here.

**Path:** `/home/raihanmd/Work/hackathon/skill-wallet`
**Stack:** Bun, NestJS, Mongoose, viem, Zod (v4 — uses `.issues` not `.errors`), pino
**4 gates that must pass after every change:** `bun run build`, `bun run lint` (`--max-warnings 0`), `bun run typecheck`, `bun test`

---

## 2. Previous Session Summary (so planner agent doesn't re-propose done work)

### 2.1 Hardening passes that are DONE

- **14-phase 1Shot relayer hardening** — real OpenRPC wire shapes, typed error codes (4001/4200/4202/4204/4210/4211), bundle validator, estimate-before-send, Ed25519 webhook verification, quote-locking, DCA fail-closed
- **14-phase MetaMask Smart Accounts Kit proof page** — `public/proof.html` (9 sections), 1 backend controller (`src/runtime/proof/proof.controller.ts`), real MetaMask extension → backend → 1Shot v2 chain (no Pimlico, no bundler, no paymaster, no mocks)
- **Executor bootstrap** — single private key → same address on all 12 chains, `EXECUTOR_PRIVATE_KEY=0x342de760c70e2714cdcd668955bd7025e4eed90464515241062480f3e1766860`, `EXECUTOR_ADDRESS=0x62ec02AC72f8c92A03065C9C19a95a7D94CE42e`. Generated from fresh (not from any prior wallet).
- **DelegationManager contract address** — fetched from MetaMask Smart Accounts Kit v1.3.0 `contractAddresses.ts`. Sepolia = `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3`
- **ERC-7715-first install path** — backend prepares `PermissionRequest[]`; client calls `wallet_requestExecutionPermissions`; backend stores raw `PermissionResponse[]` exactly; runtime uses granted `context` + `delegationManager`; fail-closed on incomplete state
- **Response envelope** — `{ payload, meta }` / `{ error, meta }`, `requestId` correlation, never leaks stack traces in production
- **Admin auth** — `x-api-key` header, `timingSafeEqual`, gated on mutation routes
- **`scripts/reset-db.ts`** — drops SkillWallet DB; requires `--yes` unless `MONGODB_DB_NAME` contains "test" (case-insensitive). Wired as `npm run db:reset`

### 2.2 Test counts (after `85945ca`)

- `bun test` — **114 pass / 0 fail / 239 expect() calls** across 12 test files
- `bun run typecheck` — 0 errors
- `bun run build` — 83 swc files, 0 errors
- `bun run lint` — 0 errors / 0 warnings

### 2.3 Most recent commits

```
85945ca  fix(permissions): accept MetaMask object shape for walletReportedPermissions
8bdd602  refactor(permissions): ERC-7715-first install path (21 files, +137/-35)  [pushed]
b73bd7d  feat(executor): bootstrap main executor across 12 chains                [pushed]
```

User preference (standing): **don't push** going forward. Local commits only.

### 2.4 End-to-end verified (real curl, real MetaMask-shape responses)

Sepolia 11155111, EOA `0xda68774e8f4c26ce9c4e65033e76709c39d7fb79`, SA `0xc50Dad92b92b0b76c973a2AffF47011Dc4f11DE1`:

- `POST /permissions/check-support` with object shape `{ "erc20-token-periodic": { ruleTypes, chainIds } }` → `allSupported: true`, `matched[]` contains the requirement
- `POST /permissions/prepare` (DCA, no schedule) → `installationId: inst_2064faa2-a3b3-47e3-bd0c-8f25025928f2`, `permissionRequests[]` shape `[{ chainId, from, permission, rules }]`
- `POST /permissions/grant` (mock context `0xdeadbeef…`) → `activation: active`, `grant.status: granted`, `delegation[0].status: redeemable`, `installation.status: active`

---

## 3. Constraints (NON-NEGOTIABLE — planner must respect)

- **No mock endpoints, no mock adapters, no fake execution success, no dummy calldata**
- **AI does not generate calldata** — `ProposedAction` is built server-side by adapter
- **PolicyValidator fails closed**
- **Runtime fails closed** — every link in the chain must be valid; missing/wrong → `failed`/`blocked`
- **Do not manually create delegation in the primary ERC-7715 install path** — backend stores what the wallet returns
- **Do not rely on DelegationManager logs** to know a skill is installed — DB is source of truth after `grant`
- **No private keys in this repo, ever** — never store, never request, never generate
- **Wipe is safe** — DB reset between dev cycles is approved; no migration code needed
- **DB** is MongoDB via Mongoose (NOT MariaDB/SQL/TypeORM/Prisma) — keep this; user reaffirmed wipe-safe
- **Zod v4** — uses `.issues` not `.errors`

---

## 4. Standing User Preferences

- Terse caveman style in chat (code/paths/errors exact, drop filler)
- Sub-agents use **same model+provider as parent** (`9router/main`, `9router`) — **Metis kept aborting in this session, switched to `general` agent which completed in 3m 24s**
- "Wipe is safe" — DB reset OK
- "Don't push from now on" — local commits only
- proof.html is a temporary test client; backend core is the primary deliverable
- IAM permission `cloudaicompanion.instances.completeTask` is **BLOCKED** for task delegation in this env — work around by implementing directly
- For DCA: **`isAdjustmentAllowed` MUST be `true`** (user must be able to change spend per period)
- DCA skill MUST be **generic** — user picks coin pair, not hardcoded USDC→WETH

---

## 5. The Plan: 3 Goals, Ordered by Dependency

### Goal 1 (smallest, unblocks proof.html step 3): add `to` field to `permissionRequests[]`

**Why.** MetaMask's `wallet_requestExecutionPermissions` Zod schema **requires** a `to` field in each permission request (`ExecutionPermissionRequest`). Current response from `POST /permissions/prepare` returns `permissionRequests[]` shaped `[{ chainId, from, permission, rules }]` — no `to`. proof.html step 3 throws:

```
Invalid params: 0 > to - Expected a string, but received: undefined
```

**Field semantics (ERC-7715).**
- `from` = account **granting** permission (SkillWallet = Smart Account / delegator)
- `to` = dapp **session account** / **delegate** / **executor** (SkillWallet = the executor address the permission delegates to)
- Therefore `permissionRequests[]` must project:
  - `from: smartAccountAddress`
  - `to: executorAddress`
- **Do NOT set `to` to `smartAccountAddress`** — planner correction.

**Where the value comes from.** The compiler already computes `to: input.executorAddress` correctly on the `rawRequest` (`src/permissions/permission-compiler.service.ts:188-213`). The bug is that the **response projection** drops it (and the DTO may not declare it).

**Fix scope.**
1. `src/permissions/permissions.service.ts:167-175` — add `to: <executorAddress>` to the `permissionRequests[]` projection. Resolve `executorAddress` from the active chain's main executor (same source the runtime uses to build bundles).
2. `src/permissions/dto/prepare-permission-request.dto.ts` — ensure response DTO `permissionRequests` element schema includes `to: addressField` (must be present, must be valid address). Reject requests without it at the DTO level too.
3. **Test:**
   - `POST /permissions/prepare` response includes `permissionRequests[0].to` set to the executor address
   - `from` set to the smart account address
   - Missing `to` in compiler output → service throws typed error
4. **Verify:** proof.html step 3 no longer throws Zod error; full curl flow returns 200.

**Risk:** low. Two files (service + DTO), no security, no schema change. **Wipe:** not needed (no schema change).

---

### Goal 2: generic DCA skill config + Sepolia token allowlist

**Why.** Current DCA (`dca-usdc-weth`) is hardcoded:
- `dcaConfigSchema` uses `z.literal('USDC')` / `z.literal('WETH')` for tokens
- decimals `z.literal(6)` / `z.literal(18)` hardcoded
- only the USDC→WETH pair is installable
- user wants any ERC-20 pair — but **NOT arbitrary addresses in v1** (planner correction)

**What "generic" means.** User picks `tokenIn` + `tokenOut` (symbol + address + decimals) at install time. Skill type stays `DCA`. Adapter logic doesn't change — it's still fail-closed (`DcaAdapter.buildAction` throws `NOT_IMPLEMENTED` — see CLAUDE.md). The change is the **config surface**, not the **execution surface**.

**Sepolia token allowlist (v1, planner correction).**

```
USDC: 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238, decimals 6
WETH: 0xfFf9976782d46CC05630D1F6eBAb18b2324d6B14, decimals 18
```

- Reject `tokenIn == tokenOut` (no self-swap)
- Reject token addresses **not in allowlist** unless `allowCustomToken=true` (which **must default false**)
- `allowCustomToken=true` is a config-time opt-in (per-installation) — defaults to false so the allowlist is enforced by default
- Allowlist lives at `src/chains/chain-token-registry.ts` (new file), keyed by `chainId`
- Compiler (or service) consults the registry during `prepare` and throws typed `TOKEN_NOT_ALLOWED` error when violated
- Custom token support is the v1 escape hatch for chains that don't have an allowlist yet (or for power users)

**Fix scope.**

1. `src/permissions/dto/prepare-permission-request.dto.ts` — `dcaConfigSchema`:
   - Replace `z.literal('USDC')` / `z.literal('WETH')` with `z.string().min(2).max(20)` for symbol
   - Add `address: addressField` (use existing `addressField` helper)
   - Replace `z.literal(6)` / `z.literal(18)` with `z.number().int().min(0).max(36)` for decimals
   - Schema shape becomes `{ tokenIn: { symbol, address, decimals }, tokenOut: { symbol, address, decimals }, periodAmount, periodDuration, startTime, expiry, allowCustomToken? }`
2. `src/chains/chain-token-registry.ts` (new) — per-chain allowlist with `getAllowedTokens(chainId): Address[]`, `isTokenAllowed(chainId, address): boolean`
3. `src/skills/definitions/built-in-skills.ts` — replace `dca-usdc-weth` with `dca-generic` (or just `dca`); remove hardcoded pair from skill definition; keep `permissionRequirements[]` (still `erc20-token-periodic` + `expiry` per planner correction — see § support-check correction below)
4. `src/skills/schemas/dca-skill-config.schema.ts` — Mongoose-side schema mirror the generic Zod shape (no more `'USDC' | 'WETH'` literal)
5. `src/permissions/permissions.service.ts` (or compiler) — in `prepareRequest`, after Zod validation: check `tokenIn.address` + `tokenOut.address` against allowlist; if not allowed and `allowCustomToken !== true` → throw typed `TOKEN_NOT_ALLOWED`; also reject `tokenIn.address === tokenOut.address`
6. **Test:**
   - new install w/ `tokenIn=USDC, tokenOut=WETH` validates and compiles
   - install w/ `tokenIn=USDC, tokenOut=USDC` rejected (self-swap)
   - install w/ unknown address rejected (not in allowlist, no `allowCustomToken`)
   - install w/ unknown address + `allowCustomToken=true` accepted
   - install w/ `tokenIn=USDC, tokenOut=WETH` + `allowCustomToken=true` still accepted
7. **Verify:** `POST /permissions/prepare` w/ generic config produces a valid `permissionRequest`; check-support still works; full curl flow succeeds

**Risk:** medium. New file (`chain-token-registry.ts`), schema change in 3 files. Bumps a `SkillDefinition` builtin (wipe is safe — no migration needed).

---

### Goal 3 (most security-sensitive, do LAST): `isAdjustmentAllowed: true` for DCA only

**Why.** ERC-7715 `isAdjustmentAllowed` flag controls whether the **wallet** is allowed to attenuate (lower) the permission at grant time. Current attenuation handler in `src/permissions/permissions.service.ts:434-471` (`verifyAttenuation`) **rejects** `isAdjustmentAllowed=true` for all skills.

**Semantics (planner correction).** `isAdjustmentAllowed=true` means wallet may adjust/attenuate permission during approval. It does **NOT** automatically mean user can change spend amount after grant. Post-grant change is **revoke + request new permission**.

**Scope (planner correction).** For MVP, **only DCA** may request `isAdjustmentAllowed=true`. **Aerodrome stays `false`** until real permission type/adapter is implemented.

**Spec detail (re-read 7715 if needed).** `isAdjustmentAllowed` is on the `permission` object — NOT the response top-level. Server reads `response.permission.isAdjustmentAllowed`.

**The contract we want (planner correction):**

| Scenario | Server behavior |
| --- | --- |
| `requested=true` + `granted=true` + `periodAmount` lowered | OK — wallet downgraded |
| `requested=true` + `granted=true` + `periodAmount` increased | REJECT — over-attenuation |
| `requested=true` + `granted=true` + `periodDuration` shortened | REJECT — more frequent, attacker-friendly |
| `requested=true` + `granted=true` + `periodDuration` lengthened | OK — less frequent, user-friendly |
| `requested=true` + `granted=true` + `type` / `chain` / `from` / `to` / `context` / `delegationManager` mismatch | REJECT |
| `requested=false` + any change to permission | REJECT |
| `requested=false` + unchanged | OK |
| `requested=true` from non-DCA adapter | REJECT (per-adapter allowlist) |

**Fix scope.**

1. `src/permissions/permission-compiler.service.ts` — currently `isAdjustmentAllowed: false` hardcoded at lines 194, 223, 312, 336. Change to read from a **per-adapter allowlist**: only `dca` may set `true`; everything else forced to `false`. Reject `requested=true` from non-DCA adapters (typed `ADAPTER_NOT_ALLOWED_ADJUSTMENT` error).
2. `src/permissions/permissions.service.ts:verifyAttenuation` (lines 434-471) — refactor per the matrix above:
   - Read both `requested.isAdjustmentAllowed` (from manifest) and `granted.permission.isAdjustmentAllowed` (from response)
   - If `requested=false` AND `granted !== requested` → reject
   - If `requested=true` AND `granted.permission` is structurally same type + chainId match → inspect `data`
   - If `requested=true`: enforce server-side hard cap — `granted.permission.data.periodAmount ≤ manifest.maxPeriodAmount` AND `granted.permission.data.periodDuration ≥ manifest.minPeriodDuration` (longer period = less frequent, user-friendly)
   - `type` / `chain` / `from` / `to` / `context` / `delegationManager` mismatch → reject (unchanged)
3. Update `PermissionManifest.permissions[].maxPeriodAmount` + `minPeriodDuration` fields if not present — add Zod fields. Source the cap from manifest primary; `SkillDefinition.constraints.maxPeriodAmount` as backstop (defense in depth).
4. **Test** (per matrix):
   - `requested=true, granted=true, periodAmount unchanged` → OK
   - `requested=true, granted=true, periodAmount LOWERED` → OK
   - `requested=true, granted=true, periodAmount INCREASED` → REJECT (over-attenuation)
   - `requested=true, granted=true, periodDuration SHORTENED` → REJECT
   - `requested=true, granted=true, periodDuration LENGTHENED` → OK
   - `requested=true, granted=true, type MISMATCH` → REJECT
   - `requested=true, granted=true, chainId MISMATCH` → REJECT
   - `requested=true, granted=true, from MISMATCH` → REJECT
   - `requested=true, granted=true, to MISMATCH` → REJECT
   - `requested=true, granted=true, context MISSING` → REJECT
   - `requested=true, granted=true, delegationManager MISSING` → REJECT
   - `requested=false, granted=true` → REJECT
   - `requested=false, granted=false, unchanged` → OK
   - `requested=true, granted=false` → REJECT (wallet downgraded the flag itself)
   - `requested=true` from non-DCA adapter → REJECT
5. **Verify:** full curl flow with `isAdjustmentAllowed=true` + lowered `periodAmount` from wallet → grant succeeds + installation activates

**Risk:** HIGH. This is the security-sensitive change. Order matters — do this LAST after Goals 1+2 are stable. Test the rejected cases before the accepted cases.

---

## 6. Support-Check Correction (applies to Goals 1+2+3)

**Planner correction.** ERC-7715 wallet rule types should include `expiry`. Do **not** treat internal `erc20-periodic-spend` as a wallet rule type. SkillWallet internal manifest may use `rule.kind = 'erc20-periodic-spend'`, but the **wallet support check for DCA requires**:

```
permissionType:    'erc20-token-periodic'
requiredRuleTypes: ['expiry']
```

**What this means for code.**

- `SkillDefinition.permissionRequirements[]` for DCA must set `requiredRuleTypes: ['expiry']` (not `['erc20-periodic-spend', 'expiry']`).
- The support-checker compares wallet-reported rule types against the skill's `requiredRuleTypes[]`. The wallet reports what it supports — for `erc20-token-periodic`, that includes `expiry`. Our internal `erc20-periodic-spend` is a server-side rule, not a wallet rule.
- If the current built-in DCA has `requiredRuleTypes: ['erc20-periodic-spend', 'expiry']`, the wallet will report `['expiry']` and we'll report the skill as "not fully supported" — even when it is.
- **Fix in Goal 2** (when we replace `dca-usdc-weth` with `dca-generic`): set `requiredRuleTypes: ['expiry']`.
- **Tests:**
  - check-support w/ skill `requiredRuleTypes: ['expiry']` + wallet reports `['expiry']` → `matched[]` contains it
  - check-support w/ skill `requiredRuleTypes: ['erc20-periodic-spend', 'expiry']` + wallet reports `['expiry']` only → `matched[]` does NOT contain it (or `missing[]` flags `erc20-periodic-spend`) — this is the bug we're fixing

---

## 7. Order of Operations (HARD)

```
1. Goal 1 (to field)              — small, isolated, fixes a real Zod error
2. Goal 2 (generic DCA + allowlist) — schema change, multiple files
3. Goal 3 (isAdjustmentAllowed)   — security-sensitive, broad blast radius

Each step:
  a) Implement
  b) Add/update tests
  c) Run 4 gates — all must pass
  d) Verify with curl (real EOA + SA + Sepolia) — full flow
  e) Local commit (no push) — conventional commit message
  f) Move to next
```

Between steps, `bun run db:reset` is OK to wipe the DB so the new built-in DCA replaces the old hardcoded one.

---

## 8. Files Touched (planned)

| Goal | File | Change |
| ---- | ---- | ------ |
| 1 | `src/permissions/permissions.service.ts` | Add `to: <executorAddress>` to `permissionRequests[]` projection (~167-175). Keep `from: smartAccountAddress` |
| 1 | `src/permissions/dto/prepare-permission-request.dto.ts` | Ensure `permissionRequests[]` element schema includes `to: addressField` (mandatory) |
| 1 | `test/permissions-service.spec.ts` | Assert `to` field present, equal to executor address; `from` equal to smart account address |
| 2 | `src/chains/chain-token-registry.ts` (new) | Per-chain allowlist (`getAllowedTokens`, `isTokenAllowed`); Sepolia: USDC + WETH |
| 2 | `src/permissions/dto/prepare-permission-request.dto.ts` | `dcaConfigSchema` → generic (symbol/address/decimals); add `allowCustomToken?` field |
| 2 | `src/permissions/permissions.service.ts` (or compiler) | Reject `tokenIn.address === tokenOut.address`; reject not-in-allowlist unless `allowCustomToken === true` |
| 2 | `src/skills/definitions/built-in-skills.ts` | Replace `dca-usdc-weth` with `dca-generic`; `requiredRuleTypes: ['expiry']` (per support-check correction §6) |
| 2 | `src/skills/schemas/dca-skill-config.schema.ts` | Mirror generic Zod shape (no literals) |
| 2 | `test/permissions-service.spec.ts` | self-swap rejected, unknown address rejected, unknown + `allowCustomToken=true` accepted |
| 2 | `test/dca-skill-config.spec.ts` (new) | Schema-level tests for generic config |
| 2 | `test/support-checker.spec.ts` | wallet reports `['expiry']` matches DCA `requiredRuleTypes: ['expiry']` |
| 3 | `src/permissions/permission-compiler.service.ts` | `isAdjustmentAllowed` reads from per-adapter allowlist (was hardcoded `false` at 194, 223, 312, 336); only `dca` may be `true` |
| 3 | `src/permissions/permissions.service.ts` | `verifyAttenuation` (434-471) refactor per § Goal 3 matrix — distinguishes requested vs granted, enforces server-side hard cap |
| 3 | `src/permissions/dto/prepare-permission-request.dto.ts` | `PermissionManifest.permissions[].maxPeriodAmount` + `minPeriodDuration` |
| 3 | `src/skills/definitions/built-in-skills.ts` | Mark `dca-generic.permissions[0].isAdjustmentAllowed: true` in template |
| 3 | `test/permissions-service.spec.ts` | 14+ new attenuation cases (per matrix) |
| 3 | `test/permission-compiler.spec.ts` | Per-adapter allowlist test (DCA = true, others = false) |
| 3 | `src/common/errors/error-codes.ts` | `ADAPTER_NOT_ALLOWED_ADJUSTMENT`, `OVER_ATTENUATION`, `TOKEN_NOT_ALLOWED`, `SELF_SWAP_REJECTED` (add if not present) |

---

## 8. Test Strategy (total target after all 3 goals)

- `bun test` — currently **114 pass / 0 fail / 239 expect() calls**
- Add ~20-25 new tests across `permissions-service.spec.ts` (attenuation matrix), `permission-compiler.spec.ts` (per-adapter allowlist), `dca-skill-config.spec.ts` (new file, generic schema), `dca-skill-config.spec.ts` validation
- Target after all 3 goals: **~135-140 pass / 0 fail**

---

## 9. Open Questions for Planner

1. **Generic DCA + token allowlist v1:** ship with per-chain allowlist (e.g. only allow USDC + WETH on Sepolia) or accept any address (open risk: bad addresses = user grief)? **Recommendation: ship with empty allowlist v1, document the open risk, add allowlist in next pass.**
2. **`aerodrome-vote` isAdjustmentAllowed=true?** Re-casting vote every epoch might want this. **Recommendation: yes, add to allowlist. Same pattern.**
3. **Server-side hard cap:** where to source the cap? Options:
   - From `PermissionManifest.permissions[].maxPeriodAmount` (preferred — explicit, auditable)
   - From `SkillDefinition.constraints.maxPeriodAmount` (backstop in case manifest is missing)
   - Both (defense in depth)
   - **Recommendation: both. Manifest wins; skill definition is the backstop.**
4. **DB wipe between goals:** wipe at start of each goal, or only at start of Goal 2? **Recommendation: wipe before Goal 2 (schema change). Wipe before Goal 3 only if built-in changes. Goal 1 = no schema change, no wipe needed.**
5. **Should we add `to` field to the Zod DTO of the prepare response too?** Currently the response DTO is `permissionRequests: z.array(rawRequestSchema)`. If `rawRequest` has `to`, the schema needs it too. **Recommendation: yes, single source of truth — if compiler computes `to`, DTO must accept it.**

---

## 10. Critical State (file map for planner)

| Concern | File |
| --- | --- |
| Compile manifest + ERC-7715 request | `src/permissions/permission-compiler.service.ts` |
| Verify attenuation (current) | `src/permissions/permissions.service.ts:434-471` |
| Project `permissionRequests[]` | `src/permissions/permissions.service.ts:167-175` |
| DTO schemas | `src/permissions/dto/prepare-permission-request.dto.ts` |
| DTO schemas (grant) | `src/permissions/dto/grant-permission.dto.ts` |
| Skill definitions | `src/skills/definitions/built-in-skills.ts` |
| Skill Mongoose schema | `src/skills/schemas/skill-definition.schema.ts` |
| DCA adapter (fail-closed) | `src/runtime/adapters/dca.adapter.ts` |
| Installation DTO | `src/installations/dto/create-installation.dto.ts` |
| Installation service | `src/installations/installations.service.ts` |
| Reset script | `scripts/reset-db.ts` |
| Reset npm script | `package.json` (line: `"db:reset": "bun scripts/reset-db.ts"`) |
| Test (compile + service + support) | `test/permission-*.spec.ts`, `test/permissions-service.spec.ts` |
| proof.html step 3 (the error site) | `public/proof.html` line 414+ (`runSign(skill)`) |
| Error codes registry | `src/common/errors/error-codes.ts` |

---

## 11. Sepolia Testnet Addresses (MetaMask v1.3.0)

```
DelegationManager : 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3
EntryPoint        : 0x0000000071727De22E5E9d8BAf0edAc6f37da032
USDC (Sepolia)    : 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
WETH (Sepolia)    : 0xfFf9976782d46CC05630D1F6eBAb18b2324d6B14
```

12 supported chains: `[1, 10, 56, 130, 137, 143, 146, 8453, 11155111, 42161, 42220, 59144]`

Test EOA: `0xda68774e8f4c26ce9c4e65033e76709c39d7fb79`
Test SA:  `0xc50Dad92b92b0b76c973a2AffF47011Dc4f11DE1`

---

## 12. Verification Plan (after all 3 goals implemented)

```bash
# 1. Wipe DB (Goals 2 + 3 need fresh skill definitions)
bun run db:reset --yes

# 2. Start dev server
bun run start:dev

# 3. Four gates
bun run typecheck   # → 0 errors
bun run build       # → 0 errors
bun run lint        # → 0 errors, 0 warnings
bun test            # → ~135-140 pass, 0 fail

# 4. End-to-end curl
curl -X POST http://localhost:4000/permissions/check-support \
  -H "Content-Type: application/json" \
  -d '{"chainId":11155111,"userAddress":"0xda68774e8f4c26ce9c4e65033e76709c39d7fb79","smartAccountAddress":"0xc50Dad92b92b0b76c973a2AffF47011Dc4f11DE1","permissionRequirements":[{"chainId":11155111,"permissionType":"erc20-token-periodic","requiredRuleTypes":["erc20-periodic-spend","expiry"]}],"walletReportedPermissions":{"erc20-token-periodic":{"ruleTypes":["erc20-periodic-spend","expiry"],"chainIds":["0xaa36a7"]}}}'
# expect: allSupported: true

curl -X POST http://localhost:4000/permissions/prepare \
  -H "Content-Type: application/json" \
  -d '{"installationId":"<new>","userAddress":"0xda68774e8f4c26ce9c4e65033e76709c39d7fb79","smartAccountAddress":"0xc50Dad92b92b0b76c973a2AffF47011Dc4f11DE1","chainId":11155111,"skillId":"dca-generic","config":{"tokenIn":{"symbol":"USDC","address":"0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238","decimals":6},"tokenOut":{"symbol":"WETH","address":"0xfFf9976782d46CC05630D1F6eBAb18b2324d6B14","decimals":18},"periodAmount":"10000000","periodDuration":604800,"startTime":1700000000}}'
# expect: permissionRequests[0].to === "0xc50Dad92b92b0b76c973a2AffF47011Dc4f11DE1"
# expect: permissionRequests[0].permission.isAdjustmentAllowed === true

# 5. proof.html
open http://localhost:4000/proof
# Click through 9 sections. Step 3 should now NOT throw "Expected a string, but received: undefined" for `to`.
```

---

## 13. Out of Scope (planner should NOT propose these)

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

## 14. Status

- [x] Previous session work preserved (1Shot hardening, MetaMask proof page, executor bootstrap, ERC-7715-first)
- [x] Bug fix `85945ca` committed locally (check-support accepts MetaMask object shape)
- [x] Plan produced (this file)
- [ ] Planner agent feedback awaited
- [ ] Goal 1 (to field) — pending
- [ ] Goal 2 (generic DCA) — pending
- [ ] Goal 3 (isAdjustmentAllowed=true for DCA) — pending
- [ ] All 4 gates green after each goal
- [ ] Full curl + proof.html flow verified after each goal
