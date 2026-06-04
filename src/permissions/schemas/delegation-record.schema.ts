import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ _id: false })
export class DelegationCaveat {
  @Prop({ required: true }) kind!: string;
  @Prop() enforcer?: string;
  @Prop() terms?: string;
  @Prop() args?: string;
  @Prop({ type: Object }) normalized?: Record<string, unknown>;
}

export const DelegationCaveatSchema = SchemaFactory.createForClass(DelegationCaveat);

export type DelegationRecordDocument = HydratedDocument<DelegationRecord>;

@Schema({ timestamps: true, collection: 'delegation_records' })
export class DelegationRecord {
  @Prop({ required: true, default: 'erc7710' }) standard!: string;
  @Prop({ required: true, enum: ['redeemable', 'revoked', 'expired', 'unknown'], index: true })
  status!: string;
  @Prop({ required: true }) delegator!: string;
  @Prop({ required: true }) delegate!: string;
  @Prop({ required: true }) delegationManager!: string;
  @Prop({ required: true, index: true }) permissionContext!: string;
  @Prop({ type: Object }) rawPermissionResponse?: Record<string, unknown>;
  @Prop() signature?: string;
  @Prop({ type: [DelegationCaveatSchema], default: [] }) caveats!: DelegationCaveat[];
  @Prop({ required: true }) grantedAt!: Date;
  @Prop() expiresAt?: Date;
  @Prop() revokedAt?: Date;
}

export const DelegationRecordSchema = SchemaFactory.createForClass(DelegationRecord);
DelegationRecordSchema.index({ delegator: 1, status: 1 });
DelegationRecordSchema.index({ delegate: 1, status: 1 });
DelegationRecordSchema.index({ permissionContext: 1 });
