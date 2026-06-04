import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WalletPermissionRequestDocument = HydratedDocument<WalletPermissionRequestRecord>;

@Schema({ timestamps: true, collection: 'wallet_permission_requests' })
export class WalletPermissionRequestRecord {
  @Prop({ required: true, default: 'erc7715' }) standard!: string;
  @Prop({
    required: true,
    enum: [
      'wallet_requestExecutionPermissions',
      'wallet_grantPermissions',
      'metamask_requestExecutionPermissions',
    ],
  })
  method!: string;
  @Prop({
    required: true,
    enum: ['prepared', 'submitted', 'approved', 'rejected', 'failed'],
    index: true,
  })
  status!: string;
  @Prop({ required: true, unique: true, index: true }) requestId!: string;
  @Prop({ required: true, index: true }) compiledFromManifestHash!: string;
  @Prop({ required: true, type: Object }) rawRequest!: Record<string, unknown>;
  @Prop({ required: true, type: Object }) normalized!: Record<string, unknown>;
  @Prop({ type: [Object], default: [] })
  rawRules?: Array<Record<string, unknown>>;
  @Prop({ required: true }) requestHash!: string;
  @Prop({ required: true }) requestedAt!: Date;
  @Prop() approvedAt?: Date;
  @Prop() rejectedAt?: Date;
  @Prop() error?: string;
}

export const WalletPermissionRequestSchema = SchemaFactory.createForClass(
  WalletPermissionRequestRecord,
);
WalletPermissionRequestSchema.index({ compiledFromManifestHash: 1 });
