import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
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
import { ConfigService } from '@nestjs/config';
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
    private readonly configService: ConfigService,
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

  @Post('bundler-rpc')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Proxy JSON-RPC to the Pimlico bundler',
    description:
      'Server-side proxy that forwards any ERC-4337 / Pimlico JSON-RPC call to PIMLICO_BUNDLER_URL while keeping the API key off the client.',
  })
  @ApiOkResponse({ description: 'JSON-RPC result (passthrough)' })
  async bundlerRpc(@Body() body: unknown) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('JSON-RPC body is required');
    }

    const bundlerUrl = this.configService.get<string>('pimlicoBundlerUrl');
    if (!bundlerUrl) {
      throw new InternalServerErrorException('PIMLICO_BUNDLER_URL is not configured');
    }

    const response = await fetch(bundlerUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let payload: unknown = text;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text };
      }
    }

    if (!response.ok) {
      throw new InternalServerErrorException(payload);
    }
    return payload;
  }

  @Get('status/:taskId')
  @ApiOperation({ summary: 'Read 1Shot task status' })
  @ApiParam({ name: 'taskId', description: '1Shot task id' })
  @ApiOkResponse({ description: '1Shot task status' })
  async status(@Param('taskId') taskId: `0x${string}`) {
    return this.oneShotService.getStatus(taskId);
  }
}
