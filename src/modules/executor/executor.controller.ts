import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { ExecutorService } from './executor.service';

@ApiTags('Executor')
@Controller('executor')
export class ExecutorController {
  constructor(
    private readonly executorService: ExecutorService,
    private readonly config: ConfigService,
  ) {}

  @Get('address')
  @ApiOperation({ summary: 'Read executor EVM address' })
  @ApiOkResponse({
    description: 'Executor address and configured default chain id',
    schema: {
      type: 'object',
      properties: {
        address: { type: 'string', example: '0x90F79bf6EB2c4f870365E785982E1f101E93b906' },
        chainId: { type: 'number', example: 84532 },
      },
    },
  })
  async address() {
    return {
      address: this.executorService.getAddress(),
      chainId: this.config.get<number>('defaultChainId') ?? 84532,
    };
  }
}
