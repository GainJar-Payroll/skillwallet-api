import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DelegationRecordDocument = HydratedDocument<DelegationRecord>;

@Schema({ timestamps: true, collection: 'delegation_records' })
export class DelegationRecord {
  @Prop({ required: true, default: 'erc7710' }) standard!: string;
  @Prop({ required: true, enum: ['redeemable', 'revoked', 'expired', 'unknown'], index: true }) status!: string;
  @Prop({ required: true }) delegator!: string;
  @Prop({ required: true }) delegate!: string;
  @Prop({ required: true }) delegationManager!: string;
  @Prop() permissionContext?: string;
  @Prop({ type: Object }) rawDelegation?: Record<string, unknown>;
  @Prop() signature?: string;
  @Prop({ required: true, type: [Object] }) caveats!: Record<string, unknown>[];
  @Prop({ required: true }) grantedAt!: Date;
  @Prop() expiresAt?: Date;
  @Prop() revokedAt?: Date;
}

export const DelegationRecordSchema = SchemaFactory.createForClass(DelegationRecord);
DelegationRecordSchema.index({ delegator: 1, status: 1 });
DelegationRecordSchema.index({ delegate: 1, status: 1 });
