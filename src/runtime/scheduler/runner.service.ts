import { Injectable, Logger } from '@nestjs/common';
import { InstallationsService } from '../../installations/installations.service';
import { ExecutionAttemptsService } from '../execution-attempts.service';
import { ActivityLogService } from '../activity-log.service';
import { AdapterRegistryService } from '../adapters/adapter-registry.service';
import { PolicyValidatorService } from '../policy/policy-validator.service';
import { OneShotRelayerService } from '../relayers/oneshot-relayer.service';
import { OneShotBundleValidator } from '../relayers/oneshot-bundle-validator';
import { SkillInstallation } from '../../installations/schemas/skill-installation.schema';
import { ExecutionAttempt } from '../schemas/execution-attempt.schema';
import { nextRunFromFrequency } from '../../common/utils/time';
import { RelaySubmissionResult } from '../relayers/relayer.interface';
import { PolicyManifest } from '../policy/policy-types';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

interface GrantedResponse {
  chainId: number;
  context: string;
  delegationManager: string;
}

@Injectable()
export class RunnerService {
  private readonly logger = new Logger(RunnerService.name);

  constructor(
    private readonly installations: InstallationsService,
    private readonly attempts: ExecutionAttemptsService,
    private readonly activity: ActivityLogService,
    private readonly adapters: AdapterRegistryService,
    private readonly policy: PolicyValidatorService,
    private readonly relayer: OneShotRelayerService,
    private readonly validator: OneShotBundleValidator,
  ) {}

