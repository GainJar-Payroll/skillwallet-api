import { Injectable, Logger } from '@nestjs/common';
import { InstallationsService } from '../../installations/installations.service';
import { RunnerService } from './runner.service';
import { ActivityLogService } from '../activity-log.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly installations: InstallationsService,
    private readonly runner: RunnerService,
    private readonly activity: ActivityLogService,
  ) {}

  async runDueInstallations(): Promise<{ processed: number; failed: number }> {
    const now = new Date();
    const due = await this.installations.findDueInstallations(now);
    this.logger.log(`Scheduler found ${due.length} due installations`);

    let processed = 0;
    let failed = 0;

    for (const inst of due) {
      try {
        await this.runner.run(inst.installationId);
        processed++;
      } catch (err) {
        failed++;
        this.logger.error(`Failed to run installation ${inst.installationId}: ${(err as Error).message}`);
        await this.activity.log({
          installationId: inst.installationId,
          userAddress: inst.userAddress,
          chainId: inst.chainId,
          type: 'execution.failed',
          message: `Scheduler exception: ${(err as Error).message}`,
        });
      }
    }

    return { processed, failed };
  }
}