# Skill-Wallet API Integration Guide (Frontend)

This document is the single source of truth for FE integration with Skill-Wallet.
It covers the full install flow: skill discovery, parameter rendering, prepare, sign, confirm, history, and operational endpoints.

Base URL:
```txt
http://localhost:4000
```

In development, Vite already proxies `/skills`, `/installations`, `/admin/*` to port 4000.

## Runtime assumptions
- All requests are JSON.
- The user's EOA signs nothing; the smart account signs the delegation through MetaMask Smart Accounts Kit.
- The backend validates every parameter the FE sends. The FE must derive the form schema from `skill.parameters` and never invent keys.
- Only `cron` and `event-trigger` are valid run types.
- `CLIENT_SECRET` is never required from FE and is never exposed by BE.

---

## 1. Get the skill catalog

### `GET /skills`

Purpose: list every active skill the user can install.

Query params (optional):
- `onlyActive=true` (default) filters out `isActive: false`.
- `chainId=<number>` filters by chain.

Response includes `delegationScopeMeta` — human-readable metadata (label, description, block explorer URL) for each contract in `delegationScope.targets[]`, same-indexed so FE can loop and render contract info alongside each scope item.

Response `200`:
```json
{
  "data": [
    {
      "skillId": "generic-dca-84532",
      "name": "Generic DCA",
      "description": "Dollar-cost average USDC into a selected Base token on a fixed schedule.",
      "iconUrl": "https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/usdc.png",
      "runType": "cron",
      "trigger": {
        "type": "cron",
        "cronExpression": "0 9 * * *"
      },
      "chainId": 84532,
      "delegationScope": { "...": "..." },
      "delegationScopeMeta": [
        {
          "target": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          "label": "USDC Token",
          "description": "Let the agent transfer and approve USDC tokens for DCA swaps",
          "contractUrl": "https://sepolia.basescan.org/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e"
        }
      ],
      "parameters": [
        {
          "key": "outputToken",
          "label": "Output Token",
          "type": "select",
          "required": true,
          "defaultValue": "weth",
          "options": [
            {
              "label": "WETH",
              "value": "weth",
              "metadata": {
                "address": "0x4200000000000000000000000000000000000006",
                "symbol": "WETH",
                "decimals": 18
              }
            },
            {
              "label": "cbBTC",
              "value": "cbBtc",
              "metadata": { "symbol": "cbBTC", "decimals": 8 }
            }
          ]
        },
        {
          "key": "amountUsdc",
          "label": "Amount (USDC atoms)",
          "type": "number",
          "required": true,
          "defaultValue": "10000000"
        }
      ],
      "isActive": true,
      "metadata": { "category": "DeFi", "kind": "dca", "risk": "medium", "builtin": true }
    }
  ]
}
```

### How FE renders parameters
For each `parameter` in `skill.parameters`, render the matching control:

| `type` | FE control | Submit `value` |
|---|---|---|
| `select` | dropdown; show `options[].label`, store `options[].value` | string from `options[].value` only |
| `number` | numeric input | string or number |
| `boolean` | checkbox/toggle | boolean only |
| `string` | text input | string |
| `address` | text input with 0x validation | string (BE normalizes via `getAddress`) |
| `cron` | text input | string (cron expression validated server-side) |

#### Delegation scope metadata

`skill.delegationScopeMeta` is an array of objects (same index as `delegationScope.targets[]`), each with:
- `target` — contract address
- `label` — short display name
- `description` — what this contract does in the delegation context
- `contractUrl` — block explorer link

FE can render these alongside each delegation scope item in the install card so the user understands which contracts the agent will interact with.
Rules:


- Required parameters with no default must be filled before submit.
- Optional parameters may be empty; BE will fall back to `defaultValue` when defined.
- `select` is enforced as a closed enum: never let the user type a free string for select token fields.
- The BE never accepts arbitrary user-submitted token addresses. The canonical WETH metadata address is the trusted one; cbBTC on Base Sepolia currently has no onchain token at the chain config slot, so its metadata does not expose an `address`.

Example install form state for `generic-dca-84532`:
```json
[
  { "key": "outputToken", "value": "weth" },
  { "key": "amountUsdc", "value": "10000000" }
]
```

---

## 2. Check if a skill is already installed for this user

### `GET /installations`

Query params:
- `userAddress=<eoa address>` required
- `chainId=<number>` optional
- `smartAccountAddress=<sa address>` optional

Response `200`:
```json
{
  "data": [
    {
      "_id": "65f...",
      "userAddress": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      "smartAccountAddress": "0x1234567890123456789012345678901234567890",
      "skillId": "generic-dca-84532",
      "chainId": 84532,
      "status": "active",
      "parameters": {
        "outputToken": "weth",
        "amountUsdc": "10000000"
      },
      "delegationSalt": "0xabc...",
      "signedDelegation": { "...": "..." },
      "executions": [],
      "lastExecutedAt": null,
      "nextExecutionAt": null,
      "createdAt": "2026-06-01T00:00:00.000Z",
      "updatedAt": "2026-06-01T00:00:00.000Z"
    }
  ]
}
```

