import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ActivityLogDocument = HydratedDocument<ActivityLog>;
export type ActivityLogDoc = ActivityLogDocument;

export type ActivityKind =
  | 'attempt-status'
  | 'attempt-error'
  | 'installation-status'
  | 'grant-status'
  | 'webhook';

@Schema({ timestamps: { createdAt: 'createdAt', updatedAt: false }, collection: 'activity_logs' })
export class ActivityLog {
  @Prop() activityId?: string;
  @Prop({ required: true, type: String, index: true }) kind!: ActivityKind;
  @Prop({ index: true }) installationId?: string;
  @Prop() attemptId?: string;
  @Prop() userAddress?: string;
  @Prop({ type: Number }) chainId?: number;
  @Prop() type?: string;
  @Prop({ required: true, index: true }) status!: string;
  @Prop() message?: string;
  @Prop({ required: true }) reason!: string;
  @Prop({ type: Object }) meta?: Record<string, unknown>;
  @Prop({ type: Object }) metadata?: Record<string, unknown>;
  @Prop({ type: Date, default: () => new Date() }) createdAt!: Date;
}

export const ActivityLogSchema = SchemaFactory.createForClass(ActivityLog);
ActivityLogSchema.index({ createdAt: -1 });
