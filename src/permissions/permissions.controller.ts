import { Controller, Post, Get, Body, Param, HttpCode } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import {
  checkSupportSchema,
  CheckSupportDto,
  preparePermissionRequestSchema,
  PreparePermissionRequestDto,
  submitPermissionGrantSchema,
  SubmitPermissionGrantDto,
  reportDependenciesSchema,
  ReportDependenciesDto,
  revokePermissionSchema,
  RevokePermissionDto,
} from './dto/prepare-permission-request.dto';

@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Post('check-support')
  @HttpCode(200)
  async checkSupport(@Body() body: unknown) {
    const parsed: CheckSupportDto = checkSupportSchema.parse(body);
    return this.permissionsService.checkSupport(parsed);
  }

  @Post('prepare')
  @HttpCode(200)
  async prepare(@Body() body: unknown) {
    const parsed: PreparePermissionRequestDto = preparePermissionRequestSchema.parse(body);
    return this.permissionsService.prepareRequest(parsed);
  }

  @Post('grant')
  @HttpCode(200)
  async grant(@Body() body: unknown) {
    const parsed: SubmitPermissionGrantDto = submitPermissionGrantSchema.parse(body);
    return this.permissionsService.submitGrant(parsed);
  }

  @Post('dependencies/report')
  @HttpCode(200)
  async reportDependencies(@Body() body: unknown) {
    const parsed: ReportDependenciesDto = reportDependenciesSchema.parse(body);
    return this.permissionsService.reportDependencies(parsed);
  }

  @Post('revoke')
  @HttpCode(200)
  async revoke(@Body() body: unknown) {
    const parsed: RevokePermissionDto = revokePermissionSchema.parse(body);
    return this.permissionsService.revoke(parsed);
  }

  @Get('granted/:installationId')
  async granted(@Param('installationId') installationId: string) {
    return this.permissionsService.getGranted(installationId);
  }
}
