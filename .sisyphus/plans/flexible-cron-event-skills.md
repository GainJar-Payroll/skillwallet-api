# Flexible Cron/Event Skill Architecture

Baseline commit: `98f0990 checkpoint public skill ids`

This file is the compaction-safe source of truth. If context is compacted, continue from this plan and do not reinterpret the original scope.

## Original Objectives

- Support only two skill run types for now: `cron` and `event-trigger`.
- Preserve the current public `skillId` flow end-to-end; never revert to Mongo `_id` for install runtime.
- Preserve existing `test/proof/proof.ts` behavior and make sure it still succeeds.
- Add a second proof for a different skill type: trigger-based DCA when USDC is transferred into the user smart account.
- Proof watches for a real onchain USDC `Transfer` event caught by the backend watcher; tests may use admin event injection but runtime history trigger type remains `event-trigger`.
- Add history data so the frontend can prove a skill ran before: status, trigger source, spend amount, tx/task ids, skipped reason.
- Use `bun`/`bunx`, not npm.
- No external CDN dependencies.
- Implement only after this plan is frozen and committed.

## Design Decisions

- Highest-probability implementation strategy: backward-compatible schema evolution, not a big-bang breaking rewrite.
- Add normalized `trigger`, `execution`, and `limits` fields while keeping existing `cronExpression`, `eventTriggerConfig`, and `metadata.kind` compatibility where needed.
- Runner dispatch should use normalized execution kind, not `skill.name`.
- Event-trigger proof should not simulate or submit transfers itself; it should wait until the backend watcher catches a real onchain event sent by the user.
- Daily spend enforcement should be backend runtime enforced first, with delegation scope carrying intended `erc20SpendLimit` metadata for future caveat support.
- Spend limit should reserve on submit and release on failure to avoid race-condition overspend.
- Execution history remains embedded on installation for now, capped at 50 latest entries; add richer fields instead of a separate execution collection.
- Skill `parameters[]` is the UI/user-input schema. User-selected values should be accepted as chosen runtime parameters, ideally already at `/prepare`, so delegation scope and limits can be derived from the same choices later. `/confirm` must persist the finalized chosen values for runner execution.

## Target Skill Shape

```ts
type SkillRunType = 'cron' | 'event-trigger';

type Skill = {
  name: string;
  skillId: string;
  description: string;
  iconUrl: string;
  chainId: number;
  runType: SkillRunType;
  trigger?: CronTriggerConfig | EventTriggerConfig;
  execution?: DcaUniswapV3ExecutionConfig | ContractCallExecutionConfig;
  delegationScope: DelegationScopeConfig;
  parameters: SkillParameter[];
  limits?: SkillLimits;
  metadata: Record<string, unknown>;
  isActive: boolean;
};
```

## Target Cron Trigger

```ts
type CronTriggerConfig = {
  type: 'cron';
  cronExpression: string;
  timezone?: string;
};
```

Cron runner algorithm:

1. Every 5 minutes, find active due installations.
2. Load skill by public `skillId`.
3. Normalize skill trigger.
4. Skip unless trigger type is `cron`.
5. Execute installation.
6. Compute `nextExecutionAt` from normalized `cronExpression`.

## Target Event Trigger

```ts
type EventTriggerConfig = {
  type: 'event-trigger';
  chainId: number;
  contractAddress: `0x${string}`;
  eventSignature: string;
  filterArgs?: Record<string, EventFilterValue>;
  confirmations?: number;
  dedupeKey?: 'txHash-logIndex';
};

type EventFilterValue =
  | string
  | { source: 'installation'; path: 'smartAccountAddress' | 'userAddress' }
  | { source: 'parameters'; path: string };
```

Event runner algorithm:

1. On app start, load active event-trigger skills.
2. Register watcher per unique `(chainId, contractAddress, eventSignature)`.
3. On logs, call a shared event handler service.
4. Handler finds active installations by public `skillId`.
5. Handler resolves dynamic filters per installation.
6. Handler dedupes by `(chainId, contractAddress, txHash, logIndex, skillId, installationId)`.
7. Handler checks runtime limits.
8. Handler executes installation with trigger context.
9. Handler records execution history.

## Trigger-Based DCA Skill

Skill id: `usdc-inbound-dca-84532`

Purpose: when USDC `Transfer` event sends tokens to a user's smart account, swap a bounded amount into selected output token.

Trigger:

```ts
{
  type: 'event-trigger',
  chainId: 84532,
  contractAddress: USDC_BASE_SEPOLIA,
  eventSignature: 'Transfer(address indexed from,address indexed to,uint256 value)',
  filterArgs: {
    to: { source: 'installation', path: 'smartAccountAddress' },
  },
  confirmations: 1,
  dedupeKey: 'txHash-logIndex',
}
```

Execution:

```ts
{
  kind: 'dca-uniswap-v3',
  tokenIn: USDC_BASE_SEPOLIA,
  router: SWAP_ROUTER_02_BASE_SEPOLIA,
  defaultFeeTier: 3000,
}
```

Parameters:

- `outputToken`: `weth` or `cbBtc`, default `weth`.
- `spendMode`: `fixed` or `percent-of-inbound`, default `fixed`.
- `amountPerRun`: USDC atoms for fixed mode, default `100000`.
- `percentOfInboundBps`: default `5000`.
- `dailySpendLimit`: USDC atoms, default `10000000`.

Delegation scope:

