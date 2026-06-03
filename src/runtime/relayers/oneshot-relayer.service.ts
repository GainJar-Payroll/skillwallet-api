import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { DEFAULT_PAYMENT_TOKEN_BY_CHAIN, Env } from '../../config/env.schema';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  Bundle7710,
  MultichainBundle7710,
  OneShotCapabilities,
  OneShotChainCapability,
  OneShotDelegatedTransaction,
  OneShotErrorCode,
  OneShotEstimateResult,
  OneShotExecution,
  OneShotFeeData,
  OneShotSendResult,
  OneShotStatusCode,
  OneShotStatusName,
  OneShotStatusResult,
  OneShotTokenInfo,
  RelayInput,
  RelaySubmissionResult,
  RelayerInterface,
  RelayerStatusResult,
} from './relayer.interface';
import { WebhookSignatureVerifier } from './webhook-signature-verifier.service';
import { OneShotBundleValidator } from './oneshot-bundle-validator';

const ONESHOT_NETWORK_URLS = {
  mainnet: 'https://relayer.1shotapi.com/relayers',
  testnet: 'https://relayer.1shotapi.dev/relayers',
} as const;

const STATUS_CODE_TO_NAME: Record<OneShotStatusCode, OneShotStatusName> = {
  100: 'pending',
  110: 'submitted',
  200: 'confirmed',
  400: 'rejected',
  500: 'reverted',
};

const ERROR_CODE_TO_APP: Partial<Record<OneShotErrorCode, ErrorCode>> = {
  4001: ErrorCode.ONESHOT_RPC_ERROR,
  4200: ErrorCode.ONESHOT_INSUFFICIENT_PAYMENT,
  4202: ErrorCode.ONESHOT_PAYMENT_TOKEN_UNSUPPORTED,
  4204: ErrorCode.EXPIRED_ONESHOT_CONTEXT,
  4210: ErrorCode.ONESHOT_INVALID_AUTHORIZATION_LIST,
  4211: ErrorCode.ONESHOT_SIMULATION_FAILED,
};

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function isAddress(s: unknown): s is string {
  return typeof s === 'string' && ADDRESS_RE.test(s);
}

