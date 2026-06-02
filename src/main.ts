import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ZodError } from 'zod';
import { AppModule } from './app.module';
import { AppError } from './common/errors/app-error';
import { ErrorCode } from './common/errors/error-codes';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  app.useGlobalPipes(
    new ValidationPipe({
      exceptionFactory: (errors) => {
        return new AppError(ErrorCode.VALIDATION_ERROR, 'Validation failed', errors);
      },
    }),
  );

  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled promise rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
  });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  logger.log(`SkillWallet Core Backend listening on port ${port}`);
}

bootstrap().catch((err) => {
  const logger = new Logger('Bootstrap');
  logger.error(`Failed to start: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});