# ERC-7715 Advanced Permissions — Implementation Guide

> **Status:** Design doc — not yet implemented
> **Goal:** Allow installations to use MetaMask Smart Accounts Kit `requestExecutionPermissions()` flow instead of the `signDelegation()` + 1Shot flow, enabling gasless session-based execution.

---

## Problem

Currently every installation requires a **signed delegation** (produced by `signDelegation()` from the Smart Accounts Kit). The runner submits this delegation as a `permissionContext` to the 1Shot relayer, which verifies the delegation on-chain via the `DelegationManager` contract.

For **undeployed Hybrid Smart Accounts**, this fails because:

1. 1Shot calls `EXTCODEHASH(delegator)` → returns `keccak256('')` (no code)
2. `DelegationManager` falls into EOA verification path → `ecrecover(signature) == delegator`
3. `delegator` is the Smart Account address (not the user's EOA) → signature mismatch → `InvalidEOASignature`

**ERC-7715** solves this by shifting the authority model: instead of verifying a static delegation on-chain, the FE requests **execution permissions** via `requestExecutionPermissions()`, which returns a `permissionContext` that 1Shot can verify without requiring the smart account to be deployed.

---

## What Changed (in the aborted implementation)

The following 6 files were modified before the revert:

| File | Change |
|------|--------|
| `installation.schema.ts` | Added `mode`, `permissionContext`, made `signedDelegation` optional |
| `confirm-installation.dto.ts` | Added `mode`, `permissionContext`, `delegationManager`, `sessionAccountAddress` |
| `installations.controller.ts` | Branched on `mode` in POST `/confirm` |
| `installations.service.ts` | Added `confirmAdvancedPermission()` method |
| `runner.service.ts` | Branched `permissionContext` by mode, added deploy-status guard |
| `test/installations.e2e-spec.ts` | 2 new tests verifying advanced-permission mode |

See commit history at checkpoint `c824200` for the pre-ERC-7715 baseline.

---

## Frontend Integration (ERC-7715 flow)

### 1. FE requests execution permissions

```typescript
import { erc7715ProviderActions } from '@metamask/smart-accounts-kit';

// Extend the wallet client with ERC-7715 actions
const walletClient = smartAccountClient.extend(erc7715ProviderActions());

// Request execution permissions
const permissionContext = await walletClient.requestExecutionPermissions([
  {
    type: 'Session',
    start: 0n,                          // immediate
    end: 0n,                             // no expiry (or set a block number)
    startContext: { account: smartAccountAddress },
    signer: {
      type: 'contract',                  // or 'account'
      data: {
        account: userEOA,                // EOA that controls the session
        scopes: [
          {
            target: usdcToken,
            allowedMethods: ['transfer(address,uint256)', 'approve(address,uint256)'],
          },
          {
            target: swapRouter,
            allowedMethods: ['exactInputSingle((...)')],
          },
        ],
      },
    },
    policies: {
      erc20SpendLimit: {
        token: usdcToken,
        period: 'day',
        maxAmount: dailySpendLimit,
      },
      valueLte: { maxValue: '0x0' },
    },
  },
]);
```

### 2. FE sends permissionContext to backend

```typescript
// POST /installations/confirm
{
  mode: 'advanced-permission',
  skillId: 'custom-cron-dca-84532',
  userAddress: '0x...',
  smartAccountAddress: '0x...',   // Hybrid Smart Account (may be undeployed)
  permissionContext: [ /* array from requestExecutionPermissions() */ ],
  delegationSalt: '...',           // returned from /installations/prepare
  parameters: { amountUsdc: '5000000', outputToken: 'weth' },
}
```

---

## Backend Changes Required (when re-implementing)

### 1. Schema — `installation.schema.ts`

```typescript
@Prop({
  required: true,
  enum: ['manual-delegation', 'advanced-permission'],
  default: 'manual-delegation',
})
mode!: 'manual-delegation' | 'advanced-permission';

@Prop({ type: Object })
signedDelegation?: Record<string, unknown>;

@Prop({ type: [Object], default: [] })
permissionContext!: unknown[];
```

### 2. DTO — `confirm-installation.dto.ts`

Add:
- `mode?: 'manual-delegation' | 'advanced-permission'` — optional, defaults to `manual-delegation`
- `permissionContext?: unknown[]` — required when mode is `advanced-permission`
- `signedDelegation` made optional with `@ValidateIf(o => o.mode !== 'advanced-permission')`
- Optional: `delegationManager?: string`, `sessionAccountAddress?: string`

### 3. Service — `installations.service.ts`

Add `confirmAdvancedPermission()`:
- Skip `delegationService.validateDelegationShape()` (not a delegation)
- Create installation with `mode: 'advanced-permission'` and `permissionContext: dto.permissionContext`
- No `signedDelegation` stored

### 4. Controller — `installations.controller.ts`

```typescript
@Post('confirm')
async confirm(@Body() dto: ConfirmInstallationDto) {
  if (dto.mode === 'advanced-permission') {
    return this.installations.confirmAdvancedPermission(dto);
  }
  return this.installations.confirmInstallation(dto);
}
```

### 5. Runner — `runner.service.ts`

The `submitBundle()` method must construct the 1Shot payload differently:

```typescript
const userPermissionContext =
  installation.mode === 'advanced-permission'
    ? installation.permissionContext  // array already in correct shape
    : [OneShotService.toRelayerJson(installation.signedDelegation)];
```

**For manual-delegation with undeployed accounts**, add a deploy-status guard:

```typescript
if (installation.mode === 'manual-delegation' && !(await isDeployed(smartAccount))) {
  // Skip — account needs deployment first
  // Use Pimlico paymaster path instead (see PIMLICO_INTEGRATION.md)
}
```

### 6. 1Shot interaction

The 1Shot RPC methods (`relayer_send7710Transaction`, `relayer_send7710TransactionMultichain`) remain **unchanged**. The `permissionContext` in the 1Shot payload is already typed as `unknown[]`:

```typescript
interface OneShotTransaction {
  permissionContext: unknown[];
  executions: OneShotExecution[];
}
```

Both paths produce `unknown[]` — the difference is:
- **manual-delegation**: `[toRelayerJson(signedDelegation)]` — single-element array wrapping the delegation object
- **advanced-permission**: `permissionContext` directly — already in the shape 1Shot expects

---

## Deploy-Status Guard

When the runner encounters an installation in `manual-delegation` mode with an **undeployed** smart account, it should:

1. **Skip** the 1Shot path and record a `skipped` execution with `skippedReason: 'needs_smart_account_deployment'`
2. The admin/user can then use the **Pimlico paymaster** endpoint to deploy the account and execute

Check implementation:

```typescript
const bytecode = await client.getBytecode({ address: smartAccountAddress });
const isDeployed = bytecode !== undefined && bytecode !== '0x';
```

---

## ERC-7715 Advantages

| Aspect | Manual Delegation | Advanced Permission |
|--------|-------------------|---------------------|
| Requires deployed SA | ✅ Yes (or 1Shot fails) | ✅ No (permissions are off-chain) |
| UX flow | `signDelegation()` → 1Shot | `requestExecutionPermissions()` → 1Shot |
| On-chain cost | 1 verification per execution | 0 no per-execution verification |
| Session revoke | Off-chain (revoke on DelegationManager) | Off-chain (drop session key) |

---

## Files Touched (for re-implementation reference)

```
src/modules/installations/schemas/installation.schema.ts
src/modules/installations/dto/confirm-installation.dto.ts
src/modules/installations/installations.controller.ts
src/modules/installations/installations.service.ts
src/modules/runner/runner.service.ts
test/installations.e2e-spec.ts
```

No changes needed to:
- `oneshot.service.ts` / `oneshot.module.ts` — `toRelayerJson` already handles both paths
- `delegation.service.ts` — advanced-permission skips delegation validation
- Admin controller — only `/confirm` POST changes
