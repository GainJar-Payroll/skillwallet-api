import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PermissionManifestDocument = HydratedDocument<PermissionManifest>;

@Schema({ timestamps: true, collection: 'permission_manifests' })
export class PermissionManifest {
  @Prop({ required: true, enum: ['skillwallet.permission.v1'] })
  version!: string;

  @Prop({ required: true, unique: true, index: true })
  manifestId!: string;

  @Prop({ required: true, index: true })
  skillId!: string;

  @Prop({ required: true, index: true })
  chainId!: number;

  @Prop({ required: true })
  delegator!: string;

  @Prop({ required: true })
  delegate!: string;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  summary!: string;

  @Prop({ required: true, type: [String] })
  allowedActions!: string[];

  @Prop({ required: true, type: [String] })
  forbiddenActions!: string[];

  @Prop({ required: true, type: [String] })
  allowedTargets!: string[];

  @Prop({ required: true, type: [String] })
  allowedSelectors!: string[];

  @Prop({ required: true, type: [String] })
  allowedTokens!: string[];

  @Prop({ required: true, type: [Object] })
  rules!: Record<string, unknown>[];

  @Prop()
  validAfter?: Date;

  @Prop({ required: true })
  validUntil!: Date;

  @Prop({ required: true, index: true })
  manifestHash!: string;
}

export const PermissionManifestSchema = SchemaFactory.createForClass(PermissionManifest);
