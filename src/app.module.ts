import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration, { validationSchema } from './config/configuration';
import { ExecutorModule } from './modules/executor/executor.module';
import { SkillsModule } from './modules/skills/skills.module';
import { DelegationModule } from './modules/delegation/delegation.module';
import { InstallationsModule } from './modules/installations/installations.module';
import { RunnerModule } from './modules/runner/runner.module';
import { OneShotModule } from './modules/oneshot/oneshot.module';
import { X402Module } from './modules/x402/x402.module';
import { VeniceModule } from './modules/venice/venice.module';
import { AdminModule } from './modules/admin/admin.module';
import { AppController } from './app.controller';
import { SponsorModule } from './modules/sponsor/sponsor.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema,
      load: [configuration],
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => {
        const uri = c.get<string>('mongodbUri');
        const dbName = c.get<string>('mongodbDbName');
        return dbName ? { uri, dbName } : { uri };
      },
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
    ExecutorModule,
    OneShotModule,
    X402Module,
    VeniceModule,
    SkillsModule,
    DelegationModule,
    InstallationsModule,
    RunnerModule,
    AdminModule,
    SponsorModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
