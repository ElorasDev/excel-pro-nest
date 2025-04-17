import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import * as dotenv from 'dotenv';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import passport = require('passport');
// eslint-disable-next-line @typescript-eslint/no-require-imports
import session = require('express-session');

dotenv.config({ path: '.env.local' });
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // تنظیمات CORS بر اساس محیط
  // const corsOrigins =
  //   process.env.NODE_ENV !== 'development'
  //     ? ['https://excel-pro-next-git-develop-eloras-dev.vercel.app']
  //     : ['http://localhost:3000'];

  // app.enableCors({
  //   origin: corsOrigins,
  //   methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  //   allowedHeaders: [
  //     'Content-Type',
  //     'Authorization',
  //     'Cache-Control',
  //     'Pragma',
  //     'Expires',
  //     'Origin',
  //     'X-Requested-With',
  //     'Accept',
  //   ],
  //   credentials: true,
  //   preflightContinue: false,
  //   optionsSuccessStatus: 204,
  // });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
    }),
  );
  app.use(
    session({
      secret: 'secret',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: process.env.NODE_ENV === 'production' },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());
  app.use(json({ limit: '100mb' }));
  app.use(urlencoded({ limit: '100mb', extended: true }));

  const config = new DocumentBuilder()
    .setTitle('Excel Pro Nest App')
    .setDescription(
      'A comprehensive NestJS application built for managing operations and workflows of Excel Pro Football Academy.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(process.env.PORT || 3001);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
