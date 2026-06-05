import { z } from 'zod';
import { skillConfigSchema } from '../../runtime/adapters/skill-adapter.interface';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const isNonZeroAddress = (value: string) => value.toLowerCase() !== ZERO_ADDRESS;
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hex32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const hexSchema = z.string().regex(/^0x[0-9a-fA-F]*$/);
const selectorSchema = z.string().regex(/^0x[0-9a-fA-F]{8}$/);
const uintStringSchema = z.string().regex(/^[0-9]+$/);

export const delegationScopeSchema = z.object({
  type: z.literal('function-call'),
  targets: z.array(addressSchema).min(1),
  selectors: z.array(selectorSchema).min(1),
  valueLte: z.object({ maxValue: z.literal('0x0') }),
});

export const prepareSnapshotSchema = z.object({
  skillId: z.string().min(1),
  adapter: z.enum(['direct-router-dca', 'gm-self-call']),
  chainId: z.number().int().positive(),
  smartAccountAddress: addressSchema.refine(isNonZeroAddress),
  delegate: addressSchema,
  feeCollector: addressSchema,
  paymentToken: addressSchema,
  requiredPaymentAmount: uintStringSchema,
  amountOut: uintStringSchema.optional(),
  minAmountOut: uintStringSchema.optional(),
  delegationScope: delegationScopeSchema,
  configSnapshot: skillConfigSchema,
  review: z.record(z.string(), z.string()).optional(),
  expiresAt: z.string().datetime(),
});

export const signedDelegationSchema = z.object({
  delegate: addressSchema,
  delegator: addressSchema,
  authority: hex32Schema,
  caveats: z
    .array(
      z.object({
        enforcer: addressSchema,
        terms: hexSchema,
        args: hexSchema,
      }),
    )
    .default([]),
  salt: hex32Schema,
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
});

const rawMetaSchema = z
  .object({
    source: z.string().optional(),
    sdk: z.string().optional(),
    flow: z.string().optional(),
  })
  .optional();

export const grantInstallationSchema = z.object({
  userAddress: addressSchema,
  smartAccountAddress: addressSchema.refine(isNonZeroAddress, {
    message: 'smartAccountAddress must not be the zero address',
  }),
  chainId: z.number().int().positive(),
  permissionPath: z.literal('low-level-function-call-delegation'),
  prepareSnapshot: prepareSnapshotSchema,
  signedDelegation: signedDelegationSchema,
  // Backward compatibility for old 1Shot bundle-shaped callers.
  permissionContext: z.array(signedDelegationSchema).optional(),
  raw: rawMetaSchema,
});

export type GrantInstallationInput = z.infer<typeof grantInstallationSchema>;
export type PrepareSnapshot = z.infer<typeof prepareSnapshotSchema>;
export type SignedDelegation = z.infer<typeof signedDelegationSchema>;
