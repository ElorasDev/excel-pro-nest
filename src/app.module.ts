import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { pool } from './common/db/postgresql.config';
import redisConfig from './common/db/redis.config';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProgramsModule } from './modules/programs/programs.module';
import { PaymentModule } from './modules/payment/payment.module';
import { MatchesModule } from './modules/matches/matches.module';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
@Module({
  imports: [
    TypeOrmModule.forRoot(pool),
    ConfigModule.forRoot({
      isGlobal: true,
      load: [redisConfig],
    }),
    PassportModule,
    AuthModule,
    UsersModule,
    ProgramsModule,
    PaymentModule,
    MatchesModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
