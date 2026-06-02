import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EnvModule } from './config/env.module';
import { DatabaseModule } from './database/database.module';
import { SkillsModule } from './skills/skills.module';
import { InstallationsModule } from './installations/installations.module';
import { PermissionsModule } from './permissions/permissions.module';
import { ExecutorsModule } from './executors/executors.module';
import { RuntimeModule } from './runtime/runtime.module';
import { HealthModule } from './health/health.module';
import { ChainsModule } from './chains/chains.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    EnvModule,
    DatabaseModule,
    ChainsModule,
    SkillsModule,
    ExecutorsModule,
    InstallationsModule,
    PermissionsModule,
    RuntimeModule,
    HealthModule,
  ],
})
export class AppModule {}
