import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { randomBytes } from 'node:crypto';
import {
  createDelegation,
  Implementation,
  ScopeType,
  toMetaMaskSmartAccount,
} from '@metamask/smart-accounts-kit';
import { createPublicClient, encodeFunctionData, erc20Abi, getAddress, http } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import type { Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bytesToHex } from 'viem/utils';
import { SponsorState, type SponsorStateDocument } from './schemas/sponsor-state.schema';
import { OneShotService, type OneShotExecution } from '../oneshot/oneshot.service';
import { getChainConfig } from '../../config/chains.config';

export interface SponsorContext {
  feeChainId: number;
  permissionContext: unknown[];
  feeExecution: OneShotExecution;
  /**
   * Present only on first use (eip7702Upgraded = false).
   * Caller must include this in the relayer request so the sponsor EOA gets
   * upgraded atomically with the first delegation redemption.
   * After confirmed, recordSuccessfulExecution() clears this requirement.
   */
  authorizationList?: unknown[];
}

const FEE_AMOUNT_ATOMS = 10_000n;

/** 500 fee executions × 10_000 atoms = 50 USDC per delegation cycle */
const DEFAULT_BUDGET_ATOMS = 5_000_000n;

/** Sign a fresh delegation when local spend tracker exceeds this ratio */
const DEFAULT_REFRESH_THRESHOLD = 0.8;

/**
 * Same across Base mainnet and Base Sepolia.
 * Override via STATELESS_DELEGATOR_IMPL_ADDRESS env if needed.
 */
const DEFAULT_STATELESS_IMPL = '0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B' as `0x${string}`;

const VIEM_CHAINS: Record<number, Chain> = {
  84532: baseSepolia,
  8453: base,
};

