import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export class ExecutionRecord {
  executedAt: Date;
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
  oneShotTaskId?: string;
  txHash?: string;
  errorMessage?: string;
  aiContext?: string;
  newsContext?: string;
}

export type InstallationDocument = Installation & Document;

@Schema({ timestamps: true, collection: 'installations' })
export class Installation {
  @Prop({ required: true, index: true })
  userAddress: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Skill', index: true })
  skillId: Types.ObjectId;

  @Prop({ required: true, type: Object })
  signedDelegation: Record<string, unknown>;

  @Prop({ required: true })
  delegationSalt: string;

  @Prop({ required: true })
  chainId: number;

  @Prop({ type: Object, default: {} })
  parameters: Record<string, unknown>;

  @Prop({
    required: true,
    enum: ['active', 'paused', 'revoked'],
    default: 'active',
    index: true,
  })
  status: 'active' | 'paused' | 'revoked';

  @Prop({ type: Date })
  lastExecutedAt?: Date;

  @Prop({ type: Date })
  nextExecutionAt?: Date;

  @Prop({ type: [Object], default: [] })
  executions: ExecutionRecord[];
}

export const InstallationSchema = SchemaFactory.createForClass(Installation);
InstallationSchema.index({ status: 1, skillId: 1 });
InstallationSchema.index({ status: 1, nextExecutionAt: 1 });
