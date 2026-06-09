import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { encodeFunctionData, erc20Abi, getAddress } from 'viem';
import { getChainConfig, type ChainConfig } from '../../config/chains.config';
import { SkillsService } from '../skills/skills.service';
import { InstallationsService } from '../installations/installations.service';
import {
  OneShotService,
  type OneShotExecution,
  type OneShotTransaction,
} from '../oneshot/oneshot.service';
import { SponsorService, type SponsorContext } from '../sponsor/sponsor.service';
import { SpendReservationsService } from '../spend-reservations/spend-reservations.service';
import {
  type ExecutionRecord,
  type ExecutionSpendRecord,
  type ExecutionTriggerRecord,
  type Installation,
} from '../installations/schemas/installation.schema';
import type { Skill } from '../skills/schemas/skill.schema';
import { GM_ABI, SWAP_ROUTER_02_ABI } from './abis';

const FEE_AMOUNT_ATOMS = 10_000n;

export interface ExecutionContext {
  trigger?: ExecutionTriggerRecord;
  spend?: ExecutionSpendRecord & { skippedReason?: string };
}

@Injectable()
export class RunnerService {
  private readonly logger = new Logger(RunnerService.name);

  constructor(
    private readonly skillsService: SkillsService,
    private readonly installationsService: InstallationsService,
    private readonly oneShotService: OneShotService,
    private readonly sponsorService: SponsorService,
    private readonly spendReservationsService: SpendReservationsService,
  ) {}

  async executeInstallation(installationId: string, ctx: ExecutionContext = {}): Promise<void> {
    const installation = await this.installationsService.findById(installationId);
    if (installation.status !== 'active') return;

    const skill = await this.resolveSkill(installation);
    const chainConfig = getChainConfig(installation.chainId);
    const feeCollector = await this.fetchFeeCollector(installation.chainId);
    const sponsorCtx = await this.sponsorService.getSponsorContext();
    const workExecutions = this.buildWorkExecutions(skill, installation, chainConfig);

    const record = this.initRecord(ctx);

    let taskId: `0x${string}`;
    try {
      taskId = await this.submitBundle({
        installation,
        chainConfig,
        workExecutions,
        feeCollector,
        sponsorCtx,
      });
    } catch (err) {
      await this.recordFailure(installationId, record, err as Error, ctx.spend?.reservationId);
      return;
    }

    record.oneShotTaskId = taskId;
    record.status = 'submitted';
    await this.installationsService.appendExecution(installationId, record);

    void this.pollAndFinalize(
      installationId,
      record.executionId!,
      taskId,
      Boolean(sponsorCtx),
      ctx.spend?.reservationId,
    ).catch((err: Error) => {
      this.logger.error(`Poll failed installation=${installationId}: ${err.message}`);
    });
  }

  // ---------------------------------------------------------------------------
  // Bundle submission
  // ---------------------------------------------------------------------------

  private async submitBundle(params: {
    installation: Installation;
    chainConfig: ChainConfig;
    workExecutions: OneShotExecution[];
    feeCollector: `0x${string}`;
    sponsorCtx: SponsorContext | null;
  }): Promise<`0x${string}`> {
    const { installation, chainConfig, workExecutions, feeCollector, sponsorCtx } = params;
    const userPermissionContext = [OneShotService.toRelayerJson(installation.signedDelegation)];

    if (sponsorCtx && sponsorCtx.feeChainId !== installation.chainId) {
      return this.submitMultichain({
        sponsorCtx,
        userPermissionContext,
        workExecutions,
        skillChainId: installation.chainId,
      });
    }

    const transactions: OneShotTransaction[] = sponsorCtx
      ? [
          // Sponsor pays fee from their account; user's delegation covers only work
          {
            permissionContext: sponsorCtx.permissionContext,
            executions: [sponsorCtx.feeExecution],
          },
          { permissionContext: userPermissionContext, executions: workExecutions },
        ]
      : [
          // No sponsor: fee + work both from the user's smart account
          {
            permissionContext: userPermissionContext,
            executions: [
              this.buildFeeTransfer(chainConfig.tokens.usdc, feeCollector),
              ...workExecutions,
            ],
          },
        ];

    return this.oneShotService.send7710Transaction({
      chainId: String(installation.chainId),
      transactions,
      ...(sponsorCtx?.authorizationList && { authorizationList: sponsorCtx.authorizationList }),
    });
  }

  private async submitMultichain(params: {
    sponsorCtx: SponsorContext;
    userPermissionContext: unknown[];
    workExecutions: OneShotExecution[];
    skillChainId: number;
  }): Promise<`0x${string}`> {
    const { sponsorCtx, userPermissionContext, workExecutions, skillChainId } = params;

    const taskIds = await this.oneShotService.send7710TransactionMultichain([
      {
        chainId: String(sponsorCtx.feeChainId),
        transactions: [
          {
            permissionContext: sponsorCtx.permissionContext,
            executions: [sponsorCtx.feeExecution],
          },
        ],
        ...(sponsorCtx.authorizationList && { authorizationList: sponsorCtx.authorizationList }),
      },
      {
        chainId: String(skillChainId),
        transactions: [{ permissionContext: userPermissionContext, executions: workExecutions }],
      },
    ]);

    // taskIds[0] = fee chain, taskIds[1] = work chain
    this.logger.debug(`Multichain bundle submitted feeTask=${taskIds[0]} workTask=${taskIds[1]}`);
    return taskIds[1] as `0x${string}`;
  }

