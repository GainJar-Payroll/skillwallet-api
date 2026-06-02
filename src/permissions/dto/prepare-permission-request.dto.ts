import { z } from 'zod';

const addressField = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid EVM address');
const hexField = z.string().regex(/^0x[a-fA-F0-9]*$/, 'Must be a valid hex string');

const dcaConfigSchema = z.object({
  type: z.literal('dca'),
  tokenIn: z.object({
    symbol: z.literal('USDC'),
    address: addressField,
    decimals: z.literal(6),
  }),
  tokenOut: z.object({
    symbol: z.literal('WETH'),
    address: addressField,
    decimals: z.literal(18),
  }),
  amountPerRun: z.string().regex(/^\d+(\.\d+)?$/),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  maxSlippageBps: z.number().int().min(1).max(500),
  router: z.object({
    name: z.enum(['uniswap', 'aerodrome', 'custom']),
    address: addressField,
  }),
  recipient: addressField,
  quoteMode: z.enum(['external-quote-required', 'router-quote', 'manual-min-out']),
  minAmountOut: z.string().regex(/^\d+(\.\d+)?$/).optional(),
});

const aerodromeVoteConfigSchema = z.object({
  type: z.literal('aerodrome-vote'),
  veAeroTokenId: z.string().min(1),
  strategy: z.enum(['max-reward-density', 'risk-adjusted', 'balanced']),
  maxPools: z.number().int().min(1),
  executionWindow: z.object({
    day: z.enum(['wednesday', 'thursday']),
    startUtcHour: z.number().int().min(0).max(23),
    endUtcHour: z.number().int().min(0).max(23),
  }).optional(),
  allowAiExplanation: z.boolean(),
});

export const preparePermissionRequestSchema = z.object({
  userAddress: addressField,
  smartAccountAddress: addressField,
  chainId: z.number().int().positive(),
  skillId: z.string().min(1),
  config: z.discriminatedUnion('type', [dcaConfigSchema, aerodromeVoteConfigSchema]),
  pricingPlan: z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    durationDays: z.number().int().positive(),
    skillFeeUsdc: z.string().regex(/^\d+(\.\d+)?$/),
  }),
  schedule: z.object({
    frequency: z.enum(['daily', 'weekly', 'monthly']).optional(),
    timezone: z.string().optional(),
    startAt: z.string().datetime().optional(),
  }),
});

export type PreparePermissionRequestDto = z.infer<typeof preparePermissionRequestSchema>;

export const submitPermissionGrantSchema = z.object({
  installationId: z.string().min(1),
  rawGrantResponse: z.unknown(),
  context: hexField.optional(),
  delegationManager: addressField.optional(),
  dependencies: z.array(z.object({
    factory: addressField.optional(),
    factoryData: hexField.optional(),
  })).optional(),
  expiresAt: z.string().datetime().optional(),
  normalizedPermissions: z.array(z.object({
    chainId: z.union([z.string(), z.number()]),
    from: addressField,
    to: addressField.optional(),
    permissionType: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
  })).optional(),
});

export type SubmitPermissionGrantDto = z.infer<typeof submitPermissionGrantSchema>;