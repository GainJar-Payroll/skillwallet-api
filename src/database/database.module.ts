import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Env } from '../config/env.schema';
import { createMongooseOptions } from './mongoose.connection';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => createMongooseOptions(config),
    }),
  ],
})
export class DatabaseModule {}
