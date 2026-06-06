import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { encodeFunctionData, erc20Abi, getAddress } from 'viem';
import { getChainConfig, ChainConfig } from '../../config/chains.config';
import { Skill } from '../skills/schemas/skill.schema';
import { SkillsService } from '../skills/skills.service';
import { InstallationsService } from '../installations/installations.service';
import { OneShotService, OneShotExecution, OneShotStatus } from '../oneshot/oneshot.service';
import { X402Service } from '../x402/x402.service';
import { VeniceService } from '../venice/venice.service';
import { Installation, ExecutionRecord } from '../installations/schemas/installation.schema';
import { SWAP_ROUTER_02_ABI, GM_ABI } from './abis';

const FEE_AMOUNT_ATOMS = 10_000n;

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
  ) {}

  async executeInstallation(installationId: string): Promise<void> {
    const installation = await this.installationsService.findById(installationId);

    if (installation.status !== 'active') return;

    const skillId =
      typeof installation.skillId === 'object' &&
      installation.skillId !== null &&
      '_id' in installation.skillId
        ? String((installation.skillId as { _id: unknown })._id)
        : String(installation.skillId);

    const skill = await this.skillsService.findById(skillId);
    const chainConfig = getChainConfig(installation.chainId);

    let executions: OneShotExecution[];
    let aiContext: string | undefined;
    let newsContext: string | undefined;

    if (this.isDcaSkill(skill)) {
      const result = await this.buildDcaExecutions(installation, chainConfig);
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
      executedAt: new Date(),
      status: 'pending',
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
      record.errorMessage = (err as Error).message;

      await this.installationsService.appendExecution(installationId, record);

      this.logger.error(`1Shot submission failed for ${installationId}: ${(err as Error).message}`);

      return;
    }

    record.oneShotTaskId = taskId;
    record.status = 'submitted';

    await this.installationsService.appendExecution(installationId, record);

    void this.pollAndRecord(installationId, taskId).catch((err) => {
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

    const parameters = installation.parameters ?? {};

    const amountUsdc = BigInt(
      String(parameters['amountPerRun'] ?? parameters['amountUsdc'] ?? '10000000'),
    );

    const tokenOutFromConfig = (parameters['tokenOut'] as { address?: string } | undefined)
      ?.address;

    const outputToken = (parameters['outputToken'] as 'weth' | 'cbBtc' | undefined) ?? 'weth';

    const tokenOut = tokenOutFromConfig
      ? (getAddress(tokenOutFromConfig) as `0x${string}`)
      : outputToken === 'cbBtc'
        ? chainConfig.tokens.cbBtc
        : chainConfig.tokens.weth;

    const feeTier = Number(parameters['feeTier'] ?? 500);

    const recipient = getAddress(
      String(
        parameters['recipient'] ?? installation.smartAccountAddress ?? installation.userAddress,
      ),
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
    installation: Installation,
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

  private isDcaSkill(skill: Skill): boolean {
    return (
      skill.name === 'DCA Daily' || skill.name === 'Generic DCA' || skill.metadata?.kind === 'dca'
    );
  }

  private async pollAndRecord(installationId: string, taskId: `0x${string}`): Promise<void> {
    try {
      const finalStatus: OneShotStatus = await this.oneShotService.poll(taskId);

      await this.installationsService.updateLastExecution(installationId, {
        status: finalStatus.status === 200 ? 'confirmed' : 'failed',
        txHash: finalStatus.hash,
        errorMessage: finalStatus.status !== 200 ? finalStatus.message : undefined,
      });
    } catch (err) {
      await this.installationsService.updateLastExecution(installationId, {
        status: 'failed',
        errorMessage: (err as Error).message,
      });

      this.logger.error(
        `1Shot poll failed for ${installationId} task=${taskId}: ${(err as Error).message}`,
      );
    }
  }
}
