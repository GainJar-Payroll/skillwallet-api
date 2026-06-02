import { Module } from '@nestjs/common';
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
export class ExecutorsModule {}
