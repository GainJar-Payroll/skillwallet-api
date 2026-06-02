import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Env } from '../../config/env.schema';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  Bundle7710,
  MultichainBundle7710,
  OneShotCapabilities,
  OneShotErrorCode,
  OneShotFeeData,
  OneShotStatusCode,
  OneShotStatusName,
  RelayerInterface,
  RelayerStatusResult,
  RelayInput,
  RelaySubmissionResult,
} from './relayer.interface';

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 envelopes
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: unknown;
}

interface JsonRpcSuccess<T> {
  jsonrpc: '2.0';
  id: string;
  result: T;
}

interface JsonRpcError {
  jsonrpc: '2.0';
  id: string;
  error: { code: number; message: string; data?: unknown };
}

type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcError;

// ---------------------------------------------------------------------------
// 1Shot URL / config helpers
// ---------------------------------------------------------------------------

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
  4200: ErrorCode.VALIDATION_ERROR,
  4202: ErrorCode.NOT_FOUND,
  4204: ErrorCode.RELAYER_ERROR,
  4210: ErrorCode.RELAYER_ERROR,
  4211: ErrorCode.RELAYER_ERROR,
};

@Injectable()
export class OneShotRelayerService implements RelayerInterface {
  private readonly logger = new Logger(OneShotRelayerService.name);
  private readonly relayerUrl: string;
  private readonly network: 'mainnet' | 'testnet';
  private readonly paymentTokenAddress: string;
  private readonly destinationUrl: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.network = this.config.get('ONESHOT_NETWORK', { infer: true });
    const override = this.config.get('ONESHOT_RELAYER_URL', { infer: true });
    this.relayerUrl = (
      override && override.length > 0 ? override : ONESHOT_NETWORK_URLS[this.network]
    ).replace(/\/$/, '');
    this.paymentTokenAddress = this.config.get('ONESHOT_PAYMENT_TOKEN_ADDRESS', {
      infer: true,
    });
    this.destinationUrl = this.config.get('ONESHOT_DESTINATION_URL', { infer: true });
  }

  // -------------------------------------------------------------------------
  // Configuration guard
  // -------------------------------------------------------------------------

  private ensureConfigured(requirePayment = false, requireDestination = false): void {
    // Network is always set (zod default 'testnet'); URL is derived.
    if (requirePayment && (!this.paymentTokenAddress || this.paymentTokenAddress === '')) {
      throw new AppError(
        ErrorCode.NOT_CONFIGURED,
        '1Shot relayer payment token is not configured. Set ONESHOT_PAYMENT_TOKEN_ADDRESS.',
      );
    }
    if (requireDestination && (!this.destinationUrl || this.destinationUrl === '')) {
      throw new AppError(
        ErrorCode.NOT_CONFIGURED,
        '1Shot webhook destination URL is not configured. Set ONESHOT_DESTINATION_URL.',
      );
    }
  }

  // -------------------------------------------------------------------------
  // JSON-RPC transport
  // -------------------------------------------------------------------------

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    const body: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: randomUUID(),
      method,
      params,
    };
    let res: Response;
    try {
      res = await fetch(`${this.relayerUrl}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

    let json: JsonRpcResponse<T>;
    try {
      json = (await res.json()) as JsonRpcResponse<T>;
    } catch (err) {
      throw new AppError(
        ErrorCode.RELAYER_ERROR,
        `1Shot relayer ${method} returned invalid JSON: ${(err as Error).message}`,
      );
    }

    if ('error' in json) {
      const code = json.error.code as OneShotErrorCode;
      const mapped = ERROR_CODE_TO_APP[code] ?? ErrorCode.RELAYER_ERROR;
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

    return json.result;
  }

  // -------------------------------------------------------------------------
  // Result normalization
  // -------------------------------------------------------------------------

  private normalize(result: unknown): RelaySubmissionResult {
    const obj = (result ?? {}) as Record<string, unknown>;
    const statusCode = (obj.statusCode ?? obj.status ?? 100) as OneShotStatusCode;
    const status = STATUS_CODE_TO_NAME[statusCode] ?? 'pending';
    const errCode = obj.errorCode as OneShotErrorCode | undefined;
    return {
      taskId: (obj.taskId as string) ?? '',
      statusCode,
      status,
      targetAddress: (obj.targetAddress as string) ?? '',
      paymentToken: (obj.paymentToken as string) ?? this.paymentTokenAddress,
      requiredPaymentAmount: (obj.requiredPaymentAmount as string) ?? '0',
      context: obj.context as string | undefined,
      txHash: obj.txHash as string | undefined,
      externalStatusUrl: obj.statusUrl as string | undefined,
      errorCode: errCode,
      errorMessage: obj.errorMessage as string | undefined,
    };
  }

  // -------------------------------------------------------------------------
  // 1Shot JSON-RPC methods (1:1 wire mapping)
  // -------------------------------------------------------------------------

  async getCapabilities(): Promise<OneShotCapabilities> {
    const result = await this.rpc<OneShotCapabilities>('relayer_getCapabilities', []);
    return result;
  }

  async getFeeData(bundle: Bundle7710): Promise<OneShotFeeData> {
    this.ensureConfigured(true);
    return this.rpc<OneShotFeeData>('relayer_getFeeData', [bundle]);
  }

  async estimate7710Transaction(bundle: Bundle7710): Promise<RelaySubmissionResult> {
    this.ensureConfigured(true);
    const result = await this.rpc<Record<string, unknown>>('relayer_estimate7710Transaction', [
      this.withDefaults(bundle),
    ]);
    return this.normalize(result);
  }

  async estimate7710TransactionMultichain(
    bundle: MultichainBundle7710,
  ): Promise<RelaySubmissionResult> {
    this.ensureConfigured(true);
    const result = await this.rpc<Record<string, unknown>>(
      'relayer_estimate7710TransactionMultichain',
      [this.withDefaultsMultichain(bundle)],
    );
    return this.normalize(result);
  }

  async send7710Transaction(bundle: Bundle7710): Promise<RelaySubmissionResult> {
    this.ensureConfigured(true, true);
    const result = await this.rpc<Record<string, unknown>>('relayer_send7710Transaction', [
      this.withDefaults(bundle),
    ]);
    return this.normalize(result);
  }

  async send7710TransactionMultichain(
    bundle: MultichainBundle7710,
  ): Promise<RelaySubmissionResult> {
    this.ensureConfigured(true, true);
    const result = await this.rpc<Record<string, unknown>>(
      'relayer_send7710TransactionMultichain',
      [this.withDefaultsMultichain(bundle)],
    );
    return this.normalize(result);
  }

  async sendTransaction(bundle: {
    chainId: number;
    tx: { to: string; data: string; value?: string };
  }): Promise<RelaySubmissionResult> {
    this.ensureConfigured(true, true);
    const result = await this.rpc<Record<string, unknown>>('relayer_sendTransaction', [
      {
        chainId: `0x${bundle.chainId.toString(16)}`,
        tx: {
          to: bundle.tx.to,
          data: bundle.tx.data,
          value: bundle.tx.value ?? '0x0',
        },
        taskId: randomUUID(),
        destinationUrl: this.destinationUrl,
      },
    ]);
    return this.normalize(result);
  }

  async sendTransactionMultichain(bundle: {
    transactions: Array<{
      chainId: number;
      tx: { to: string; data: string; value?: string };
    }>;
  }): Promise<RelaySubmissionResult> {
    this.ensureConfigured(true, true);
    const result = await this.rpc<Record<string, unknown>>('relayer_sendTransactionMultichain', [
      {
        transactions: bundle.transactions.map((t) => ({
          chainId: `0x${t.chainId.toString(16)}`,
          tx: {
            to: t.tx.to,
            data: t.tx.data,
            value: t.tx.value ?? '0x0',
          },
        })),
        taskId: randomUUID(),
        destinationUrl: this.destinationUrl,
      },
    ]);
    return this.normalize(result);
  }

  async getStatus(taskId: string): Promise<RelayerStatusResult> {
    const result = (await this.rpc<unknown>('relayer_getStatus', [taskId])) as Record<
      string,
      unknown
    > | null;
    const obj = result ?? {};
    const statusCode = (obj.statusCode ?? 100) as OneShotStatusCode;
    return {
      taskId,
      statusCode,
      status: STATUS_CODE_TO_NAME[statusCode] ?? 'pending',
      txHash: obj.txHash as string | undefined,
      errorCode: obj.errorCode as OneShotErrorCode | undefined,
      errorMessage: obj.errorMessage as string | undefined,
    };
  }

  // -------------------------------------------------------------------------
  // High-level helpers (used by RunnerService)
  // -------------------------------------------------------------------------

  async relayDelegatedExecution(input: RelayInput): Promise<RelaySubmissionResult> {
    this.ensureConfigured(true, true);
    const bundle: Bundle7710 = {
      chainId: input.chainId,
      transactions: [
        {
          permissionContext: input.permissionContext,
          executions: [
            {
              target: input.call.to,
              callData: input.call.data,
              value: input.call.value,
            },
          ],
        },
      ],
      context: input.context,
      taskId: input.taskId ?? randomUUID(),
      destinationUrl: this.destinationUrl,
    };
    return this.send7710Transaction(bundle);
  }

  async getRelayStatus(taskId: string): Promise<RelayerStatusResult> {
    return this.getStatus(taskId);
  }

  // -------------------------------------------------------------------------
  // Bundle defaults (taskId + destinationUrl)
  // -------------------------------------------------------------------------

  private withDefaults(bundle: Bundle7710): Bundle7710 {
    return {
      ...bundle,
      taskId: bundle.taskId ?? randomUUID(),
      destinationUrl: bundle.destinationUrl ?? this.destinationUrl,
    };
  }

  private withDefaultsMultichain(bundle: MultichainBundle7710): MultichainBundle7710 {
    return {
      ...bundle,
      taskId: bundle.taskId ?? randomUUID(),
      destinationUrl: bundle.destinationUrl ?? this.destinationUrl,
    };
  }
}
