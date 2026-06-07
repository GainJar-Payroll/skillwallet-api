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
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ProofService } from './proof.service';
import { OneShotService } from '../oneshot/oneshot.service';
import { getChainConfig } from '../../config/chains.config';

function serveProofIndex(res: Response): void {
  const reactBuildPath = join(process.cwd(), 'public', 'proof-app', 'index.html');
  const fallbackPath = join(process.cwd(), 'public', 'proof.html');

  res
    .status(200)
    .setHeader('Content-Type', 'text/html; charset=utf-8')
    .sendFile(existsSync(reactBuildPath) ? reactBuildPath : fallbackPath);
}

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
    serveProofIndex(res);
  }

  @Get('config')
  @ApiOperation({ summary: 'Read browser-safe proof runtime config' })
  @ApiOkResponse({ description: 'Browser-safe proof runtime config only' })
  config() {
    const chainId = Number(process.env.DEFAULT_CHAIN_ID ?? '84532');
    const chain = getChainConfig(chainId);

    return {
      clientId: process.env.CLIENT_ID,
      web3AuthNetwork: 'sapphire_devnet',
      chainId,
      chainIdHex: `0x${chainId.toString(16)}`,
      baseSepoliaRpcUrl: process.env.BASE_SEPOLIA_RPC_URL,
      pimlicoBundlerUrl: process.env.PIMLICO_BUNDLER_URL,
      sponsorshipPolicyId: process.env.SPONSORSHIP_POLICY_ID,
      usdcAddress: chain.tokens.usdc,
      wethAddress: chain.tokens.weth,
      swapRouter02Address: chain.dex.swapRouter02,
    };
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

@ApiTags('Proof')
@Controller({ path: 'proof-app', version: VERSION_NEUTRAL })
export class ProofAppController {
  @Get()
  @ApiOperation({ summary: 'Serve the React proof app index' })
  serve(@Res() res: Response): void {
    serveProofIndex(res);
  }

  @Get('*')
  @ApiOperation({ summary: 'SPA fallback for the React proof app' })
  serveSpa(@Res() res: Response): void {
    serveProofIndex(res);
  }
}
