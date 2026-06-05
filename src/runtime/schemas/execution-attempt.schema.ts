import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ExecutionAttemptDocument = HydratedDocument<ExecutionAttempt>;
export type ExecutionAttemptDoc = ExecutionAttemptDocument;

export type AttemptStatus =
  | 'queued'
  | 'checking_trigger'
  | 'building_action'
  | 'policy_checking'
  | 'blocked'
  | 'quoting'
  | 'relaying'
  | 'relayed'
  | 'confirmed'
  | 'failed'
  | 'skipped';

export type RelayStatusCode = 100 | 110 | 200 | 400 | 500;
export type RelayStatusName = 'pending' | 'submitted' | 'confirmed' | 'rejected' | 'reverted';
export type RelayErrorCode = 4001 | 4200 | 4202 | 4204 | 4210 | 4211;

@Schema({ _id: false })
export class ProposedAction {
  @Prop() chainId?: number;
  @Prop({ required: true }) target!: string;
  @Prop({ required: true }) value!: string;
  @Prop() data?: string;
  @Prop({ required: true }) calldata!: string;
  @Prop() selector?: string;
  @Prop({ type: Object }) decoded?: Record<string, unknown>;
  @Prop({ type: Object }) metadata?: Record<string, unknown>;
}
export const ProposedActionSchema = SchemaFactory.createForClass(ProposedAction);

@Schema({ _id: false })
export class ProposedExecution {
  @Prop({ required: true }) description!: string;
  @Prop({ type: [ProposedActionSchema], required: true })
  actions!: ProposedAction[];
}
export const ProposedExecutionSchema = SchemaFactory.createForClass(ProposedExecution);

@Schema({ _id: false })
export class ProposedBundle {
  @Prop({ required: true }) description!: string;
  @Prop({ type: [ProposedExecutionSchema], required: true })
  executions!: ProposedExecution[];
}
export const ProposedBundleSchema = SchemaFactory.createForClass(ProposedBundle);

@Schema({ _id: false })
export class RelayContext {
  @Prop() environment?: string;
  @Prop() relayerVersion?: string;
}
export const RelayContextSchema = SchemaFactory.createForClass(RelayContext);

@Schema({ _id: false })
export class RelayRecord {
  @Prop({ type: String, enum: ['1shot'], default: '1shot' })
  provider?: '1shot';
  @Prop() taskId?: string;
  @Prop({ type: Number, enum: [100, 110, 200, 400, 500] })
  statusCode?: RelayStatusCode;
  @Prop({
    type: String,
    enum: ['pending', 'submitted', 'confirmed', 'rejected', 'reverted'],
  })
  status?: RelayStatusName;
  @Prop() targetAddress?: string;
  @Prop() paymentToken?: string;
  @Prop() requiredPaymentAmount?: string;
  @Prop({ type: RelayContextSchema }) context?: RelayContext;
  @Prop() txHash?: string;
  @Prop({ type: Object }) receipt?: Record<string, unknown>;
  @Prop({ type: Number }) errorCode?: number;
  @Prop() errorMessage?: string;
  @Prop({ type: String, enum: ['relayer_send7710Transaction'] })
  method?: 'relayer_send7710Transaction';
}
export const RelayRecordSchema = SchemaFactory.createForClass(RelayRecord);

@Schema({ _id: false })
export class AttemptError {
  @Prop() code?: string;
  @Prop() message?: string;
}
export const AttemptErrorSchema = SchemaFactory.createForClass(AttemptError);

@Schema({ timestamps: true, collection: 'execution_attempts' })
export class ExecutionAttempt {
  @Prop({ required: true, unique: true, index: true }) attemptId!: string;
  @Prop({ required: true, index: true }) installationId!: string;
  @Prop({ required: true, index: true }) skillType!: string;
  @Prop({ required: true, index: true }) chainId!: number;
  @Prop({ required: true }) userAddress!: string;
  @Prop({
    required: true,
    type: String,
    enum: [
      'queued',
      'checking_trigger',
      'building_action',
      'policy_checking',
      'blocked',
      'quoting',
      'relaying',
      'relayed',
      'confirmed',
      'failed',
      'skipped',
    ],
    index: true,
  })
  status!: AttemptStatus;
  @Prop({ type: ProposedBundleSchema }) proposed?: ProposedBundle;
  @Prop({ type: RelayRecordSchema }) relay?: RelayRecord;
  @Prop({ type: AttemptErrorSchema }) error?: AttemptError;
}

export const ExecutionAttemptSchema = SchemaFactory.createForClass(ExecutionAttempt);
ExecutionAttemptSchema.index({ installationId: 1, createdAt: -1 });
ExecutionAttemptSchema.index({ status: 1, createdAt: -1 });
ExecutionAttemptSchema.index({ chainId: 1, status: 1 });
ExecutionAttemptSchema.index({ 'relay.taskId': 1 }, { sparse: true });
