import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ _id: false })
export class WalletPermissionResponseItem {
  @Prop({ required: true }) chainId!: number;
  @Prop({ required: true }) chainIdHex!: string;
  @Prop() from?: string;
  @Prop() to?: string;
  @Prop({ type: Object, required: true }) permission!: Record<string, unknown>;
  @Prop({ type: [Object] }) rules?: Array<Record<string, unknown>>;
  @Prop({ required: true }) context!: string;
  @Prop({ required: true }) delegationManager!: string;
  @Prop({ type: [Object], default: [] })
  dependencies!: Array<{ factory?: string; factoryData?: string }>;
  @Prop({ required: true }) responseHash!: string;
}

export const WalletPermissionResponseItemSchema = SchemaFactory.createForClass(
  WalletPermissionResponseItem,
);

export type WalletPermissionGrantDocument = HydratedDocument<WalletPermissionGrantRecord>;

@Schema({ timestamps: true, collection: 'wallet_permission_grants' })
export class WalletPermissionGrantRecord {
  @Prop({ required: true, default: 'erc7715' }) standard!: string;
  @Prop({ required: true, enum: ['granted', 'revoked', 'expired'], index: true }) status!: string;
  @Prop({ required: true }) grantedAt!: Date;
  @Prop() expiresAt?: Date;
  @Prop() revokedAt?: Date;
  @Prop({ type: [WalletPermissionResponseItemSchema], required: true })
  responses!: WalletPermissionResponseItem[];
  @Prop({ required: true, type: Object }) rawResponse!: Record<string, unknown>;
  @Prop({ required: true }) responseHash!: string;
}

export const WalletPermissionGrantSchema = SchemaFactory.createForClass(
  WalletPermissionGrantRecord,
);
