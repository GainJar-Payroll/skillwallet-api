import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { isSupportedChain } from '../../chains/registry/chains';
import { AdapterRegistryService } from '../adapters/adapter-registry.service';
import { PolicyValidatorService } from '../policy/policy-validator.service';
import { OneShotRelayerService } from '../relayers/oneshot-relayer.service';
import {
  assertChainSupportedByCapabilities,
  assertPaymentTokenSupported,
  validateBundleShape,
} from '../relayers/oneshot-bundle-validator';
import {
  SkillInstallation,
  SkillInstallationDoc,
} from '../../installations/schemas/skill-installation.schema';
import {
  DelegationGrant,
  DelegationGrantDoc,
} from '../../delegations/schemas/delegation-grant.schema';
import {
  PermissionManifest,
  PermissionManifestDoc,
} from '../../common/permissions/permission-manifest.schema';
import { ActivityLog, ActivityLogDoc } from '../schemas/activity-log.schema';
import {
  ExecutionAttempt,
  ExecutionAttemptDoc,
  AttemptStatus,
  ProposedExecution,
  RelayRecord,
} from '../schemas/execution-attempt.schema';
import type { Address } from '../../common/types/evm';
import type { OneShotDelegation } from '../relayers/relayer.interface';

@Injectable()
export class RunnerService {
  private readonly logger = new Logger(RunnerService.name);
  private readonly paymentToken: Address;
  private readonly testnetChainId: number;
  private readonly mainnetChainId: number;

  constructor(
    @InjectConnection() private readonly conn: Connection,
    @InjectModel(SkillInstallation.name)
    private readonly installationModel: Model<SkillInstallationDoc>,
    @InjectModel(DelegationGrant.name)
    private readonly grantModel: Model<DelegationGrantDoc>,
    @InjectModel(PermissionManifest.name)
    private readonly manifestModel: Model<PermissionManifestDoc>,
    @InjectModel(ExecutionAttempt.name)
    private readonly attemptModel: Model<ExecutionAttemptDoc>,
    @InjectModel(ActivityLog.name)
    private readonly activityModel: Model<ActivityLogDoc>,
    private readonly relayer: OneShotRelayerService,
    private readonly adapterRegistry: AdapterRegistryService,
    private readonly policy: PolicyValidatorService,
    private readonly config: ConfigService,
  ) {
    const get = (key: string): string | undefined => this.config?.get?.(key) as string | undefined;
    this.paymentToken = (get('ONESHOT_PAYMENT_TOKEN_ADDRESS') ||
      '0x0000000000000000000000000000000000000000') as Address;
    this.testnetChainId = Number(get('ONESHOT_TESTNET_CHAIN_ID')) || 84532;
    this.mainnetChainId = Number(get('ONESHOT_MAINNET_CHAIN_ID')) || 8453;
  }

  async runByInstallationId(installationId: string): Promise<ExecutionAttemptDoc> {
    const installation = await this.installationModel.findOne({ installationId }).exec();
    if (!installation) {
      throw AppError.notFound(`installation ${installationId}`);
    }
    return this.executeRun(installation);
  }

  async run(installationId: string, _options?: { force?: boolean }): Promise<ExecutionAttemptDoc> {
    return this.runByInstallationId(installationId);
  }

  async runDue(limit: number): Promise<{ attemptIds: string[]; skipped: number }> {
    const due = await this.installationModel
      .find({
        status: 'active',
        $or: [
          { 'schedule.nextRunAt': { $lte: new Date() } },
          { 'schedule.nextRunAt': { $exists: false } },
        ],
      })
      .limit(limit)
      .exec();
    const attemptIds: string[] = [];
    let skipped = 0;
    for (const inst of due) {
      try {
        const a = await this.executeRun(inst);
        attemptIds.push(a.attemptId);
      } catch (err) {
        skipped += 1;
        this.logger.warn(
          `runDue: skipped installation=${inst.installationId} reason=${(err as Error).message}`,
        );
      }
    }
    return { attemptIds, skipped };
  }

