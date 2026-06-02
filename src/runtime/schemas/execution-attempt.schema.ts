import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

// 1Shot v2 status code → textual status name
export const RELAY_STATUS_NAMES = [
  'not_submitted',
  'pending',
  'submitted',
  'confirmed',
  'rejected',
  'reverted',
  'failed',
] as const;
export type RelayStatusName = (typeof RELAY_STATUS_NAMES)[number];

// 1Shot v2 numeric status codes
export const RELAY_STATUS_CODES = [100, 110, 200, 400, 500] as const;
export type RelayStatusCode = (typeof RELAY_STATUS_CODES)[number];

// 1Shot / EIP-1193 error codes
export const RELAY_ERROR_CODES = [4200, 4202, 4204, 4210, 4211] as const;
export type RelayErrorCode = (typeof RELAY_ERROR_CODES)[number];

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

/**
 * 1Shot v2 RelayRecord. The webhook controller patches this in place
 * (statusCode / txHash / errorCode / errorMessage) when 1Shot calls back.
 */
@Schema({ _id: false })
export class RelayRecord {
  @Prop({ required: true, default: '1shot' }) provider!: '1shot';

  /** 1Shot task id (UUID) — key for webhook correlation + status polls.
   *  Indexed via `ExecutionAttemptSchema.index({ 'relay.taskId': 1 })` below. */
  @Prop({ required: true }) taskId!: string;

  /** 1Shot numeric status code (100/110/200/400/500) */
  @Prop({ required: true, type: Number, enum: RELAY_STATUS_CODES })
  statusCode!: RelayStatusCode;

  /** Textual name for the status code (for UIs/logs) */
  @Prop({ required: true, type: String, enum: RELAY_STATUS_NAMES })
  status!: RelayStatusName;

  /** Target address the relayer is going to call (e.g. smart account
   *  or DelegationManager). 1Shot-decided. */
  @Prop({ required: true }) targetAddress!: string;

  /** ERC-20 token used to pay 1Shot fees (USDC by default) */
  @Prop({ required: true }) paymentToken!: string;

  /** Required payment in atomic units (base-10 string) */
  @Prop({ required: true }) requiredPaymentAmount!: string;

  /** Opaque 1Shot context blob (echoed from the bundle) */
  @Prop() context?: string;

  /** On-chain tx hash (set when statusCode >= 200) */
  @Prop() txHash?: string;

  /** 1Shot / EIP-1193 error code (set when statusCode >= 400) */
  @Prop({ type: Number, enum: RELAY_ERROR_CODES }) errorCode?: RelayErrorCode;

  /** Human-readable error message (set when statusCode >= 400) */
  @Prop() errorMessage?: string;

  /** URL where the user can watch the task on 1Shot's UI */
  @Prop() externalStatusUrl?: string;
}

export const RelayRecordSchema = SchemaFactory.createForClass(RelayRecord);

@Schema({ timestamps: true, collection: 'execution_attempts' })
export class ExecutionAttempt {
  @Prop({ required: true, unique: true, index: true }) attemptId!: string;
  @Prop({ required: true, index: true }) installationId!: string;
  @Prop({ required: true }) skillId!: string;
  @Prop({ required: true }) adapter!: string;
  @Prop({ required: true, index: true }) chainId!: number;
  @Prop({
    required: true,
    enum: [
      'queued',
      'checking_trigger',
      'building_action',
      'policy_checking',
      'blocked',
      'relaying',
      'relayed',
      'confirmed',
      'failed',
      'skipped',
    ],
    index: true,
  })
  status!: string;
  @Prop() triggerReason?: string;
  @Prop({ type: Object }) proposedAction?: ProposedAction;
  @Prop({ type: Object }) policyResult?: Record<string, unknown>;
  @Prop({ type: RelayRecordSchema }) relay?: RelayRecord;
  @Prop() error?: string;
}

export const ExecutionAttemptSchema = SchemaFactory.createForClass(ExecutionAttempt);
ExecutionAttemptSchema.index({ installationId: 1, createdAt: -1 });
ExecutionAttemptSchema.index({ status: 1, createdAt: -1 });
ExecutionAttemptSchema.index({ chainId: 1, status: 1 });
// Lookup attempts by their 1Shot taskId (for webhook status updates)
ExecutionAttemptSchema.index({ 'relay.taskId': 1 }, { sparse: true });
