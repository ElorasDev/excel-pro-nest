import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { pool } from './common/db';
import { AuthModule } from './auth/auth.module';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
@Module({
  imports: [TypeOrmModule.forRoot(pool), PassportModule, AuthModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
