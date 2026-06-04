import { z } from 'zod';

const addressField = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid EVM address');
const hexField = z.string().regex(/^0x[a-fA-F0-9]*$/, 'Must be a valid hex string');

const dcaConfigSchema = z.object({
  type: z.literal('dca'),
  tokenIn: z.object({
    symbol: z.string().min(2).max(20),
    address: addressField,
    decimals: z.number().int().min(0).max(36),
  }),
  tokenOut: z.object({
    symbol: z.string().min(2).max(20),
    address: addressField,
    decimals: z.number().int().min(0).max(36),
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
  allowCustomToken: z.boolean().optional(),
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

// /permissions/check-support
// MetaMask wallet_getSupportedExecutionPermissions returns:
//   { "erc20-token-periodic": { ruleTypes: string[], chainIds: string[] }, ... }
// We also accept string[] for backwards compat.
const walletPermissionTypeDescriptor = z.object({
  ruleTypes: z.array(z.string()).optional(),
  chainIds: z.array(z.string()).optional(),
});
export const checkSupportSchema = z.object({
  userAddress: addressField,
  smartAccountAddress: addressField,
  chainId: z.number().int().positive(),
  skillId: z.string().min(1),
  walletReportedPermissions: z.union([
    z.array(z.string().min(1)),
    z.record(z.string().min(1), walletPermissionTypeDescriptor),
  ]),
});
export type CheckSupportDto = z.infer<typeof checkSupportSchema>;

export const preparePermissionRequestSchema = z.object({
  installationId: z.string().min(1).optional(),
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
});
export type PreparePermissionRequestDto = z.infer<typeof preparePermissionRequestSchema>;

// /permissions/grant
const permissionResponseItemSchema = z.object({
  chainId: z.union([z.string(), z.number()]),
  chainIdHex: hexField.optional(),
  from: addressField.optional(),
  to: addressField.optional(),
  permission: z.record(z.string(), z.unknown()),
  rules: z.array(z.record(z.string(), z.unknown())).optional(),
  context: hexField,
  delegationManager: addressField,
  dependencies: z
    .array(
      z.object({
        factory: addressField.optional(),
        factoryData: hexField.optional(),
      }),
    )
    .optional(),
  isAdjustmentAllowed: z.boolean().optional(),
});

export const submitPermissionGrantSchema = z.object({
  installationId: z.string().min(1),
  permissionResponses: z.array(permissionResponseItemSchema).min(1),
  rawGrantResponse: z.unknown().optional(),
});
export type SubmitPermissionGrantDto = z.infer<typeof submitPermissionGrantSchema>;

// /permissions/dependencies/report
export const reportDependenciesSchema = z.object({
  installationId: z.string().min(1),
  dependencies: z.array(
    z.object({
      chainId: z.number().int().positive(),
      factory: addressField.optional(),
      factoryData: hexField.optional(),
      deployedAddress: addressField.optional(),
      txHash: hexField.optional(),
      status: z.enum(['pending', 'deploying', 'deployed', 'failed', 'not_required']),
      errorMessage: z.string().optional(),
    }),
  ),
});
export type ReportDependenciesDto = z.infer<typeof reportDependenciesSchema>;

// /permissions/revoke
export const revokePermissionSchema = z.object({
  installationId: z.string().min(1),
  reason: z.string().min(1).optional(),
});
export type RevokePermissionDto = z.infer<typeof revokePermissionSchema>;
