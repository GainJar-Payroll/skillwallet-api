import { SkillInstallation } from '../../installations/schemas/skill-installation.schema';
import { ProposedAction } from '../schemas/execution-attempt.schema';

export type AdapterId = 'dca' | 'aerodrome-vote' | 'lp-keeper' | 'x402-research';

export interface AdapterContext {
  installation: SkillInstallation;
  now: Date;
}

export interface BuildActionResult {
  proposedAction: ProposedAction;
}

export interface CheckTriggerResult {
  shouldRun: boolean;
  reason?: string;
}

export interface SkillAdapter {
  readonly id: AdapterId;
  validateConfig(config: unknown): void;
  getNextRun(installation: SkillInstallation, now: Date): Date | null;
  checkTrigger(ctx: AdapterContext): CheckTriggerResult;
  buildAction(ctx: AdapterContext): Promise<BuildActionResult>;
  validateAction(ctx: AdapterContext, action: ProposedAction): void;
}
