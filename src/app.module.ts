import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { pool } from './common/db/postgresql.config';
import redisConfig from './common/db/redis.config';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProgramsModule } from './modules/programs/programs.module';
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
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
