import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { bytesToHex, getAddress as viemGetAddress } from 'viem';
import {
  createDelegation,
  getSmartAccountsEnvironment,
  ScopeType,
  type Delegation,
} from '@metamask/smart-accounts-kit';
import { ExecutorService } from '../executor/executor.service';
import { Skill, DelegationScopeConfig } from '../skills/schemas/skill.schema';

const HEX_BIGINT_FIELDS: Array<string | string[]> = [
  'maxAmount',
  'periodAmount',
  ['valueLte', 'maxValue'],
];

@Injectable()
export class DelegationService {
  constructor(private readonly executorService: ExecutorService) {}

  generateSalt(): `0x${string}` {
    return bytesToHex(randomBytes(32)) as `0x${string}`;
  }

  prepare(
    skill: Skill,
    userAddress: `0x${string}`,
    salt: `0x${string}`,
  ): Delegation {
    const environment = getSmartAccountsEnvironment(skill.chainId);
    const executorAddress = this.executorService.getAddress();

    const scope = this.deserialiseScope(skill.delegationScope);

    return createDelegation({
      to: executorAddress,
      from: userAddress,
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
        if (container && typeof container[child] === 'string' && (container[child] as string).startsWith('0x')) {
          container[child] = BigInt(container[child] as string);
        }
      }
    }
    return result;
  }

  validateDelegationShape(
    delegation: Record<string, unknown>,
    expectedSigner: `0x${string}`,
  ): void {
    if (!delegation.signature || (delegation.signature as string) === '0x') {
      throw new Error('Missing delegation signature');
    }
    const delegate = viemGetAddress(delegation.delegate as string);
    if (delegate !== viemGetAddress(this.executorService.getAddress())) {
      throw new Error('Delegation delegate does not match executor');
    }
    const delegator = viemGetAddress(delegation.delegator as string);
    if (delegator !== viemGetAddress(expectedSigner)) {
      throw new Error('Delegation delegator does not match user');
    }
  }
}
