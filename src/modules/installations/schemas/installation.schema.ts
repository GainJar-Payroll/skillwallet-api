import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export class ExecutionRecord {
  executionId?: string;
  executedAt!: Date;
  completedAt?: Date;
  status!: 'pending' | 'submitted' | 'confirmed' | 'failed' | 'skipped';
  trigger?: ExecutionTriggerRecord;
  spend?: ExecutionSpendRecord;
  oneShotTaskId?: string;
  txHash?: string;
  errorMessage?: string;
  skippedReason?: string;
  aiContext?: string;
  newsContext?: string;
}

export type ExecutionTriggerType = 'cron' | 'event-trigger';

export class ExecutionTriggerEventRecord {
  chainId!: number;
  contractAddress!: string;
  eventSignature!: string;
  txHash?: string;
  logIndex?: number;
  blockNumber?: string;
  args?: Record<string, unknown>;
}

export class ExecutionTriggerRecord {
  type!: ExecutionTriggerType;
  event?: ExecutionTriggerEventRecord;
}

export class ExecutionSpendRecord {
  tokenAddress!: string;
  requestedAmount!: string;
  actualAmount!: string;
  dailyLimit?: string;
  periodKey?: string;
  reservationId?: string;
}

export type InstallationDocument = Installation & Document;

@Schema({ timestamps: true, collection: 'installations' })
export class Installation {
  @Prop({ required: true, index: true })
  userAddress!: string;

  @Prop({ required: true, index: true })
  smartAccountAddress!: string;

  @Prop({ required: true, type: String, index: true })
  skillId!: string;

  @Prop({ required: true, type: Object })
  signedDelegation!: Record<string, unknown>;

  @Prop({ required: true })
  delegationSalt!: string;

  @Prop({ required: true })
  chainId!: number;

  @Prop({ type: Object, default: {} })
  parameters!: Record<string, unknown>;

  @Prop({
    required: true,
    enum: ['active', 'paused', 'revoked'],
    default: 'active',
    index: true,
  })
  status!: 'active' | 'paused' | 'revoked';

  @Prop({ type: Date })
  lastExecutedAt?: Date;

  @Prop({ type: Date })
  nextExecutionAt?: Date;

  @Prop({ type: [Object], default: [] })
  executions!: ExecutionRecord[];
}

export const InstallationSchema = SchemaFactory.createForClass(Installation);

InstallationSchema.index({ status: 1, skillId: 1 });
InstallationSchema.index({ status: 1, nextExecutionAt: 1 });
InstallationSchema.index({ userAddress: 1, smartAccountAddress: 1 });

InstallationSchema.index(
  {
    userAddress: 1,
    smartAccountAddress: 1,
    skillId: 1,
    status: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ['active', 'paused'] },
    },
  },
);
