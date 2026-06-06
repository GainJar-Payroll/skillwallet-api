import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { bytesToHex, getAddress as viemGetAddress } from 'viem';
import {
  createDelegation,
  getSmartAccountsEnvironment,
  ScopeType,
  type Delegation,
} from '@metamask/smart-accounts-kit';
import { Skill, DelegationScopeConfig } from '../skills/schemas/skill.schema';

const HEX_BIGINT_FIELDS: Array<string | string[]> = [
  'maxAmount',
  'periodAmount',
  ['valueLte', 'maxValue'],
];

@Injectable()
export class DelegationService {
  generateSalt(): `0x${string}` {
    return bytesToHex(randomBytes(32)) as `0x${string}`;
  }

  prepare(
    skill: Skill,
    delegatorAddress: `0x${string}`,
    salt: `0x${string}`,
    delegateAddress: `0x${string}`,
  ): Delegation {
    const environment = getSmartAccountsEnvironment(skill.chainId);
    const scope = this.deserialiseScope(skill.delegationScope);

    return createDelegation({
      to: viemGetAddress(delegateAddress) as `0x${string}`,
      from: viemGetAddress(delegatorAddress) as `0x${string}`,
      environment,
      salt,
      scope: scope as never,
    });
  }

  deserialiseScope(stored: DelegationScopeConfig): unknown {
    const scopeType = (ScopeType as unknown as Record<string, string>)[stored.type] ?? stored.type;

    const result: Record<string, unknown> = { ...stored, type: scopeType };

    for (const field of HEX_BIGINT_FIELDS) {
      if (typeof field === 'string') {
        const val = result[field];
        if (typeof val === 'string' && val.startsWith('0x')) {
          result[field] = BigInt(val);
        }
      } else {
        const [parent, child] = field;
        const container = result[parent] as Record<string, unknown> | undefined;
        if (
          container &&
          typeof container[child] === 'string' &&
          (container[child] as string).startsWith('0x')
        ) {
          container[child] = BigInt(container[child] as string);
        }
      }
    }

    return result;
  }

  validateDelegationShape(
    delegation: Record<string, unknown>,
    expectedDelegator: `0x${string}`,
    expectedDelegate: `0x${string}`,
  ): void {
    if (!delegation.signature || (delegation.signature as string) === '0x') {
      throw new Error('Missing delegation signature');
    }

    const delegate = viemGetAddress(delegation.delegate as string);
    if (delegate !== viemGetAddress(expectedDelegate)) {
      throw new Error(
        `Delegation delegate mismatch. Expected ${expectedDelegate}, got ${delegate}`,
      );
    }

    const delegator = viemGetAddress(delegation.delegator as string);
    if (delegator !== viemGetAddress(expectedDelegator)) {
      throw new Error(
        `Delegation delegator mismatch. Expected ${expectedDelegator}, got ${delegator}`,
      );
    }
  }
}
