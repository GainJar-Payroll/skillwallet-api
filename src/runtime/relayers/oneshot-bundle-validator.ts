import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  Bundle7710,
  OneShotCapabilities,
  OneShotDelegation,
  OneShotDelegatedTransaction,
  OneShotTokenInfo,
} from './relayer.interface';

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const HEX_RE = /^0x([a-fA-F0-9]{2})*[a-fA-F0-9]?$|^0x$/;

function isAddress(s: unknown): s is string {
  return typeof s === 'string' && ADDRESS_RE.test(s);
}

function isHex(s: unknown): s is string {
  return typeof s === 'string' && HEX_RE.test(s);
}

export interface BundleValidationContext {
  chainId: number;
  paymentTokenAddress: string;
  capabilities?: OneShotCapabilities;
}

@Injectable()
export class OneShotBundleValidator {
  private readonly logger = new Logger(OneShotBundleValidator.name);

  validateShape(bundle: Bundle7710): void {
    if (!Number.isFinite(bundle.chainId) || bundle.chainId <= 0) {
      throw new AppError(
        ErrorCode.INVALID_ONESHOT_BUNDLE,
        `bundle.chainId must be a positive number, got ${String(bundle.chainId)}`,
      );
    }
    if (!Array.isArray(bundle.transactions) || bundle.transactions.length === 0) {
      throw new AppError(
        ErrorCode.INVALID_ONESHOT_BUNDLE,
        'bundle.transactions must be a non-empty array',
      );
    }
    this.ensureNoPrivateKeys(bundle, 'bundle');
    for (let i = 0; i < bundle.transactions.length; i += 1) {
      this.validateDelegatedTransaction(bundle.chainId, bundle.transactions[i], i);
    }
  }

  async validateAgainstCapabilities(
    bundle: Bundle7710,
    ctx: BundleValidationContext,
    fetchCapabilities: (chainId: number) => Promise<OneShotCapabilities>,
  ): Promise<void> {
    let caps = ctx.capabilities;
    if (!caps) {
      caps = await fetchCapabilities(ctx.chainId);
    }
    const chain = caps.chains.find((c) => Number(c.chainId) === ctx.chainId);
    if (!chain) {
      throw new AppError(
        ErrorCode.ONESHOT_CAPABILITY_UNSUPPORTED,
        `1Shot does not advertise chainId ${ctx.chainId} in capabilities`,
        { advertisedChains: caps.chains.map((c) => c.chainId) },
      );
    }
    const tokenOk = chain.tokens.some(
      (t) => t.address.toLowerCase() === ctx.paymentTokenAddress.toLowerCase(),
    );
    if (!tokenOk) {
      throw new AppError(
        ErrorCode.ONESHOT_PAYMENT_TOKEN_UNSUPPORTED,
        `Payment token ${ctx.paymentTokenAddress} not accepted on chainId ${ctx.chainId}`,
        { accepted: chain.tokens.map((t) => t.address) },
      );
    }
  }

  validateContext(
    context: string | undefined,
    expectedChainId: number,
    expectedPaymentToken: string,
  ): void {
    if (!context || context.length === 0) {
      throw new AppError(
        ErrorCode.MISSING_ONESHOT_CONTEXT,
        'relay context is required (call estimate first, pass result.context)',
      );
    }
    let parsed: {
      expiry?: number;
      chainId?: number | string;
      paymentTokenAddress?: string;
    };
    try {
      parsed = JSON.parse(context) as typeof parsed;
    } catch {
      throw new AppError(
        ErrorCode.EXPIRED_ONESHOT_CONTEXT,
        'relay context is not valid JSON (re-estimate to get a fresh context)',
      );
    }
    if (typeof parsed.expiry === 'number' && parsed.expiry * 1000 < Date.now()) {
      throw new AppError(
        ErrorCode.EXPIRED_ONESHOT_CONTEXT,
        `relay context expired at ${new Date(parsed.expiry * 1000).toISOString()} (re-estimate)`,
      );
    }
    if (parsed.chainId !== undefined && String(parsed.chainId) !== String(expectedChainId)) {
      throw new AppError(
        ErrorCode.SIGNATURE_REFRESH_REQUIRED,
        `relay context chainId ${String(parsed.chainId)} != expected ${expectedChainId} (re-sign)`,
      );
    }
    if (
      parsed.paymentTokenAddress !== undefined &&
      parsed.paymentTokenAddress.toLowerCase() !== expectedPaymentToken.toLowerCase()
    ) {
      throw new AppError(
        ErrorCode.SIGNATURE_REFRESH_REQUIRED,
        `relay context paymentTokenAddress ${parsed.paymentTokenAddress} != expected ${expectedPaymentToken} (re-sign)`,
      );
    }
  }

