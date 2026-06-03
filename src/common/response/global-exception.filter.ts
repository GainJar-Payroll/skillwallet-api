import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ZodError } from 'zod';
import type { Response, Request } from 'express';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import { requestContextStorage } from './request-id.middleware';
import type { ErrorBody, ErrorEnvelope, ErrorFieldDetail } from './envelope.types';

@Injectable()
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = req.requestId ?? requestContextStorage.getStore()?.requestId ?? 'unknown';

    const { status, error } = this.toSafeError(exception);
    this.logError(exception, req, status, requestId);

    const body: ErrorEnvelope = {
      error,
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
      },
    };
    res.status(status).json(body);
  }

  private toSafeError(exception: unknown): {
    status: number;
    error: ErrorBody;
  } {
    if (exception instanceof AppError) {
      return {
        status: exception.getStatus(),
        error: this.fromAppError(exception),
      };
    }
    if (exception instanceof ZodError) {
      const issues =
        (exception as unknown as { issues?: unknown[] }).issues ??
        (exception as unknown as { errors?: unknown[] }).errors ??
        [];
      return {
        status: HttpStatus.BAD_REQUEST,
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Request validation failed',
          type: 'validation',
          fields: (
            issues as Array<{ path: unknown[]; message: string; code: string }>
          ).map<ErrorFieldDetail>((issue) => ({
            field: Array.isArray(issue.path) ? issue.path.join('.') || '(root)' : '(root)',
            reason: issue.message,
            code: issue.code,
          })),
        },
      };
    }
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }
    if (this.isMongooseError(exception)) {
      return this.fromMongooseError(exception);
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: {
        code: 'INTERNAL_ERROR',
        message:
          process.env.NODE_ENV === 'production'
            ? 'An unexpected error occurred'
            : this.extractMessage(exception) || 'An unexpected error occurred',
      },
    };
  }

  private fromAppError(err: AppError): ErrorBody {
    const body: ErrorBody = {
      code: err.code,
      message: err.message,
      type: err.code,
    };
    return body;
  }

  private fromHttpException(err: HttpException): {
    status: number;
    error: ErrorBody;
  } {
    const status = err.getStatus();
    const response = err.getResponse();
    const message = this.extractMessage(response) || err.message;
    return {
      status,
      error: {
        code: this.mapStatusToCode(status),
        message: this.sanitizeMessage(status, message),
        type: this.mapStatusToType(status),
      },
    };
  }

  private fromMongooseError(err: unknown): {
    status: number;
    error: ErrorBody;
  } {
    const name = (err as { name?: string }).name ?? '';
    if (name === 'ValidationError' || name === 'ValidatorError') {
      return {
        status: HttpStatus.BAD_REQUEST,
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Invalid data',
          type: 'validation',
        },
      };
    }
    if (name === 'CastError') {
      return {
        status: HttpStatus.BAD_REQUEST,
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Invalid identifier format',
          type: 'validation',
        },
      };
    }
    const code = (err as { code?: number }).code;
    if (code === 11000 || code === 11001) {
      return {
        status: HttpStatus.CONFLICT,
        error: {
          code: ErrorCode.CONFLICT,
          message: 'Resource already exists',
          type: 'conflict',
        },
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Database error',
      },
    };
  }

  private mapStatusToCode(status: number): ErrorCode | 'INTERNAL_ERROR' | 'UNAUTHORIZED' {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_ERROR;
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return ErrorCode.POLICY_BLOCKED;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return ErrorCode.POLICY_BLOCKED;
      case HttpStatus.NOT_IMPLEMENTED:
        return ErrorCode.NOT_IMPLEMENTED;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return ErrorCode.NOT_CONFIGURED;
      case HttpStatus.BAD_GATEWAY:
        return ErrorCode.RELAYER_ERROR;
      default:
        return 'INTERNAL_ERROR';
    }
  }

  private mapStatusToType(status: number): string {
    if (status >= 400 && status < 500) return 'client_error';
    if (status >= 500) return 'server_error';
    return 'error';
  }

  private sanitizeMessage(status: number, message: string): string {
    if (status === HttpStatus.UNAUTHORIZED) {
      return 'Authentication required';
    }
    if (status === HttpStatus.FORBIDDEN) {
      return 'Forbidden';
    }
    if (status >= 500 && process.env.NODE_ENV === 'production') {
      return 'An unexpected error occurred';
    }
    return message;
  }

  private isMongooseError(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const name = (value as { name?: string }).name;
    return (
      name === 'ValidationError' ||
      name === 'CastError' ||
      name === 'ValidatorError' ||
      name === 'MongoServerError' ||
      name === 'MongoError' ||
      (value as { code?: number }).code === 11000 ||
      (value as { code?: number }).code === 11001
    );
  }

  private extractMessage(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      const m = (value as { message?: unknown }).message;
      if (typeof m === 'string') return m;
      if (Array.isArray(m) && m.length > 0 && typeof m[0] === 'string') {
        return m.join('; ');
      }
    }
    return '';
  }

  private logError(exception: unknown, req: Request, status: number, requestId: string): void {
    const method = req.method;
    const url = req.originalUrl ?? req.url;
    const code =
      exception instanceof AppError
        ? exception.code
        : exception instanceof HttpException
          ? String(exception.getStatus())
          : 'INTERNAL_ERROR';
    const message = exception instanceof Error ? exception.message : String(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;

    if (status >= 500) {
      this.logger.error(`[${requestId}] ${method} ${url} → ${status} ${code} ${message}`, stack);
    } else if (status >= 400) {
      this.logger.warn(`[${requestId}] ${method} ${url} → ${status} ${code} ${message}`);
    }
  }
}
