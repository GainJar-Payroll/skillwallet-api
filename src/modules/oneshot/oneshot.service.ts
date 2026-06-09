import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { bytesToHex } from 'viem';

export interface OneShotExecution {
  target: `0x${string}`;
  value: string;
  data: `0x${string}`;
}

export interface OneShotTransaction {
  permissionContext: unknown[];
  executions: OneShotExecution[];
}

export interface OneShotSendParams {
  chainId: string;
  transactions: OneShotTransaction[];
  authorizationList?: unknown[];
}

export interface OneShotStatus {
  status: number;
  message?: string;
  hash?: `0x${string}`;
  logs?: unknown;
}

export interface OneShotPollOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_POLL_TIMEOUT_MS = 300_000;

@Injectable()
export class OneShotService {
  private readonly logger = new Logger(OneShotService.name);
  private readonly relayerUrl: string;
  private readonly defaultPollIntervalMs: number;
  private readonly defaultPollTimeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.relayerUrl = this.config.get<string>('oneShotRelayerUrl')!;
    this.defaultPollIntervalMs = this.toPositiveInt(
      this.config.get('oneShotPollIntervalMs'),
      DEFAULT_POLL_INTERVAL_MS,
    );
    this.defaultPollTimeoutMs = this.toPositiveInt(
      this.config.get('oneShotPollTimeoutMs'),
      DEFAULT_POLL_TIMEOUT_MS,
    );
  }

  async getCapabilities(chainId: number): Promise<Record<string, unknown>> {
    return this.rpc<Record<string, unknown>>('relayer_getCapabilities', [String(chainId)]);
  }

  async getFeeData(
    chainId: number | string,
    token: `0x${string}`,
  ): Promise<Record<string, unknown>> {
    return this.rpc<Record<string, unknown>>('relayer_getFeeData', {
      chainId: String(chainId),
      token,
    });
  }

  async send7710Transaction(params: OneShotSendParams): Promise<`0x${string}`> {
    return this.rpc<`0x${string}`>(
      'relayer_send7710Transaction',
      OneShotService.toRelayerJson(params),
    );
  }

  /**
   * Submits bundles across multiple chains in a single relayer call.
   * Returns one task ID per entry in the params array, in the same order.
   */
  async send7710TransactionMultichain(params: OneShotSendParams[]): Promise<string[]> {
    return this.rpc<string[]>(
      'relayer_send7710TransactionMultichain',
      params.map((p) => OneShotService.toRelayerJson(p)),
    );
  }

  async getStatus(taskId: `0x${string}`): Promise<OneShotStatus> {
    return this.rpc<OneShotStatus>('relayer_getStatus', { id: taskId, logs: true });
  }

  async poll(taskId: `0x${string}`, options: OneShotPollOptions = {}): Promise<OneShotStatus> {
    const timeoutMs = options.timeoutMs ?? this.defaultPollTimeoutMs;
    const intervalMs = options.intervalMs ?? this.defaultPollIntervalMs;
    const deadline = Date.now() + timeoutMs;

    this.logger.log(`Poll started taskId=${taskId}`);

    while (Date.now() < deadline) {
      const status = await this.getStatus(taskId);
      this.logger.debug(`status=${status.status} hash=${status.hash ?? '-'}`);

      if (status.status === 200) {
        this.logger.log(`Confirmed taskId=${taskId} hash=${status.hash ?? '-'}`);
        return status;
      }
      if (status.status === 400) {
        throw new Error(`Task rejected: ${JSON.stringify(status)}`);
      }
      if (status.status === 500) {
        throw new Error(`Task reverted: ${JSON.stringify(status)}`);
      }

      await new Promise((r) => setTimeout(r, intervalMs));
    }

    throw new Error(`Task ${taskId} timed out after ${timeoutMs}ms`);
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  /** Recursively converts bigints and Uint8Arrays to hex strings for JSON-RPC. */
  static toRelayerJson(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === 'bigint') return `0x${value.toString(16)}`;
    if (value instanceof Uint8Array) return bytesToHex(value);
    if (Array.isArray(value)) return value.map(OneShotService.toRelayerJson);
    if (typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [
          k,
          OneShotService.toRelayerJson(v),
        ]),
      );
    }
    return value;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    const body = { jsonrpc: '2.0' as const, id: 1, method, params };

    this.logger.debug(`RPC ${method}`);

    const res = await fetch(this.relayerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const json = (await res.json()) as {
      result?: T;
      error?: { code: number; message: string; data?: unknown };
    };

    if (!res.ok || json.error) {
      const msg = JSON.stringify(json.error ?? json);
      this.logger.error(`1Shot RPC error ${method}: ${msg}`);
      throw new Error(`1Shot error: ${msg}`);
    }

    if (json.result === undefined) {
      throw new Error(`1Shot missing result for ${method}: ${JSON.stringify(json)}`);
    }

    return json.result;
  }

  private toPositiveInt(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  }
}
