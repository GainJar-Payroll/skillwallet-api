import {
  Controller,
  Get,
  Post,
  Body,
  Logger,
  BadRequestException,
  Res,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { OneShotRelayerService } from '../relayers/oneshot-relayer.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  OneShotCapabilities,
  OneShotFeeData,
  OneShotSendResult,
  RelayerStatusResult,
} from '../relayers/relayer.interface';

/**
 * Dev-only proof surface.
 *
 *   GET  /proof            → serves the single-page proof UI
 *   POST /proof/relayer    → JSON-RPC proxy to 1Shot (avoids CORS + keeps
 *                            future server-side auth / rate limiting in one place)
 *
 * Both routes are unauthenticated and intended for local testing only.
 * The HTML page uses the same backend origin, so /skills, /health, and
 * /proof all share CORS-free access.
 */
@Controller('proof')
export class ProofController {
  private readonly logger = new Logger(ProofController.name);
  private readonly html: string | null;
  private readonly css: string | null;

  constructor(private readonly relayer: OneShotRelayerService) {
    const baseDir = join(__dirname, '..', '..', '..', 'public');
    try {
      this.html = readFileSync(join(baseDir, 'proof.html'), 'utf8');
    } catch (err) {
      this.logger.warn(
        `proof.html not found at ${baseDir}: ${(err as Error).message}. GET /proof will return 404.`,
      );
      this.html = null;
    }
    try {
      this.css = readFileSync(join(baseDir, 'proof.css'), 'utf8');
    } catch (err) {
      this.logger.warn(
        `proof.css not found at ${baseDir}: ${(err as Error).message}. GET /proof/style.css will return 404.`,
      );
      this.css = null;
    }
  }

  @Get()
  serveProof(@Res() res: Response): void {
    if (!this.html) {
      res.status(HttpStatus.NOT_FOUND).json({
        error: {
          code: ErrorCode.NOT_FOUND,
          message:
            'proof.html missing from test/integration/ — check the file is at test/integration/proof.html',
          type: 'not_found',
        },
        meta: { requestId: randomUUID(), timestamp: new Date().toISOString() },
      });
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(HttpStatus.OK).send(this.html);
  }

  @Get('style.css')
  serveCss(@Res() res: Response): void {
    if (!this.css) {
      res.status(HttpStatus.NOT_FOUND).json({
        error: {
          code: ErrorCode.NOT_FOUND,
          message:
            'proof.css missing from test/integration/ — check the file is at test/integration/proof.css',
          type: 'not_found',
        },
        meta: { requestId: randomUUID(), timestamp: new Date().toISOString() },
      });
      return;
    }
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(HttpStatus.OK).send(this.css);
  }

  /**
   * Thin JSON-RPC proxy: takes {method, params}, forwards to 1Shot.
   *
   * Whitelist the methods the page actually needs. Anything else returns 400.
   * This stops the page (or a malicious extension) from poking at methods
   * we have not validated against docs.
   */
  @Post('relayer')
  async proxyRelayer(
    @Body() body: { method?: unknown; params?: unknown },
  ): Promise<Record<string, unknown>> {
    const method = typeof body?.method === 'string' ? body.method : '';
    const params = body?.params;
    if (!method) {
      throw new BadRequestException('body.method is required');
    }
    const allowed = new Set([
      'relayer_getCapabilities',
      'relayer_getFeeData',
      'relayer_estimate7710Transaction',
      'relayer_send7710Transaction',
      'relayer_getStatus',
    ]);
    if (!allowed.has(method)) {
      throw new BadRequestException(`method ${method} is not allowed on /proof/relayer`);
    }

    try {
      switch (method) {
        case 'relayer_getCapabilities': {
          const chainIdRaw = Array.isArray(params)
            ? params[0]
            : (params as { chainId?: unknown })?.chainId;
          const chainId = Number(chainIdRaw);
          const result: OneShotCapabilities = await this.relayer.getCapabilities(chainId);
          return { result };
        }
        case 'relayer_getFeeData': {
          const chainId = Number((params as { chainId?: unknown })?.chainId);
          if (!chainId) throw new BadRequestException('relayer_getFeeData: chainId required');
          const result: OneShotFeeData = await this.relayer.getFeeData({
            chainId,
            transactions: [],
          });
          return { result };
        }
        case 'relayer_estimate7710Transaction': {
          const result = await this.relayer.estimate7710Transaction(
            params as Parameters<OneShotRelayerService['estimate7710Transaction']>[0],
          );
          return { result };
        }
        case 'relayer_send7710Transaction': {
          const result: OneShotSendResult = await this.relayer.send7710Transaction(
            params as Parameters<OneShotRelayerService['send7710Transaction']>[0],
          );
          return { result };
        }
        case 'relayer_getStatus': {
          const taskId = String((params as { id?: unknown })?.id ?? '');
          if (!taskId) throw new BadRequestException('relayer_getStatus: id required');
          const result: RelayerStatusResult = await this.relayer.getStatus(taskId);
          return { result };
        }
        default:
          throw new BadRequestException(`unhandled method ${method}`);
      }
    } catch (err) {
      if (err instanceof AppError) {
        return {
          error: {
            code: err.code,
            message: err.message,
            type: 'relayer',
          },
        };
      }
      throw err;
    }
  }
}
