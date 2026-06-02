import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema';

@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly mongo: Connection,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get()
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      mongodb: this.mongo.readyState === 1 ? 'connected' : 'disconnected',
      nodeEnv: this.config.get('NODE_ENV', { infer: true }),
    };
  }
}