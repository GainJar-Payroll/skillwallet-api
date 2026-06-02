import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export class DcaSkillConfig {
  @Prop({ required: true, default: 'dca' }) type!: string;
  @Prop({ required: true, default: 'USDC' }) tokenInSymbol!: string;
  @Prop({ required: true }) tokenInAddress!: string;
  @Prop({ required: true, default: 6 }) tokenInDecimals!: number;
  @Prop({ required: true, default: 'WETH' }) tokenOutSymbol!: string;
  @Prop({ required: true }) tokenOutAddress!: string;
  @Prop({ required: true, default: 18 }) tokenOutDecimals!: number;
  @Prop({ required: true }) amountPerRun!: string;
  @Prop({ required: true, enum: ['daily', 'weekly', 'monthly'] }) frequency!: string;
  @Prop({ required: true, min: 1, max: 500 }) maxSlippageBps!: number;
  @Prop({ required: true }) routerName!: 'uniswap' | 'aerodrome' | 'custom';
  @Prop({ required: true }) routerAddress!: string;
  @Prop({ required: true }) recipient!: string;
  @Prop({ required: true, enum: ['external-quote-required', 'router-quote', 'manual-min-out'] }) quoteMode!: string;
  @Prop({ required: false }) minAmountOut?: string;
}

export const DcaSkillConfigSchema = SchemaFactory.createForClass(DcaSkillConfig);
