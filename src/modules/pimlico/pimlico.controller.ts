import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PimlicoService } from './pimlico.service';
import { PimlicoApiKeyGuard } from './pimlico-api-key.guard';

class SendUserOperationDto {
  @IsNumber()
  @IsOptional()
  chainId?: number;

  @IsString()
  sender!: string;

  @IsString()
  initCode!: string;

  @IsString()
  callData!: string;
}

class SubmitUserOpDto {
  @IsNumber()
  @IsOptional()
  chainId?: number;

  @IsString()
  sender!: string;

  @IsString()
  nonce!: string;

  @IsString()
  @IsOptional()
  factory?: string;

  @IsString()
  @IsOptional()
  factoryData?: string;

  @IsString()
  callData!: string;

  @IsString()
  callGasLimit!: string;

  @IsString()
  verificationGasLimit!: string;

  @IsString()
  preVerificationGas!: string;

  @IsString()
  maxFeePerGas!: string;

  @IsString()
  maxPriorityFeePerGas!: string;

  @IsString()
  @IsOptional()
  paymaster?: string;

  @IsString()
  @IsOptional()
  paymasterData?: string;

  @IsString()
  @IsOptional()
  paymasterVerificationGasLimit?: string;

  @IsString()
  @IsOptional()
  paymasterPostOpGasLimit?: string;

  @IsString()
  signature!: string;
}

class UserOperationReceiptResult {
  userOpHash!: string;
  transactionHash?: string;
  success?: boolean;
  blockNumber?: string;
}

@ApiTags('Pimlico')
@Controller('pimlico')
export class PimlicoController {
  private readonly logger = new Logger(PimlicoController.name);

  constructor(private readonly pimlicoService: PimlicoService) {}

  @Get('entry-points')
  @ApiOperation({ summary: 'Get supported ERC-4337 entry points' })
  @ApiOkResponse({ description: 'List of entry point addresses' })
  async getEntryPoints() {
    return this.pimlicoService.getSupportedEntryPoints();
  }

  @Post('deploy-and-execute')
  @HttpCode(200)
  @UseGuards(PimlicoApiKeyGuard)
  @ApiSecurity('pimlico-api-key')
  @ApiOperation({
    summary: 'Phase 1: Estimate gas + get paymaster data (no signature needed)',
    description:
      'Returns gas estimates and paymaster sponsorship data for the caller to ' +
      'build and sign a UserOperation. The signed UserOp must then be submitted ' +
      'to POST /pimlico/submit-user-op.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        nonce: { type: 'string' },
        callGasLimit: { type: 'string' },
        verificationGasLimit: { type: 'string' },
        preVerificationGas: { type: 'string' },
        paymaster: { type: 'string', nullable: true },
        paymasterData: { type: 'string', nullable: true },
        paymasterVerificationGasLimit: { type: 'string' },
        paymasterPostOpGasLimit: { type: 'string' },
      },
    },
  })
  async deployAndExecute(@Body() dto: SendUserOperationDto) {
    return this.pimlicoService.deployAndExecute({
      sender: dto.sender as `0x${string}`,
      initCode: dto.initCode as `0x${string}`,
      callData: dto.callData as `0x${string}`,
      chainId: dto.chainId,
    });
  }

  @Post('submit-user-op')
  @HttpCode(200)
  @UseGuards(PimlicoApiKeyGuard)
  @ApiSecurity('pimlico-api-key')
  @ApiOperation({
    summary: 'Phase 2: Submit a pre-signed UserOperation to the bundler',
    description:
      'Takes a fully signed UserOperation (all fields including signature) ' +
      'and forwards it to the Pimlico bundler. Returns the userOpHash for polling.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        userOpHash: { type: 'string' },
      },
    },
  })
  async submitUserOp(@Body() dto: SubmitUserOpDto, @Body('entryPoint') entryPoint?: string) {
    const userOp = {
      sender: dto.sender as `0x${string}`,
      nonce: dto.nonce,
      factory: (dto.factory ?? '0x') as `0x${string}`,
      factoryData: (dto.factoryData ?? '0x') as `0x${string}`,
      callData: dto.callData as `0x${string}`,
      callGasLimit: dto.callGasLimit,
      verificationGasLimit: dto.verificationGasLimit,
      preVerificationGas: dto.preVerificationGas,
      maxFeePerGas: dto.maxFeePerGas,
      maxPriorityFeePerGas: dto.maxPriorityFeePerGas,
      paymaster: dto.paymaster as `0x${string}` | undefined,
      paymasterData: dto.paymasterData as `0x${string}` | undefined,
      paymasterVerificationGasLimit: dto.paymasterVerificationGasLimit,
      paymasterPostOpGasLimit: dto.paymasterPostOpGasLimit,
      signature: dto.signature as `0x${string}`,
    };

    const userOpHash = await this.pimlicoService.submitUserOp(
      userOp,
      (entryPoint ?? undefined) as `0x${string}` | undefined,
      dto.chainId,
    );

    return { userOpHash };
  }

  @Post('user-operation/receipt')
  @HttpCode(200)
  @UseGuards(PimlicoApiKeyGuard)
  @ApiSecurity('pimlico-api-key')
  @ApiOperation({ summary: 'Get UserOperation receipt by hash' })
  @ApiOkResponse({ type: UserOperationReceiptResult })
  async getReceipt(
    @Body('userOpHash') userOpHash: string,
    @Body('chainId') chainId?: number,
  ) {
    const receipt = await this.pimlicoService.getUserOperationReceipt(
      userOpHash as `0x${string}`,
      chainId,
    );

    if (!receipt) {
      return { userOpHash, status: 'pending' };
    }

    return {
      userOpHash,
      transactionHash: receipt.receipt.transactionHash,
      success: receipt.success,
      blockNumber: receipt.receipt.blockNumber,
      status: 'confirmed',
    };
  }

  @Post('user-operation/poll')
  @HttpCode(200)
  @UseGuards(PimlicoApiKeyGuard)
  @ApiSecurity('pimlico-api-key')
  @ApiOperation({
    summary: 'Poll for UserOperation receipt (blocks until confirmed or timeout)',
  })
  @ApiOkResponse({ type: UserOperationReceiptResult })
  async pollReceipt(
    @Body('userOpHash') userOpHash: string,
    @Body('timeoutMs') timeoutMs?: number,
    @Body('chainId') chainId?: number,
  ) {
    const receipt = await this.pimlicoService.pollForReceipt(
      userOpHash as `0x${string}`,
      timeoutMs ?? 120_000,
      3_000,
      chainId,
    );

    return {
      userOpHash,
      transactionHash: receipt.receipt.transactionHash,
      success: receipt.success,
      blockNumber: receipt.receipt.blockNumber,
      status: 'confirmed',
    };
  }
}
