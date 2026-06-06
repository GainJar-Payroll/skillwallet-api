import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Request, Response } from 'express';

const NOISE_GET_PATHS = new Set<string>([
  '/favicon.ico',
  '/OneSignalSDKWorker.js',
  '/service-worker.js',
  '/robots.txt',
  '/sitemap.xml',
  '/apple-touch-icon.png',
  '/apple-touch-icon-precomposed.png',
]);

const NOISE_PATH_PREFIXES = ['/proof-app', '/proof-app/'];

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (this.shouldSilentlyServeProofAppIndex(request, exception)) {
      this.serveProofAppIndex(response);
      return;
    }

    if (this.shouldSilentlyNoContent(request, exception)) {
      this.logger.debug(
        `Browser-noise request silenced: ${request.method} ${request.url} → 204`,
      );
      response.status(HttpStatus.NO_CONTENT).end();
      return;
    }

    if (exception instanceof HttpException) {
      this.logger.error(exception.getResponse());
    }

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException ? exception.message : 'Internal server error';

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status} ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json({
      message,
    });
  }

  private shouldSilentlyNoContent(request: Request, exception: unknown): boolean {
    if (request.method !== 'GET') return false;
    if (!(exception instanceof NotFoundException)) return false;
    return NOISE_GET_PATHS.has(request.path) || this.isProofAppSpaPath(request);
  }

  private shouldSilentlyServeProofAppIndex(
    request: Request,
    exception: unknown,
  ): boolean {
    if (request.method !== 'GET') return false;
    if (!(exception instanceof NotFoundException)) return false;
    return this.isProofAppSpaPath(request);
  }

  private isProofAppSpaPath(request: Request): boolean {
    return NOISE_PATH_PREFIXES.some(
      (prefix) => request.path === prefix || request.path.startsWith(`${prefix}/`),
    );
  }

  private serveProofAppIndex(response: Response): void {
    const { existsSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');

    const reactBuildPath = join(process.cwd(), 'public', 'proof-app', 'index.html');
    const fallbackPath = join(process.cwd(), 'public', 'proof.html');

    response
      .status(HttpStatus.OK)
      .contentType('text/html; charset=utf-8')
      .sendFile(existsSync(reactBuildPath) ? reactBuildPath : fallbackPath);
  }
}
