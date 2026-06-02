import { Injectable, Logger } from '@nestjs/common';
import { InstallationsService } from '../../installations/installations.service';
import { ExecutionAttemptsService } from '../execution-attempts.service';
import { ActivityLogService } from '../activity-log.service';
import { AdapterRegistryService } from '../adapters/adapter-registry.service';
import { PolicyValidatorService } from '../policy/policy-validator.service';
import { OneShotRelayerService } from '../relayers/oneshot-relayer.service';
import { SkillInstallation } from '../../installations/schemas/skill-installation.schema';
import { ExecutionAttempt } from '../schemas/execution-attempt.schema';
import { nextRunFromFrequency } from '../../common/utils/time';
import { RelaySubmissionResult } from '../relayers/relayer.interface';

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
      await this.attempts.updateStatus(attempt.attemptId, 'skipped', { error: 'installation is locked' });
      throw new Error('installation is locked by another runner');
    }

    try {
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
      const manifest = installation.permissionManifest as any;
      const policyResult = this.policy.validate(installation, proposedAction, {
        allowedTargets: manifest.allowedTargets ?? [],
        allowedSelectors: manifest.allowedSelectors ?? [],
        allowedTokens: manifest.allowedTokens ?? [],
        rules: manifest.rules ?? [],
        validUntil: manifest.validUntil,
      });
      if (!policyResult.ok) {
        await this.attempts.updateStatus(attempt.attemptId, 'blocked', { policyResult, error: policyResult.blockedReason });
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

      await this.attempts.updateStatus(attempt.attemptId, 'relaying', { policyResult });
      const grant = installation.walletPermissionGrant as any;
      const delegation = installation.delegation as any;
      let relayResult: RelaySubmissionResult;
      try {
        relayResult = await this.relayer.relayDelegatedExecution({
          chainId: installation.chainId,
          delegationManager: grant?.delegationManager,
          permissionContext: delegation?.permissionContext ?? grant?.context,
          calls: [
            {
              to: proposedAction.target,
              data: proposedAction.calldata,
              value: proposedAction.value === '0x0' ? undefined : proposedAction.value,
            },
          ],
        });
      } catch (err) {
        await this.attempts.updateStatus(attempt.attemptId, 'failed', { error: (err as Error).message });
        await this.activity.log({
          installationId,
          attemptId: attempt.attemptId,
          userAddress: installation.userAddress,
          chainId: installation.chainId,
          type: 'execution.failed',
          message: `Relayer error: ${(err as Error).message}`,
        });
        await this.installations.recordFailure(installationId, (err as Error).message);
        await this.scheduleNextRun(installation);
        return (await this.attempts.findById(attempt.attemptId))!;
      }

      const finalStatus = relayResult.status === 'confirmed' ? 'confirmed' : relayResult.status === 'failed' ? 'failed' : 'relayed';
      await this.attempts.updateStatus(attempt.attemptId, finalStatus, {
        relay: {
          provider: '1shot',
          relayId: relayResult.relayId,
          status: relayResult.status,
          txHash: relayResult.txHash,
          externalStatusUrl: relayResult.externalStatusUrl,
        },
      });
      if (finalStatus === 'confirmed' || finalStatus === 'relayed') {
        await this.activity.log({
          installationId,
          attemptId: attempt.attemptId,
          userAddress: installation.userAddress,
          chainId: installation.chainId,
          type: finalStatus === 'confirmed' ? 'execution.confirmed' : 'execution.relayed',
          message: finalStatus === 'confirmed' ? `Confirmed: ${relayResult.txHash}` : `Relayed via 1Shot: ${relayResult.relayId}`,
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
          message: `1Shot returned failed: ${relayResult.error ?? 'unknown'}`,
        });
        await this.installations.recordFailure(installationId, 'relayer reported failed status');
        await this.scheduleNextRun(installation);
      }

      return (await this.attempts.findById(attempt.attemptId))!;
    } finally {
      await this.installations.unlockInstallation(installationId);
    }
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