@Injectable()
export class OneShotRelayerService implements RelayerInterface {
  private readonly logger = new Logger(OneShotRelayerService.name);
  private readonly relayerUrl: string;
  private readonly network: 'mainnet' | 'testnet';
  private readonly paymentTokenAddress: string;
  private readonly destinationUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly relayerWallet: string;
  private readonly activeChainId: number;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly webhookVerifier: WebhookSignatureVerifier,
    private readonly validator: OneShotBundleValidator,
  ) {
    this.network = this.config.get('ONESHOT_NETWORK', { infer: true });
    const override = this.config.get('ONESHOT_RELAYER_URL', { infer: true });
    this.relayerUrl = (
      override && override.length > 0 ? override : ONESHOT_NETWORK_URLS[this.network]
    ).replace(/\/$/, '');
    const explicitToken = this.config.get('ONESHOT_PAYMENT_TOKEN_ADDRESS', { infer: true });
    this.activeChainId =
      this.network === 'testnet'
        ? this.config.get('ONESHOT_TESTNET_CHAIN_ID', { infer: true })
        : this.config.get('ONESHOT_MAINNET_CHAIN_ID', { infer: true });
    this.paymentTokenAddress =
      explicitToken && explicitToken.length > 0
        ? explicitToken
        : (DEFAULT_PAYMENT_TOKEN_BY_CHAIN[this.activeChainId] ?? '');
    this.destinationUrl = this.config.get('ONESHOT_DESTINATION_URL', { infer: true });
    this.apiKey = this.config.get('ONESHOT_API_KEY', { infer: true });
    this.apiSecret = this.config.get('ONESHOT_API_SECRET', { infer: true });
    this.relayerWallet = this.config.get('ONESHOT_RELAYER_WALLET', { infer: true });
  }

  getPaymentTokenAddress(): string {
    return this.paymentTokenAddress;
  }

  getRelayerWallet(): string {
    return this.relayerWallet;
  }

  getActiveChainId(): number {
    return this.activeChainId;
  }

  private ensureConfigured(requirePayment = false): void {
    if (requirePayment && (!this.paymentTokenAddress || this.paymentTokenAddress === '')) {
      throw new AppError(
        ErrorCode.NOT_CONFIGURED,
        '1Shot relayer payment token is not configured. Set ONESHOT_PAYMENT_TOKEN_ADDRESS to an ERC-20 the relayer accepts on this chain.',
      );
    }
  }

  private resolveDestinationUrl(bundle: { destinationUrl?: string }): string {
    return bundle.destinationUrl ?? this.destinationUrl ?? '';
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey && this.apiKey.length > 0) {
      headers['x-api-key'] = this.apiKey;
    }
    if (this.apiSecret && this.apiSecret.length > 0) {
      headers['x-api-secret'] = this.apiSecret;
    }
    return headers;
  }

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    const body = {
      jsonrpc: '2.0' as const,
      id: randomUUID(),
      method,
      params,
    };
    let res: Response;
    try {
      res = await fetch(this.relayerUrl, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
      });
    } catch (err) {
      this.logger.error(`1Shot transport error on ${method}: ${(err as Error).message}`);
      throw new AppError(
        ErrorCode.RELAYER_ERROR,
        `1Shot relayer request failed: ${(err as Error).message}`,
      );
    }

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`1Shot ${method} returned HTTP ${res.status}: ${text.slice(0, 500)}`);
      throw new AppError(
        ErrorCode.RELAYER_ERROR,
        `1Shot relayer ${method} returned status ${res.status}`,
        { status: res.status, body: text.slice(0, 500) },
      );
    }

    let json: { result?: T; error?: { code: number; message: string; data?: unknown } };
    try {
      json = (await res.json()) as typeof json;
    } catch (err) {
      throw new AppError(
        ErrorCode.RELAYER_ERROR,
        `1Shot relayer ${method} returned invalid JSON: ${(err as Error).message}`,
      );
    }

    if (json.error) {
      const code = json.error.code as OneShotErrorCode;
      const mapped = ERROR_CODE_TO_APP[code] ?? ErrorCode.ONESHOT_RPC_ERROR;
      this.logger.error(`1Shot ${method} JSON-RPC error ${json.error.code}: ${json.error.message}`);
      throw new AppError(
        mapped,
        `1Shot ${method} error ${json.error.code}: ${json.error.message}`,
        {
          code: json.error.code,
          data: json.error.data,
        },
      );
    }

    if (json.result === undefined) {
      throw new AppError(
        ErrorCode.ONESHOT_RPC_ERROR,
        `1Shot ${method} returned empty result (no result, no error)`,
      );
    }

    return json.result;
  }

  async getCapabilities(chainId: number = this.activeChainId): Promise<OneShotCapabilities> {
    const raw =
      (await this.rpc<Record<string, unknown>>('relayer_getCapabilities', [String(chainId)])) ?? {};
    const chains: OneShotChainCapability[] = Object.entries(raw)
      .filter(([, v]) => v && typeof v === 'object')
      .map(([id, v]) => {
        const c = v as Record<string, unknown>;
        const tokens: OneShotTokenInfo[] = Array.isArray(c.tokens)
          ? (c.tokens as Array<Record<string, unknown>>)
              .filter((t) => isAddress(t.address))
              .map((t) => ({
                address: t.address as string,
                decimals: typeof t.decimals === 'string' ? t.decimals : Number(t.decimals ?? 0),
                symbol: (t.symbol as string) ?? undefined,
                name: (t.name as string) ?? undefined,
              }))
          : [];
        return {
          chainId: id,
          feeCollector: (c.feeCollector as string) ?? '',
          targetAddress: (c.targetAddress as string) ?? '',
          tokens,
        };
      });
    return { chains, raw };
  }

  async getFeeData(bundle: Bundle7710): Promise<OneShotFeeData> {
    this.ensureConfigured(true);
    const raw = await this.rpc<Record<string, unknown>>('relayer_getFeeData', {
      chainId: String(bundle.chainId),
      token: this.paymentTokenAddress,
    });
    return {
      chainId: String(raw.chainId ?? bundle.chainId),
      token: {
        address: ((raw.token as Record<string, unknown> | undefined)?.address as string) ?? '',
        decimals:
          typeof (raw.token as Record<string, unknown> | undefined)?.decimals === 'string'
            ? ((raw.token as Record<string, unknown>).decimals as string)
            : Number((raw.token as Record<string, unknown> | undefined)?.decimals ?? 0),
        symbol: ((raw.token as Record<string, unknown> | undefined)?.symbol as string) ?? undefined,
        name: ((raw.token as Record<string, unknown> | undefined)?.name as string) ?? undefined,
      },
      rate: Number(raw.rate ?? 0),
      minFee: String(raw.minFee ?? '0'),
      expiry: Number(raw.expiry ?? 0),
      gasPrice: String(raw.gasPrice ?? '0x0'),
      feeCollector: (raw.feeCollector as string) ?? '',
      targetAddress: (raw.targetAddress as string) ?? '',
      context: (raw.context as string) ?? '',
      raw,
    };
  }

  async estimate7710Transaction(bundle: Bundle7710): Promise<OneShotEstimateResult> {
    this.ensureConfigured(true);
    return this.estimateSingle(bundle);
  }

  async estimate7710TransactionMultichain(
    bundle: MultichainBundle7710,
  ): Promise<OneShotEstimateResult> {
    this.ensureConfigured(true);
    return this.estimateMulti(bundle);
  }

  private async estimateSingle(bundle: Bundle7710): Promise<OneShotEstimateResult> {
    const params = this.buildSendParams(bundle);
    const raw = await this.rpc<Record<string, unknown>>('relayer_estimate7710Transaction', params);
    return this.normalizeEstimate(raw);
  }

  private async estimateMulti(bundle: MultichainBundle7710): Promise<OneShotEstimateResult> {
    const params = this.buildMultichainSendParams(bundle);
    const raw = await this.rpc<Record<string, unknown>>(
      'relayer_estimate7710TransactionMultichain',
      params,
    );
    return this.normalizeEstimate(raw);
  }

  private normalizeEstimate(raw: Record<string, unknown>): OneShotEstimateResult {
    const gasUsed = (raw.gasUsed as Record<string, unknown>) ?? {};
    const gasUsedStrings: Record<string, string> = {};
    for (const [k, v] of Object.entries(gasUsed)) {
      gasUsedStrings[k] = String(v);
    }
    const contextByChainIdRaw = (raw.contextByChainId as Record<string, unknown>) ?? {};
    const contextByChainId: Record<string, string> = {};
    for (const [k, v] of Object.entries(contextByChainIdRaw)) {
      contextByChainId[k] = String(v);
    }
    return {
      success: Boolean(raw.success),
      paymentTokenAddress: (raw.paymentTokenAddress as string) ?? undefined,
      paymentChain: raw.paymentChain === undefined ? undefined : Number(raw.paymentChain),
      gasUsed: gasUsedStrings,
      requiredPaymentAmount: String(raw.requiredPaymentAmount ?? '0'),
      context: (raw.context as string) ?? '',
      contextByChainId: Object.keys(contextByChainId).length > 0 ? contextByChainId : undefined,
      error: (raw.error as string) ?? undefined,
      raw,
    };
  }

  async send7710Transaction(bundle: Bundle7710): Promise<OneShotSendResult> {
    this.ensureConfigured(true);
    if (!this.resolveDestinationUrl(bundle)) {
      this.logger.warn(
        '1Shot send: no destinationUrl set (env or bundle); webhook will not fire. Use relayer_getStatus to poll.',
      );
    }
    const params = this.buildSendParams(bundle);
    const raw = await this.rpc<string>('relayer_send7710Transaction', params);
    return { taskId: raw, raw };
  }

  async send7710TransactionMultichain(bundle: MultichainBundle7710): Promise<OneShotSendResult> {
    this.ensureConfigured(true);
    if (!this.resolveDestinationUrl(bundle)) {
      this.logger.warn(
        '1Shot send multichain: no destinationUrl set; webhook will not fire. Use relayer_getStatus to poll.',
      );
    }
    const params = this.buildMultichainSendParams(bundle);
    const raw = await this.rpc<string>('relayer_send7710TransactionMultichain', params);
    return { taskId: raw, raw };
  }

  async sendTransaction(bundle: {
    chainId: number;
    tx: { to: string; data: string; value?: string };
  }): Promise<OneShotSendResult> {
    this.ensureConfigured(true);
    if (!this.destinationUrl) {
      this.logger.warn(
        '1Shot sendTransaction: no destinationUrl set; webhook will not fire. Use relayer_getStatus to poll.',
      );
    }
    const raw = await this.rpc<string>('relayer_sendTransaction', {
      chainId: String(bundle.chainId),
      payment: {
        type: 'token',
        address: this.paymentTokenAddress,
      },
      to: bundle.tx.to,
      data: bundle.tx.data,
      value: bundle.tx.value ?? '0x0',
      taskId: randomUUID(),
      destinationUrl: this.destinationUrl,
    });
    return { taskId: raw, raw };
  }

  async sendTransactionMultichain(bundle: {
    transactions: Array<{
      chainId: number;
      tx: { to: string; data: string; value?: string };
    }>;
  }): Promise<string[]> {
    this.ensureConfigured(true);
    const params = bundle.transactions.map((t) => ({
      chainId: String(t.chainId),
      payment: {
        type: 'token',
        address: this.paymentTokenAddress,
      },
      to: t.tx.to,
      data: t.tx.data,
      value: t.tx.value ?? '0x0',
    }));
    return this.rpc<string[]>('relayer_sendTransactionMultichain', params);
  }

  async getStatus(taskId: string): Promise<RelayerStatusResult> {
    const raw =
      (await this.rpc<Record<string, unknown>>('relayer_getStatus', {
        id: taskId,
        logs: false,
      })) ?? {};
    return this.normalizeStatus(taskId, raw);
  }

  private normalizeStatus(taskId: string, raw: Record<string, unknown>): RelayerStatusResult {
    const statusCode = Number(raw.status) as OneShotStatusCode;
    if (![100, 110, 200, 400, 500].includes(statusCode)) {
      this.logger.error(`1Shot getStatus returned unknown status code: ${raw.status}`);
      throw new AppError(
        ErrorCode.RELAY_STATUS_UNKNOWN,
        `1Shot getStatus returned unknown status code: ${String(raw.status)}`,
        { raw },
      );
    }
    const status: OneShotStatusName = STATUS_CODE_TO_NAME[statusCode];
    const result: OneShotStatusResult = {
      id: String(raw.id ?? taskId),
      chainId: String(raw.chainId ?? ''),
      createdAt: Number(raw.createdAt ?? 0),
      status: statusCode,
    } as OneShotStatusResult;
    if (statusCode === 110) {
      (result as { hash?: string }).hash = String((raw as { hash?: string }).hash ?? '');
    }
    if (statusCode === 200) {
      (result as { receipt?: unknown }).receipt = raw.receipt;
    }
    if (statusCode === 400 || statusCode === 500) {
      (result as { message?: string }).message = (raw.message as string) ?? '';
      (result as { data?: unknown }).data = raw.data;
    }
    const memo = (raw.memo as string) ?? undefined;
    if (memo) (result as { memo?: string }).memo = memo;

    return {
      taskId,
      statusCode,
      status,
      chainId: result.chainId,
      createdAt: result.createdAt,
      txHash:
        statusCode === 110
          ? (result as { hash?: string }).hash
          : statusCode === 200
            ? ((raw.receipt as { transactionHash?: string } | undefined)?.transactionHash ?? '')
            : undefined,
      receipt: statusCode === 200 ? (raw.receipt as RelayerStatusResult['receipt']) : undefined,
      errorMessage:
        statusCode === 400 || statusCode === 500
          ? ((result as { message?: string }).message ?? undefined)
          : undefined,
      raw: result,
    };
  }

  async verifyWebhookSignature(
    rawBody: Buffer,
    signature: string,
    keyId?: string,
  ): Promise<boolean> {
    return this.webhookVerifier.verify(rawBody, signature, keyId);
  }

  async relayDelegatedExecution(input: RelayInput): Promise<RelaySubmissionResult> {
    this.ensureConfigured(true);

    const permissionContext = this.validator.parsePermissionContextString(input.permissionContext);
    if (permissionContext.length === 0) {
      throw new AppError(
        ErrorCode.INVALID_ONESHOT_BUNDLE,
        'permissionContext is empty or unparseable (expected JSON-encoded Delegation[])',
      );
    }

    const execution: OneShotExecution = {
      target: input.call.to,
      value: input.call.value ?? '0x0',
      data: input.call.data,
    };

    const transaction: OneShotDelegatedTransaction = {
      permissionContext,
      executions: [execution],
    };

    const bundle: Bundle7710 = {
      chainId: input.chainId,
      transactions: [transaction],
      context: input.context,
      taskId: input.taskId ?? randomUUID(),
      destinationUrl: this.resolveDestinationUrl(input),
    };

    this.validator.validateShape(bundle);
    this.validator.validateContext(input.context, input.chainId, this.paymentTokenAddress);
    await this.validator.validateAgainstCapabilities(
      bundle,
      { chainId: input.chainId, paymentTokenAddress: this.paymentTokenAddress },
      (id) => this.getCapabilities(id),
    );

    let result: OneShotSendResult;
    try {
      result = await this.send7710Transaction(bundle);
    } catch (err) {
      throw err;
    }

    return {
      taskId: result.taskId,
      statusCode: 100,
      status: 'pending',
      targetAddress: this.relayerWallet,
      paymentToken: this.paymentTokenAddress,
      requiredPaymentAmount: '0',
      context: input.context,
      raw: result.raw,
    };
  }

  async getRelayStatus(taskId: string): Promise<RelayerStatusResult> {
    return this.getStatus(taskId);
  }

  private buildSendParams(bundle: Bundle7710): Record<string, unknown> {
    const params: Record<string, unknown> = {
      chainId: String(bundle.chainId),
      transactions: bundle.transactions,
    };
    if (bundle.context) params.context = bundle.context;
    if (bundle.authorizationList) params.authorizationList = bundle.authorizationList;
    if (bundle.taskId) params.taskId = bundle.taskId;
    else params.taskId = randomUUID();
    if (bundle.destinationUrl) params.destinationUrl = bundle.destinationUrl;
    else if (this.destinationUrl) params.destinationUrl = this.destinationUrl;
    if (bundle.memo) params.memo = bundle.memo;
    return params;
  }

  private buildMultichainSendParams(bundle: MultichainBundle7710): Record<string, unknown> {
    const params: Record<string, unknown> = {
      transactions: bundle.transactions.map((t) => {
        const inner: Record<string, unknown> = {
          chainId: String(t.chainId),
          transactions: t.transactions,
        };
        if (t.context) inner.context = t.context;
        if (t.authorizationList) inner.authorizationList = t.authorizationList;
        if (t.taskId) inner.taskId = t.taskId;
        if (t.destinationUrl) inner.destinationUrl = t.destinationUrl;
        if (t.memo) inner.memo = t.memo;
        return inner;
      }),
    };
    if (bundle.context) params.context = bundle.context;
    if (bundle.authorizationList) params.authorizationList = bundle.authorizationList;
    if (bundle.taskId) params.taskId = bundle.taskId;
    if (bundle.destinationUrl) params.destinationUrl = bundle.destinationUrl;
    if (bundle.memo) params.memo = bundle.memo;
    return params;
  }
}
