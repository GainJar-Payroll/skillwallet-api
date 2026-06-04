import { z } from 'zod';

const addressField = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid EVM address');

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
  minAmountOut: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
});

const aerodromeVoteConfigSchema = z.object({
  type: z.literal('aerodrome-vote'),
  veAeroTokenId: z.string().min(1),
  strategy: z.enum(['max-reward-density', 'risk-adjusted', 'balanced']),
  maxPools: z.number().int().min(1),
  executionWindow: z
    .object({
      day: z.enum(['wednesday', 'thursday']),
      startUtcHour: z.number().int().min(0).max(23),
      endUtcHour: z.number().int().min(0).max(23),
    })
    .optional(),
  allowAiExplanation: z.boolean(),
});

export const createInstallationSchema = z.object({
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
  schedule: z
    .object({
      frequency: z.enum(['daily', 'weekly', 'monthly']).optional(),
      timezone: z.string().optional(),
      startAt: z.string().datetime().optional(),
    })
    .optional(),
  budget: z
    .object({
      totalUsdc: z
        .string()
        .regex(/^\d+(\.\d+)?$/)
        .optional(),
      perRunUsdc: z
        .string()
        .regex(/^\d+(\.\d+)?$/)
        .optional(),
    })
    .optional(),
});

export type CreateInstallationDto = z.infer<typeof createInstallationSchema>;

export const updateInstallationStatusSchema = z.object({
  status: z.enum([
    'draft',
    'pending_permission',
    'permission_granted',
    'active',
    'paused',
    'revoked',
    'expired',
    'error',
  ]),
});

export type UpdateInstallationStatusDto = z.infer<typeof updateInstallationStatusSchema>;

export const listInstallationsQuerySchema = z.object({
  userAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  chainId: z.coerce.number().int().positive().optional(),
  status: z.string().optional(),
  skillId: z.string().optional(),
});

export type ListInstallationsQuery = z.infer<typeof listInstallationsQuerySchema>;
