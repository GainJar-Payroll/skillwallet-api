import { z } from 'zod';

const optionalUrl = z.string().url().optional().or(z.literal(''));
const optionalAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .optional()
  .or(z.literal(''));

export const envSchema = z.object({
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB_NAME: z.string().min(1).default('skillwallet'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DEFAULT_CHAIN_ID: z.coerce.number().int().positive().default(8453),
  BASE_RPC_URL: optionalUrl,
  BASE_SEPOLIA_RPC_URL: optionalUrl,
  SEPOLIA_RPC_URL: optionalUrl,
  DEFAULT_DELEGATION_MANAGER_ADDRESS: optionalAddress,
  BASE_DELEGATION_MANAGER_ADDRESS: optionalAddress,
  BASE_SEPOLIA_DELEGATION_MANAGER_ADDRESS: optionalAddress,
  BASE_EXECUTOR_ADDRESS: optionalAddress,
  BASE_USDC_ADDRESS: optionalAddress,
  BASE_WETH_ADDRESS: optionalAddress,
  BASE_SWAP_ROUTER_ADDRESS: optionalAddress,
  ONESHOT_NETWORK: z.enum(['mainnet', 'testnet']).default('testnet'),
  ONESHOT_RELAYER_URL: optionalUrl,
  ONESHOT_PAYMENT_TOKEN_ADDRESS: optionalAddress,
  ONESHOT_DESTINATION_URL: optionalUrl,
  ONESHOT_JWKS_URL: optionalUrl,
  ONESHOT_WEBHOOK_PUBLIC_KEY: z.string().optional().or(z.literal('')),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  return parsed.data;
}
