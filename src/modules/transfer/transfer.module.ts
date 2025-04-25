import { Module } from '@nestjs/common';
import { TransferService } from './transfer.service';
import { TransferController } from './transfer.controller';
import { TwilioService } from '../sms/sms.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transfer } from './entities/transfer.entity';
import { User } from '../users/entities/user.entity';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { NotificationsService } from './notificationsService.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transfer, User]),
    ScheduleModule.forRoot(),
    ConfigModule,
  ],
  controllers: [TransferController],
  providers: [TransferService, TwilioService, NotificationsService],
})
export class TransferModule {}
