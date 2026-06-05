import { z } from 'zod';
import type { Address, HexString } from '../../common/types/evm';
import type { Bundle7710, OneShotDelegation } from '../relayers/relayer.interface';

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const uintStringSchema = z.string().regex(/^[0-9]+$/);

export const frequencySchema = z.enum(['daily', 'weekly', 'monthly']);
export const quoteModeSchema = z.enum(['manual-min-out', 'router-quote']);
export const dexRouterNameSchema = z.literal('uniswap-v3');
export const feeTierSchema = z.union([
  z.literal(100),
  z.literal(500),
  z.literal(3000),
  z.literal(10000),
]);

export type Frequency = z.infer<typeof frequencySchema>;
export type QuoteMode = z.infer<typeof quoteModeSchema>;
export type DexRouterName = z.infer<typeof dexRouterNameSchema>;
export type FeeTier = z.infer<typeof feeTierSchema>;

export const directRouterDcaConfigSchema = z
  .object({
    type: z.literal('direct-router-dca'),
    tokenIn: z.object({ address: addressSchema }),
    tokenOut: z.object({ address: addressSchema }),
    amountPerRun: uintStringSchema,
    frequency: frequencySchema,
    maxSlippageBps: z.number().int().min(0).max(5000),
    router: z.object({
      name: dexRouterNameSchema,
      address: addressSchema,
    }),
    feeTier: feeTierSchema,
    recipient: addressSchema.optional(),
    quoteMode: quoteModeSchema,
    minAmountOut: uintStringSchema.optional(),
    quotedAmountOut: uintStringSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.quoteMode === 'manual-min-out' && !value.minAmountOut) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'minAmountOut is required when quoteMode=manual-min-out',
        path: ['minAmountOut'],
      });
    }
  });

export const gmSelfCallConfigSchema = z.object({
  type: z.literal('gm-self-call'),
  frequency: frequencySchema,
  note: z.string().trim().min(1).max(120).optional(),
});

export const skillConfigSchema = z.discriminatedUnion('type', [
  directRouterDcaConfigSchema,
  gmSelfCallConfigSchema,
]);

export type DirectRouterDcaConfig = z.infer<typeof directRouterDcaConfigSchema>;
export type GmSelfCallConfig = z.infer<typeof gmSelfCallConfigSchema>;
export type SkillConfig = z.infer<typeof skillConfigSchema>;
export type SkillAdapterKind = SkillConfig['type'];

export interface ProposedAction {
  target: Address;
  value: string;
  callData: `0x${string}`;
  description: string;
}

export interface PreparedExecutionCall {
  description: string;
  target: Address;
  value: HexString;
  callData: HexString;
}

export interface ProposedExecution {
  description: string;
  actions: ProposedAction[];
}

export interface TriggerCheckResult {
  shouldRun: boolean;
  reason: string;
  nextEligibleAt?: Date;
}

export interface AdapterRelayContext {
  delegate: Address;
  feeCollector: Address;
  paymentToken: Address;
  requiredPaymentAmount: string;
}

export interface SkillPrepareContext<TConfig extends SkillConfig = SkillConfig> {
  skillId: string;
  userAddress: Address;
  smartAccountAddress: Address;
  chainId: number;
  now: Date;
  config: TConfig;
  relay: AdapterRelayContext;
  expiresAt: Date;
}

export interface SkillAdapterContext<TConfig extends SkillConfig = SkillConfig> {
  installationId: string;
  installation?: Record<string, unknown>;
  userAddress: Address;
  smartAccountAddress: Address;
  chainId: number;
  now: Date;
  config: TConfig;
  relay: AdapterRelayContext;
  grant?: {
    grantId: string;
    chainId: number;
    delegator: Address;
    delegate: Address;
    permissionContext: OneShotDelegation[];
    expiresAt?: Date;
  };
}

export interface PreparedSkillReview<TConfig extends SkillConfig = SkillConfig> {
  configSnapshot: TConfig;
  previewCalls: PreparedExecutionCall[];
  review?: Record<string, string>;
  labels?: {
    targets?: Record<string, string>;
    selectors?: Record<string, string>;
  };
}

export interface BuiltAction {
  description: string;
  executions: ProposedExecution[];
  bundle: Bundle7710;
}

export interface ISkillAdapter<TConfig extends SkillConfig = SkillConfig> {
  readonly kind: SkillAdapterKind;
  parseConfig(config: unknown): TConfig;
  prepare(ctx: SkillPrepareContext<TConfig>): Promise<PreparedSkillReview<TConfig>>;
  checkTrigger(ctx: SkillAdapterContext<TConfig>): Promise<TriggerCheckResult>;
  getNextRunAt(config: TConfig, now: Date): Date;
  buildAction(ctx: SkillAdapterContext<TConfig>, parsed: TConfig): Promise<BuiltAction>;
}

// Backward-compatible types for older runtime modules that still compile in this repo.
export type AdapterId = SkillAdapterKind | 'dca' | 'aerodrome-vote' | 'lp-keeper' | 'x402-research';
export interface AdapterContext {
  installation: Record<string, unknown>;
  now: Date;
}
export interface BuildActionResult {
  proposedAction: {
    chainId?: number;
    target: string;
    value: string;
    calldata: string;
    selector?: string;
    decoded?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
}
export interface CheckTriggerResult {
  shouldRun: boolean;
  reason?: string;
}
export interface SkillAdapter {
  readonly id: AdapterId;
  validateConfig(config: unknown): void;
  getNextRun(installation: Record<string, unknown>, now: Date): Date | null;
  checkTrigger(ctx: AdapterContext): CheckTriggerResult;
  buildAction(ctx: AdapterContext): Promise<BuildActionResult>;
  validateAction(ctx: AdapterContext, action: BuildActionResult['proposedAction']): void;
}
