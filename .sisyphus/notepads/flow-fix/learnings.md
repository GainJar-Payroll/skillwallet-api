# Learnings

## Executor Key Generation and Address Derivation

### Pattern
- We generated a fresh 32-byte random private key using Node's `crypto.randomBytes(32)` and derived the unified executor address using `viem/accounts`'s `privateKeyToAccount`.
- This ensures a clean security boundary between test and production environments.
- The derived address is identical across all EVM chains because ECDSA address derivation is chain-agnostic.
- Storing these credentials in `.env` and documenting them in `.env.example` ensures proper configuration for MVP 1.