  parsePermissionContextString(input: string): OneShotDelegation[] {
    if (!input || input.length === 0) return [];
    if (input.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(input) as unknown;
        if (Array.isArray(parsed)) {
          return parsed as OneShotDelegation[];
        }
      } catch (err) {
        this.logger.warn(
          `permissionContext looks like JSON array but failed to parse: ${(err as Error).message}`,
        );
        return [];
      }
    }
    return [];
  }

  private validateDelegatedTransaction(
    chainId: number,
    transaction: OneShotDelegatedTransaction,
    index: number,
  ): void {
    const prefix = `bundle.transactions[${index}]`;
    if (!Array.isArray(transaction.permissionContext)) {
      throw new AppError(
        ErrorCode.INVALID_ONESHOT_BUNDLE,
        `${prefix}.permissionContext must be an array of Delegation objects`,
      );
    }
    if (transaction.permissionContext.length === 0) {
      throw new AppError(
        ErrorCode.INVALID_ONESHOT_BUNDLE,
        `${prefix}.permissionContext is empty (at least one delegation required)`,
      );
    }
    for (let j = 0; j < transaction.permissionContext.length; j += 1) {
      const d = transaction.permissionContext[j];
      if (!isAddress(d.delegate)) {
        throw new AppError(
          ErrorCode.INVALID_ONESHOT_BUNDLE,
          `${prefix}.permissionContext[${j}].delegate is not a valid address: ${String(d.delegate)}`,
        );
      }
      if (!isAddress(d.delegator)) {
        throw new AppError(
          ErrorCode.INVALID_ONESHOT_BUNDLE,
          `${prefix}.permissionContext[${j}].delegator is not a valid address: ${String(d.delegator)}`,
        );
      }
      if (!Array.isArray(d.caveats)) {
        throw new AppError(
          ErrorCode.INVALID_ONESHOT_BUNDLE,
          `${prefix}.permissionContext[${j}].caveats must be an array`,
        );
      }
      if (d.signature && !isHex(d.signature)) {
        throw new AppError(
          ErrorCode.INVALID_ONESHOT_BUNDLE,
          `${prefix}.permissionContext[${j}].signature is not valid hex`,
        );
      }
    }
    if (!Array.isArray(transaction.executions) || transaction.executions.length === 0) {
      throw new AppError(
        ErrorCode.INVALID_ONESHOT_BUNDLE,
        `${prefix}.executions must be a non-empty array`,
      );
    }
    for (let k = 0; k < transaction.executions.length; k += 1) {
      const e = transaction.executions[k];
      if (!isAddress(e.target)) {
        throw new AppError(
          ErrorCode.INVALID_ONESHOT_BUNDLE,
          `${prefix}.executions[${k}].target is not a valid address: ${String(e.target)}`,
        );
      }
      if (e.value && !isHex(e.value)) {
        throw new AppError(
          ErrorCode.INVALID_ONESHOT_BUNDLE,
          `${prefix}.executions[${k}].value is not valid hex: ${String(e.value)}`,
        );
      }
      if (!isHex(e.data)) {
        throw new AppError(
          ErrorCode.INVALID_ONESHOT_BUNDLE,
          `${prefix}.executions[${k}].data is not valid hex: ${String(e.data)}`,
        );
      }
    }
  }

  private ensureNoPrivateKeys(payload: unknown, prefix: string): void {
    const json = JSON.stringify(payload);
    if (/"privateKey"\s*:/i.test(json) || /"priv_key"\s*:/i.test(json)) {
      throw new AppError(
        ErrorCode.INVALID_ONESHOT_BUNDLE,
        `${prefix} contains a privateKey field (refused to relay)`,
      );
    }
  }

  pickPaymentToken(capabilities: OneShotCapabilities, chainId: number): OneShotTokenInfo | null {
    const chain = capabilities.chains.find((c) => Number(c.chainId) === chainId);
    if (!chain) return null;
    return chain.tokens[0] ?? null;
  }
}
