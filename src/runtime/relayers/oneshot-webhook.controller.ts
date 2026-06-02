import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { WebhookSignatureVerifier } from './webhook-signature-verifier.service';
import { ExecutionAttemptsService } from '../execution-attempts.service';
import { OneShotWebhookPayload } from './relayer.interface';
import { ErrorCode } from '../../common/errors/error-codes';
import { AppError } from '../../common/errors/app-error';

/**
 * Receives signed status callbacks from 1Shot. The body is Ed25519-signed;
 * we verify against the configured JWKS or fallback public key, then patch
 * the matching ExecutionAttempt (located by relay.taskId).
 *
 * Wire: POST /webhooks/oneshot
 * Headers:
 *   signature: base64 Ed25519 signature over the raw body
 *   key-id:    JWKS kid (optional; first key is used if absent)
 */
@Controller('webhooks/oneshot')
export class OneshotWebhookController {
  private readonly logger = new Logger(OneshotWebhookController.name);

  constructor(
    private readonly verifier: WebhookSignatureVerifier,
    private readonly attempts: ExecutionAttemptsService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: Request,
    @Body() body: OneShotWebhookPayload,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<{ ok: true; taskId: string; statusCode: number }> {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      throw new BadRequestException('Raw body not available for signature verification');
    }

    try {
      await this.verifier.verifyFromHeaders(rawBody, headers);
    } catch (err) {
      if (err instanceof AppError && err.code === ErrorCode.INVALID_STATE) {
        throw new UnauthorizedException(err.message);
      }
      throw err;
    }

    if (!body || typeof body !== 'object' || !body.taskId) {
      throw new BadRequestException('Webhook body missing taskId');
    }

    const matched = await this.attempts.findByTaskId(body.taskId);
    if (!matched) {
      // 200 OK — we don't want 1Shot to retry. Just log and move on.
      this.logger.warn(
        `1Shot webhook for unknown taskId=${body.taskId} (statusCode=${body.statusCode})`,
      );
      return { ok: true, taskId: body.taskId, statusCode: body.statusCode };
    }

    await this.attempts.updateRelayFromWebhook(matched.attemptId, {
      statusCode: body.statusCode,
      txHash: body.txHash,
      errorCode: body.errorCode,
      errorMessage: body.errorMessage,
    });

    this.logger.log(`1Shot webhook processed taskId=${body.taskId} statusCode=${body.statusCode}`);
    return { ok: true, taskId: body.taskId, statusCode: body.statusCode };
  }
}
