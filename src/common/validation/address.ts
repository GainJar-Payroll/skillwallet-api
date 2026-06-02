import { z } from 'zod';

export const addressField = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid EVM address');
export const hexField = z.string().regex(/^0x[a-fA-F0-9]*$/, 'Must be a valid hex string');