  async run(installationId: string, options?: { force?: boolean }): Promise<ExecutionAttempt> {
    const installation = await this.installations.findById(installationId);
    const attempt = await this.attempts.create({
      installationId,
      skillId: installation.skillId,
      adapter: installation.adapter,
      chainId: installation.chainId,
      triggerReason: options?.force ? 'manual:force' : 'scheduler:due',
    });

    const locked = await this.installations.lockInstallation(installationId, 'runner');
    if (!locked) {
      await this.attempts.updateStatus(attempt.attemptId, 'skipped', {
        error: 'installation is locked',
      });
      throw new Error('installation is locked by another runner');
    }

    try {
      const failClosed = this.checkFailClosed(installation);
      if (failClosed) {
        return await this.markFailed(
          installationId,
          attempt.attemptId,
          installation,
          new AppError(ErrorCode.INVALID_STATE, failClosed, { installationId }),
          'Fail-closed pre-check',
        );
      }

      const adapter = this.adapters.resolve(installation.adapter);
      const now = new Date();

      await this.attempts.updateStatus(attempt.attemptId, 'checking_trigger');
      const trigger = adapter.checkTrigger({ installation, now });
      if (!trigger.shouldRun && !options?.force) {
        await this.attempts.updateStatus(attempt.attemptId, 'skipped', { error: trigger.reason });
        await this.activity.log({
          installationId,
          attemptId: attempt.attemptId,
          userAddress: installation.userAddress,
          chainId: installation.chainId,
          type: 'execution.skipped',
          message: `Skipped: ${trigger.reason}`,
        });
        return (await this.attempts.findById(attempt.attemptId))!;
      }

      await this.attempts.updateStatus(attempt.attemptId, 'building_action');
      const { proposedAction } = await adapter.buildAction({ installation, now });

      await this.attempts.updateStatus(attempt.attemptId, 'policy_checking', { proposedAction });
      const manifest = installation.permissionManifest as unknown as PolicyManifest;
      const granted = this.resolveGrantedResponse(installation);
      const policyResult = this.policy.validate(installation, proposedAction, {
        allowedTargets: manifest.allowedTargets ?? [],
        allowedSelectors: manifest.allowedSelectors ?? [],
        allowedTokens: manifest.allowedTokens ?? [],
        rules: manifest.rules ?? [],
        validUntil: manifest.validUntil,
        grantedContext: granted?.context,
        grantedDelegationManager: granted?.delegationManager,
        grantedChainId: granted?.chainId,
      });
      if (!policyResult.ok) {
        await this.attempts.updateStatus(attempt.attemptId, 'blocked', {
          policyResult,
          error: policyResult.blockedReason,
        });
        await this.activity.log({
          installationId,
          attemptId: attempt.attemptId,
          userAddress: installation.userAddress,
          chainId: installation.chainId,
          type: 'execution.blocked',
          message: `Blocked by policy: ${policyResult.blockedReason}`,
          metadata: { policyResult },
        });
        return (await this.attempts.findById(attempt.attemptId))!;
      }

      if (!granted) {
        return await this.markFailed(
          installationId,
          attempt.attemptId,
          installation,
          new AppError(
            ErrorCode.MISSING_PERMISSION_CONTEXT,
            'Cannot relay: installation has no usable granted PermissionResponse',
          ),
          'Missing granted permission',
        );
      }

      const bundle = this.buildBundle(installation, granted, proposedAction);

      try {
        this.validator.validateShape(bundle);
      } catch (err) {
        return await this.markFailed(
          installationId,
          attempt.attemptId,
          installation,
          err as AppError,
          'Bundle shape invalid',
        );
      }

      await this.attempts.updateStatus(attempt.attemptId, 'relaying');

      let estimateContext: string;
      let requiredPaymentAmountEstimate: string;
      try {
        const estimate = await this.relayer.estimate7710Transaction({
          ...bundle,
          context: undefined,
        });
        if (!estimate.success) {
          throw new AppError(
            ErrorCode.ONESHOT_SIMULATION_FAILED,
            `1Shot estimate returned success=false: ${estimate.error ?? 'unknown'}`,
            { estimate },
          );
        }
        if (!estimate.context) {
          throw new AppError(
            ErrorCode.MISSING_ONESHOT_CONTEXT,
            '1Shot estimate did not return a context (cannot relay without a price-lock quote)',
            { estimate },
          );
        }
        estimateContext = estimate.context;
        requiredPaymentAmountEstimate = estimate.requiredPaymentAmount;
      } catch (err) {
        return await this.markFailed(
          installationId,
          attempt.attemptId,
          installation,
          err as AppError,
          'Estimate failed',
        );
      }

      try {
        this.validator.validateContext(
          estimateContext,
          bundle.chainId,
          this.relayer.getPaymentTokenAddress(),
        );
      } catch (err) {
        return await this.markFailed(
          installationId,
          attempt.attemptId,
          installation,
          err as AppError,
          'Quote context invalid',
        );
      }

      await this.attempts.attachQuoteContext(attempt.attemptId, {
        context: estimateContext,
        requiredPaymentAmount: requiredPaymentAmountEstimate,
        method: 'relayer_send7710Transaction',
      });

      let relayResult: RelaySubmissionResult;
      try {
        relayResult = await this.relayer.relayDelegatedExecution({
          chainId: installation.chainId,
          delegationManager: granted.delegationManager,
          permissionContext: granted.context,
          call: {
            to: proposedAction.target,
            data: proposedAction.calldata,
            value: proposedAction.value === '0x0' ? undefined : proposedAction.value,
          },
          context: estimateContext,
        });
      } catch (err) {
        return await this.markFailed(
          installationId,
          attempt.attemptId,
          installation,
          err as AppError,
          'Send failed',
        );
      }

      const finalStatus =
        relayResult.status === 'confirmed'
          ? 'confirmed'
          : relayResult.status === 'rejected' || relayResult.status === 'reverted'
            ? 'failed'
            : 'relayed';
      await this.attempts.updateStatus(attempt.attemptId, finalStatus, {
        relay: {
          provider: '1shot',
          taskId: relayResult.taskId,
          statusCode: relayResult.statusCode,
          status: relayResult.status,
          targetAddress: relayResult.targetAddress,
          paymentToken: relayResult.paymentToken,
          requiredPaymentAmount: relayResult.requiredPaymentAmount,
          context: relayResult.context,
          txHash: relayResult.txHash,
          externalStatusUrl: relayResult.externalStatusUrl,
          errorCode: relayResult.errorCode,
          errorMessage: relayResult.errorMessage,
          quoteContext: estimateContext,
          requiredPaymentAmountEstimate,
          method: 'relayer_send7710Transaction',
        },
      });

      if (finalStatus === 'confirmed' || finalStatus === 'relayed') {
        await this.activity.log({
          installationId,
          attemptId: attempt.attemptId,
          userAddress: installation.userAddress,
          chainId: installation.chainId,
          type: finalStatus === 'confirmed' ? 'execution.confirmed' : 'execution.relayed',
          message:
            finalStatus === 'confirmed'
              ? `Confirmed: ${relayResult.txHash}`
              : `Relayed via 1Shot: ${relayResult.taskId}`,
          metadata: { relayResult },
        });
        await this.scheduleNextRun(installation);
      } else {
        await this.activity.log({
          installationId,
          attemptId: attempt.attemptId,
          userAddress: installation.userAddress,
          chainId: installation.chainId,
          type: 'execution.failed',
          message: `1Shot returned ${relayResult.statusCode}: ${relayResult.errorMessage ?? 'unknown'}`,
        });
        await this.installations.recordFailure(
          installationId,
          `relayer statusCode=${relayResult.statusCode}`,
        );
        await this.scheduleNextRun(installation);
      }

      return (await this.attempts.findById(attempt.attemptId))!;
    } finally {
      await this.installations.unlockInstallation(installationId);
    }
  }

