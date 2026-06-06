import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { encodeFunctionData, erc20Abi, getAddress } from 'viem';
import { getChainConfig, ChainConfig } from '../../config/chains.config';
import { Skill } from '../skills/schemas/skill.schema';
import { SkillsService } from '../skills/skills.service';
import { InstallationsService } from '../installations/installations.service';
import { OneShotExecution, OneShotService, OneShotStatus } from '../oneshot/oneshot.service';
import { X402Service } from '../x402/x402.service';
import { VeniceService } from '../venice/venice.service';
import {
  ExecutionRecord,
  ExecutionSpendRecord,
  ExecutionTriggerRecord,
  Installation,
} from '../installations/schemas/installation.schema';
import { GM_ABI, SWAP_ROUTER_02_ABI } from './abis';
import { detectDcaExecution, normalizeSkillExecution } from '../skills/skill-config.util';
import { SpendReservationsService } from '../spend-reservations/spend-reservations.service';

const FEE_AMOUNT_ATOMS = 10_000n;

export interface ExecuteInstallationContext {
  trigger?: ExecutionTriggerRecord;
  spend?: ExecutionSpendRecord & { skippedReason?: string };
}

@Injectable()
export class RunnerService {
  private readonly logger = new Logger(RunnerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly skillsService: SkillsService,
    private readonly installationsService: InstallationsService,
    private readonly oneShotService: OneShotService,
    private readonly x402Service: X402Service,
    private readonly veniceService: VeniceService,
    private readonly spendReservationsService: SpendReservationsService,
  ) {}

  async executeInstallation(
    installationId: string,
    context: ExecuteInstallationContext = {},
  ): Promise<void> {
    const installation = await this.installationsService.findById(installationId);

    if (installation.status !== 'active') return;

    const skillId =
      typeof installation.skillId === 'object' &&
      installation.skillId !== null &&
      'skillId' in installation.skillId
        ? String((installation.skillId as { skillId: unknown }).skillId)
        : String(installation.skillId);

    const skill = await this.skillsService.findById(skillId);
    const chainConfig = getChainConfig(installation.chainId);

    let executions: OneShotExecution[];
    let aiContext: string | undefined;
    let newsContext: string | undefined;
    const execution = normalizeSkillExecution(skill);

    if (execution?.kind === 'dca-uniswap-v3' || detectDcaExecution(skill)) {
      const result = await this.buildDcaExecutions(installation, chainConfig, {
        amountIn: context.spend?.actualAmount,
        feeTier:
          typeof execution?.defaultFeeTier === 'number' ? Number(execution.defaultFeeTier) : undefined,
      });
      executions = result.executions;
      aiContext = result.aiContext;
      newsContext = result.newsContext;
    } else if (skill.name === 'GM Everyday') {
      executions = await this.buildGmExecutions(installation, chainConfig);
    } else {
      throw new Error(`Unknown skill: ${skill.name}`);
    }

    const capabilities = await this.oneShotService.getCapabilities(installation.chainId);
    const chainKey = String(installation.chainId);

    const chainInfo = capabilities[chainKey] as
      | { feeCollector?: `0x${string}`; targetAddress?: `0x${string}` }
      | undefined;

    const feeCollector = chainInfo?.feeCollector;

    if (!feeCollector) {
      throw new Error(`1Shot does not support chainId ${installation.chainId}`);
    }

    const feeTransfer = this.buildFeeTransfer(chainConfig, feeCollector);
    const allExecutions = [feeTransfer, ...executions];

    const record: ExecutionRecord = {
      executionId: randomUUID(),
      executedAt: new Date(),
      status: 'pending',
      trigger: context.trigger,
      spend: context.spend,
      aiContext,
      newsContext,
    };

    let taskId: `0x${string}`;

    try {
      const sendParams = {
        chainId: String(installation.chainId),
        transactions: [
          {
            permissionContext: [OneShotService.toRelayerJson(installation.signedDelegation)],
            executions: allExecutions,
          },
        ],
      };

      this.logger.log(`Submitting 1Shot transaction for installation ${installationId}`);
      this.logger.debug(JSON.stringify(sendParams, null, 2));

      taskId = await this.oneShotService.send7710Transaction(sendParams);
    } catch (err) {
      record.status = 'failed';
      record.completedAt = new Date();
      record.errorMessage = (err as Error).message;

      if (context.spend?.reservationId) {
        await this.spendReservationsService.releaseReservation(context.spend.reservationId);
      }

      await this.installationsService.appendExecution(installationId, record);

      this.logger.error(`1Shot submission failed for ${installationId}: ${(err as Error).message}`);

      return;
    }

    record.oneShotTaskId = taskId;
    record.status = 'submitted';

    await this.installationsService.appendExecution(installationId, record);

    void this.pollAndRecord(
      installationId,
      record.executionId!,
      taskId,
      context.spend?.reservationId,
    ).catch((err) => {
      this.logger.error(`1Shot polling failed for ${installationId}: ${(err as Error).message}`);
    });
  }

