import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { InstallationsService } from './installations.service';
import { PrepareInstallationDto } from './dto/prepare-installation.dto';
import { ConfirmInstallationDto } from './dto/confirm-installation.dto';
import { OwnershipDto } from './dto/ownership.dto';

@ApiTags('Installations')
@Controller('installations')
export class InstallationsController {
  constructor(private readonly installations: InstallationsService) {}

  @Post('prepare')
  @ApiOperation({
    summary: 'Prepare a delegation',
    description:
      'Resolves a delegation scope for the requested skill/smart account, generates a salt, and returns the unsigned delegation to be signed client-side.',
  })
  @ApiCreatedResponse({
    description: 'Unsigned delegation with the salt required for /installations/confirm',
  })
  async prepare(@Body() dto: PrepareInstallationDto) {
    return this.installations.prepareInstallation(dto);
  }

  @Post('confirm')
  @ApiOperation({
    summary: 'Confirm an installation',
    description:
      'Persists the signed delegation and skill parameters, then returns the new installation document.',
  })
  @ApiCreatedResponse({ description: 'Installation document' })
  async confirm(@Body() dto: ConfirmInstallationDto) {
    return this.installations.confirmInstallation(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List installations for a user' })
  @ApiQuery({
    name: 'userAddress',
    required: true,
    description: 'EOA address of the user that owns the installations',
  })
  @ApiQuery({
    name: 'chainId',
    required: false,
    description: 'Optional chain id filter',
  })
  @ApiQuery({
    name: 'smartAccountAddress',
    required: false,
    description: 'Optional Hybrid Smart Account address filter',
  })
  @ApiOkResponse({ description: 'Installations wrapped in { data }' })
  async findByUser(
    @Query('userAddress') userAddress: string,
    @Query('chainId') chainId?: string,
    @Query('smartAccountAddress') smartAccountAddress?: string,
  ) {
    const data = await this.installations.findByUser(userAddress, {
      chainId: chainId ? Number(chainId) : undefined,
      smartAccountAddress,
    });

    return { data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an installation by id' })
  @ApiParam({ name: 'id', description: 'Installation Mongo ObjectId' })
  @ApiOkResponse({ description: 'Installation document with executions history' })
  async findOne(@Param('id') id: string) {
    return this.installations.findById(id);
  }

  @Patch(':id/pause')
  @ApiOperation({ summary: 'Pause an installation' })
  @ApiParam({ name: 'id', description: 'Installation Mongo ObjectId' })
  @ApiOkResponse({ description: 'New installation status' })
  async pause(@Param('id') id: string, @Body() dto: OwnershipDto) {
    const inst = await this.installations.pause(id, dto.userAddress);
    return { status: inst.status };
  }

  @Patch(':id/resume')
  @ApiOperation({ summary: 'Resume a paused installation' })
  @ApiParam({ name: 'id', description: 'Installation Mongo ObjectId' })
  @ApiOkResponse({ description: 'New installation status' })
  async resume(@Param('id') id: string, @Body() dto: OwnershipDto) {
    const inst = await this.installations.resume(id, dto.userAddress);
    return { status: inst.status };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke an installation' })
  @ApiParam({ name: 'id', description: 'Installation Mongo ObjectId' })
  @ApiOkResponse({ description: 'Revocation confirmation' })
  async revoke(@Param('id') id: string, @Body() dto: OwnershipDto) {
    await this.installations.revoke(id, dto.userAddress);
    return { message: 'Installation revoked' };
  }
}
