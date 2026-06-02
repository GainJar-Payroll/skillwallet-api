import { Injectable, Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { v4 as uuidv4 } from 'uuid';
import {
  ExecutionAttempt,
  ExecutionAttemptDocument,
  ProposedAction,
  RelayErrorCode,
  RelayRecord,
  RelayStatusCode,
  RelayStatusName,
} from './schemas/execution-attempt.schema';
import { PolicyValidationResult } from './policy/policy-types';
import { OneShotStatusCode } from './relayers/relayer.interface';

const STATUS_CODE_TO_NAME: Record<RelayStatusCode, RelayStatusName> = {
  100: 'pending',
  110: 'submitted',
  200: 'confirmed',
  400: 'rejected',
  500: 'reverted',
};

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
    extras?: {
      proposedAction?: ProposedAction;
      policyResult?: PolicyValidationResult;
      relay?: RelayRecord;
      error?: string;
    },
  ): Promise<ExecutionAttempt | null> {
    const update: Record<string, unknown> = { status };
    if (extras?.proposedAction) update.proposedAction = extras.proposedAction;
    if (extras?.policyResult) update.policyResult = extras.policyResult;
    if (extras?.relay) update.relay = extras.relay;
    if (extras?.error !== undefined) update.error = extras.error;
    const doc = await this.attemptModel.findOneAndUpdate(
      { attemptId },
      { $set: update },
      { new: true },
    );
    return doc ? (doc.toObject() as ExecutionAttempt) : null;
  }

  async findById(attemptId: string): Promise<ExecutionAttempt | null> {
    return this.attemptModel.findOne({ attemptId }).lean();
  }

  async findByTaskId(taskId: string): Promise<ExecutionAttempt | null> {
    return this.attemptModel.findOne({ 'relay.taskId': taskId }).lean();
  }

  async listForInstallation(installationId: string): Promise<ExecutionAttempt[]> {
    return this.attemptModel.find({ installationId }).sort({ createdAt: -1 }).lean();
  }

  async updateRelayFromWebhook(
    attemptId: string,
    patch: {
      statusCode: OneShotStatusCode;
      txHash?: string;
      errorCode?: RelayErrorCode;
      errorMessage?: string;
    },
  ): Promise<ExecutionAttempt | null> {
    const update: Record<string, unknown> = {
      'relay.statusCode': patch.statusCode,
      'relay.status': STATUS_CODE_TO_NAME[patch.statusCode] ?? 'pending',
    };
    if (patch.txHash !== undefined) update['relay.txHash'] = patch.txHash;
    if (patch.errorCode !== undefined) update['relay.errorCode'] = patch.errorCode;
    if (patch.errorMessage !== undefined) update['relay.errorMessage'] = patch.errorMessage;

    const attemptStatusByCode: Record<OneShotStatusCode, string> = {
      100: 'relayed',
      110: 'relayed',
      200: 'confirmed',
      400: 'failed',
      500: 'failed',
    };
    update.status = attemptStatusByCode[patch.statusCode] ?? 'relayed';

    return this.attemptModel
      .findOneAndUpdate({ attemptId }, { $set: update }, { new: true })
      .lean();
  }
}
