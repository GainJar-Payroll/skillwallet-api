import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ChainConfigDocument = HydratedDocument<ChainConfig>;

@Schema({ timestamps: true, collection: 'chain_configs' })
export class ChainConfig {
  @Prop({ required: true, unique: true, index: true })
  chainId!: number;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  rpcUrl!: string;

  @Prop({ required: false })
  delegationManagerAddress?: string;

  @Prop({ required: false })
  usdcAddress?: string;

  @Prop({ required: false })
  wethAddress?: string;

  @Prop({ required: false })
  swapRouterAddress?: string;

  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;
}

export const ChainConfigSchema = SchemaFactory.createForClass(ChainConfig);