```ts
{
  type: 'FunctionCall',
  targets: [USDC_BASE_SEPOLIA, SWAP_ROUTER_02_BASE_SEPOLIA],
  selectors: [
    'transfer(address,uint256)',
    'approve(address,uint256)',
    'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))',
  ],
  valueLte: { maxValue: '0x0' },
  erc20SpendLimit: {
    token: USDC_BASE_SEPOLIA,
    period: 'day',
    maxAmountParam: 'dailySpendLimit',
  },
}
```

## Spend Limit Algorithm

Use UTC daily period key: `YYYY-MM-DD`.

```txt
on inbound event:
  inboundAmount = event.args.value
  dailyLimit = installation.parameters.dailySpendLimit
  spentOrReservedToday = confirmed + reserved amount for installation/token/day
  remaining = dailyLimit - spentOrReservedToday

  if spendMode == fixed:
    desiredSpend = amountPerRun

  if spendMode == percent-of-inbound:
    desiredSpend = inboundAmount * percentOfInboundBps / 10000

  actualSpend = min(desiredSpend, inboundAmount, remaining)

  if actualSpend <= 0:
    append execution status skipped with reason daily-limit-exhausted
    do not submit 1Shot

  reserve actualSpend
  submit 1Shot
  if submit succeeds: execution submitted, reservation reserved
  if tx confirmed: execution confirmed, reservation confirmed
  if tx failed: execution failed, reservation released
```

First implementation rule: do not use pre-existing smart-account USDC balance. Spend only up to the inbound event amount.

## History Data Model

Extend installation execution history to support frontend proof.

```ts
type ExecutionStatus = 'pending' | 'submitted' | 'confirmed' | 'failed' | 'skipped';

type ExecutionRecord = {
  executionId?: string;
  executedAt: Date;
  completedAt?: Date;
  status: ExecutionStatus;
  trigger?: {
    type: 'manual' | 'cron' | 'event-trigger' | 'simulated-event';
    event?: {
      chainId: number;
      contractAddress: string;
      eventSignature: string;
      txHash?: string;
      logIndex?: number;
      blockNumber?: string;
      args?: Record<string, unknown>;
    };
  };
  spend?: {
    tokenAddress: string;
    requestedAmount: string;
    actualAmount: string;
    dailyLimit?: string;
    periodKey?: string;
    reservationId?: string;
  };
  oneShotTaskId?: string;
  txHash?: string;
  errorMessage?: string;
  skippedReason?: string;
  aiContext?: string;
  newsContext?: string;
};
```

Add history endpoint:

```http
GET /installations/:id/executions
```

Keep existing:

```http
GET /installations/:id
```

## Admin Simulated Event Endpoint

Add protected endpoint:

```http
POST /admin/events/simulate
```

Body:

```json
{
  "skillId": "usdc-inbound-dca-84532",
  "chainId": 84532,
  "event": {
    "contractAddress": "0xUSDC",
    "eventSignature": "Transfer(address indexed from,address indexed to,uint256 value)",
    "txHash": "0x...",
    "logIndex": 0,
    "blockNumber": "0",
    "args": {
      "from": "0xSender",
      "to": "0xSmartAccount",
      "value": "1000000"
    }
  }
}
```

The simulated endpoint must call the same shared event handler used by real watchers.

## Proof Plan

Existing proof:

```txt
test/proof/proof.ts
```

Must still work.

New proof:

```txt
test/proof/proof-trigger-dca.ts
```

Default mode:

1. Seed skills.
2. Select `usdc-inbound-dca-84532`.
3. Prepare installation.
4. Sign returned delegation.
5. Confirm installation with trigger DCA parameters.
6. Print the target smart account address and wait while the user sends USDC onchain.
7. Backend watcher catches the real USDC `Transfer` event.
8. Poll installation/executions.
9. Assert history contains `event-trigger` metadata and spend metadata.

## TODOs

- [x] T1 Add typed skill trigger/execution/limit/history interfaces.
- [x] T2 Extend skill schema/DTO for `trigger`, `execution`, and `limits` while preserving old fields.
- [x] T3 Add skill config normalization helper for backward compatibility.
- [x] T4 Refactor runner dispatch to normalized `execution.kind` while preserving Generic DCA.
- [x] T5 Refactor cron runner to normalized cron trigger.
- [x] T6 Add shared skill event handler service with dynamic filter matching.
- [x] T7 Add event dedupe persistence or deterministic dedupe mechanism.
- [x] T8 Add spend reservation model/service and daily limit calculation.
- [x] T9 Integrate event-triggered DCA amount calculation into runner/event handler.
- [x] T10 Seed `USDC Inbound DCA` alongside `Generic DCA`.
- [x] T11 Add admin simulated event endpoint.
- [x] T12 Extend execution history records and add `GET /installations/:id/executions`.
- [x] T13 Add `test/proof/proof-trigger-dca.ts` with simulation default and real mode optional.
- [x] T14 Update unit/e2e tests for cron, event-trigger, spend limit, history, and skill seed.

## Final Verification Wave

- [x] F1 Existing `test/proof/proof.ts` still succeeds or reaches same expected external-network boundary as before.
- [x] F2 New `test/proof/proof-trigger-dca.ts` is wired to wait for a real backend-watched onchain event.
- [x] F3 `bunx jest --config jest.config.cjs --runInBand` passes.
- [x] F4 `bunx nest build --builder swc` passes.
- [x] F5 `GET /installations/:id/executions` returns proof-ready execution history.

## Rollback

If implementation destabilizes the project and we decide not to continue, revert to:

```txt
98f0990 checkpoint public skill ids
```
