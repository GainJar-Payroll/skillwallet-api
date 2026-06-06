import { Injectable, Logger } from '@nestjs/common';
import { getAddress } from 'viem';
import { getChainConfig } from '../../config/chains.config';
import { InstallationsService } from '../installations/installations.service';
import {
  ExecutionTriggerEventRecord,
  ExecutionTriggerType,
  Installation,
} from '../installations/schemas/installation.schema';
import { SpendReservationsService } from '../spend-reservations/spend-reservations.service';
import { SkillEventFilterValue } from '../skills/skill-config.types';
import { normalizeSkillExecution, normalizeSkillTrigger } from '../skills/skill-config.util';
import { SkillsService } from '../skills/skills.service';
import { ExecuteInstallationContext, RunnerService } from './runner.service';

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
  ) {}

  async handleSkillEvent(payload: SkillEventPayload): Promise<SkillEventHandlingSummary> {
    const skill = await this.skillsService.findById(payload.skillId);
    const trigger = normalizeSkillTrigger(skill);

    if (!trigger || trigger.type !== 'event-trigger') {
      throw new Error(`Skill ${payload.skillId} is not event-triggered`);
    }

    if (
      (trigger.chainId ?? skill.chainId) !== payload.chainId ||
      this.normalizeString(trigger.contractAddress) !== this.normalizeString(payload.event.contractAddress) ||
      trigger.eventSignature !== payload.event.eventSignature
    ) {
      throw new Error(`Event payload does not match trigger config for skill ${payload.skillId}`);
    }

    const installations = await this.installationsService.findActiveBySkillId(skill.skillId);
    let matchedInstallations = 0;
    let executedInstallations = 0;
    let skippedInstallations = 0;
    let dedupedInstallations = 0;

    for (const installation of installations) {
      if (!this.matchesDynamicFilters(trigger.filterArgs, installation, payload.event.args ?? {})) {
        continue;
      }

      matchedInstallations += 1;

      if (this.hasProcessedEvent(installation, payload.event)) {
        dedupedInstallations += 1;
        continue;
      }

      const context = await this.buildExecutionContext(skill.skillId, installation, payload);

      if (context.spend?.actualAmount === '0') {
        skippedInstallations += 1;
        await this.installationsService.appendExecution(this.getInstallationId(installation), {
          executedAt: new Date(),
          completedAt: new Date(),
          status: 'skipped',
          trigger: context.trigger,
          spend: context.spend,
          skippedReason: context.spend.skippedReason,
        });
        continue;
      }

      try {
        await this.runnerService.executeInstallation(this.getInstallationId(installation), context);
        executedInstallations += 1;
      } catch (err) {
        this.logger.error(
          `Event-triggered execution failed for installation ${this.getInstallationId(installation)}: ${(err as Error).message}`,
        );
      }
    }

    return {
      skillId: skill.skillId,
      matchedInstallations,
      executedInstallations,
      skippedInstallations,
      dedupedInstallations,
    };
  }

  matchesDynamicFilters(
    filterArgs: Record<string, SkillEventFilterValue> | undefined,
    installation: Installation,
    eventArgs: Record<string, unknown>,
  ): boolean {
    if (!filterArgs) {
      return true;
    }

    return Object.entries(filterArgs).every(([argName, filterValue]) => {
      const actualValue = eventArgs[argName];
      const expectedValue = this.resolveFilterValue(filterValue, installation);

      if (actualValue === undefined || expectedValue === undefined) {
        return false;
      }

      return this.normalizeComparable(actualValue) === this.normalizeComparable(expectedValue);
    });
  }

  private async buildExecutionContext(
    skillId: string,
    installation: Installation,
    payload: SkillEventPayload,
  ): Promise<ExecuteInstallationContext> {
    return {
      trigger: {
        type: payload.triggerType,
        event: this.serializeEvent(payload.event),
      },
      spend: await this.buildSpendContext(skillId, installation, payload),
    };
  }

  private async buildSpendContext(
    skillId: string,
    installation: Installation,
    payload: SkillEventPayload,
  ): Promise<ExecuteInstallationContext['spend']> {
    const execution = normalizeSkillExecution(await this.skillsService.findById(skillId));

    if (execution?.kind !== 'dca-uniswap-v3') {
      return undefined;
    }

    const chainConfig = getChainConfig(installation.chainId);
    const inboundAmount = BigInt(String(payload.event.args?.value ?? '0'));
    const parameters = installation.parameters ?? {};
    const spendMode = String(parameters['spendMode'] ?? 'fixed');
    const amountPerRun = BigInt(String(parameters['amountPerRun'] ?? '100000'));
    const percentOfInboundBps = BigInt(String(parameters['percentOfInboundBps'] ?? '5000'));
    const dailySpendLimit = BigInt(String(parameters['dailySpendLimit'] ?? '10000000'));

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

  private hasProcessedEvent(installation: Installation, event: ExecutionTriggerEventRecord): boolean {
    return (installation.executions ?? []).some((execution) => {
      const recordedEvent = execution.trigger?.event;
      return (
        recordedEvent?.chainId === event.chainId &&
        this.normalizeString(recordedEvent.contractAddress) === this.normalizeString(event.contractAddress) &&
        recordedEvent.txHash !== undefined &&
        event.txHash !== undefined &&
        this.normalizeString(recordedEvent.txHash) === this.normalizeString(event.txHash) &&
        recordedEvent.logIndex === event.logIndex
      );
    });
  }

  private resolveFilterValue(
    filterValue: SkillEventFilterValue,
    installation: Installation,
  ): unknown {
    if (typeof filterValue === 'string') {
      return filterValue;
    }

    if (filterValue.source === 'installation') {
      return installation[filterValue.path];
    }

    return installation.parameters?.[filterValue.path];
  }

  private normalizeComparable(value: unknown): string {
    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (typeof value === 'string') {
      return this.normalizeString(value);
    }

    return JSON.stringify(value);
  }

  private normalizeString(value: string): string {
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
        Object.entries(event.args ?? {}).map(([key, value]) => [
          key,
          typeof value === 'bigint' ? value.toString() : value,
        ]),
      ),
    };
  }

  private getInstallationId(installation: Installation): string {
    return String((installation as Installation & { _id?: unknown })._id);
  }
}
