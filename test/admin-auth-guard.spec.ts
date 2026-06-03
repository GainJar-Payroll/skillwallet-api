import { describe, it, expect } from 'bun:test';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AdminAuthGuard, AdminOnly, ADMIN_ONLY_KEY } from '../src/common/auth/admin.guard';
import { UnauthorizedException, InternalServerErrorException } from '@nestjs/common';

function makeCtx(expected: string | null, provided: string | undefined, isAdminOnly: boolean) {
  const reflector = new Reflector();
  const config = {
    get: (k: string) => (k === 'ADMIN_API_KEY' ? expected : null),
  } as unknown as ConfigService;
  const guard = new AdminAuthGuard(reflector, config);
  const handler = function h() {} as unknown as (...args: unknown[]) => unknown;
  if (isAdminOnly) Reflect.defineMetadata(ADMIN_ONLY_KEY, true, handler);
  const req = {
    header: (name: string) => (name === 'x-api-key' ? provided : undefined),
  };
  const ctx = {
    getHandler: () => handler,
    getClass: () => class Foo {},
    switchToHttp: () => ({ getRequest: () => req }),
  };
  return { guard, ctx };
}

describe('AdminAuthGuard', () => {
  it('passes when route is not @AdminOnly', () => {
    const { guard, ctx } = makeCtx('secret', undefined, false);
    expect(guard.canActivate(ctx as never)).toBe(true);
  });

  it('rejects @AdminOnly route without x-api-key header', () => {
    const { guard, ctx } = makeCtx('secret', undefined, true);
    expect(() => guard.canActivate(ctx as never)).toThrow(UnauthorizedException);
  });

  it('rejects @AdminOnly route with wrong x-api-key', () => {
    const { guard, ctx } = makeCtx('secret', 'wrong', true);
    expect(() => guard.canActivate(ctx as never)).toThrow(UnauthorizedException);
  });

  it('accepts @AdminOnly route with matching x-api-key', () => {
    const { guard, ctx } = makeCtx('secret', 'secret', true);
    expect(guard.canActivate(ctx as never)).toBe(true);
  });

  it('throws 500 when ADMIN_API_KEY is not configured', () => {
    const { guard, ctx } = makeCtx(null, 'any', true);
    expect(() => guard.canActivate(ctx as never)).toThrow(InternalServerErrorException);
  });

  it('rejects when key length differs (no false positive on prefix)', () => {
    const { guard, ctx } = makeCtx('secret-key-abc', 'secret', true);
    expect(() => guard.canActivate(ctx as never)).toThrow(UnauthorizedException);
  });

  it('AdminOnly() sets the metadata key', () => {
    const reflector = new Reflector();
    class Tmp {
      @AdminOnly()
      handler() {}
    }
    const meta = reflector.get<boolean>(ADMIN_ONLY_KEY, Tmp.prototype.handler);
    expect(meta).toBe(true);
  });
});
