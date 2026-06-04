import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';

@Schema({ _id: false })
export class MatchedItem {
  @Prop({ required: true }) chainId!: number;
  @Prop({ required: true }) permissionType!: string;
  @Prop({ type: [String], required: true }) requiredRuleTypes!: string[];
  @Prop({ default: true }) required?: boolean;
}

export const MatchedItemSchema = SchemaFactory.createForClass(MatchedItem);

@Schema({ _id: false })
export class MissingItem {
  @Prop({ required: true }) chainId!: number;
  @Prop({ required: true }) permissionType!: string;
  @Prop({ type: [String], required: true }) requiredRuleTypes!: string[];
  @Prop({ required: true }) reason!: string;
}

export const MissingItemSchema = SchemaFactory.createForClass(MissingItem);

export type WalletSupportCheckDocument = HydratedDocument<WalletSupportCheckRecord>;

@Schema({ timestamps: true, collection: 'wallet_support_checks' })
export class WalletSupportCheckRecord {
  @Prop({ required: true, unique: true, index: true }) checkId!: string;
  @Prop({ required: true, index: true }) userAddress!: string;
  @Prop({ required: true }) smartAccountAddress!: string;
  @Prop({ required: true, index: true }) skillId!: string;
  @Prop({ required: true, index: true }) chainId!: number;
  // Raw wallet response (object: { "erc20-token-periodic": { ruleTypes, chainIds } }) OR string[] for back-compat.
  @Prop({ type: SchemaTypes.Mixed, required: true })
  walletReportedPermissions!: unknown;
  // Derived array of permission type names (sorted) — for stable matching + queries.
  @Prop({ type: [String], default: [] })
  walletReportedPermissionTypes!: string[];
  @Prop({ type: [MatchedItemSchema], default: [] }) matched!: MatchedItem[];
  @Prop({ type: [MissingItemSchema], default: [] }) missing!: MissingItem[];
  @Prop({ required: true }) checkedAt!: Date;
}

export const WalletSupportCheckSchema = SchemaFactory.createForClass(WalletSupportCheckRecord);
