import { Skill } from './schemas/skill.schema';

export type SkillRunType = 'cron' | 'event-trigger';

export const SkillRunEnum = ['cron', 'event-trigger'] as const;

export interface CronSkillTriggerConfig {
  type: 'cron';
  cronExpression: string;
  timezone?: string;
}

export interface EventSkillTriggerConfig {
  type: 'event-trigger';
  chainId?: number;
  contractAddress: string;
  eventSignature: string;
  filterArgs?: Record<string, SkillEventFilterValue>;
  confirmations?: number;
  dedupeKey?: 'txHash-logIndex';
}

export type SkillTriggerConfig = CronSkillTriggerConfig | EventSkillTriggerConfig;

export type CronSkill = Skill & {
  runType: 'cron';
  trigger: CronSkillTriggerConfig;
};

export type EventTriggerSkill = Skill & {
  runType: 'event-trigger';
  trigger: EventSkillTriggerConfig;
};

export type SkillEntity = CronSkill | EventTriggerSkill;

export type InstallationTriggerFilterSource = {
  source: 'installation';
  path: 'smartAccountAddress' | 'userAddress';
};

export type ParameterTriggerFilterSource = {
  source: 'parameters';
  path: string;
};

export type SkillEventFilterValue =
  | string
  | InstallationTriggerFilterSource
  | ParameterTriggerFilterSource;

export interface SkillDailySpendLimitConfig {
  tokenAddress?: string;
  maxAmount?: string;
  maxAmountParam?: string;
  period?: 'day' | 'hour' | 'week' | 'month';
  [key: string]: unknown;
}

export interface SkillLimitsConfig {
  dailySpend?: SkillDailySpendLimitConfig;
  maxExecutionsPerDay?: number;
  [key: string]: unknown;
}
