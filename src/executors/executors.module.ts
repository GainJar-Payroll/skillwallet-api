import { Module, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExecutorRegistry, ExecutorRegistrySchema } from './schemas/executor-registry.schema';
import { ExecutorsService } from './executors.service';
import { ExecutorsController } from './executors.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ExecutorRegistry.name, schema: ExecutorRegistrySchema }]),
  ],
  providers: [ExecutorsService],
  controllers: [ExecutorsController],
  exports: [ExecutorsService, MongooseModule],
})
export class ExecutorsModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(ExecutorsModule.name);

  constructor(private readonly executorsService: ExecutorsService) {}

  async onApplicationBootstrap() {
    try {
      await this.executorsService.ensureBuiltInsSeeded();
      this.logger.log('Executor seeded for all supported chains');
    } catch (err) {
      this.logger.error('Failed to seed executor', err as Error);
    }
  }
}
