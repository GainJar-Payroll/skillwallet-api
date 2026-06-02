import { Controller, Post, Param, Get, Query, Body } from '@nestjs/common';
import { RunnerService } from './scheduler/runner.service';
import { SchedulerService } from './scheduler/scheduler.service';
import { ExecutionAttemptsService } from './execution-attempts.service';
import { ActivityLogService } from './activity-log.service';

@Controller('runtime')
export class RuntimeController {
  constructor(
    private readonly runner: RunnerService,
    private readonly scheduler: SchedulerService,
    private readonly attempts: ExecutionAttemptsService,
    private readonly activity: ActivityLogService,
  ) {}

  @Post('run-due')
  async runDue() {
    return this.scheduler.runDueInstallations();
  }

  @Post('run/:installationId')
  async runOne(
    @Param('installationId') installationId: string,
    @Body() body: { force?: boolean } = {},
  ) {
    const attempt = await this.runner.run(installationId, { force: body.force });
    return attempt;
  }

  @Get('attempts')
  async listAttempts(@Query('installationId') installationId?: string) {
    if (!installationId) {
      throw new Error('installationId is required');
    }
    return this.attempts.listForInstallation(installationId);
  }

  @Get('attempts/:attemptId')
  async getAttempt(@Param('attemptId') attemptId: string) {
    return this.attempts.findById(attemptId);
  }
}