  // ---------------------------------------------------------------------------
  // Work execution building
  // ---------------------------------------------------------------------------

  /**
   * Builds the skill-specific on-chain calls (everything except the fee transfer).
   *
   * TODO: Replace skillId-prefix dispatch with skill-defined execution templates
   *       so new skills can be added without touching this service.
   */
  private buildWorkExecutions(
    skill: Skill,
    installation: Installation,
    chainConfig: ChainConfig,
  ): OneShotExecution[] {
    if (skill.skillId.includes('dca')) {
      return this.buildDcaExecutions(installation, chainConfig);
    }
    if (skill.skillId.includes('gm')) {
      return this.buildGmExecutions(chainConfig);
    }
    this.logger.warn(`No work execution builder for skillId=${skill.skillId}`);
    return [];
  }

  private buildDcaExecutions(
    installation: Installation,
    chainConfig: ChainConfig,
  ): OneShotExecution[] {
    const params = installation.parameters ?? {};
    const amountIn = BigInt(String(params['amountPerRun'] ?? params['amountUsdc'] ?? '10000000'));
    const outputToken = (params['outputToken'] as 'weth' | 'cbBtc' | undefined) ?? 'weth';
    const tokenOut = outputToken === 'cbBtc' ? chainConfig.tokens.cbBtc : chainConfig.tokens.weth;
    const feeTier = Number(params['feeTier'] ?? 500);
    const recipient = getAddress(
      String(params['recipient'] ?? installation.smartAccountAddress),
    ) as `0x${string}`;

    return [
      {
        target: chainConfig.tokens.usdc,
        value: '0',
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [chainConfig.dex.swapRouter02, amountIn],
        }),
      },
      {
        target: chainConfig.dex.swapRouter02,
        value: '0',
        data: encodeFunctionData({
          abi: SWAP_ROUTER_02_ABI,
          functionName: 'exactInputSingle',
          args: [
            {
              tokenIn: chainConfig.tokens.usdc,
              tokenOut,
              fee: feeTier,
              recipient,
              amountIn,
              amountOutMinimum: 0n,
              sqrtPriceLimitX96: 0n,
            },
          ],
        }),
      },
    ];
  }

  private buildGmExecutions(chainConfig: ChainConfig): OneShotExecution[] {
    return [
      {
        target: chainConfig.skillContracts.gmContract,
        value: '0',
        data: encodeFunctionData({ abi: GM_ABI, functionName: 'gm', args: [] }),
      },
    ];
  }

  private buildFeeTransfer(usdc: `0x${string}`, feeCollector: `0x${string}`): OneShotExecution {
    return {
      target: usdc,
      value: '0',
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [feeCollector, FEE_AMOUNT_ATOMS],
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async resolveSkill(installation: Installation): Promise<Skill> {
    const populated = installation.skillId as unknown;

    // findById() populates skillId — if it's already the full doc, use it directly
    if (typeof populated === 'object' && populated !== null && 'skillId' in (populated as object)) {
      return populated as Skill;
    }

    return this.skillsService.findById(String(populated));
  }

  private async fetchFeeCollector(chainId: number): Promise<`0x${string}`> {
    const capabilities = await this.oneShotService.getCapabilities(chainId);
    const chainInfo = capabilities[String(chainId)] as { feeCollector?: string } | undefined;

    if (!chainInfo?.feeCollector) {
      throw new Error(`1Shot does not support chainId=${chainId}`);
    }

    return chainInfo.feeCollector as `0x${string}`;
  }

  private initRecord(ctx: ExecutionContext): ExecutionRecord {
    return {
      executionId: randomUUID(),
      executedAt: new Date(),
      status: 'pending',
      trigger: ctx.trigger,
      spend: ctx.spend,
    };
  }

  private async recordFailure(
    installationId: string,
    record: ExecutionRecord,
    err: Error,
    reservationId?: string,
  ): Promise<void> {
    record.status = 'failed';
    record.completedAt = new Date();
    record.errorMessage = err.message;

    if (reservationId) {
      await this.spendReservationsService.releaseReservation(reservationId);
    }

    await this.installationsService.appendExecution(installationId, record);
    this.logger.error(`Submission failed installation=${installationId}: ${err.message}`);
  }

  private async pollAndFinalize(
    installationId: string,
    executionId: string,
    taskId: `0x${string}`,
    isSponsored: boolean,
    reservationId?: string,
  ): Promise<void> {
    try {
      const finalStatus = await this.oneShotService.poll(taskId);
      const confirmed = finalStatus.status === 200;

      if (reservationId) {
        confirmed
          ? await this.spendReservationsService.confirmReservation(reservationId)
          : await this.spendReservationsService.releaseReservation(reservationId);
      }

      if (confirmed && isSponsored) {
        void this.sponsorService.recordSuccessfulExecution().catch((err: Error) => {
          this.logger.warn(`Failed to record sponsor spend: ${err.message}`);
        });
      }

      await this.installationsService.updateExecution(installationId, executionId, {
        status: confirmed ? 'confirmed' : 'failed',
        completedAt: new Date(),
        txHash: finalStatus.hash,
        errorMessage: confirmed ? undefined : finalStatus.message,
      });
    } catch (err) {
      if (reservationId) {
        await this.spendReservationsService.releaseReservation(reservationId);
      }
      await this.installationsService.updateExecution(installationId, executionId, {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: (err as Error).message,
      });
      throw err;
    }
  }
}
