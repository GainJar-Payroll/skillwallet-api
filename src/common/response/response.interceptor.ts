import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { requestContextStorage } from './request-id.middleware';
import type { SuccessEnvelope } from './envelope.types';

export const SKIP_ENVELOPE = 'skip-envelope';
export const SkipEnvelope = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_ENVELOPE, true);

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<SuccessEnvelope<unknown> | unknown> {
    return next.handle().pipe(
      map((data: unknown): SuccessEnvelope<unknown> | unknown => {
        const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE, [
          context.getHandler(),
          context.getClass(),
        ]);
        if (skip) {
          return data;
        }
        const { requestId } = requestContextStorage.getStore() ?? { requestId: 'unknown' };
        return {
          payload: data ?? null,
          meta: {
            requestId,
            timestamp: new Date().toISOString(),
          },
        };
      }),
    );
  }
}
