export type SkillRunType = 'cron' | 'event-trigger';

export interface CronSkillTriggerConfig {
  type: 'cron';
  cronExpression: string;
  timezone?: string;
}

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

export interface DcaUniswapV3ExecutionConfig {
  kind: 'dca-uniswap-v3';
  tokenIn?: string;
  router?: string;
  defaultFeeTier?: number;
  [key: string]: unknown;
}

export interface ContractCallExecutionConfig {
  kind: 'contract-call';
  target?: string;
  functionName?: string;
  args?: unknown[];
  [key: string]: unknown;
}

export type SkillExecutionConfig =
  | DcaUniswapV3ExecutionConfig
  | ContractCallExecutionConfig
  | ({ kind: string } & Record<string, unknown>);

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

export interface SkillHistoryConfig {
  maxEntries?: number;
  [key: string]: unknown;
}
