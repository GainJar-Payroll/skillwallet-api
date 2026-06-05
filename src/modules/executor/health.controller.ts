import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { ExecutorService } from './executor.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly executor: ExecutorService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Liveness probe',
    description: 'Returns overall service health, uptime, and Mongo connection state.',
  })
  @ApiOkResponse({
    description: 'Service health snapshot',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok', 'degraded'] },
        uptime: { type: 'number' },
        timestamp: { type: 'string', format: 'date-time' },
        executor: { type: 'string' },
        mongo: {
          type: 'object',
          properties: {
            connected: { type: 'boolean' },
            state: { type: 'number' },
          },
        },
      },
    },
  })
  check() {
    const mongoState = this.connection?.readyState ?? 0;
    return {
      status: mongoState === 1 ? 'ok' : 'degraded',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      executor: this.executor.getAddress(),
      mongo: {
        connected: mongoState === 1,
        state: mongoState,
      },
    };
  }
}
