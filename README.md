# SkillWallet*

**Own an AI agent that pays its own gas, swaps its own tokens, and watches onchain events for you.**

SkillWallet* is a backoffice API for **delegated, onchain automation**. A user signs a single MetaMask delegation. From that point on, an AI agent runs the user's strategy without ever holding the user's private key:

- Reacts to onchain events (`Transfer`, `Sync`, anything) the moment they happen.
- Pays gas via the 1Shot relayer (no user-side UserOp).
- Bounded spend with per-day, per-strategy limits, period-keyed, double-spend safe.
- Flexible, type-safe skill parameters that admins can ship without backend code changes.

The Hackathon MVP ships two skills that show the full pipeline end-to-end:

| Skill                       | Trigger        | What it does                                              |
| --------------------------- | -------------- | --------------------------------------------------------- |
| `generic-dca-{chainId}`     | `cron`         | Every N seconds, swap USDC → WETH via Uniswap V3.         |
| `usdc-inbound-dca-{chainId}`| `event-trigger`| When USDC lands in the smart account, spend a portion of it. |

The same backend powers both: a single delegation from the user's Hybrid Smart Account to the 1Shot relayer is enough to run either skill, paused, resumed, or revoked at any time.

---

## Live demo flow (the "wow" path)

```bash
# 1. Boot the stack
docker compose up -d                  # mongo
cp .env.example .env                  # then fill keys
bun install
bun run build:swc
bun run start:dev

# 2. Seed the built-in skills
curl -X POST http://localhost:4000/admin/skills/seed \
  -H "x-api-key: $ADMIN_API_KEY"
#   → seeds "Generic DCA" and "USDC Inbound DCA"

# 3. The proof scripts in test/proof/ walk the full UX:
#    proof.ts             → admin-trigger DCA (cron, manual /admin/.../trigger)
#    proof-trigger-dca.ts → event-trigger DCA (watches onchain USDC Transfer)
#    Both:
#    - Resolve the skill from /skills
#    - Client-side validate the chosen parameters against the skill definition
#    - Skip /prepare + /confirm if a matching (user, smartAccount, skillId)
#      installation is already active
#    - POST /installations/prepare → sign delegation → POST /installations/confirm
#    - Read /installations/:id/executions for proof
```

The frontend integration is fully documented in [`docs/FE_INTEGRATION.md`](./docs/FE_INTEGRATION.md).

---

## What the backend is (in one minute)

- **NestJS 10** + Mongoose + Swagger, TypeScript strict.
- **MetaMask Smart Accounts Kit** for Hybrid Smart Account + delegation.
- **1Shot relayer** for gasless execution.
- **viem** for ABI parsing, address checksums, RPC reads.
- **x402** + **Venice AI** for paid AI endpoints (crypto news, topup).
- **Jest** e2e + unit, in-memory Mongo via `mongodb-memory-server`.
- **128/128 tests passing** in 14 suites.

### API surface (root-level, no `/api/v1`)

```
GET    /skills                                       — public catalog
GET    /skills/:skillId                              — single skill
POST   /installations/prepare                        — unsigned delegation
POST   /installations/confirm                        — signed delegation
GET    /installations?userAddress=...&chainId=...    — list (filters by smartAccountAddress)
GET    /installations/:id                            — installation + executions
GET    /installations/:id/executions                 — execution history
PATCH  /installations/:id/pause                      — user pauses
PATCH  /installations/:id/resume                     — user resumes
DELETE /installations/:id                            — user revokes

GET    /admin/executor                  [x-api-key]  — executor EOA
POST   /admin/skills/seed               [x-api-key]  — seed built-ins
POST   /admin/installations/:id/trigger [x-api-key]  — force-run (admin / cron)

GET    /docs                            — Swagger UI
GET    /docs-json                       — OpenAPI JSON
```

---

## Type-safe skill parameters (the design point)

Every skill declares its runtime parameters as a discriminated union:

```ts
type SkillParameterDefinition =
  | SkillSelectParameterDefinition   // options: { label, value, metadata? }[]
  | SkillNumberParameterDefinition    // min/max/integer
  | SkillBooleanParameterDefinition
  | SkillStringParameterDefinition    // pattern/minLength/maxLength
  | SkillAddressParameterDefinition;  // checksummed via getAddress
```

Canonical user input is `[{ key, value }]`. The backend validates in **both** `/installations/prepare` and `/installations/confirm`, persists a normalized object, and the runner reads a stable shape. Select options are server-declared objects so users cannot inject arbitrary token addresses.

See [`src/modules/skills/skill-parameter.types.ts`](./src/modules/skills/skill-parameter.types.ts) and [`src/modules/skills/skill-parameter-validation.ts`](./src/modules/skills/skill-parameter-validation.ts) for the full contract.

---

## What's intentionally out of scope (hackathon-cut)

- No CD pipeline, no staging env. `bun run start:dev` is the only deployment.
- No PII or KYC. Wallets are the identity layer.
- No persistent analytics, no dashboards. The proof scripts *are* the dashboard.
- `CLIENT_SECRET` is never sent to the browser. Auth is delegated to Web3Auth.
- The `manual` and `simulated-event` runtime trigger types are not shipped. Only `cron` and `event-trigger`.

---

## License

UNLICENSED — internal hackathon project.
