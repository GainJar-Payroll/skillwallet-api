import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChainConfig, ChainConfigSchema } from './chain-config.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ChainConfig.name, schema: ChainConfigSchema }]),
  ],
  exports: [MongooseModule],
})
export class ChainsModule {}