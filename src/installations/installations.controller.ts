import { Controller, Get, Param, Post, Body, Patch, Query } from '@nestjs/common';
import { InstallationsService } from './installations.service';
import {
  createInstallationSchema,
  CreateInstallationDto,
  updateInstallationStatusSchema,
  UpdateInstallationStatusDto,
  listInstallationsQuerySchema,
  ListInstallationsQuery,
} from './dto/create-installation.dto';

@Controller('installations')
export class InstallationsController {
  constructor(private readonly installationsService: InstallationsService) {}

  @Get()
  async list(@Query() query: Record<string, unknown>) {
    const parsed: ListInstallationsQuery = listInstallationsQuerySchema.parse(query);
    return this.installationsService.list(parsed);
  }

  @Get(':installationId')
  async findOne(@Param('installationId') installationId: string) {
    return this.installationsService.findById(installationId);
  }

  @Post()
  async create(@Body() body: unknown) {
    const parsed: CreateInstallationDto = createInstallationSchema.parse(body);
    return parsed;
  }

  @Patch(':installationId/status')
  async updateStatus(
    @Param('installationId') installationId: string,
    @Body() body: unknown,
  ) {
    const parsed: UpdateInstallationStatusDto = updateInstallationStatusSchema.parse(body);
    return this.installationsService.updateStatus(installationId, parsed);
  }

  @Post(':installationId/pause')
  async pause(@Param('installationId') installationId: string) {
    return this.installationsService.pause(installationId);
  }

  @Post(':installationId/resume')
  async resume(@Param('installationId') installationId: string) {
    return this.installationsService.resume(installationId);
  }

  @Post(':installationId/revoke')
  async revoke(@Param('installationId') installationId: string) {
    return this.installationsService.revoke(installationId);
  }
}