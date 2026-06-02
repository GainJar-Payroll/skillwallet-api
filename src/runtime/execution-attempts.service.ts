import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { ExecutionAttempt, ExecutionAttemptDocument, ProposedAction, RelayRecord } from './schemas/execution-attempt.schema';
import { PolicyValidationResult } from './policy/policy-types';

@Injectable()
export class ExecutionAttemptsService {
  private readonly logger = new Logger(ExecutionAttemptsService.name);

  constructor(
    @InjectModel(ExecutionAttempt.name)
    private readonly attemptModel: Model<ExecutionAttemptDocument>,
  ) {}

  async create(input: {
    installationId: string;
    skillId: string;
    adapter: string;
    chainId: number;
    triggerReason?: string;
  }): Promise<ExecutionAttempt> {
    const doc = await this.attemptModel.create({
      attemptId: `att_${uuidv4()}`,
      ...input,
      status: 'queued',
    });
    return doc.toObject();
  }

  async updateStatus(
    attemptId: string,
    status: string,
    extras?: { proposedAction?: ProposedAction; policyResult?: PolicyValidationResult; relay?: RelayRecord; error?: string },
  ): Promise<ExecutionAttempt | null> {
    const update: Record<string, unknown> = { status };
    if (extras?.proposedAction) update.proposedAction = extras.proposedAction;
    if (extras?.policyResult) update.policyResult = extras.policyResult;
    if (extras?.relay) update.relay = extras.relay;
    if (extras?.error !== undefined) update.error = extras.error;
    const doc = await this.attemptModel.findOneAndUpdate({ attemptId }, { $set: update }, { new: true });
    return doc ? (doc.toObject() as ExecutionAttempt) : null;
  }

  async findById(attemptId: string): Promise<ExecutionAttempt | null> {
    return this.attemptModel.findOne({ attemptId }).lean();
  }

  async listForInstallation(installationId: string): Promise<ExecutionAttempt[]> {
    return this.attemptModel.find({ installationId }).sort({ createdAt: -1 }).lean();
  }
}