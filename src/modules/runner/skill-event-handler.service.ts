import { Injectable, Logger } from '@nestjs/common';
import { getAddress } from 'viem';
import { getChainConfig } from '../../config/chains.config';
import { InstallationsService } from '../installations/installations.service';
import {
  type ExecutionTriggerEventRecord,
  type ExecutionTriggerType,
  type Installation,
} from '../installations/schemas/installation.schema';
import { SpendReservationsService } from '../spend-reservations/spend-reservations.service';
import type { SkillEventFilterValue } from '../skills/skill-config.types';
import { SkillsService } from '../skills/skills.service';
import { ProcessedEventService } from './processed-event.service';
import { type ExecutionContext, RunnerService } from './runner.service';

export interface SkillEventPayload {
  skillId: string;
  chainId: number;
  triggerType: Extract<ExecutionTriggerType, 'event-trigger'>;
  event: ExecutionTriggerEventRecord;
}

export interface SkillEventHandlingSummary {
  skillId: string;
  matchedInstallations: number;
  executedInstallations: number;
  skippedInstallations: number;
  dedupedInstallations: number;
}

@Injectable()
export class SkillEventHandlerService {
  private readonly logger = new Logger(SkillEventHandlerService.name);

  constructor(
    private readonly skillsService: SkillsService,
    private readonly installationsService: InstallationsService,
    private readonly runnerService: RunnerService,
    private readonly spendReservationsService: SpendReservationsService,
    private readonly processedEventService: ProcessedEventService,
  ) {}

  async handleSkillEvent(payload: SkillEventPayload): Promise<SkillEventHandlingSummary> {
    const skill = await this.skillsService.findById(payload.skillId);
    const trigger = skill.trigger;

    if (!trigger || trigger.type !== 'event-trigger') {
      throw new Error(`Skill ${payload.skillId} is not event-triggered`);
    }

    const triggerChainId = trigger.chainId ?? skill.chainId;
    if (
      triggerChainId !== payload.chainId ||
      this.normalizeAddress(trigger.contractAddress) !==
        this.normalizeAddress(payload.event.contractAddress) ||
      trigger.eventSignature !== payload.event.eventSignature
    ) {
      throw new Error(`Event payload does not match trigger config for skill ${payload.skillId}`);
    }

    const installations = await this.installationsService.findActiveBySkillId(skill.skillId);

    let matched = 0,
      executed = 0,
      skipped = 0,
      deduped = 0;

    for (const installation of installations) {
      if (!this.matchesDynamicFilters(trigger.filterArgs, installation, payload.event.args ?? {})) {
        continue;
      }
      matched++;

      if (this.isDuplicateEvent(installation, payload.event)) {
        deduped++;
        continue;
      }

      if (!(await this.claimEvent(payload.event))) {
        deduped++;
        continue;
      }

      const ctx = await this.buildExecutionContext(skill.skillId, installation, payload);
      const installationId = this.getInstallationId(installation);

      if (ctx.spend?.actualAmount === '0') {
        skipped++;
        await this.installationsService.appendExecution(installationId, {
          executedAt: new Date(),
          completedAt: new Date(),
          status: 'skipped',
          trigger: ctx.trigger,
          spend: ctx.spend,
          skippedReason: ctx.spend.skippedReason,
        });
        continue;
      }

      try {
        await this.runnerService.executeInstallation(installationId, ctx);
        executed++;
      } catch (err) {
        this.logger.error(
          `Event-triggered execution failed installation=${installationId}: ${(err as Error).message}`,
        );
      }
    }

    return {
      skillId: skill.skillId,
      matchedInstallations: matched,
      executedInstallations: executed,
      skippedInstallations: skipped,
      dedupedInstallations: deduped,
    };
  }