  buildFeeTransfer(chainConfig: ChainConfig, feeCollector: `0x${string}`): OneShotExecution {
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

  async buildDcaExecutions(
    installation: Installation,
    chainConfig: ChainConfig,
    options: { amountIn?: string; feeTier?: number } = {},
  ): Promise<{
    executions: OneShotExecution[];
    aiContext?: string;
    newsContext?: string;
  }> {
    let newsContext = '';
    let aiContext = '';

    try {
      const news = await this.x402Service.fetch<{
        headlines?: string;
        content?: string;
      }>(this.config.get<string>('ottoAiNewsUrl')!);

      newsContext = news.headlines ?? news.content ?? JSON.stringify(news).slice(0, 500);
      aiContext = await this.veniceService.summariseMarketContext(newsContext);
    } catch (err) {
      this.logger.warn(`DCA context enrichment failed: ${(err as Error).message}`);
    }

    if (!installation.smartAccountAddress) {
      throw new Error(
        `Installation ${String((installation as any)._id)} has no smartAccountAddress`,
      );
    }

    const parameters = installation.parameters ?? {};

    const amountUsdc = BigInt(
      String(options.amountIn ?? parameters['amountPerRun'] ?? parameters['amountUsdc'] ?? '10000000'),
    );

    const tokenOutFromConfig = (parameters['tokenOut'] as { address?: string } | undefined)
      ?.address;

    const outputToken = (parameters['outputToken'] as 'weth' | 'cbBtc' | undefined) ?? 'weth';

    const tokenOut = tokenOutFromConfig
      ? (getAddress(tokenOutFromConfig) as `0x${string}`)
      : outputToken === 'cbBtc'
        ? chainConfig.tokens.cbBtc
        : chainConfig.tokens.weth;

    const feeTier = Number(options.feeTier ?? parameters['feeTier'] ?? 500);

    const recipient = getAddress(
      String(parameters['recipient'] ?? installation.smartAccountAddress),
    ) as `0x${string}`;

    const approveCalldata = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [chainConfig.dex.swapRouter02, amountUsdc],
    });

    const swapCalldata = encodeFunctionData({
      abi: SWAP_ROUTER_02_ABI,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn: chainConfig.tokens.usdc,
          tokenOut,
          fee: feeTier,
          recipient,
          amountIn: amountUsdc,
          amountOutMinimum: 0n,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });

    return {
      executions: [
        {
          target: chainConfig.tokens.usdc,
          value: '0',
          data: approveCalldata,
        },
        {
          target: chainConfig.dex.swapRouter02,
          value: '0',
          data: swapCalldata,
        },
      ],
      aiContext,
      newsContext,
    };
  }

  async buildGmExecutions(
    _installation: Installation,
    chainConfig: ChainConfig,
  ): Promise<OneShotExecution[]> {
    const gmCalldata = encodeFunctionData({
      abi: GM_ABI,
      functionName: 'gm',
      args: [],
    });

    return [
      {
        target: chainConfig.skillContracts.gmContract,
        value: '0',
        data: gmCalldata,
      },
    ];
  }

  private async pollAndRecord(
    installationId: string,
    executionId: string,
    taskId: `0x${string}`,
    reservationId?: string,
  ): Promise<void> {
    try {
      const finalStatus: OneShotStatus = await this.oneShotService.poll(taskId);

      if (reservationId) {
        if (finalStatus.status === 200) {
          await this.spendReservationsService.confirmReservation(reservationId);
        } else {
          await this.spendReservationsService.releaseReservation(reservationId);
        }
      }

      await this.installationsService.updateExecution(installationId, executionId, {
        status: finalStatus.status === 200 ? 'confirmed' : 'failed',
        completedAt: new Date(),
        txHash: finalStatus.hash,
        errorMessage: finalStatus.status !== 200 ? finalStatus.message : undefined,
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

      this.logger.error(
        `1Shot poll failed for ${installationId} task=${taskId}: ${(err as Error).message}`,
      );
    }
  }
}
