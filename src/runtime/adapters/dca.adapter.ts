import { Injectable } from '@nestjs/common';
import { SkillAdapter, AdapterContext, CheckTriggerResult, BuildActionResult } from './skill-adapter.interface';
import { ProposedAction } from '../schemas/execution-attempt.schema';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { nextRunFromFrequency, now as nowFn } from '../../common/utils/time';

interface DcaConfig {
  type: 'dca';
  tokenIn: { symbol: string; address: string; decimals: number };
  tokenOut: { symbol: string; address: string; decimals: number };
  amountPerRun: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  maxSlippageBps: number;
  router: { name: string; address: string };
  recipient: string;
  quoteMode: 'external-quote-required' | 'router-quote' | 'manual-min-out';
  minAmountOut?: string;
}

@Injectable()
export class DcaAdapter implements SkillAdapter {
  readonly id = 'dca' as const;

  validateConfig(config: unknown): void {
    if (!config || typeof config !== 'object') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'DCA config must be an object');
    }
    const c = config as Partial<DcaConfig>;
    if (c.type !== 'dca') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `DCA config type must be "dca", got "${c.type}"`);
    }
    if (!c.tokenIn?.address || !c.tokenOut?.address) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'DCA config requires tokenIn.address and tokenOut.address');
    }
    if (!c.amountPerRun || !/^\d+(\.\d+)?$/.test(c.amountPerRun)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'DCA config amountPerRun must be a decimal string');
    }
    if (!c.router?.address) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'DCA config requires router.address');
    }
    if (!c.recipient) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'DCA config requires recipient');
    }
    if (c.maxSlippageBps === undefined || c.maxSlippageBps < 1 || c.maxSlippageBps > 500) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'DCA config maxSlippageBps must be 1-500');
    }
    if (c.quoteMode === 'manual-min-out' && !c.minAmountOut) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'DCA config quoteMode=manual-min-out requires minAmountOut');
    }
  }

  getNextRun(installation: { schedule?: { nextRunAt?: Date | null; frequency?: string } }, now: Date): Date | null {
    const freq = installation.schedule?.frequency as 'daily' | 'weekly' | 'monthly' | undefined;
    if (!freq) return null;
    return nextRunFromFrequency(now, freq);
  }

  checkTrigger(ctx: AdapterContext): CheckTriggerResult {
    const inst = ctx.installation;
    if (inst.status !== 'active') {
      return { shouldRun: false, reason: `installation status is ${inst.status}` };
    }
    if (!inst.walletPermissionGrant) {
      return { shouldRun: false, reason: 'no wallet permission grant' };
    }
    if (inst.schedule?.nextRunAt && inst.schedule.nextRunAt > ctx.now) {
      return { shouldRun: false, reason: 'nextRunAt is in the future' };
    }
    return { shouldRun: true };
  }

  async buildAction(ctx: AdapterContext): Promise<BuildActionResult> {
    const config = ctx.installation.config as unknown as DcaConfig;
    if (!config.router?.address) {
      throw new AppError(ErrorCode.ACTION_BUILD_NOT_CONFIGURED, 'DCA router address not configured');
    }
    if (config.quoteMode === 'manual-min-out' && !config.minAmountOut) {
      throw new AppError(ErrorCode.ACTION_BUILD_NOT_CONFIGURED, 'DCA manual-min-out requires minAmountOut from external quote');
    }

    throw new AppError(
      ErrorCode.NOT_IMPLEMENTED,
      'DCA calldata builder is not yet implemented. A real router-specific builder (Uniswap V3, Aerodrome, etc.) must be wired before live execution.',
    );
  }

  validateAction(_ctx: AdapterContext, _action: ProposedAction): void {
    // validation is performed by PolicyValidatorService
  }
}