@Injectable()
export class SponsorService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SponsorService.name);

  private readonly supportedChains: number[] = [84532, 8453];
  private readonly budgetAtoms: bigint;
  private readonly refreshThreshold: number;
  private readonly statelessImplAddress: `0x${string}`;

  constructor(
    @InjectModel(SponsorState.name)
    private readonly stateModel: Model<SponsorStateDocument>,
    private readonly oneShotService: OneShotService,
    private readonly config: ConfigService,
  ) {
    this.budgetAtoms = BigInt(
      this.config.get<string>('sponsorBudgetAtoms') ?? String(DEFAULT_BUDGET_ATOMS),
    );
    this.refreshThreshold = Number(
      this.config.get<string | number>('sponsorRefreshThreshold') ?? DEFAULT_REFRESH_THRESHOLD,
    );
    this.statelessImplAddress =
      (this.config.get<string>('statelessDelegatorImplAddress') as `0x${string}`) ??
      DEFAULT_STATELESS_IMPL;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get<string>('sponsorPrivateKey')) {
      this.logger.warn('SPONSOR_PRIVATE_KEY not configured — dapp-sponsored gas disabled');
      return;
    }
    for (const chainId of this.supportedChains) {
      try {
        await this.ensureReady(chainId);
      } catch (err) {
        // Non-fatal: 1Shot may not support this chain in current environment
        this.logger.warn(`Sponsor bootstrap skipped for chainId=${chainId}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Returns the sponsor's permission context + fee execution to embed in the relayer bundle,
   * or null when sponsorship is not configured for the fee chain.
   */
  async getSponsorContext(installationChainId: number): Promise<SponsorContext | null> {
    const feeChainId = installationChainId;
    if (!this.supportedChains.includes(feeChainId)) return null;

    const state = await this.stateModel.findOne({ chainId: feeChainId }).lean().exec();
    if (!state) return null;

    const ctx: SponsorContext = {
      feeChainId,
      permissionContext: [OneShotService.toRelayerJson(state.signedDelegation)],
      feeExecution: this.buildFeeExecution(state.feeCollector as `0x${string}`, feeChainId),
    };

    if (!state.eip7702Upgraded) {
      ctx.authorizationList = await this.buildAuthorizationList(feeChainId);
    }

    return ctx;
  }

  /**
   * Call after a sponsored bundle is confirmed on-chain.
   * Marks EIP-7702 upgrade done and increments the local spend counter.
   * Triggers a background delegation refresh if budget is running low.
   */
  async recordSuccessfulExecution(chainId: number): Promise<void> {
    const state = await this.stateModel.findOne({ chainId }).exec();
    if (!state) return;

    if (!state.eip7702Upgraded) {
      state.eip7702Upgraded = true;
    }

    const used = BigInt(state.usedAmountAtoms) + FEE_AMOUNT_ATOMS;
    state.usedAmountAtoms = used.toString();
    await state.save();

    const ratio = Number(used) / Number(BigInt(state.maxAmountAtoms));
    this.logger.debug(`Sponsor budget ${(ratio * 100).toFixed(1)}% used chainId=${chainId}`);

    if (ratio >= this.refreshThreshold) {
      this.logger.log(
        `Sponsor budget at ${(ratio * 100).toFixed(0)}% — refreshing delegation in background`,
      );
      void this.signAndPersistDelegation(chainId).catch((err: Error) => {
        this.logger.error(`Delegation refresh failed for chainId=${chainId}: ${err.message}`);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async ensureReady(chainId: number): Promise<void> {
    const existing = await this.stateModel.findOne({ chainId }).lean().exec();

    if (existing) {
      const ratio =
        Number(BigInt(existing.usedAmountAtoms)) / Number(BigInt(existing.maxAmountAtoms));

      if (ratio < this.refreshThreshold) {
        this.logger.log(
          `Sponsor ready chainId=${chainId} address=${existing.sponsorAddress} (${(ratio * 100).toFixed(0)}% used)`,
        );
        return;
      }

      this.logger.log(`Budget at ${(ratio * 100).toFixed(0)}% — refreshing on startup`);
    }

    await this.signAndPersistDelegation(chainId);
  }

  private async signAndPersistDelegation(chainId: number): Promise<void> {
    const pk = this.config.get<string>('sponsorPrivateKey')!;
    const account = privateKeyToAccount(pk as `0x${string}`);
    const publicClient = this.makePublicClient(chainId);

    const smartAccount = await toMetaMaskSmartAccount({
      client: publicClient as Parameters<typeof toMetaMaskSmartAccount>[0]['client'],
      implementation: Implementation.Stateless7702,
      address: account.address,
      signer: { account },
    });

    const capabilities = await this.oneShotService.getCapabilities(chainId);
    const chainInfo = capabilities[String(chainId)] as
      | { targetAddress?: string; feeCollector?: string }
      | undefined;

    if (!chainInfo?.targetAddress || !chainInfo.feeCollector) {
      throw new Error(`1Shot missing targetAddress/feeCollector for chainId=${chainId}`);
    }

    const chainConfig = getChainConfig(chainId);
    const salt = bytesToHex(Uint8Array.from(randomBytes(32))) as `0x${string}`;

    const delegation = createDelegation({
      to: getAddress(chainInfo.targetAddress) as `0x${string}`,
      from: smartAccount.address,
      environment: smartAccount.environment,
      salt,
      scope: {
        type: ScopeType.Erc20TransferAmount,
        tokenAddress: chainConfig.tokens.usdc,
        maxAmount: this.budgetAtoms,
      },
    });

    const signature = await smartAccount.signDelegation({ delegation });

    // Preserve eip7702Upgraded across refreshes — if already upgraded, keep it true
    const current = await this.stateModel.findOne({ chainId }).lean().exec();

    await this.stateModel.findOneAndUpdate(
      { chainId },
      {
        $set: {
          chainId,
          sponsorAddress: account.address,
          feeCollector: getAddress(chainInfo.feeCollector),
          targetAddress: getAddress(chainInfo.targetAddress),
          signedDelegation: OneShotService.toRelayerJson({
            ...delegation,
            signature,
          }) as Record<string, unknown>,
          maxAmountAtoms: this.budgetAtoms.toString(),
          usedAmountAtoms: '0',
          eip7702Upgraded: current?.eip7702Upgraded ?? false,
          lastRefreshedAt: new Date(),
        },
      },
      { upsert: true, new: true },
    );

    this.logger.log(`Sponsor delegation signed chainId=${chainId} address=${account.address}`);
  }

  private async buildAuthorizationList(chainId: number): Promise<unknown[]> {
    const pk = this.config.get<string>('sponsorPrivateKey')!;
    const account = privateKeyToAccount(pk as `0x${string}`);
    const publicClient = this.makePublicClient(chainId);

    const nonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: 'pending',
    });

    const signed = await account.signAuthorization({
      chainId,
      contractAddress: this.statelessImplAddress,
      nonce,
    });

    const { address, chainId: sigChainId, nonce: authNonce, r, s, yParity } = signed;
    return [{ address, chainId: sigChainId, nonce: authNonce, r, s, yParity }];
  }

  private buildFeeExecution(feeCollector: `0x${string}`, chainId: number): OneShotExecution {
    const chainConfig = getChainConfig(chainId);
    return {
      target: chainConfig.tokens.usdc,
      value: '0',
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [feeCollector, FEE_AMOUNT_ATOMS],
      }),
    };
  }

  private makePublicClient(chainId: number) {
    const chain = VIEM_CHAINS[chainId];
    if (!chain) throw new Error(`No viem chain config for chainId=${chainId}`);

    const rpcUrl =
      chainId === 8453
        ? this.config.get<string>('baseMainnetRpcUrl')
        : this.config.get<string>('baseSepoliaRpcUrl');

    return createPublicClient({ chain, transport: http(rpcUrl) });
  }
}
