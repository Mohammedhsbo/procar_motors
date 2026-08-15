import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { JsonLogger } from './common/logging/json.logger';
import type { EnvConfig } from './config/env.validation';

async function bootstrap() {
  const isProd = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create(AppModule, {
    logger: isProd ? new JsonLogger() : undefined,
  });
  app.enableShutdownHooks();
  const config = app.get(ConfigService<EnvConfig, true>);
  const port = config.get('PORT', { infer: true });
  const corsOrigins = config.get('CORS_ORIGINS', { infer: true }).split(',');
  configureApp(app, {
    corsOrigins,
    nodeEnv: config.get('NODE_ENV', { infer: true }),
  });
  await app.listen(port);
}

void bootstrap();
