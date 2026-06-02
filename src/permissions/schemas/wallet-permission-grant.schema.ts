import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WalletPermissionGrantDocument = HydratedDocument<WalletPermissionGrantRecord>;

@Schema({ timestamps: true, collection: 'wallet_permission_grants' })
export class WalletPermissionGrantRecord {
  @Prop({ required: true, default: 'erc7715' }) standard!: string;
  @Prop({ required: true, enum: ['granted', 'revoked', 'expired'], index: true }) status!: string;
  @Prop({ required: true }) grantedAt!: Date;
  @Prop() expiresAt?: Date;
  @Prop() delegationManager?: string;
  @Prop() context?: string;
  @Prop({ type: Object }) dependencies?: Record<string, unknown>[];
  @Prop({ required: true, type: Object }) rawResponse!: Record<string, unknown>;
  @Prop({ required: true }) responseHash!: string;
  @Prop({ required: true, type: Object }) normalizedPermissions!: Record<string, unknown>;
}

export const WalletPermissionGrantSchema = SchemaFactory.createForClass(WalletPermissionGrantRecord);
