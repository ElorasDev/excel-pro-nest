import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PassportModule } from '@nestjs/passport';
import { pool } from './common/db';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
@Module({
  imports: [TypeOrmModule.forRoot(pool), PassportModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
