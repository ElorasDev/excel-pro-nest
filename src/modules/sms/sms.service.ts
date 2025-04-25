import { Injectable } from '@nestjs/common';
import { Twilio } from 'twilio';

@Injectable()
export class TwilioService {
  private twilioClient: Twilio;

  constructor() {
    this.twilioClient = new Twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN,
    );
  }

  async sendSMS(to: string, message: string): Promise<any> {
    try {
      const formattedPhoneNumber = this.formatPhoneNumber(to);
      console.log(formattedPhoneNumber);
      console.log(message);
      // const response = await this.twilioClient.messages.create({
      //   body: message,
      //   from: process.env.TWILIO_PHONE_NUMBER,
      //   to: formattedPhoneNumber,
      // });

      // return response;
    } catch (error) {
      console.error('Twilio SMS Error:', error);
      throw error;
    }
  }

  private formatPhoneNumber(phone: string): string {
    const cleanedPhone = phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');

    if (cleanedPhone.startsWith('+')) return cleanedPhone;
    if (cleanedPhone.length === 10) return '+1' + cleanedPhone;
    if (cleanedPhone.startsWith('1') && cleanedPhone.length === 11)
      return '+' + cleanedPhone;
    if (
      cleanedPhone.startsWith('0') &&
      cleanedPhone.length >= 10 &&
      cleanedPhone.length <= 12
    )
      return '+49' + cleanedPhone.substring(1);
    if (cleanedPhone.startsWith('49')) return '+' + cleanedPhone;

    return '+1' + cleanedPhone;
  }
}