  matchesDynamicFilters(
    filterArgs: Record<string, SkillEventFilterValue> | undefined,
    installation: Installation,
    eventArgs: Record<string, unknown>,
  ): boolean {
    if (!filterArgs) return true;

    return Object.entries(filterArgs).every(([argName, filterValue]) => {
      const actual = eventArgs[argName];
      const expected = this.resolveFilterValue(filterValue, installation);
      if (actual === undefined || expected === undefined) return false;
      return this.normalizeComparable(actual) === this.normalizeComparable(expected);
    });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async claimEvent(event: ExecutionTriggerEventRecord): Promise<boolean> {
    if (!event.txHash || event.logIndex === undefined) return true;

    return this.processedEventService.tryMarkProcessed({
      chainId: event.chainId,
      contractAddress: event.contractAddress,
      txHash: event.txHash,
      logIndex: event.logIndex,
    });
  }

  private async buildExecutionContext(
    skillId: string,
    installation: Installation,
    payload: SkillEventPayload,
  ): Promise<ExecutionContext> {
    return {
      trigger: { type: payload.triggerType, event: this.serializeEvent(payload.event) },
      spend: await this.buildSpendContext(skillId, installation, payload),
    };
  }

  private async buildSpendContext(
    _skillId: string,
    installation: Installation,
    payload: SkillEventPayload,
  ): Promise<ExecutionContext['spend']> {
    const chainConfig = getChainConfig(installation.chainId);
    const params = installation.parameters ?? {};

    const inboundAmount = BigInt(String(payload.event.args?.value ?? '0'));
    const spendMode = String(params['spendMode'] ?? 'fixed');
    const amountPerRun = BigInt(String(params['amountPerRun'] ?? '100000'));
    const percentOfInboundBps = BigInt(String(params['percentOfInboundBps'] ?? '5000'));
    const dailySpendLimit = BigInt(String(params['dailySpendLimit'] ?? '10000000'));

    const desiredAmount =
      spendMode === 'percent-of-inbound'
        ? (inboundAmount * percentOfInboundBps) / 10_000n
        : amountPerRun;

    const reservation = await this.spendReservationsService.reserveDailySpend({
      installationId: this.getInstallationId(installation),
      tokenAddress: chainConfig.tokens.usdc,
      dailyLimit: dailySpendLimit,
      desiredAmount,
      inboundAmount,
    });

    return {
      tokenAddress: chainConfig.tokens.usdc,
      requestedAmount: reservation.requestedAmount,
      actualAmount: reservation.actualAmount,
      dailyLimit: reservation.dailyLimit,
      periodKey: reservation.periodKey,
      reservationId: reservation.reservationId,
      skippedReason:
        reservation.actualAmount === '0'
          ? reservation.remainingAmount === '0'
            ? 'daily-limit-exhausted'
            : 'zero-actual-spend'
          : undefined,
    };
  }

  private isDuplicateEvent(
    installation: Installation,
    event: ExecutionTriggerEventRecord,
  ): boolean {
    return (installation.executions ?? []).some((record) => {
      const recorded = record.trigger?.event;
      return (
        recorded?.chainId === event.chainId &&
        this.normalizeAddress(recorded.contractAddress) ===
          this.normalizeAddress(event.contractAddress) &&
        recorded.txHash !== undefined &&
        event.txHash !== undefined &&
        recorded.txHash.toLowerCase() === event.txHash.toLowerCase() &&
        recorded.logIndex === event.logIndex
      );
    });
  }

  private resolveFilterValue(
    filterValue: SkillEventFilterValue,
    installation: Installation,
  ): unknown {
    if (typeof filterValue === 'string') return filterValue;
    if (filterValue.source === 'installation') return installation[filterValue.path];
    return installation.parameters?.[filterValue.path];
  }

  private normalizeComparable(value: unknown): string {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'string') return this.normalizeAddress(value);
    return JSON.stringify(value);
  }

  private normalizeAddress(value: string): string {
    try {
      return getAddress(value).toLowerCase();
    } catch {
      return value.toLowerCase();
    }
  }

  private serializeEvent(event: ExecutionTriggerEventRecord): ExecutionTriggerEventRecord {
    return {
      ...event,
      args: Object.fromEntries(
        Object.entries(event.args ?? {}).map(([k, v]) => [
          k,
          typeof v === 'bigint' ? v.toString() : v,
        ]),
      ),
    };
  }

  private getInstallationId(installation: Installation): string {
    return String((installation as Installation & { _id: unknown })._id);
  }
}
