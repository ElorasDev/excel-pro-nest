import { Module } from '@nestjs/common';
import { KavenegarService } from './sms.service';

@Module({
  providers: [KavenegarService],
  exports: [KavenegarService],
})
export class SmsModule {}
