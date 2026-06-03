import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Logger,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { OneShotRelayerService } from './oneshot-relayer.service';
import { ExecutionAttemptsService } from '../execution-attempts.service';
import { ActivityLogService } from '../activity-log.service';
import type { OneShotWebhookPayload, OneShotStatusCode } from './relayer.interface';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

interface WebhookNormalized {
  taskId: string;
  statusCode: OneShotStatusCode;
  txHash?: string;
  errorMessage?: string;
  chain: number;
  eventName: string;
  raw: unknown;
}

@Controller('runtime/oneshot/webhook')
export class OneshotWebhookController {
  private readonly logger = new Logger(OneshotWebhookController.name);

  constructor(
    private readonly relayer: OneShotRelayerService,
    private readonly attempts: ExecutionAttemptsService,
    private readonly activity: ActivityLogService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: OneShotWebhookPayload,
  ): Promise<{ ok: true; taskId: string; statusCode: number; eventName: string }> {
    const rawBody = req.rawBody;
    if (!rawBody || rawBody.length === 0) {
      throw new BadRequestException('Raw body not available for signature verification');
    }

    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Webhook body is missing or invalid');
    }

    const signature =
      this.pickHeader(req, 'signature') ?? (body as { signature?: string }).signature;
    if (!signature) {
      throw new BadRequestException('Webhook missing signature (neither header nor body field)');
    }

    const signedBody = this.stripSignatureField(body, signature);
    const ok = await this.relayer.verifyWebhookSignature(
      Buffer.from(signedBody, 'utf8'),
      signature,
    );
    if (!ok) {
      throw new AppError(
        ErrorCode.WEBHOOK_SIGNATURE_INVALID,
        '1Shot webhook signature did not verify against configured public key',
      );
    }

    const normalized = this.normalize(body);
    if (!normalized) {
      throw new BadRequestException(
        'Webhook body missing data.transactionId or data.transactionReceipt.hash',
      );
    }

    const matched = await this.attempts.findByTaskId(normalized.taskId);
    if (!matched) {
      this.logger.warn(
        `1Shot webhook for unknown taskId=${normalized.taskId} (event=${normalized.eventName}, statusCode=${normalized.statusCode})`,
      );
      return {
        ok: true,
        taskId: normalized.taskId,
        statusCode: normalized.statusCode,
        eventName: normalized.eventName,
      };
    }

    const updated = await this.attempts.updateRelayFromWebhook(matched.attemptId, {
      statusCode: normalized.statusCode,
      txHash: normalized.txHash,
      errorMessage: normalized.errorMessage,
    });
    if (!updated) {
      throw new NotFoundException(
        `ExecutionAttempt ${matched.attemptId} disappeared during update`,
      );
    }

    await this.activity.log({
      installationId: updated.installationId,
      attemptId: updated.attemptId,
      userAddress: (updated as { userAddress?: string }).userAddress,
      chainId: updated.chainId,
      type: this.activityTypeForStatus(normalized.statusCode, normalized.eventName),
      message: this.activityMessageForStatus(normalized, updated.attemptId),
      metadata: {
        taskId: normalized.taskId,
        eventName: normalized.eventName,
        chain: normalized.chain,
        statusCode: normalized.statusCode,
        txHash: normalized.txHash,
      },
    });

    this.logger.log(
      `1Shot webhook processed taskId=${normalized.taskId} event=${normalized.eventName} statusCode=${normalized.statusCode}`,
    );
    return {
      ok: true,
      taskId: normalized.taskId,
      statusCode: normalized.statusCode,
      eventName: normalized.eventName,
    };
  }

  private normalize(body: OneShotWebhookPayload): WebhookNormalized | null {
    const transactionId = body.data?.transactionId;
    const hash = body.data?.transactionReceipt?.hash;
    if (!transactionId || !hash) return null;
    const eventName = body.eventName ?? 'TransactionExecutionSuccess';
    const chain = body.data?.chain ?? 0;
    const statusCode = this.statusCodeForEvent(eventName, body);
    return {
      taskId: transactionId,
      statusCode,
      txHash: hash,
      errorMessage: this.errorMessageForEvent(eventName, body),
      chain,
      eventName,
      raw: body,
    };
  }

  private pickHeader(req: Request, name: string): string | undefined {
    const lower = name.toLowerCase();
    for (const k of Object.keys(req.headers)) {
      if (k.toLowerCase() === lower) {
        const v = req.headers[k];
        if (Array.isArray(v)) return v[0];
        return v as string | undefined;
      }
    }
    return undefined;
  }

  private stripSignatureField(body: OneShotWebhookPayload, _signature: string): string {
    const copy: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (k === 'signature') continue;
      copy[k] = v;
    }
    return JSON.stringify(copy);
  }

  private statusCodeForEvent(eventName: string, body: OneShotWebhookPayload): OneShotStatusCode {
    if (eventName.includes('Reverted')) return 500;
    if (eventName.includes('Rejected')) return 400;
    if (eventName.includes('Submitted')) return 110;
    if (eventName.includes('Success') || eventName.includes('Confirmed')) {
      const receipt = body.data?.transactionReceipt;
      if (receipt && Number(receipt.status) === 0) return 500;
      return 200;
    }
    return 100;
  }

  private errorMessageForEvent(
    eventName: string,
    _body: OneShotWebhookPayload,
  ): string | undefined {
    if (eventName.includes('Reverted')) {
      return `Transaction reverted (event=${eventName})`;
    }
    if (eventName.includes('Rejected')) {
      return `Transaction rejected (event=${eventName})`;
    }
    return undefined;
  }

  private activityTypeForStatus(
    statusCode: OneShotStatusCode,
    _eventName: string,
  ): 'execution.confirmed' | 'execution.failed' | 'execution.relayed' {
    if (statusCode === 200) return 'execution.confirmed';
    if (statusCode === 400 || statusCode === 500) return 'execution.failed';
    return 'execution.relayed';
  }

  private activityMessageForStatus(normalized: WebhookNormalized, attemptId: string): string {
    return `1Shot webhook ${normalized.eventName} statusCode=${normalized.statusCode} txHash=${normalized.txHash} attempt=${attemptId}`;
  }
}