FE rule:
- Match on `(userAddress, chainId, smartAccountAddress, skillId)` and `status` in `['active', 'paused']` to decide whether the user has it installed.
- If installed, show the existing parameters and offer Pause/Resume/Revoke.

---

## 3. Prepare

### `POST /installations/prepare`

Purpose: ask the BE to build the unsigned delegation for the user's smart account, then validate the chosen parameters before any signing happens.

Headers:
- `content-type: application/json`

Body:
```json
{
  "skillId": "generic-dca-84532",
  "userAddress": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "smartAccountAddress": "0x1234567890123456789012345678901234567890",
  "chainId": 84532,
  "parameters": [
    { "key": "outputToken", "value": "weth" },
    { "key": "amountUsdc", "value": "10000000" }
  ]
}
```

Field rules:
- `parameters` is canonical `[{ key, value }]`. The legacy object form is also accepted during migration.
- `parameters` items are validated against `skill.parameters`. Unknown keys, invalid selects, non-numeric numbers, and duplicate keys all return `400` with a clear error.
- `chainId` is optional. If provided, the BE will keep using the skill's own chain for delegation. Most FE clients should omit it.

Response `201`:
```json
{
  "delegation": {
    "delegate": "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    "delegator": "0x1234567890123456789012345678901234567890",
    "authority": "0x...",
    "caveats": [ { "enforcer": "0x...", "terms": "0x...", "args": "0x..." } ],
    "salt": "0xabc..."
  },
  "salt": "0xabc...",
  "skillId": "generic-dca-84532",
  "executorAddress": "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "chainId": 84532
}
```

Failure modes:
- `400` invalid parameters (e.g. unknown key, invalid select value, non-numeric number, duplicate key)
- `400` skill not active
- `409` duplicate active installation for the same `(user, smart account, skill)`

---

## 4. Sign the delegation

The FE uses MetaMask Smart Accounts Kit against the user's deployed Hybrid Smart Account:

```ts
import {
  Implementation,
  ScopeType,
  toMetaMaskSmartAccount,
  createDelegation,
} from '@metamask/smart-accounts-kit';

const smartAccount = await toMetaMaskSmartAccount({ ... });
const signature = await smartAccount.signDelegation({ delegation });

const signedDelegation = { ...delegation, signature };
```

Important: `delegation.delegator` MUST equal the smart account address; `delegation.delegate` MUST equal `executorAddress` returned by `/prepare`.

---

## 5. Confirm

### `POST /installations/confirm`

Purpose: validate the parameter payload again server-side, persist the installation, and return the saved record.

Body:
```json
{
  "skillId": "generic-dca-84532",
  "userAddress": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "smartAccountAddress": "0x1234567890123456789012345678901234567890",
  "chainId": 84532,
  "signedDelegation": {
    "delegate": "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    "delegator": "0x1234567890123456789012345678901234567890",
    "authority": "0x...",
    "caveats": [],
    "salt": "0xabc...",
    "signature": "0x..."
  },
  "delegationSalt": "0xabc...",
  "parameters": [
    { "key": "outputToken", "value": "weth" },
    { "key": "amountUsdc", "value": "10000000" }
  ]
}
```

Response `201`:
```json
{
  "_id": "65f...",
  "userAddress": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "smartAccountAddress": "0x1234567890123456789012345678901234567890",
  "skillId": "generic-dca-84532",
  "chainId": 84532,
  "status": "active",
  "parameters": {
    "outputToken": "weth",
    "amountUsdc": "10000000"
  },
  "delegationSalt": "0xabc...",
  "signedDelegation": { "...": "..." },
  "executions": [],
  "lastExecutedAt": null,
  "nextExecutionAt": null,
  "createdAt": "2026-06-01T00:00:00.000Z",
  "updatedAt": "2026-06-01T00:00:00.000Z"
}
```

Notes:
- The `parameters` object stored on the installation is normalized, with number values saved as strings (e.g. `"10000000"`).
- A second confirm with the same `(user, smart account, skill)` returns `409`. Call `/installations` to fetch the existing one.

---

## 6. Read the installation

### `GET /installations/:id`

Response `200`: same shape as the confirm response.

### `GET /installations/:id/executions`

