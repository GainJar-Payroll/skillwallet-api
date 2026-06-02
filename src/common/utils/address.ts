import { isAddress } from 'viem';
import { Address } from '../types/evm';

const addressRegex = /^0x[a-fA-F0-9]{40}$/;

export function assertAddress(value: string, fieldName = 'address'): Address {
  if (!addressRegex.test(value) || !isAddress(value)) {
    throw new Error(`${fieldName} must be a valid EVM address`);
  }
  return value as Address;
}

export function normalizeAddress(value: string): Address {
  assertAddress(value);
  return value.toLowerCase() as Address;
}

export function isValidAddress(value: string): boolean {
  return addressRegex.test(value) && isAddress(value);
}
