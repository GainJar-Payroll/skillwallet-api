import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { requireDexRouter } from '../../chains/registry/dex';
import { findToken } from '../../chains/registry/tokens';
import { encodeApprove, encodeExactInputSingle, encodeTransfer } from './dex/uniswap-v3.builder';
import type { Address, HexString } from '../../common/types/evm';
import type {
  BuiltAction,
  DirectRouterDcaConfig,
  ISkillAdapter,
  PreparedExecutionCall,
  PreparedSkillReview,
  SkillAdapterContext,
  SkillPrepareContext,
  TriggerCheckResult,
} from './skill-adapter.interface';
import { directRouterDcaConfigSchema } from './skill-adapter.interface';
import { nextRunFromFrequency } from '../../common/utils/time';
import { QuoterV2Service } from '../quoter/quoter-v2.service';

@Injectable()
export class DirectRouterDcaAdapter implements ISkillAdapter<DirectRouterDcaConfig> {
  readonly kind = 'direct-router-dca' as const;

  private readonly logger = new Logger(DirectRouterDcaAdapter.name);
  private readonly relayerUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly quoter: QuoterV2Service,
  ) {
    const raw = (config?.get?.('ONESHOT_RELAYER_URL') as string | undefined) ?? undefined;
    this.relayerUrl = raw ?? '';
    this.logger.log(
      `DirectRouterDcaAdapter initialized (relayerUrl=${this.relayerUrl || 'unset'})`,
    );
  }

  parseConfig(config: unknown): DirectRouterDcaConfig {
    const parsed = directRouterDcaConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.CONFIG_INVALID,
        400,
        parsed.error.issues[0]?.message ?? 'invalid direct-router-dca config',
        parsed.error.flatten(),
      );
    }
    if (!parsed.data.recipient) {
      throw new AppError(ErrorCode.CONFIG_INVALID, 400, 'recipient is required');
    }
    return parsed.data as DirectRouterDcaConfig;
  }

  async prepare(
    ctx: SkillPrepareContext<DirectRouterDcaConfig>,
  ): Promise<PreparedSkillReview<DirectRouterDcaConfig>> {
    const recipient = ctx.smartAccountAddress as Address;
    const config = this.parseConfig({ ...ctx.config, recipient });
    this.assertChainConfig(ctx.chainId, config);

    const amountIn = BigInt(config.amountPerRun);
    if (amountIn <= 0n) {
      throw new AppError(ErrorCode.AMOUNT_INVALID, 400, 'amountPerRun must be > 0');
    }

    let quotedAmountOut: bigint | undefined;
    let minAmountOut: bigint;
    if (config.quoteMode === 'router-quote') {
      quotedAmountOut = await this.quoter.quoteExactInputSingle({
        chainId: ctx.chainId,
        tokenIn: config.tokenIn.address as Address,
        tokenOut: config.tokenOut.address as Address,
        amountIn,
        fee: config.feeTier,
      });
      minAmountOut = applySlippage(quotedAmountOut, config.maxSlippageBps);
    } else {
      minAmountOut = BigInt(config.minAmountOut ?? '0');
    }

    const configSnapshot: DirectRouterDcaConfig = {
      ...config,
      recipient,
      minAmountOut: minAmountOut.toString(),
      ...(quotedAmountOut ? { quotedAmountOut: quotedAmountOut.toString() } : {}),
    };

    return {
      configSnapshot,
      previewCalls: this.buildPreviewCalls({
        relay: ctx.relay,
        chainId: ctx.chainId,
        config: configSnapshot,
      }),
      review:
        quotedAmountOut !== undefined
          ? {
              amountOut: quotedAmountOut.toString(),
              minAmountOut: minAmountOut.toString(),
            }
          : { minAmountOut: minAmountOut.toString() },
      labels: {
        targets: {
          [ctx.relay.paymentToken]: 'payment token for 1Shot fee',
          [configSnapshot.tokenIn.address]: 'tokenIn approval target',
          [configSnapshot.router.address]: 'Uniswap V3 SwapRouter02',
        },
        selectors: {
          ['0xa9059cbb']: 'transfer(address,uint256)',
          ['0x095ea7b3']: 'approve(address,uint256)',
          ['0x04e45aaf']: 'exactInputSingle((...))',
        },
      },
    };
  }

  async checkTrigger(ctx: SkillAdapterContext<DirectRouterDcaConfig>): Promise<TriggerCheckResult> {
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

  getNextRunAt(config: DirectRouterDcaConfig, now: Date): Date {
    return nextRunFromFrequency(config.frequency, now);
  }

  async buildAction(
    ctx: SkillAdapterContext<DirectRouterDcaConfig>,
    config: DirectRouterDcaConfig,
  ): Promise<BuiltAction> {
    if (!ctx.grant) {
      throw new AppError(
        ErrorCode.NO_ACTIVE_GRANT,
        412,
        `Installation ${ctx.installationId} has no active delegation grant`,
      );
    }

    this.assertChainConfig(ctx.chainId, config);
    const amountIn = BigInt(config.amountPerRun);
    if (amountIn <= 0n) {
      throw new AppError(ErrorCode.AMOUNT_INVALID, 400, 'amountPerRun must be > 0');
    }

    let amountOutMinimum: bigint;
    if (config.quoteMode === 'manual-min-out') {
      amountOutMinimum = BigInt(config.minAmountOut ?? '0');
    } else {
      if (!config.minAmountOut) {
        throw new AppError(
          ErrorCode.CONFIG_INVALID,
          400,
          'router-quote config missing prepared minAmountOut',
        );
      }
      amountOutMinimum = BigInt(config.minAmountOut);
    }

    const previewCalls = this.buildPreviewCalls({
      relay: ctx.relay,
      chainId: ctx.chainId,
      config,
    });

    const execFee = {
      description: previewCalls[0].description,
      actions: [
        {
          target: previewCalls[0].target,
          value: previewCalls[0].value,
          callData: previewCalls[0].callData,
          description: 'ERC20.transfer(feeCollector, requiredPaymentAmount)',
        },
      ],
    };

    const execApprove = {
      description: previewCalls[1].description,
      actions: [
        {
          target: previewCalls[1].target,
          value: previewCalls[1].value,
          callData: previewCalls[1].callData,
          description: `ERC20.approve(SwapRouter02, ${amountIn.toString()})`,
        },
      ],
    };

    const execSwap = {
      description: previewCalls[2].description,
      actions: [
        {
          target: previewCalls[2].target,
          value: previewCalls[2].value,
          callData: previewCalls[2].callData,
          description: 'SwapRouter02.exactInputSingle',
        },
      ],
    };

    const tokenIn = findToken(ctx.chainId, config.tokenIn.address);
    const tokenOut = findToken(ctx.chainId, config.tokenOut.address);

    const bundle = {
      chainId: ctx.chainId,
      transactions: [
        {
          permissionContext: ctx.grant.permissionContext,
          executions: [...execFee.actions, ...execApprove.actions, ...execSwap.actions],
        },
      ],
      context: {
        installationId: ctx.installationId,
        skillType: this.kind,
        description: 'Direct router DCA bundle (fee + approve + swap)',
      },
    };

    this.logger.log(
      `buildAction: installation=${ctx.installationId} chain=${ctx.chainId} amountIn=${amountIn.toString()} minOut=${amountOutMinimum.toString()}`,
    );

    return {
      description: `DirectRouterDca(${tokenIn?.symbol ?? 'tokenIn'}->${tokenOut?.symbol ?? 'tokenOut'}, amountIn=${amountIn.toString()}, minOut=${amountOutMinimum.toString()})`,
      executions: [execFee, execApprove, execSwap],
      bundle,
    };
  }

  private assertChainConfig(chainId: number, config: DirectRouterDcaConfig): void {
    const router = requireDexRouter(chainId, 'uniswap-v3');
    const tokenIn = findToken(chainId, config.tokenIn.address);
    const tokenOut = findToken(chainId, config.tokenOut.address);
    if (!tokenIn) {
      throw new AppError(
        ErrorCode.TOKEN_NOT_IN_REGISTRY,
        400,
        `tokenIn ${config.tokenIn.address} not in registry`,
      );
    }
    if (!tokenOut) {
      throw new AppError(
        ErrorCode.TOKEN_NOT_IN_REGISTRY,
        400,
        `tokenOut ${config.tokenOut.address} not in registry`,
      );
    }
    if (config.router.address.toLowerCase() !== router.swapRouter02.toLowerCase()) {
      throw new AppError(
        ErrorCode.ROUTER_MISMATCH,
        400,
        `router.address ${config.router.address} does not match chainId ${chainId} registered swapRouter02 ${router.swapRouter02}`,
      );
    }
  }

  private buildPreviewCalls(input: {
    relay: SkillPrepareContext<DirectRouterDcaConfig>['relay'];
    chainId: number;
    config: DirectRouterDcaConfig;
  }): PreparedExecutionCall[] {
    const amountIn = BigInt(input.config.amountPerRun);
    const requiredPaymentAmount = BigInt(input.relay.requiredPaymentAmount);
    const minAmountOut = BigInt(input.config.minAmountOut ?? '0');

    return [
      {
        description: `Fee: transfer ${requiredPaymentAmount.toString()} base units to 1Shot feeCollector ${input.relay.feeCollector}`,
        target: input.relay.paymentToken,
        value: '0x0',
        callData: encodeTransfer({
          token: input.relay.paymentToken,
          to: input.relay.feeCollector,
          amount: requiredPaymentAmount,
        }) as HexString,
      },
      {
        description: `Approve SwapRouter02 ${input.config.router.address} to spend ${amountIn.toString()} of ${input.config.tokenIn.address}`,
        target: input.config.tokenIn.address as Address,
        value: '0x0',
        callData: encodeApprove({
          token: input.config.tokenIn.address as Address,
          spender: input.config.router.address as Address,
          amount: amountIn,
        }) as HexString,
      },
      {
        description: `SwapRouter02.exactInputSingle fee=${input.config.feeTier} amountIn=${amountIn.toString()} minOut=${minAmountOut.toString()}`,
        target: input.config.router.address as Address,
        value: '0x0',
        callData: encodeExactInputSingle({
          tokenIn: input.config.tokenIn.address as Address,
          tokenOut: input.config.tokenOut.address as Address,
          fee: input.config.feeTier,
          recipient: input.config.recipient as Address,
          amountIn,
          amountOutMinimum: minAmountOut,
          sqrtPriceLimitX96: 0n,
        }) as HexString,
      },
    ];
  }
}

function applySlippage(amountOut: bigint, bps: number): bigint {
  return (amountOut * BigInt(10000 - bps)) / 10000n;
}
