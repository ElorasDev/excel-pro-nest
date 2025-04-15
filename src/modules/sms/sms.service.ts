// sms/kavenegar.service.ts
import { Injectable } from '@nestjs/common';
import * as Kavenegar from 'kavenegar';

@Injectable()
export class KavenegarService {
  private kavenegarApi: any;

  constructor() {
    this.kavenegarApi = Kavenegar.KavenegarApi({
      apikey: process.env.KAVENEGAR_API_KEY,
    });
  }

  sendSMS(to: string, message: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.kavenegarApi.Send(
        {
          message,
          sender: '0018018949161',
          receptor: to,
        },
        (response: any, status: any) => {
          if (status === 200) {
            resolve(response);
          } else {
            reject(response);
          }
        },
      );
    });
  }
}
