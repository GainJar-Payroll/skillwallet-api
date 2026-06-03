import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

export const ADMIN_ONLY_KEY = 'admin-only';
export const AdminOnly = (): MethodDecorator & ClassDecorator => SetMetadata(ADMIN_ONLY_KEY, true);

const KEY_HEADER = 'x-api-key';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isAdminOnly = this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isAdminOnly) {
      return true;
    }

    const expected = this.config.get<string>('ADMIN_API_KEY') ?? '';
    if (!expected) {
      throw new InternalServerErrorException('ADMIN_API_KEY is not configured on the server');
    }

    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.header(KEY_HEADER);
    if (!provided) {
      throw new UnauthorizedException('Missing x-api-key header');
    }

    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(provided, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid x-api-key');
    }
    return true;
  }
}