Response `200`:
```json
{
  "installationId": "65f...",
  "data": [
    {
      "executionId": "...",
      "executedAt": "2026-06-02T09:00:00.000Z",
      "completedAt": "2026-06-02T09:00:14.000Z",
      "status": "confirmed",
      "oneShotTaskId": "...",
      "txHash": "0x...",
      "trigger": {
        "type": "event-trigger",
        "event": {
          "chainId": 84532,
          "contractAddress": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          "eventSignature": "Transfer(address indexed from,address indexed to,uint256 value)",
          "txHash": "0x...",
          "logIndex": 0,
          "blockNumber": "0x...",
          "args": {
            "from": "0x...",
            "to": "0x1234567890123456789012345678901234567890",
            "value": "1000000"
          }
        }
      },
      "spend": {
        "tokenAddress": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        "requestedAmount": "500000",
        "actualAmount": "500000",
        "dailyLimit": "10000000",
        "periodKey": "2026-06-02",
        "reservationId": "..."
      }
    }
  ]
}
```

Execution `status` values:
- `pending` — accepted, waiting to be sent
- `submitted` — sent to the relayer
- `confirmed` — onchain receipt captured
- `failed` — relayer or onchain error, `errorMessage` populated
- `skipped` — guarded by policy (e.g. daily limit exhausted), `skippedReason` populated

---

## 7. Pause / Resume / Revoke

### `PATCH /installations/:id/pause`
### `PATCH /installations/:id/resume`
### `DELETE /installations/:id`

Body for pause/resume:
```json
{
  "userAddress": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
}
```

`DELETE` body is not required; ownership is checked from the authenticated smart account session.

Response `200` (pause/resume) and `200` (revoke) returns the updated installation.

`status` lifecycle:
- `active` <-> `paused`
- `active`/`paused` -> `revoked` (terminal)

---

## 8. Event-trigger specific data

For `runType: "event-trigger"`, installations may execute automatically when the configured event fires on chain. The FE does not call any trigger endpoint. Execution records arrive via the watcher and are visible through `GET /installations/:id/executions`.

For USDC Inbound DCA, the relevant event is the USDC `Transfer` to the user's smart account. FE may show a live status by polling `/installations/:id/executions` or by surfacing the latest `lastExecutedAt` from the installation document.

---

## 9. Canonical payload recipes

### Generic DCA (skillId `generic-dca-84532`)
Prepare/Confirm `parameters`:
```json
[
  { "key": "outputToken", "value": "weth" },
  { "key": "amountUsdc", "value": "10000000" }
]
```

### USDC Inbound DCA (skillId `usdc-inbound-dca-84532`)
Prepare/Confirm `parameters`:
```json
[
  { "key": "outputToken", "value": "weth" },
  { "key": "spendMode", "value": "percent-of-inbound" },
  { "key": "amountPerRun", "value": "100000" },
  { "key": "percentOfInboundBps", "value": "5000" },
  { "key": "dailySpendLimit", "value": "10000000" }
]
```

`outputToken` accepts `weth` or `cbBtc`. `spendMode` accepts `fixed` or `percent-of-inbound`. Numbers may be submitted as numbers or numeric strings; the BE always normalizes to a string on save.

---

## 10. Error format

All errors are NestJS `HttpException` JSON:
```json
{
  "statusCode": 400,
  "message": "Skill parameter outputToken must be one of: weth, cbBtc",
  "error": "Bad Request"
}
```

Common error codes:
- `400` validation error (parameters, addresses, delegation salt/delegator/delegate)
- `404` installation not found
- `409` active duplicate for `(user, smartAccount, skillId)`
- `500` unexpected backend error

---

## 11. Frontend flow checklist

1. Load `GET /skills` once on app/tab load.
2. For each skill, render the install form from `parameters`. For `select`, render labels from `options[].label` and store `options[].value`.
3. Show existing installations via `GET /installations?userAddress=...`. Match on `skillId + status active|paused` for "already installed" UX.
4. On submit, build the canonical `parameters: [{ key, value }]` payload and call `POST /installations/prepare`.
5. On `201`, sign `delegation` with the smart account and call `POST /installations/confirm` with the same `parameters` payload.
6. On `201`, store `_id` and surface the saved record. On `409`, fetch the existing installation and link to it.
7. After install, poll `GET /installations/:id/executions` (or refresh on event) to render execution history.
8. Surface pause/resume/revoke actions and reflect the latest `status` in the UI.

---

## 12. Things FE must never do

- Do not submit a token address as a `select` value. The BE only accepts the closed enum `value` for token-like selects.
- Do not bypass the canonical `[{ key, value }]` shape unless you also know the BE is in legacy compatibility mode. Prefer canonical.
- Do not send secrets or `ADMIN_API_KEY` to BE. The admin routes are BE-only.
- Do not call `/admin/*` from the browser. They are server-only and protected by `x-api-key`.
- Do not run live onchain proof flows from the browser. Use the local `test/proof/*.ts` scripts, which the user triggers manually.
