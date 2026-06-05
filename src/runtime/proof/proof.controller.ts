import { Controller, Get, Logger, Res, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { ErrorCode } from '../../common/errors/error-codes';

/**
 * Dev-only proof surface.
 *
 *   GET  /proof            → serves the single-page proof UI
 *   GET  /proof/style.css  → serves proof styling
 */
@Controller('proof')
export class ProofController {
  private readonly logger = new Logger(ProofController.name);
  private readonly html: string | null;
  private readonly css: string | null;

  constructor() {
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
}
