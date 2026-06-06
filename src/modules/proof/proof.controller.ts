import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { join } from 'node:path';
import { ProofService } from './proof.service';
import { OneShotService } from '../oneshot/oneshot.service';

@ApiTags('Proof')
@Controller({ path: 'proof', version: VERSION_NEUTRAL })
export class ProofController {
  constructor(
    private readonly proofService: ProofService,
    private readonly oneShotService: OneShotService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Serve the proof harness HTML' })
  serve(@Res() res: Response): void {
    res.sendFile(join(process.cwd(), 'public', 'proof.html'));
  }

  @Post('run')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run the proof flow',
    description: 'Prepares a delegation, signs it via the kit, and runs the executor end-to-end.',
  })
  @ApiOkResponse({ description: 'Run summary with taskId/hash' })
  async run() {
    return this.proofService.runProof();
  }

  @Get('status/:taskId')
  @ApiOperation({ summary: 'Read 1Shot task status' })
  @ApiParam({ name: 'taskId', description: '1Shot task id' })
  @ApiOkResponse({ description: '1Shot task status' })
  async status(@Param('taskId') taskId: `0x${string}`) {
    return this.oneShotService.getStatus(taskId);
  }
}
