import type {
  SkillExecutionConfig,
  SkillHistoryConfig,
  SkillLimitsConfig,
  SkillTriggerConfig,
  SkillEventFilterValue,
  SkillRunType,
} from './skill-config.types';

type SkillConfigSource = {
  name?: string;
  runType?: SkillRunType;
  cronExpression?: string;
  eventTriggerConfig?: Record<string, unknown>;
  chainId?: number;
  metadata?: Record<string, unknown>;
  trigger?: SkillTriggerConfig;
  execution?: SkillExecutionConfig;
  limits?: SkillLimitsConfig;
  history?: SkillHistoryConfig;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLegacyDcaSkillName(name: string | undefined): boolean {
  return name === 'DCA Daily' || name === 'Generic DCA';
}

export function normalizeSkillTrigger(skill: SkillConfigSource): SkillTriggerConfig | undefined {
  const typedTrigger = isObject(skill.trigger)
    ? (skill.trigger as Record<string, unknown>)
    : undefined;

  if (typedTrigger?.type === 'cron') {
    const cronExpression =
      typeof typedTrigger.cronExpression === 'string'
        ? typedTrigger.cronExpression
        : skill.cronExpression;

    if (cronExpression) {
      return {
        type: 'cron',
        cronExpression,
        ...(typeof typedTrigger.timezone === 'string' ? { timezone: typedTrigger.timezone } : {}),
      };
    }
  }

  const legacyEventConfig = isObject(skill.eventTriggerConfig) ? skill.eventTriggerConfig : undefined;

  if (typedTrigger?.type === 'event-trigger' || skill.runType === 'event-trigger') {
    const merged = {
      ...(legacyEventConfig ?? {}),
      ...(typedTrigger?.type === 'event-trigger' ? typedTrigger : {}),
    };

    if (typeof merged.contractAddress === 'string' && typeof merged.eventSignature === 'string') {
      return {
        type: 'event-trigger',
        chainId: typeof merged.chainId === 'number' ? merged.chainId : skill.chainId,
        contractAddress: merged.contractAddress,
        eventSignature: merged.eventSignature,
        ...(isObject(merged.filterArgs)
          ? { filterArgs: merged.filterArgs as Record<string, SkillEventFilterValue> }
          : {}),
        ...(typeof merged.confirmations === 'number'
          ? { confirmations: merged.confirmations }
          : {}),
        ...(merged.dedupeKey === 'txHash-logIndex' ? { dedupeKey: merged.dedupeKey } : {}),
      };
    }
  }

  if (skill.runType === 'cron' && typeof skill.cronExpression === 'string') {
    return { type: 'cron', cronExpression: skill.cronExpression };
  }

  return undefined;
}

export function normalizeSkillExecution(skill: SkillConfigSource): SkillExecutionConfig | undefined {
  if (isObject(skill.execution) && typeof skill.execution.kind === 'string') {
    return skill.execution as SkillExecutionConfig;
  }

  if (skill.metadata?.kind === 'dca' || isLegacyDcaSkillName(skill.name)) {
    return { kind: 'dca-uniswap-v3' };
  }

  return undefined;
}

export function normalizeSkillLimits(skill: SkillConfigSource): SkillLimitsConfig | undefined {
  return isObject(skill.limits) ? (skill.limits as SkillLimitsConfig) : undefined;
}

export function detectDcaExecution(skill: SkillConfigSource): boolean {
  return normalizeSkillExecution(skill)?.kind === 'dca-uniswap-v3';
}

export function normalizeSkillConfig(skill: SkillConfigSource): {
  trigger?: SkillTriggerConfig;
  execution?: SkillExecutionConfig;
  limits?: SkillLimitsConfig;
  history?: SkillHistoryConfig;
} {
  return {
    trigger: normalizeSkillTrigger(skill),
    execution: normalizeSkillExecution(skill),
    limits: normalizeSkillLimits(skill),
    history: isObject(skill.history) ? (skill.history as SkillHistoryConfig) : undefined,
  };
}
