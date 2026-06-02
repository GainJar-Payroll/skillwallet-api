import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { ActivityLog, ActivityLogDocument } from './schemas/activity-log.schema';

@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger(ActivityLogService.name);

  constructor(
    @InjectModel(ActivityLog.name)
    private readonly logModel: Model<ActivityLogDocument>,
  ) {}

  async log(input: {
    installationId?: string;
    attemptId?: string;
    userAddress?: string;
    chainId?: number;
    type: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<ActivityLog> {
    const doc = await this.logModel.create({
      activityId: `act_${uuidv4()}`,
      ...input,
      metadata: input.metadata ?? {},
    });
    this.logger.log(`[${input.type}] ${input.message}`);
    return doc.toObject();
  }

  async listForInstallation(installationId: string): Promise<ActivityLog[]> {
    return this.logModel.find({ installationId }).sort({ createdAt: -1 }).lean();
  }

  async listForUser(userAddress: string): Promise<ActivityLog[]> {
    return this.logModel.find({ userAddress }).sort({ createdAt: -1 }).lean();
  }
}
