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
  authorizationList?: unknown[];
  transactions: OneShotTransaction[];
}

export interface OneShotStatus {
  status: number;
  message?: string;
  hash?: `0x${string}`;
  logs?: unknown;
}

@Injectable()
export class OneShotService {
  private readonly logger = new Logger(OneShotService.name);
  private readonly relayerUrl: string;

  constructor(private readonly config: ConfigService) {
    this.relayerUrl = this.config.get<string>('oneShotRelayerUrl')!;
  }

  async getCapabilities(chainId: number): Promise<Record<string, unknown>> {
    return this.rpc<Record<string, unknown>>('relayer_getCapabilities', [chainId]);
  }

  async getFeeData(chainId: number, token: `0x${string}`): Promise<Record<string, unknown>> {
    return this.rpc<Record<string, unknown>>('relayer_getFeeData', [chainId, token]);
  }

  async send7710Transaction(params: OneShotSendParams): Promise<`0x${string}`> {
    return this.rpc<`0x${string}`>(
      'relayer_send7710Transaction',
      [OneShotService.toRelayerJson(params)],
    );
  }

  async getStatus(taskId: `0x${string}`): Promise<OneShotStatus> {
    return this.rpc<OneShotStatus>('relayer_getStatus', [taskId]);
  }

  async poll(taskId: `0x${string}`, timeoutMs = 300_000): Promise<OneShotStatus> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.getStatus(taskId);
      if (status.status === 200) return status;
      if (status.status === 400) {
        throw new Error(`1Shot task rejected: ${status.message ?? 'unknown'}`);
      }
      if (status.status === 500) {
        throw new Error(`1Shot task reverted: ${status.message ?? 'unknown'}`);
      }
      await new Promise((r) => setTimeout(r, 3_000));
    }
    throw new Error(`1Shot task ${taskId} timed out after ${timeoutMs}ms`);
  }

  private async rpc<T>(method: string, params: unknown, id = 1): Promise<T> {
    const body = { jsonrpc: '2.0', id, method, params };
    const res = await fetch(this.relayerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { result?: T; error?: unknown };
    if (!res.ok || json.error) {
      const errMsg = JSON.stringify(json.error ?? json);
      this.logger.error(`1Shot error: ${errMsg}`);
      throw new Error(`1Shot error: ${errMsg}`);
    }
    return json.result as T;
  }

  static toRelayerJson(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === 'bigint') {
      return '0x' + value.toString(16);
    }
    if (value instanceof Uint8Array) {
      return bytesToHex(value);
    }
    if (Array.isArray(value)) {
      return value.map((v) => OneShotService.toRelayerJson(v));
    }
    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = OneShotService.toRelayerJson(v);
      }
      return out;
    }
    return value;
  }
}
