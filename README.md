# SkillWallet*

**Own an AI agent that pays its own gas, swaps its own tokens, and watches onchain events for you.**

SkillWallet* is a backoffice API for **delegated, onchain automation**. A user signs a single MetaMask delegation. From that point on, an AI agent runs the user's strategy without ever holding the user's private key:

- Reacts to onchain events (`Transfer`, `Sync`, anything) the moment they happen.
- Pays gas via the 1Shot relayer (no user-side UserOp).
- Bounded spend with per-day, per-strategy limits, double-spend safe.
- Type-safe skill parameters — admins ship new strategies without backend code changes.
- Marketplace skill catalog. Each skill declares its own trigger (cron / event) and runtime parameters.

---

## Getting Started

```bash
git clone https://github.com/GainJar-Payroll/mbg-api
cd mbg-api
cp .env.example .env
bun install
bun run build:swc
bun run start:dev
```

MongoDB is on Atlas — provide your own `MONGODB_URI` in `.env`. Fill in the other secrets (RPC URL, 1Shot relayer, Pimlico, Venice AI, sponsor keys). See `.env.example` for all fields.

Seed built-in skills on first run:

```bash
curl -X POST http://localhost:4000/admin/skills/seed \
  -H "x-api-key: $ADMIN_API_KEY"
```

---

## Stack

- **NestJS 10** + Mongoose + Swagger, strict TypeScript
- **MetaMask Smart Accounts Kit** — Hybrid Smart Account + delegation
- **1Shot relayer** — gasless execution via ERC-7710
- **Pimlico** — ERC-4337 v0.7 paymaster for undeployed smart accounts
- **viem** — ABI parsing, address checksums, RPC reads
- **x402 + Venice AI** — paid AI endpoints (crypto news, topup)
- **Jest** — e2e + unit with `mongodb-memory-server`

---

## API Surface

```
GET    /skills                                       — public catalog
GET    /skills/:skillId                              — single skill
POST   /installations/prepare                        — unsigned delegation
POST   /installations/confirm                        — signed delegation
GET    /installations?userAddress=...&chainId=...    — list
GET    /installations/:id                            — installation + executions
GET    /installations/:id/executions                 — execution history
PATCH  /installations/:id/pause                      — user pauses
PATCH  /installations/:id/resume                     — user resumes
DELETE /installations/:id                            — user revokes

GET    /admin/executor                  [x-api-key]  — executor EOA
POST   /admin/skills/seed               [x-api-key]  — seed built-ins
POST   /admin/installations/:id/trigger [x-api-key]  — force-run

POST   /pimlico/deploy-and-execute      [x-pimlico-key]  — Phase 1: gas estimates
POST   /pimlico/submit-user-op          [x-pimlico-key]  — Phase 2: submit signed UserOp

GET    /docs                            — Swagger UI
GET    /docs-json                       — OpenAPI JSON
```

---

## Deployment

Docker image pushed to `ghcr.io/gainjar-payroll/mbg-api` on tag push (`git tag v*`). Deploy on your VPS:

```bash
docker pull ghcr.io/gainjar-payroll/mbg-api:latest
docker run -d --restart=always -p 4000:4000 --env-file .env \
  ghcr.io/gainjar-payroll/mbg-api:latest
```

---

## License

UNLICENSED — internal hackathon project.