  private async executeRun(installation: SkillInstallationDoc): Promise<ExecutionAttemptDoc> {
    const attemptId = `att_${uuidv4()}`;
    const now = new Date();
    const chainId = installation.chainId;
    const userAddress = installation.userAddress as Address;
    const smartAccountAddress = installation.smartAccountAddress as Address;

    const attempt = await this.attemptModel.create({
      attemptId,
      installationId: installation.installationId,
      skillType: installation.skillType,
      chainId,
      userAddress,
      status: 'queued',
    });

    const log = async (
      status: AttemptStatus,
      reason: string,
      extra: Record<string, unknown> = {},
    ) => {
      attempt.status = status;
      attempt.error = { code: extra.code as string, message: reason };
      if (extra.proposed) attempt.proposed = extra.proposed as ExecutionAttemptDoc['proposed'];
      if (extra.relay) attempt.relay = extra.relay as RelayRecord;
      await attempt.save();
      await this.activityModel.create({
        kind: 'attempt-status',
        installationId: installation.installationId,
        attemptId,
        status,
        reason,
        meta: extra,
      });
    };

    try {
      if (!isSupportedChain(chainId)) {
        await log('failed', `chainId ${chainId} not in MVP supported set`, {
          code: ErrorCode.CHAIN_UNSUPPORTED,
        });
        throw AppError.notConfigured(`chainId=${chainId}`, 'chain not in MVP supported set');
      }

      const adapter = this.adapterRegistry.get(installation.skillType);
      const parsedConfig = this.adapterRegistry.parseConfig(
        installation.skillType,
        installation.config,
      );

      const grant = await this.grantModel
        .findOne({
          installationId: installation.installationId,
          chainId,
          status: 'redeemable',
        })
        .sort({ createdAt: -1 })
        .exec();
      if (!grant) {
        await log('failed', 'no active delegation grant', { code: ErrorCode.NO_ACTIVE_GRANT });
        throw new AppError(
          ErrorCode.NO_ACTIVE_GRANT,
          412,
          `Installation ${installation.installationId} has no active delegation grant`,
        );
      }

      const relay = {
        delegate: grant.delegate as Address,
        feeCollector: installation.runtime?.oneShotFeeCollector as Address,
        paymentToken: installation.runtime?.paymentToken as Address,
        requiredPaymentAmount: installation.runtime?.oneShotRequiredPaymentAmount ?? '0',
      };

      const trigger = await adapter.checkTrigger({
        installationId: installation.installationId,
        userAddress,
        smartAccountAddress,
        chainId,
        now,
        config: parsedConfig,
        relay,
        grant: {
          grantId: grant.grantId,
          chainId: grant.chainId,
          delegator: grant.delegator as Address,
          delegate: grant.delegate as Address,
          permissionContext: grant.permissionContext as unknown as OneShotDelegation[],
          expiresAt: grant.expiresAt,
        },
      });
      if (!trigger.shouldRun) {
        await log('skipped', trigger.reason, { code: 'TRIGGER_NOT_DUE' });
        if (trigger.nextEligibleAt) {
          installation.schedule = {
            ...installation.schedule,
            nextRunAt: trigger.nextEligibleAt,
          };
          await installation.save();
        }
        return attempt;
      }

      attempt.status = 'building_action';
      await attempt.save();

      const built = await adapter.buildAction(
        {
          installationId: installation.installationId,
          userAddress,
          smartAccountAddress,
          chainId,
          now,
          config: parsedConfig,
          relay,
          grant: {
            grantId: grant.grantId,
            chainId: grant.chainId,
            delegator: grant.delegator as Address,
            delegate: grant.delegate as Address,
            permissionContext: grant.permissionContext as unknown as OneShotDelegation[],
            expiresAt: grant.expiresAt,
          },
        },
        parsedConfig,
      );

      validateBundleShape(built.bundle);

      attempt.proposed = {
        description: built.description,
        executions: built.executions.map((e) => ({
          description: e.description,
          actions: e.actions.map((a) => ({
            target: a.target,
            value: a.value,
            data: a.callData,
          })),
        })) as unknown as ProposedExecution[],
      };
      attempt.status = 'policy_checking';
      await attempt.save();

      const manifest = await this.manifestModel
        .findOne({ installationId: installation.installationId, status: 'active' })
        .exec();

      for (const exec of built.executions) {
        const verdict = this.policy.evaluate({
          chainId,
          userAddress,
          manifest,
          execution: {
            description: exec.description,
            actions: exec.actions.map((a) => ({
              target: a.target,
              value: a.value,
              callData: a.callData,
            })),
          },
        });
        if (!verdict.allowed) {
          await log('blocked', verdict.reason, { code: verdict.blockedBy ?? 'POLICY_BLOCKED' });
          throw new AppError(ErrorCode.POLICY_BLOCKED, 403, verdict.reason, verdict);
        }
      }

      attempt.status = 'quoting';
      await attempt.save();

      const capabilities = await this.relayer.getCapabilities(chainId);
      assertChainSupportedByCapabilities(capabilities, chainId);
      assertPaymentTokenSupported(capabilities, chainId, this.paymentToken);

      let estimate;
      try {
        estimate = await this.relayer.estimate7710Transaction({
          chainId,
          bundle: built.bundle,
        });
      } catch (err) {
        this.logger.warn(
          `relayer.estimate7710Transaction failed (continuing without quote): ${(err as Error).message}`,
        );
      }

      attempt.relay = {
        targetAddress: built.bundle.transactions[0].executions.map((e) => e.target).join(','),
        paymentToken: this.paymentToken,
        requiredPaymentAmount: estimate?.requiredPaymentAmount,
        context: {
          environment: capabilities.meta?.environment,
          relayerVersion: capabilities.meta?.version,
        },
        method: 'relayer_send7710Transaction',
      };
      attempt.status = 'relaying';
      await attempt.save();

      const sendResult = await this.relayer.send7710Transaction({
        chainId,
        bundle: built.bundle,
      });

      attempt.relay = {
        ...attempt.relay,
        taskId: sendResult.taskId,
        statusCode: sendResult.statusCode,
        status: sendResult.status,
        txHash: sendResult.txHash,
        receipt: sendResult.receipt as RelayRecord['receipt'],
        errorCode: sendResult.errorCode ? Number(sendResult.errorCode) : undefined,
        errorMessage: sendResult.errorMessage,
      };

      if (sendResult.status === 'rejected' || sendResult.status === 'reverted') {
        attempt.status = 'failed';
        await attempt.save();
        await this.activityModel.create({
          kind: 'attempt-status',
          installationId: installation.installationId,
          attemptId,
          status: 'failed',
          reason: `relayer ${sendResult.status}: ${sendResult.errorMessage ?? sendResult.errorCode ?? 'unknown'}`,
          createdAt: new Date(),
        });
        return attempt;
      }

      attempt.status = 'relayed';
      await attempt.save();

      let finalStatus: AttemptStatus = 'relayed';
      if (sendResult.status === 'confirmed') {
        finalStatus = 'confirmed';
      } else {
        const polled = await this.pollUntilSettled(sendResult.taskId);
        if (polled.status === 'confirmed') finalStatus = 'confirmed';
        else if (polled.status === 'rejected' || polled.status === 'reverted')
          finalStatus = 'failed';
        attempt.relay = {
          ...attempt.relay,
          taskId: polled.taskId,
          statusCode: polled.statusCode,
          status: polled.status,
          txHash: polled.txHash ?? attempt.relay?.txHash,
          receipt: polled.receipt ?? attempt.relay?.receipt,
        };
      }
      attempt.status = finalStatus;
      await attempt.save();

      if (finalStatus === 'confirmed') {
        installation.runtime = {
          ...installation.runtime,
          lastSuccessAt: new Date(),
          lastAttemptId: attempt.attemptId,
          successCount: (installation.runtime?.successCount ?? 0) + 1,
          lastTxHash: attempt.relay?.txHash,
        } as SkillInstallation['runtime'];
        installation.schedule = {
          ...installation.schedule,
          nextRunAt: adapter.getNextRunAt(parsedConfig, new Date()),
        };
        await installation.save();
      } else {
        installation.runtime = {
          ...installation.runtime,
          lastFailureAt: new Date(),
          lastAttemptId: attempt.attemptId,
          failureCount: (installation.runtime?.failureCount ?? 0) + 1,
        } as SkillInstallation['runtime'];
        await installation.save();
      }

      await this.activityModel.create({
        kind: 'attempt-status',
        installationId: installation.installationId,
        attemptId,
        status: finalStatus,
        reason:
          finalStatus === 'confirmed'
            ? `txHash=${attempt.relay?.txHash ?? 'n/a'}`
            : 'relayer did not confirm',
        createdAt: new Date(),
      });

      return attempt;
    } catch (err) {
      const code = (err as AppError).code ?? ErrorCode.RUNNER_ERROR;
      const message = (err as Error).message ?? 'unknown runner error';
      if (
        attempt.status !== 'failed' &&
        attempt.status !== 'blocked' &&
        attempt.status !== 'skipped'
      ) {
        attempt.status = 'failed';
        attempt.error = { code, message };
        await attempt.save();
      }
      await this.activityModel.create({
        kind: 'attempt-error',
        installationId: installation.installationId,
        attemptId,
        status: 'failed',
        reason: message,
        meta: { code },
        createdAt: new Date(),
      });
      throw err;
    }
  }

  private async pollUntilSettled(taskId: string): Promise<{
    taskId: string;
    status: 'pending' | 'submitted' | 'confirmed' | 'rejected' | 'reverted';
    statusCode: 100 | 110 | 200 | 400 | 500;
    txHash?: `0x${string}`;
    receipt?: {
      blockNumber?: string;
      blockHash?: `0x${string}`;
      gasUsed?: string;
      status?: string;
    };
  }> {
    const maxAttempts = 6;
    const delayMs = 1500;
    for (let i = 0; i < maxAttempts; i += 1) {
      await new Promise((r) => setTimeout(r, delayMs));
      const r = await this.relayer.getStatus(taskId);
      if (r.status === 'confirmed' || r.status === 'rejected' || r.status === 'reverted') {
        return {
          taskId: r.taskId,
          status: r.status,
          statusCode: r.statusCode,
          txHash: r.txHash as `0x${string}` | undefined,
          receipt: r.receipt as
            | {
                blockNumber?: string;
                blockHash?: `0x${string}`;
                gasUsed?: string;
                status?: string;
              }
            | undefined,
        };
      }
    }
    return { taskId, status: 'submitted', statusCode: 110 };
  }
}
