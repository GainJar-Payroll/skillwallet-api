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
import type { Skill, DelegationScopeConfig } from '../skills/schemas/skill.schema';

/** Fields stored as hex strings in Mongo that must be re-hydrated to bigint before signing */
const BIGINT_HEX_FIELDS: Array<string | [parent: string, child: string]> = [
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
    const targetAddress = await this.fetchTargetAddress(skill.chainId);
    const scope = this.deserialiseScope(skill.delegationScope);

    return createDelegation({
      to: targetAddress,
      from: viemGetAddress(smartAccountAddress) as `0x${string}`,
      environment,
      salt,
      scope: scope as never,
    });
  }

  validateDelegationShape(
    delegation: Record<string, unknown>,
    expectedSmartAccountAddress: `0x${string}`,
    expectedDelegate?: `0x${string}`,
  ): void {
    if (!delegation.signature || delegation.signature === '0x') {
      throw new Error('Missing delegation signature');
    }

    const delegator = viemGetAddress(delegation.delegator as string);
    if (delegator !== viemGetAddress(expectedSmartAccountAddress)) {
      throw new Error(
        `Delegation delegator mismatch: got=${delegator} expected=${viemGetAddress(expectedSmartAccountAddress)}`,
      );
    }

    if (expectedDelegate) {
      const delegate = viemGetAddress(delegation.delegate as string);
      if (delegate !== viemGetAddress(expectedDelegate)) {
        throw new Error(
          `Delegation delegate mismatch: got=${delegate} expected=${viemGetAddress(expectedDelegate)}`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async fetchTargetAddress(chainId: number): Promise<`0x${string}`> {
    const capabilities = await this.oneShotService.getCapabilities(chainId);
    const chainKey = String(chainId);

    // Response shape: { [chainId]: { targetAddress, feeCollector, ... } }
    const direct = capabilities[chainKey] as { targetAddress?: string } | undefined;
    if (direct?.targetAddress) {
      return viemGetAddress(direct.targetAddress) as `0x${string}`;
    }

    // Fallback: some API versions return { chains: [...] }
    const chains = (capabilities as { chains?: Array<Record<string, unknown>> }).chains ?? [];
    const found = chains.find((c) => String(c.chainId) === chainKey);
    if (typeof found?.targetAddress === 'string') {
      return viemGetAddress(found.targetAddress) as `0x${string}`;
    }

    throw new Error(
      `1Shot capabilities missing targetAddress for chainId=${chainId}: ${JSON.stringify(capabilities)}`,
    );
  }

  /**
   * Re-hydrates bigint fields from their hex-string DB representation
   * back to native bigints before passing the scope to createDelegation().
   */
  private deserialiseScope(stored: DelegationScopeConfig): unknown {
    const scopeType = (ScopeType as unknown as Record<string, string>)[stored.type] ?? stored.type;
    const scope: Record<string, unknown> = { ...stored, type: scopeType };

    for (const field of BIGINT_HEX_FIELDS) {
      if (typeof field === 'string') {
        const val = scope[field];
        if (typeof val === 'string' && val.startsWith('0x')) {
          scope[field] = BigInt(val);
        }
      } else {
        const [parent, child] = field;
        const container = scope[parent] as Record<string, unknown> | undefined;
        if (
          typeof container?.[child] === 'string' &&
          (container[child] as string).startsWith('0x')
        ) {
          container[child] = BigInt(container[child] as string);
        }
      }
    }

    return scope;
  }
}
