import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

function parseCorsOrigins(): string | string[] | true {
  const raw = process.env.CORS_ORIGINS;
  if (!raw || raw.trim() === '*') return true;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  app.enableCors({
    origin: parseCorsOrigins(),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-pimlico-key', 'X-402-Payment'],
    exposedHeaders: ['PAYMENT-REQUIRED'],
    maxAge: 86400,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('SkillWallet Backend API')
    .setDescription(
      'REST surface for the SkillWallet marketplace. Skills are published server-side; ' +
        'EVM wallets sign delegations via ERC-4337 delegation and submit ' +
        'them to /installations. The runner executes each skill via the configured relayer.',
    )
    .setVersion('0.1.0')
    .addApiKey(
      { type: 'apiKey', name: 'x-api-key', in: 'header' },
      'admin-api-key',
    )
    .addTag('Health', 'Liveness and dependency status')
    .addTag('Executor', 'Executor EVM account read APIs')
    .addTag('Skills', 'Skill catalog and admin CRUD')
    .addTag('Installations', 'Prepare, sign, confirm, and manage user skill installations')
    .addApiKey(
      { type: 'apiKey', name: 'x-pimlico-key', in: 'header' },
      'pimlico-api-key',
    )
    .addTag('Admin', 'Admin-only operations (seed skills, trigger executions)')
    .addTag('Pimlico', 'Pimlico ERC-4337 bundler + ERC-7677 paymaster endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
    customSiteTitle: 'SkillWallet Backend API Docs',
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  Logger.log(`SkillWallet Backend running on http://0.0.0.0:${port}/`, 'Bootstrap');
  Logger.log(`Health endpoint:        http://0.0.0.0:${port}/health`, 'Bootstrap');
  Logger.log(`API docs:               http://0.0.0.0:${port}/docs`, 'Bootstrap');
}

bootstrap().catch((err) => {
  Logger.error(`Bootstrap failed: ${err?.message ?? err}`, err?.stack, 'Bootstrap');
  process.exit(1);
});
