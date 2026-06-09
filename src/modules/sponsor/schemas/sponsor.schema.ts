import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { Document } from 'mongoose';

export type SponsorStateDocument = SponsorState & Document;

@Schema({ timestamps: true, collection: 'sponsor_states' })
export class SponsorState {
  @Prop({ required: true, unique: true })
  chainId!: number;

  @Prop({ required: true })
  sponsorAddress!: string;

  @Prop({ required: true })
  feeCollector!: string;

  @Prop({ required: true })
  targetAddress!: string;

  @Prop({ required: true, type: Object })
  signedDelegation!: Record<string, unknown>;

  /** Total USDC atoms authorized in the current delegation's caveat */
  @Prop({ required: true })
  maxAmountAtoms!: string;

  /** Local spend counter — used to trigger refresh before caveat is exhausted on-chain */
  @Prop({ required: true, default: '0' })
  usedAmountAtoms!: string;

  /** True once the EIP-7702 authorization has been included in a confirmed relayer tx */
  @Prop({ default: false })
  eip7702Upgraded!: boolean;

  @Prop({ type: Date, default: Date.now })
  lastRefreshedAt?: Date;
}

export const SponsorStateSchema = SchemaFactory.createForClass(SponsorState);
