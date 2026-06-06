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
    return this.rpc<Record<string, unknown>>('relayer_getCapabilities', [String(chainId)], 1);
  }

  async getFeeData(input: {
    chainId: number | string;
    token: `0x${string}`;
  }): Promise<Record<string, unknown>> {
    return this.rpc<Record<string, unknown>>(
      'relayer_getFeeData',
      {
        chainId: String(input.chainId),
        token: input.token,
      },
      2,
    );
  }

  async send7710Transaction(params: OneShotSendParams): Promise<`0x${string}`> {
    const normalized = OneShotService.toRelayerJson(params);

    return this.rpc<`0x${string}`>('relayer_send7710Transaction', normalized, 3);
  }

  async getStatus(taskId: `0x${string}`): Promise<OneShotStatus> {
    return this.rpc<OneShotStatus>(
      'relayer_getStatus',
      {
        id: taskId,
        logs: true,
      },
      4,
    );
  }

  async poll(taskId: `0x${string}`, timeoutMs = 300_000): Promise<OneShotStatus> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const status = await this.getStatus(taskId);

      this.logger.log(
        `1Shot status=${status.status} hash=${status.hash ?? '-'} message=${status.message ?? '-'}`,
      );

      if (status.status === 200) return status;

      if (status.status === 400) {
        throw new Error(`1Shot task rejected: ${JSON.stringify(status)}`);
      }

      if (status.status === 500) {
        throw new Error(`1Shot task reverted: ${JSON.stringify(status)}`);
      }

      await new Promise((r) => setTimeout(r, 3_000));
    }

    throw new Error(`1Shot task ${taskId} timed out after ${timeoutMs}ms`);
  }

  private async rpc<T>(method: string, params: unknown, id = 1): Promise<T> {
    const body = {
      jsonrpc: '2.0' as const,
      id,
      method,
      params,
    };

    this.logger.debug(`1Shot RPC request ${method}: ${JSON.stringify(body, null, 2)}`);

    const res = await fetch(this.relayerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const json = (await res.json()) as {
      result?: T;
      error?: {
        code: number;
        message: string;
        data?: unknown;
      };
    };

    if (!res.ok || json.error) {
      const errMsg = JSON.stringify(json.error ?? json);
      this.logger.error(`1Shot error: ${errMsg}`);
      throw new Error(`1Shot error: ${errMsg}`);
    }

    if (json.result === undefined) {
      throw new Error(`1Shot missing result: ${JSON.stringify(json)}`);
    }

    return json.result;
  }

  static toRelayerJson(value: unknown): unknown {
    if (value === null || value === undefined) return value;

    if (typeof value === 'bigint') {
      return `0x${value.toString(16)}`;
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
