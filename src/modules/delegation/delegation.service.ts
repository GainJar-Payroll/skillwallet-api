import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { bytesToHex, getAddress as viemGetAddress } from 'viem';
import {
  createDelegation,
  getSmartAccountsEnvironment,
  ScopeType,
  type Delegation,
} from '@metamask/smart-accounts-kit';
import { OneShotService } from '../oneshot/oneshot.service';
import { Skill, DelegationScopeConfig } from '../skills/schemas/skill.schema';

const HEX_BIGINT_FIELDS: Array<string | string[]> = [
  'maxAmount',
  'periodAmount',
  ['valueLte', 'maxValue'],
];

@Injectable()
export class DelegationService {
  constructor(private readonly oneShotService: OneShotService) {}

  generateSalt(): `0x${string}` {
    return bytesToHex(randomBytes(32)) as `0x${string}`;
  }

  async prepare(
    skill: Skill,
    smartAccountAddress: `0x${string}`,
    salt: `0x${string}`,
  ): Promise<Delegation> {
    const environment = getSmartAccountsEnvironment(skill.chainId);
    const oneShotTargetAddress = await this.getOneShotTargetAddress(skill.chainId);

    const scope = this.deserialiseScope(skill.delegationScope);

    return createDelegation({
      to: oneShotTargetAddress,
      from: viemGetAddress(smartAccountAddress) as `0x${string}`,
      environment,
      salt,
      scope: scope as never,
    });
  }

  async getOneShotTargetAddress(chainId: number): Promise<`0x${string}`> {
    const capabilities = await this.oneShotService.getCapabilities(chainId);
    const chainKey = String(chainId);

    const direct = capabilities?.[chainKey] as
      | {
          targetAddress?: string;
          feeCollector?: string;
          tokens?: unknown[];
        }
      | undefined;

    if (direct?.targetAddress) {
      return viemGetAddress(direct.targetAddress) as `0x${string}`;
    }

    const chains = (capabilities as { chains?: Array<Record<string, unknown>> })?.chains ?? [];
    const found = chains.find((item) => String(item.chainId) === chainKey);

    if (typeof found?.targetAddress === 'string') {
      return viemGetAddress(found.targetAddress) as `0x${string}`;
    }

    throw new Error(
      `1Shot capabilities missing targetAddress for chainId=${chainId}: ${JSON.stringify(
        capabilities,
      )}`,
    );
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
    expectedSmartAccountAddress: `0x${string}`,
    expectedDelegate?: `0x${string}`,
  ): void {
    if (!delegation.signature || (delegation.signature as string) === '0x') {
      throw new Error('Missing delegation signature');
    }

    const delegator = viemGetAddress(delegation.delegator as string);
    const expectedDelegator = viemGetAddress(expectedSmartAccountAddress);

    if (delegator !== expectedDelegator) {
      throw new Error(
        `Delegation delegator does not match smartAccountAddress. got=${delegator}, expected=${expectedDelegator}`,
      );
    }

    if (expectedDelegate) {
      const delegate = viemGetAddress(delegation.delegate as string);
      const expected = viemGetAddress(expectedDelegate);

      if (delegate !== expected) {
        throw new Error(
          `Delegation delegate does not match 1Shot targetAddress. got=${delegate}, expected=${expected}`,
        );
      }
    }
  }
}
