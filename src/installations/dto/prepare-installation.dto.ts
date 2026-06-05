import { z } from 'zod';
import { skillConfigSchema } from '../../runtime/adapters/skill-adapter.interface';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const isNonZeroAddress = (value: string) => value.toLowerCase() !== ZERO_ADDRESS;
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export const prepareInstallationSchema = z.object({
  userAddress: addressSchema,
  smartAccountAddress: addressSchema.refine(isNonZeroAddress, {
    message: 'smartAccountAddress must not be the zero address',
  }),
  chainId: z.number().int().positive(),
  skillId: z.string().min(1),
  // Backward compatibility while old clients move from skillType to skillId+catalog lookup.
  skillType: z.string().min(1).optional(),
  config: skillConfigSchema,
});

export type PrepareInstallationInput = z.infer<typeof prepareInstallationSchema>;
