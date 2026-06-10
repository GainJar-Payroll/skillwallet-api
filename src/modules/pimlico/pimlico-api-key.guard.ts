import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PimlicoApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const key = request.headers['x-pimlico-key'];
    const expected = this.config.get<string>('pimlico.execKey');

    if (!key || key !== expected) {
      throw new UnauthorizedException('Invalid or missing PIMLICO_EXEC_KEY');
    }
    return true;
  }
}
