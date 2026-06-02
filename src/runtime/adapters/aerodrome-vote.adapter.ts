import { Injectable } from '@nestjs/common';
import {
  SkillAdapter,
  AdapterContext,
  CheckTriggerResult,
  BuildActionResult,
} from './skill-adapter.interface';
import { ProposedAction } from '../schemas/execution-attempt.schema';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

@Injectable()
export class AerodromeVoteAdapter implements SkillAdapter {
  readonly id = 'aerodrome-vote' as const;

  validateConfig(config: unknown): void {
    if (!config || typeof config !== 'object') {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Aerodrome config must be an object');
    }
    const c = config as {
      type?: string;
      veAeroTokenId?: string;
      strategy?: string;
      maxPools?: number;
    };
    if (c.type !== 'aerodrome-vote') {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Aerodrome config type must be "aerodrome-vote"`,
      );
    }
    if (!c.veAeroTokenId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Aerodrome config requires veAeroTokenId');
    }
    if (!c.strategy) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Aerodrome config requires strategy');
    }
    if (!c.maxPools || c.maxPools < 1) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Aerodrome config maxPools must be >= 1');
    }
  }

  getNextRun(_installation: { schedule?: { nextRunAt?: Date | null } }, now: Date): Date | null {
    return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  }

  checkTrigger(_ctx: AdapterContext): CheckTriggerResult {
    return { shouldRun: false, reason: 'Aerodrome adapter is not yet implemented' };
  }

  async buildAction(_ctx: AdapterContext): Promise<BuildActionResult> {
    throw new AppError(
      ErrorCode.ADAPTER_NOT_IMPLEMENTED,
      'Aerodrome Vote adapter is not implemented. buildAction is unavailable.',
    );
  }

  validateAction(_ctx: AdapterContext, _action: ProposedAction): void {
    throw new AppError(
      ErrorCode.ADAPTER_NOT_IMPLEMENTED,
      'Aerodrome Vote adapter is not implemented. validateAction is unavailable.',
    );
  }
}
