import { describe, it, expect, beforeEach } from 'bun:test';
import { z } from 'zod';
import { GlobalExceptionFilter } from '../src/common/response/global-exception.filter';
import { AppError } from '../src/common/errors/app-error';
import { ErrorCode } from '../src/common/errors/error-codes';
import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

interface MockRes {
  statusCode: number;
  body: unknown;
  status: (n: number) => MockRes;
  json: (b: unknown) => MockRes;
}

function makeRes(): MockRes {
  const res: MockRes = {
    statusCode: 0,
    body: null,
    status(n: number) {
      this.statusCode = n;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return res;
}

function makeHost(reqId?: string): { host: ArgumentsHost; res: MockRes } {
  const res = makeRes();
  const req: Record<string, unknown> = {
    method: 'GET',
    originalUrl: '/x',
    url: '/x',
  };
  if (reqId) req.requestId = reqId;
  const host: ArgumentsHost = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => req,
      getNext: () => undefined,
    }),
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
    getArgs: () => [],
    getArgByIndex: () => undefined,
    getType: () => 'http',
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
  });

  it('wraps AppError with its code and status', () => {
    const { host, res } = makeHost();
    const err = new AppError(ErrorCode.NOT_FOUND, 'Skill not found');
    filter.catch(err, host);
    expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    expect(res.body).toMatchObject({
      error: {
        code: ErrorCode.NOT_FOUND,
        message: 'Skill not found',
        type: ErrorCode.NOT_FOUND,
      },
      meta: { requestId: 'unknown', timestamp: expect.any(String) },
    });
  });

  it('maps ZodError to 400 with field-level errors', () => {
    const { host, res } = makeHost();
    const schema = z.object({ amount: z.number().positive() });
    let caught: unknown = null;
    try {
      schema.parse({ amount: -1 });
    } catch (e) {
      caught = e;
    }
    filter.catch(caught, host);
    expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    const body = res.body as { error: { code: string; fields: Array<{ field: string }> } };
    expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(body.error.fields.length).toBeGreaterThan(0);
    expect(body.error.fields[0]?.field).toBe('amount');
  });

  it('maps NotFoundException to 404 NOT_FOUND', () => {
    const { host, res } = makeHost();
    filter.catch(new NotFoundException('no such resource'), host);
    expect(res.statusCode).toBe(HttpStatus.NOT_FOUND);
    expect(res.body).toMatchObject({ error: { code: ErrorCode.NOT_FOUND } });
  });

  it('sanitizes UnauthorizedException to a generic message', () => {
    const { host, res } = makeHost();
    filter.catch(new UnauthorizedException('jwt malformed token xyz'), host);
    expect(res.statusCode).toBe(HttpStatus.UNAUTHORIZED);
    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('Authentication required');
    expect(body.error.message).not.toContain('malformed');
  });

  it('maps BadRequestException to VALIDATION_ERROR', () => {
    const { host, res } = makeHost();
    filter.catch(new BadRequestException('amount must be positive'), host);
    expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(res.body).toMatchObject({ error: { code: ErrorCode.VALIDATION_ERROR } });
  });

  it('handles Mongoose duplicate-key error (code 11000)', () => {
    const { host, res } = makeHost();
    const mongoErr = Object.assign(new Error('E11000 duplicate key'), {
      name: 'MongoServerError',
      code: 11000,
    });
    filter.catch(mongoErr, host);
    expect(res.statusCode).toBe(HttpStatus.CONFLICT);
    expect(res.body).toMatchObject({
      error: { code: ErrorCode.CONFLICT, message: 'Resource already exists' },
    });
  });

  it('handles Mongoose CastError', () => {
    const { host, res } = makeHost();
    const castErr = Object.assign(new Error('Cast to ObjectId failed'), {
      name: 'CastError',
    });
    filter.catch(castErr, host);
    expect(res.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(res.body).toMatchObject({ error: { code: ErrorCode.VALIDATION_ERROR } });
  });

  it('returns generic 500 INTERNAL_ERROR for unknown Error', () => {
    const { host, res } = makeHost();
    filter.catch(new Error('database password leaked from config'), host);
    expect(res.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('does not leak stack on unknown Error', () => {
    const { host, res } = makeHost();
    const e = new Error('boom');
    filter.catch(e, host);
    const body = res.body as { error: { message: string } };
    expect(body.error.message).not.toContain('at ');
    expect(JSON.stringify(res.body)).not.toContain('.ts:');
  });

  it('uses requestId from req when present', () => {
    const { host, res } = makeHost('req-from-middleware');
    filter.catch(new NotFoundException('x'), host);
    expect(res.body).toMatchObject({ meta: { requestId: 'req-from-middleware' } });
  });
});
