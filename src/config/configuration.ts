import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  ADMIN_API_KEY: Joi.string().min(16).required(),
  MONGODB_URI: Joi.string().required(),
  MONGODB_DB_NAME: Joi.string().optional(),
  EXECUTOR_PRIVATE_KEY: Joi.string()
    .pattern(/^0x[0-9a-fA-F]{64}$/)
    .required(),
  BASE_SEPOLIA_RPC_URL: Joi.string().uri().required(),
  BASE_MAINNET_RPC_URL: Joi.string().uri().required(),
  DEFAULT_CHAIN_ID: Joi.number().valid(84532, 8453).default(84532),
  ONESHOT_RELAYER_URL: Joi.string().uri().required(),
  PIMLICO_BUNDLER_URL: Joi.string().uri().optional(),
  VENICE_API_BASE: Joi.string().uri().default('https://api.venice.ai/api/v1'),
  VENICE_MODEL: Joi.string().default('google/gemini-2.5-flash'),
  VENICE_TOPUP_AMOUNT_USD: Joi.number().default(5),
  OTTOAI_NEWS_URL: Joi.string().uri().default('https://x402.ottoai.services/crypto-news'),
  PROOF_DELEGATOR_PRIVATE_KEY: Joi.string()
    .pattern(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
  RUNNER_ENABLED: Joi.boolean().default(true),
});

export default () => ({
  port: parseInt(process.env.PORT!, 10) || 3000,
  adminApiKey: process.env.ADMIN_API_KEY!,
  mongodbUri: process.env.MONGODB_URI!,
  mongodbDbName: process.env.MONGODB_DB_NAME,
  executorPrivateKey: process.env.EXECUTOR_PRIVATE_KEY! as `0x${string}`,
  rpc: {
    [84532]: process.env.BASE_SEPOLIA_RPC_URL!,
    [8453]: process.env.BASE_MAINNET_RPC_URL!,
  },
  defaultChainId: parseInt(process.env.DEFAULT_CHAIN_ID!, 10) || 84532,
  oneShotRelayerUrl: process.env.ONESHOT_RELAYER_URL!,
  pimlicoBundlerUrl: process.env.PIMLICO_BUNDLER_URL,
  venice: {
    apiBase: process.env.VENICE_API_BASE || 'https://api.venice.ai/api/v1',
    model: process.env.VENICE_MODEL || 'google/gemini-2.5-flash',
    topUpAmountUsd: parseInt(process.env.VENICE_TOPUP_AMOUNT_USD!, 10) || 5,
  },
  ottoAiNewsUrl:
    process.env.OTTOAI_NEWS_URL || 'https://x402.ottoai.services/crypto-news',
  proofDelegatorPrivateKey: process.env.PROOF_DELEGATOR_PRIVATE_KEY as `0x${string}` | undefined,
  runnerEnabled: process.env.RUNNER_ENABLED !== 'false',
});
