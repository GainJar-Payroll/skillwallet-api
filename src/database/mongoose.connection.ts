import { ConfigService } from '@nestjs/config';
import { MongooseModuleFactoryOptions } from '@nestjs/mongoose';
import { Env } from '../config/env.schema';

export function createMongooseOptions(config: ConfigService<Env, true>): MongooseModuleFactoryOptions {
  return {
    uri: config.get('MONGODB_URI', { infer: true }),
    dbName: config.get('MONGODB_DB_NAME', { infer: true }),
    autoIndex: config.get('NODE_ENV', { infer: true }) !== 'production',
  };
}
