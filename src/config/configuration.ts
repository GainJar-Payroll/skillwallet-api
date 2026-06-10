import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  ADMIN_API_KEY: Joi.string().min(16).required(),
  MONGODB_URI: Joi.string().required(),
  MONGODB_DB_NAME: Joi.string().optional(),
  SPONSOR_PRIVATE_KEY: Joi.string()
    .pattern(/^0x[0-9a-fA-F]{64}$/)
    .required(),
  BASE_SEPOLIA_RPC_URL: Joi.string().uri().required(),
  BASE_MAINNET_RPC_URL: Joi.string().uri().required(),
  DEFAULT_CHAIN_ID: Joi.number().valid(84532, 8453).default(84532),
  ONESHOT_RELAYER_URL: Joi.string().uri().required(),
  ONESHOT_POLL_INTERVAL_MS: Joi.number().integer().positive().optional(),
  ONESHOT_POLL_TIMEOUT_MS: Joi.number().integer().positive().optional(),
  VENICE_API_BASE: Joi.string().uri().default('https://api.venice.ai/api/v1'),
  VENICE_MODEL: Joi.string().default('e2ee-gpt-oss-120b-p'),
  VENICE_API_KEY: Joi.string().allow('').default(''),
  OTTOAI_NEWS_URL: Joi.string().uri().default('https://x402.ottoai.services/crypto-news'),
  RUNNER_ENABLED: Joi.boolean().default(true),
  CRON_INTERVAL: Joi.string().optional(),
  SPONSOR_FEE_CHAIN_ID: Joi.number().valid(84532, 8453).optional(),
  SPONSOR_BUDGET_ATOMS: Joi.string().optional(),
  SPONSOR_REFRESH_THRESHOLD: Joi.string().optional(),
  STATELESS_DELEGATOR_IMPL_ADDRESS: Joi.string()
    .pattern(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
  PAYMASTER_URL: Joi.string().uri().optional(),
  BUNDLER_URL: Joi.string().uri().optional(),
  SPONSORSHIP_POLICY: Joi.string().optional(),
  PIMLICO_EXEC_KEY: Joi.string().min(8).optional(),
});

export default () => ({
  port: parseInt(process.env.PORT!, 10) || 3000,
  adminApiKey: process.env.ADMIN_API_KEY!,
  mongodbUri: process.env.MONGODB_URI!,
  mongodbDbName: process.env.MONGODB_DB_NAME,
  executorPrivateKey: process.env.SPONSOR_PRIVATE_KEY! as `0x${string}`,
  sponsorPrivateKey: process.env.SPONSOR_PRIVATE_KEY! as `0x${string}`,
  sponsorFeeChainId: process.env.SPONSOR_FEE_CHAIN_ID
    ? Number(process.env.SPONSOR_FEE_CHAIN_ID)
    : 84532,
  sponsorBudgetAtoms: process.env.SPONSOR_BUDGET_ATOMS ?? '5000000',
  sponsorRefreshThreshold: process.env.SPONSOR_REFRESH_THRESHOLD ?? '0.8',
  statelessDelegatorImplAddress:
    process.env.STATELESS_DELEGATOR_IMPL_ADDRESS ??
    ('0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B' as `0x${string}`),
  rpc: {
    [84532]: process.env.BASE_SEPOLIA_RPC_URL!,
    [8453]: process.env.BASE_MAINNET_RPC_URL!,
  },
  defaultChainId: parseInt(process.env.DEFAULT_CHAIN_ID!, 10) || 84532,
  oneShotRelayerUrl: process.env.ONESHOT_RELAYER_URL!,
  oneShotPollIntervalMs: process.env.ONESHOT_POLL_INTERVAL_MS
    ? parseInt(process.env.ONESHOT_POLL_INTERVAL_MS, 10)
    : undefined,
  oneShotPollTimeoutMs: process.env.ONESHOT_POLL_TIMEOUT_MS
    ? parseInt(process.env.ONESHOT_POLL_TIMEOUT_MS, 10)
    : undefined,
  venice: {
    apiBase: process.env.VENICE_API_BASE || 'https://api.venice.ai/api/v1',
    model: process.env.VENICE_MODEL || 'e2ee-gpt-oss-120b-p',
    apiKey: process.env.VENICE_API_KEY || '',
  },
  ottoAiNewsUrl: process.env.OTTOAI_NEWS_URL || 'https://x402.ottoai.services/crypto-news',
  runnerEnabled: process.env.RUNNER_ENABLED !== 'false',
  cronInterval: process.env.CRON_INTERVAL ?? '*/5 * * * *',
  pimlico: {
    paymasterUrl: process.env.PAYMASTER_URL || '',
    bundlerUrl: process.env.BUNDLER_URL || process.env.PAYMASTER_URL || '',
    sponsorshipPolicy: process.env.SPONSORSHIP_POLICY || '',
    execKey: process.env.PIMLICO_EXEC_KEY || '',
  },
});
