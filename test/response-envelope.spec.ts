import { describe, it, expect, beforeEach } from 'bun:test';
import { Reflector } from '@nestjs/core';
import { of, throwError, Observable } from 'rxjs';
import { ResponseInterceptor } from '../src/common/response/response.interceptor';
import { requestContextStorage } from '../src/common/response/request-id.middleware';
import { ExecutionContext, BadRequestException } from '@nestjs/common';

function makeContext(): ExecutionContext {
  return {
    getHandler: () => function f() {},
    getClass: () => class Foo {},
    switchToHttp: () => ({}) as never,
    getArgByIndex: () => undefined,
    getArgs: () => [],
    getRequest: () => ({}) as never,
    getResponse: () => ({}) as never,
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

function captureInCtx(requestId: string | null, source$: Observable<unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      source$.subscribe({ next: resolve, error: reject });
    };
    if (requestId === null) {
      finish();
      return;
    }
    requestContextStorage.run({ requestId }, finish);
  });
}

describe('ResponseInterceptor', () => {
  let interceptor: ResponseInterceptor;

  beforeEach(() => {
    interceptor = new ResponseInterceptor(new Reflector());
  });

  it('wraps an object payload in { payload, meta }', async () => {
    const result = (await captureInCtx(
      'req-abc',
      interceptor.intercept(makeContext(), { handle: () => of({ id: 1, name: 'DCA' }) }),
    )) as { payload: unknown; meta: { requestId: string; timestamp: string } };
    expect(result.payload).toEqual({ id: 1, name: 'DCA' });
    expect(result.meta.requestId).toBe('req-abc');
    expect(typeof result.meta.timestamp).toBe('string');
  });

  it('wraps an array payload', async () => {
    const result = (await captureInCtx(
      'req-2',
      interceptor.intercept(makeContext(), { handle: () => of([1, 2, 3]) }),
    )) as { payload: unknown };
    expect(result.payload).toEqual([1, 2, 3]);
  });

  it('normalizes null payload to null', async () => {
    const result = (await captureInCtx(
      'req-3',
      interceptor.intercept(makeContext(), { handle: () => of(null) }),
    )) as { payload: unknown };
    expect(result.payload).toBeNull();
  });

  it('uses "unknown" when no requestId in context', async () => {
    const result = (await captureInCtx(
      null,
      interceptor.intercept(makeContext(), { handle: () => of('ok') }),
    )) as { meta: { requestId: string } };
    expect(result.meta.requestId).toBe('unknown');
  });

  it('emits ISO timestamp', async () => {
    const result = (await captureInCtx(
      'r',
      interceptor.intercept(makeContext(), { handle: () => of('ok') }),
    )) as { meta: { timestamp: string } };
    expect(() => new Date(result.meta.timestamp).toISOString()).not.toThrow();
  });

  it('lets downstream errors bubble (filter handles them)', async () => {
    const error = new BadRequestException('bad input');
    const observable = interceptor.intercept(makeContext(), {
      handle: () => throwError(() => error),
    });
    await expect(captureInCtx('r', observable)).rejects.toBe(error);
  });
});
