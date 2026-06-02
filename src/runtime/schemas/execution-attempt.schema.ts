import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ExecutionAttemptDocument = HydratedDocument<ExecutionAttempt>;

export interface ProposedActionDecoded {
  actionType: 'swap' | 'vote' | 'claim' | 'approve' | 'transfer' | 'unknown';
  summary: string;
  tokenIn?: string;
  tokenOut?: string;
  amountIn?: string;
  minAmountOut?: string;
  recipient?: string;
  spender?: string;
}

export interface ProposedAction {
  chainId: number;
  target: string;
  value: string;
  calldata: string;
  selector: string;
  decoded: ProposedActionDecoded;
  metadata?: Record<string, unknown>;
}

export interface RelayRecord {
  provider: '1shot';
  relayId?: string;
  status: 'not_submitted' | 'queued' | 'submitted' | 'confirmed' | 'failed';
  txHash?: string;
  externalStatusUrl?: string;
  error?: string;
}

@Schema({ timestamps: true, collection: 'execution_attempts' })
export class ExecutionAttempt {
  @Prop({ required: true, unique: true, index: true }) attemptId!: string;
  @Prop({ required: true, index: true }) installationId!: string;
  @Prop({ required: true }) skillId!: string;
  @Prop({ required: true }) adapter!: string;
  @Prop({ required: true, index: true }) chainId!: number;
  @Prop({ required: true, enum: ['queued', 'checking_trigger', 'building_action', 'policy_checking', 'blocked', 'relaying', 'relayed', 'confirmed', 'failed', 'skipped'], index: true }) status!: string;
  @Prop() triggerReason?: string;
  @Prop({ type: Object }) proposedAction?: ProposedAction;
  @Prop({ type: Object }) policyResult?: Record<string, unknown>;
  @Prop({ type: Object }) relay?: RelayRecord;
  @Prop() error?: string;
}

export const ExecutionAttemptSchema = SchemaFactory.createForClass(ExecutionAttempt);
ExecutionAttemptSchema.index({ installationId: 1, createdAt: -1 });
ExecutionAttemptSchema.index({ status: 1, createdAt: -1 });
ExecutionAttemptSchema.index({ chainId: 1, status: 1 });