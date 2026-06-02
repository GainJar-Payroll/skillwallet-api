import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Env } from '../../config/env.schema';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { RelayerInterface, RelayInput, RelaySubmissionResult, RelayerStatusResult } from './relayer.interface';

@Injectable()
export class OneShotRelayerService implements RelayerInterface {
  private readonly logger = new Logger(OneShotRelayerService.name);
  private readonly enabled: boolean;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly webhookSecret: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.enabled = this.config.get('ONESHOT_ENABLED', { infer: true });
    this.baseUrl = this.config.get('ONESHOT_BASE_URL', { infer: true });
    this.apiKey = this.config.get('ONESHOT_API_KEY', { infer: true });
    this.webhookSecret = this.config.get('ONESHOT_WEBHOOK_SECRET', { infer: true });
  }

  private ensureConfigured(): void {
    if (!this.enabled) {
      throw new AppError(
        ErrorCode.NOT_CONFIGURED,
        '1Shot relayer is not enabled. Set ONESHOT_ENABLED=true and provide ONESHOT_BASE_URL/ONESHOT_API_KEY.',
      );
    }
    if (!this.baseUrl || !this.apiKey) {
      throw new AppError(
        ErrorCode.NOT_CONFIGURED,
        '1Shot relayer is enabled but ONESHOT_BASE_URL or ONESHOT_API_KEY is missing.',
      );
    }
  }

  async relayDelegatedExecution(input: RelayInput): Promise<RelaySubmissionResult> {
    this.ensureConfigured();

    const body = {
      chainId: input.chainId,
      delegationManager: input.delegationManager,
      permissionContext: input.permissionContext,
      calls: input.calls.map((c) => ({ to: c.to, data: c.data, value: c.value ?? '0x0' })),
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/v1/relay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      this.logger.error(`1Shot relay HTTP error: ${(err as Error).message}`);
      throw new AppError(
        ErrorCode.RELAYER_ERROR,
        `1Shot relayer request failed: ${(err as Error).message}`,
      );
    }

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`1Shot relay returned ${res.status}: ${text}`);
      throw new AppError(
        ErrorCode.RELAYER_ERROR,
        `1Shot relayer returned status ${res.status}`,
        { status: res.status, body: text.slice(0, 500) },
      );
    }

    const json = await res.json() as Record<string, unknown>;
    return {
      relayId: (json.relayId ?? json.id) as string | undefined,
      status: (json.status as RelaySubmissionResult['status']) ?? 'queued',
      txHash: json.txHash as string | undefined,
      externalStatusUrl: json.statusUrl as string | undefined,
    };
  }

  async getRelayStatus(relayId: string): Promise<RelayerStatusResult> {
    this.ensureConfigured();
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/v1/relay/${relayId}`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    });
    if (!res.ok) {
      throw new AppError(
        ErrorCode.RELAYER_ERROR,
        `1Shot getRelayStatus returned ${res.status}`,
      );
    }
    const json = await res.json() as Record<string, unknown>;
    return {
      relayId,
      status: (json.status as RelayerStatusResult['status']) ?? 'queued',
      txHash: json.txHash as string | undefined,
      error: json.error as string | undefined,
    };
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.webhookSecret) return false;
    const expected = createHmac('sha256', this.webhookSecret).update(payload).digest('hex');
    const sigBuf = Buffer.from(signature.replace(/^0x/, ''), 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length) return false;
    return timingSafeEqual(sigBuf, expBuf);
  }
}