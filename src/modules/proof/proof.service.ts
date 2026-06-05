import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { keccak256, getAddress, encodePacked } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  toMetaMaskSmartAccount,
  Implementation,
} from '@metamask/smart-accounts-kit';
import { ExecutorService } from '../executor/executor.service';
import { Skill } from '../skills/schemas/skill.schema';
import { SkillsService } from '../skills/skills.service';
import { DelegationService } from '../delegation/delegation.service';
import { OneShotService, OneShotStatus, OneShotExecution } from '../oneshot/oneshot.service';
import { X402Service } from '../x402/x402.service';
import { VeniceService } from '../venice/venice.service';
import { RunnerService } from '../runner/runner.service';
import { getChainConfig } from '../../config/chains.config';

export interface ProofRunResult {
  delegatorAddress: string;
  executorAddress: string;
  skillName: string;
  chainId: number;
  delegationHash: string;
  oneShotTaskId: string;
  finalStatus: OneShotStatus;
  aiContext?: string;
  newsContext?: string;
  timestamp: string;
}

@Injectable()
export class ProofService {
  private readonly logger = new Logger(ProofService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly executorService: ExecutorService,
    private readonly skillsService: SkillsService,
    private readonly delegationService: DelegationService,
    private readonly oneShotService: OneShotService,
    private readonly x402Service: X402Service,
    private readonly veniceService: VeniceService,
    private readonly runnerService: RunnerService,
  ) {}

  async runProof(): Promise<ProofRunResult> {
    const pk = this.config.get<`0x${string}`>('proofDelegatorPrivateKey');
    if (!pk) {
      throw new ServiceUnavailableException(
        'PROOF_DELEGATOR_PRIVATE_KEY not configured',
      );
    }

    const account = privateKeyToAccount(pk);
    const delegatorAddress = getAddress(account.address);
    const chainId = (this.config.get<number>('defaultChainId') ?? 84532) as number;
    const publicClient = this.executorService.getPublicClient(chainId);

    const smartAccount = await toMetaMaskSmartAccount({
      client: publicClient,
      implementation: Implementation.Stateless7702,
      address: account.address,
      signer: { account },
    });

    const activeSkills = await this.skillsService.findAll(true);
    const skill = activeSkills.find(
      (s) => this.isDcaSkill(s) && s.chainId === chainId,
    ) ?? activeSkills.find((s) => s.chainId === chainId);

    if (!skill) {
      throw new ServiceUnavailableException('No active skill available for proof run');
    }

    const salt = this.delegationService.generateSalt();
    const unsigned = this.delegationService.prepare(
      skill,
      delegatorAddress,
      salt,
    ) as unknown as Record<string, unknown>;

    const signedDelegation = await smartAccount.signDelegation({
      delegation: unsigned as never,
    });

    const chainConfig = getChainConfig(chainId);

    let newsContext: string | undefined;
    let aiContext: string | undefined;
    if (this.isDcaSkill(skill)) {
      try {
        const news = await this.x402Service.fetch<{ headlines?: string; content?: string }>(
          this.config.get<string>('ottoAiNewsUrl')!,
        );
        newsContext = news.headlines ?? news.content ?? JSON.stringify(news).slice(0, 500);
        aiContext = await this.veniceService.summariseMarketContext(newsContext);
      } catch (err) {
        this.logger.warn(`Proof context enrichment failed: ${(err as Error).message}`);
      }
    }

    let executions: OneShotExecution[] = [];
    if (this.isDcaSkill(skill)) {
      const built = await this.runnerService.buildDcaExecutions(
        {
          userAddress: delegatorAddress,
          parameters: skill.parameters?.reduce(
            (acc, p) => ({ ...acc, [p.key]: p.defaultValue ?? null }),
            {},
          ) ?? { amountUsdc: '10000000', outputToken: 'weth' },
        } as never,
        chainConfig,
      );
      executions = built.executions;
    } else if (skill.name === 'GM Everyday') {
      executions = await this.runnerService.buildGmExecutions({} as never, chainConfig);
    }

    const capabilities = await this.oneShotService.getCapabilities(chainId);
    const chainInfo = capabilities[String(chainId)] as
      | { feeCollector?: `0x${string}` }
      | undefined;
    const feeCollector = chainInfo?.feeCollector;
    if (!feeCollector) {
      throw new ServiceUnavailableException(
        `1Shot does not support chainId ${chainId}`,
      );
    }

    const feeTransfer = this.runnerService.buildFeeTransfer(chainConfig, feeCollector);
    const allExecutions: OneShotExecution[] = [feeTransfer, ...executions];

    const taskId = await this.oneShotService.send7710Transaction({
      chainId: String(chainId),
      transactions: [
        {
          permissionContext: [OneShotService.toRelayerJson(signedDelegation)],
          executions: allExecutions,
        },
      ],
    });

    const finalStatus = await this.oneShotService.poll(taskId);

    const delegationHash = keccak256(
      encodePacked(['address'], [delegatorAddress as `0x${string}`]),
    );

    return {
      delegatorAddress,
      executorAddress: this.executorService.getAddress(),
      skillName: skill.name,
      chainId,
      delegationHash,
      oneShotTaskId: taskId,
      finalStatus,
      aiContext,
      newsContext,
      timestamp: new Date().toISOString(),
    };
  }

  private isDcaSkill(skill: Skill): boolean {
    return skill.name === 'DCA Daily' || skill.name === 'Generic DCA' || skill.metadata?.kind === 'dca';
  }
}

export { };
