import { z } from 'zod';
import { addressField } from '../../common/validation/address';

export const createExecutorSchema = z.object({
  adapter: z
    .enum(['multi', 'dca', 'aerodrome-vote', 'lp-keeper', 'x402-research'])
    .default('multi'),
  chainId: z.number().int().positive(),
  executorAddress: addressField,
  delegationManagerAddress: addressField.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CreateExecutorDto = z.infer<typeof createExecutorSchema>;

export const updateExecutorSchema = z.object({
  status: z.enum(['active', 'disabled']).optional(),
  delegationManagerAddress: addressField.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type UpdateExecutorDto = z.infer<typeof updateExecutorSchema>;
