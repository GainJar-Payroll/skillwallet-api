import { z } from 'zod';

const optionalUrl = z.string().url().optional().or(z.literal(''));
const optionalAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .optional()
  .or(z.literal(''));
const requiredAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const privateKey = z.string().regex(/^0x[a-fA-F0-9]{64}$/);

/** USDC addresses per chain — used as default payment token when
 *  ONESHOT_PAYMENT_TOKEN_ADDRESS is not set. Source: 1Shot `relayer_getCapabilities`
 *  for each supported chain. */
export const DEFAULT_PAYMENT_TOKEN_BY_CHAIN: Record<number, string> = {
  1: '0xa0b86991c6218b36c1d19d4a2e9Eb0cE3606eB48', // eth mainnet USDC
  11155111: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', // eth sepolia USDC
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // base USDC
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // base sepolia USDC
};

export const envSchema = z.object({
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB_NAME: z.string().min(1).default('skillwallet'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  ONESHOT_NETWORK: z.enum(['mainnet', 'testnet']).default('testnet'),
  ONESHOT_RELAYER_URL: optionalUrl,
  ONESHOT_PAYMENT_TOKEN_ADDRESS: optionalAddress,
  ONESHOT_DESTINATION_URL: optionalUrl,
  ONESHOT_JWKS_URL: optionalUrl,
  ONESHOT_WEBHOOK_PUBLIC_KEY: z.string().optional().or(z.literal('')),
  ONESHOT_API_KEY: z.string().optional().or(z.literal('')),
  ONESHOT_API_SECRET: z.string().optional().or(z.literal('')),
  ONESHOT_RELAYER_WALLET: optionalAddress,
  ONESHOT_TESTNET_CHAIN_ID: z.coerce.number().int().positive().default(11155111),
  ONESHOT_MAINNET_CHAIN_ID: z.coerce.number().int().positive().default(8453),
  ADMIN_API_KEY: z.string().min(1, 'ADMIN_API_KEY is required'),
  EXECUTOR_PRIVATE_KEY: privateKey.min(1, 'EXECUTOR_PRIVATE_KEY is required'),
  EXECUTOR_ADDRESS: requiredAddress.min(1, 'EXECUTOR_ADDRESS is required'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  return parsed.data;
}
