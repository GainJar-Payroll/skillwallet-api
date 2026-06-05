import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { nextRunFromFrequency } from '../../common/utils/time';
import type { Address, HexString } from '../../common/types/evm';
import { encodeTransfer } from './dex/uniswap-v3.builder';
import type {
  BuiltAction,
  GmSelfCallConfig,
  ISkillAdapter,
  PreparedExecutionCall,
  PreparedSkillReview,
  SkillAdapterContext,
  SkillPrepareContext,
  TriggerCheckResult,
} from './skill-adapter.interface';
import { gmSelfCallConfigSchema } from './skill-adapter.interface';

const SELF_CALL_PROBE_DATA = '0x00000000' as HexString;

@Injectable()
export class GmSelfCallAdapter implements ISkillAdapter<GmSelfCallConfig> {
  readonly kind = 'gm-self-call' as const;

  parseConfig(config: unknown): GmSelfCallConfig {
    const parsed = gmSelfCallConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.CONFIG_INVALID,
        400,
        parsed.error.issues[0]?.message ?? 'invalid gm-self-call config',
        parsed.error.flatten(),
      );
    }
    return parsed.data;
  }

  async prepare(
    ctx: SkillPrepareContext<GmSelfCallConfig>,
  ): Promise<PreparedSkillReview<GmSelfCallConfig>> {
    return {
      configSnapshot: ctx.config,
      previewCalls: this.buildPreviewCalls(ctx.smartAccountAddress as Address, ctx),
      review: {
        executionKind: 'self-call-probe',
        selfCallData: SELF_CALL_PROBE_DATA,
      },
      labels: {
        targets: {
          [ctx.relay.paymentToken]: 'payment token for 1Shot fee',
          [ctx.smartAccountAddress]: 'smart account self-call target',
        },
        selectors: {
          ['0xa9059cbb']: 'transfer(address,uint256)',
          ['0x00000000']: 'self-call probe selector 0x00000000',
        },
      },
    };
  }

  async checkTrigger(ctx: SkillAdapterContext<GmSelfCallConfig>): Promise<TriggerCheckResult> {
    const next = this.getNextRunAt(ctx.config, ctx.now);
    if (ctx.now < next) {
      return {
        shouldRun: false,
        reason: `next run scheduled at ${next.toISOString()}`,
        nextEligibleAt: next,
      };
    }
    return { shouldRun: true, reason: 'schedule due' };
  }

  getNextRunAt(config: GmSelfCallConfig, now: Date): Date {
    return nextRunFromFrequency(config.frequency, now);
  }

  async buildAction(
    ctx: SkillAdapterContext<GmSelfCallConfig>,
    config: GmSelfCallConfig,
  ): Promise<BuiltAction> {
    if (!ctx.grant) {
      throw new AppError(
        ErrorCode.NO_ACTIVE_GRANT,
        412,
        `Installation ${ctx.installationId} has no active delegation grant`,
      );
    }

    const executions = this.buildPreviewCalls(ctx.smartAccountAddress as Address, ctx);
    const bundle = {
      chainId: ctx.chainId,
      transactions: [
        {
          permissionContext: ctx.grant.permissionContext,
          executions: executions.map((execution) => ({
            target: execution.target,
            value: execution.value,
            callData: execution.callData,
          })),
        },
      ],
      context: {
        installationId: ctx.installationId,
        skillType: this.kind,
        description: 'GM self-call bundle (fee + smart-account self-call probe)',
        note: config.note,
      },
    };

    return {
      description: `GmSelfCall(note=${config.note ?? 'gm'})`,
      executions: [
        {
          description: executions[0].description,
          actions: [
            {
              target: executions[0].target,
              value: executions[0].value,
              callData: executions[0].callData,
              description: executions[0].description,
            },
          ],
        },
        {
          description: executions[1].description,
          actions: [
            {
              target: executions[1].target,
              value: executions[1].value,
              callData: executions[1].callData,
              description: executions[1].description,
            },
          ],
        },
      ],
      bundle,
    };
  }

  private buildPreviewCalls(
    smartAccountAddress: Address,
    ctx: Pick<
      SkillPrepareContext<GmSelfCallConfig> | SkillAdapterContext<GmSelfCallConfig>,
      'relay'
    >,
  ): PreparedExecutionCall[] {
    const amount = BigInt(ctx.relay.requiredPaymentAmount);
    if (amount <= 0n) {
      throw new AppError(
        ErrorCode.CONFIG_INVALID,
        400,
        'requiredPaymentAmount must be a positive base-unit integer string',
      );
    }

    return [
      {
        description: `Fee: transfer ${ctx.relay.requiredPaymentAmount} base units to 1Shot feeCollector ${ctx.relay.feeCollector}`,
        target: ctx.relay.paymentToken,
        value: '0x0',
        callData: encodeTransfer({
          token: ctx.relay.paymentToken,
          to: ctx.relay.feeCollector,
          amount,
        }) as HexString,
      },
      {
        description:
          'Smart-account self-call probe using selector 0x00000000. This is an honest proof call and may revert if the account rejects it.',
        target: smartAccountAddress,
        value: '0x0',
        callData: SELF_CALL_PROBE_DATA,
      },
    ];
  }
}