  private checkFailClosed(installation: SkillInstallation): string | null {
    if (installation.status !== 'active') {
      return `installation status is "${installation.status}", not "active"`;
    }
    const grant = installation.walletPermissionGrant as
      | { status?: string; responses?: GrantedResponse[]; expiresAt?: Date | string }
      | undefined;
    if (!grant) {
      return 'installation has no walletPermissionGrant';
    }
    if (grant.status !== 'granted') {
      return `grant status is "${grant.status ?? 'unknown'}", not "granted"`;
    }
    if (!grant.responses || grant.responses.length === 0) {
      return 'grant has no PermissionResponse[]';
    }
    const response = grant.responses[0];
    if (!response?.context || !response?.delegationManager) {
      return 'granted PermissionResponse is missing context or delegationManager';
    }
    if (response.chainId !== installation.chainId) {
      return `granted PermissionResponse chainId ${response.chainId} does not match installation chainId ${installation.chainId}`;
    }
    if (grant.expiresAt && new Date(grant.expiresAt).getTime() <= Date.now()) {
      return `grant expired at ${new Date(grant.expiresAt).toISOString()}`;
    }
    const delegation = installation.delegation as
      | { permissionContext?: string; delegationManager?: string }
      | undefined;
    if (!delegation?.permissionContext || !delegation?.delegationManager) {
      return 'installation has no usable delegation record';
    }
    if (delegation.permissionContext !== response.context) {
      return 'delegation permissionContext does not match granted PermissionResponse.context';
    }
    const dependencies = installation.dependencies ?? [];
    const blocking = dependencies.find(
      (dep) => dep.status === 'pending' || dep.status === 'deploying' || dep.status === 'failed',
    );
    if (blocking) {
      return `dependency on chainId=${blocking.chainId} is in "${blocking.status}" state`;
    }
    return null;
  }

  private resolveGrantedResponse(installation: SkillInstallation): GrantedResponse | null {
    const grant = installation.walletPermissionGrant as
      | { responses?: GrantedResponse[]; status?: string }
      | undefined;
    if (!grant || grant.status !== 'granted' || !grant.responses) {
      return null;
    }
    const response =
      grant.responses.find((r) => r.chainId === installation.chainId) ?? grant.responses[0];
    if (!response?.context || !response?.delegationManager) {
      return null;
    }
    return response;
  }

  private async markFailed(
    installationId: string,
    attemptId: string,
    installation: SkillInstallation,
    err: AppError,
    prefix: string,
  ): Promise<ExecutionAttempt> {
    await this.attempts.updateStatus(attemptId, 'failed', {
      error: `${prefix}: ${err.message}`,
    });
    await this.activity.log({
      installationId,
      attemptId,
      userAddress: installation.userAddress,
      chainId: installation.chainId,
      type: 'execution.failed',
      message: `${prefix}: ${err.message}`,
      metadata: { code: err.code, details: err.details },
    });
    await this.installations.recordFailure(installationId, err.message);
    await this.scheduleNextRun(installation);
    return (await this.attempts.findById(attemptId))!;
  }

  private buildBundle(
    installation: SkillInstallation,
    granted: GrantedResponse,
    proposedAction: { target: string; calldata: string; value: string },
  ) {
    return {
      chainId: installation.chainId,
      delegationManager: granted.delegationManager,
      transactions: [
        {
          permissionContext: this.validator.parsePermissionContextString(granted.context),
          executions: [
            {
              target: proposedAction.target,
              value: proposedAction.value === '0x0' ? '0x0' : proposedAction.value,
              data: proposedAction.calldata,
            },
          ],
        },
      ],
    };
  }

  private async scheduleNextRun(installation: SkillInstallation): Promise<void> {
    const freq = installation.schedule?.frequency as 'daily' | 'weekly' | 'monthly' | undefined;
    if (!freq) {
      await this.installations.updateNextRunAt(installation.installationId, null, new Date());
      return;
    }
    const base = (installation.schedule?.nextRunAt as Date | null | undefined) ?? new Date();
    const next = nextRunFromFrequency(base, freq);
    await this.installations.updateNextRunAt(installation.installationId, next, new Date());
  }
}
