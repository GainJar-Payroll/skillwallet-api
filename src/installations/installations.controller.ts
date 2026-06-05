import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { InstallationsService } from './installations.service';
import {
  listInstallationsQuerySchema,
  ListInstallationsQuery,
  updateInstallationStatusSchema,
  UpdateInstallationStatusDto,
} from './dto/create-installation.dto';
import { prepareInstallationSchema } from './dto/prepare-installation.dto';
import { grantInstallationSchema } from './dto/grant-installation.dto';
import { AdminOnly } from '../common/auth';

@Controller('installations')
export class InstallationsController {
  constructor(private readonly service: InstallationsService) {}

  @Post('prepare')
  async prepare(@Body() body: unknown) {
    prepareInstallationSchema.parse(body);
    return this.service.prepare(body as never);
  }

  @Post('grant')
  async grant(@Body() body: unknown) {
    grantInstallationSchema.parse(body);
    return this.service.grant(body as never);
  }

  @Get()
  async list(@Query() query: Record<string, unknown>) {
    const parsed: ListInstallationsQuery = listInstallationsQuerySchema.parse(query);
    return this.service.list(parsed);
  }

  @Get(':installationId')
  async findOne(@Param('installationId') installationId: string) {
    return this.service.findById(installationId);
  }

  @Patch(':installationId/status')
  @AdminOnly()
  async updateStatus(@Param('installationId') installationId: string, @Body() body: unknown) {
    const parsed: UpdateInstallationStatusDto = updateInstallationStatusSchema.parse(body);
    return this.service.updateStatus(installationId, parsed);
  }

  @Post(':installationId/pause')
  @AdminOnly()
  async pause(@Param('installationId') installationId: string) {
    return this.service.pause(installationId);
  }

  @Post(':installationId/resume')
  @AdminOnly()
  async resume(@Param('installationId') installationId: string) {
    return this.service.resume(installationId);
  }

  @Post(':installationId/revoke')
  @AdminOnly()
  async revoke(@Param('installationId') installationId: string) {
    return this.service.revoke(installationId);
  }
}
