# SkillWallet Core Backend Instructions

Project: NestJS backend for a MetaMask-native wallet skill marketplace.

## Runtime and Package Manager

- Use **Bun** for package scripts and dependency management.
- Use `bun add`, `bun install`, `bun run <script>`, and `bun test`.
- Do not use npm, yarn, or pnpm unless explicitly requested.

## Backend Stack

- **NestJS** — not Bun.serve.
- **MongoDB** with **Mongoose** — not in-memory storage.
- **TypeScript strict mode** — all compiler flags enabled.
- **Zod** for runtime validation and DTO parsing.
- **viem** for EVM address helpers and chain primitives.
- **pino** for structured logs (via `src/common/logger`).
- **dotenv/config** — Bun auto-loads `.env`, so dotenv module is optional.

## Project Structure

```
src/
  main.ts                        # NestJS bootstrap
  app.module.ts                  # Root module
  config/                        # Env validation, config module
  database/                      # Mongoose connection module
  common/types/                  # EVM types (Address, HexString, ChainId)
  common/errors/                 # AppError, ErrorCode enum
  common/utils/                  # address, hash, time helpers
  common/logger/                 # Pino logger factory
  chains/                        # Chain configuration per network
  skills/                        # Skill definitions (marketplace catalog)
  installations/                 # User skill installations
  permissions/                   # ERC-7715 request, grant, delegation records
  executors/                     # Executor registry
  runtime/                       # Adapters, policy, relayers, scheduler
  health/                        # Health check endpoint
```

## Product Constraints (NON-NEGOTIABLE)

- **No mock endpoints, no mock adapters, no fake execution success, no dummy calldata.**
- **No private key storage. No generated executor private keys.**
- External integrations missing config must return typed `NOT_CONFIGURED` errors.
- Runtime must fail closed.
- AI must not generate calldata.
- ProposedAction must be built server-side by adapter.
- PolicyValidator must fail closed.
- Do not expose internal env values in responses.

## Domain Model Summary

- **SkillDefinition** — marketplace template (DCA, Aerodrome Vote, etc.)
- **SkillInstallation** — user's active skill with config, permissions, schedule
- **PermissionManifest** — SkillWallet's normalized app-level policy
- **WalletPermissionRequestRecord** — ERC-7715 request stored for wallet
- **WalletPermissionGrantRecord** — wallet approval result
- **DelegationRecord** — ERC-7710 delegation derived from grant
- **ExecutionAttempt** — every run attempt with status chain
- **ActivityLog** — audit trail for all state changes
- **ExecutorRegistry** — public executor addresses per adapter/chain

## Forbidden Actions Policy

- forbiddenActions in PermissionManifest are descriptive and policy-oriented.
- Every forbidden action must be backed by positive rules.
- Example: "unknown router" → maps to allowedTargets.
- "spend more than 10 USDC/week" → maps to erc20-periodic-spend rule.

## Build Requirements

Required scripts:

- `bun run start:dev` — starts dev server with watch
- `bun run build` — production build
- `bun run lint` — ESLint with zero warnings
- `bun run test` — unit tests

**Before claiming done, run build and lint. Both must pass.**

## Testing

- Unit tests in `src/**/*.spec.ts` or `test/**/*.spec.ts`.
- Use `bun test` runner.
- Test permission compiler, policy validator, scheduler failure paths.
- Never fake relay success in tests.

## Environment

- Validate env at boot using Zod schema.
- Missing required MongoDB URI must crash at boot.
- Missing optional integration env must NOT crash (only crash when endpoint called).
- Never store or request private keys.

## Sub-Agent Convention

- When spawning any sub-agent (background research, explore, librarian, oracle, build, etc.), use the **same model and provider** as the orchestrating session.
- Active session: model `9router/main`, provider `9router`.
- Rationale: keeps response style, tool-use discipline, and security posture consistent across the whole agent tree. No mixing of providers within one task graph.
