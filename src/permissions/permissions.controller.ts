import { Controller, Post, Body } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import {
  preparePermissionRequestSchema,
  PreparePermissionRequestDto,
  submitPermissionGrantSchema,
  SubmitPermissionGrantDto,
} from './dto/prepare-permission-request.dto';

@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Post('prepare')
  async prepare(@Body() body: unknown) {
    const parsed: PreparePermissionRequestDto = preparePermissionRequestSchema.parse(body);
    return this.permissionsService.prepareRequest(parsed);
  }

  @Post('grant')
  async grant(@Body() body: unknown) {
    const parsed: SubmitPermissionGrantDto = submitPermissionGrantSchema.parse(body);
    return this.permissionsService.submitGrant(parsed);
  }
}
