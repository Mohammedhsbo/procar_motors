import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

export function configureApp(
  app: INestApplication,
  options?: { corsOrigins?: string[]; nodeEnv?: string },
) {
  const nodeEnv = options?.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const corsOrigins = (options?.corsOrigins ?? [])
    .map((o) => o.trim())
    .filter(Boolean);

  app.use(
    helmet({
      contentSecurityPolicy: nodeEnv === 'production',
      crossOriginEmbedderPolicy: false,
    }),
  );

  if (corsOrigins.length) {
    app.enableCors({
      origin: corsOrigins,
      credentials: true,
    });
  }

  app.setGlobalPrefix('api/v1', {
    exclude: ['health', 'ready'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Pro Motors API')
      .setDescription(
        'Vehicle Service Management System — REST API (Modular Monolith)',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .addApiKey(
        { type: 'apiKey', name: 'X-Branch-Id', in: 'header' },
        'branch',
      )
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }
}
