import { Module, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChainConfig, ChainConfigSchema } from './chain-config.schema';
import { ChainsService } from './chains.service';
import { ChainsController } from './chains.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: ChainConfig.name, schema: ChainConfigSchema }])],
  controllers: [ChainsController],
  providers: [ChainsService],
  exports: [MongooseModule, ChainsService],
})
export class ChainsModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(ChainsModule.name);

  constructor(private readonly chainsService: ChainsService) {}

  async onApplicationBootstrap() {
    try {
      await this.chainsService.ensureBuiltInsSeeded();
      this.logger.log('Built-in chain configs seeded');
    } catch (err) {
      this.logger.error('Failed to seed built-in chain configs', err as Error);
    }
  }
}
