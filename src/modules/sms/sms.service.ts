import { Injectable } from '@nestjs/common';
import * as twilio from 'twilio';

@Injectable()
export class TwilioService {
  private twilioClient: twilio.Twilio;

  constructor() {
    this.twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN,
    );
  }

  async sendSMS(to: string, message: string): Promise<any> {
    try {
      // const formattedPhoneNumber = this.formatPhoneNumber(to);
      // const response = await this.twilioClient.messages.create({
      //   body: message,
      //   from: process.env.TWILIO_PHONE_NUMBER,
      //   to: formattedPhoneNumber,
      // });

      // return response;

      console.log(message);
    } catch (error) {
      throw error;
    }
  }

  // Helper method to format phone number to international format
  private formatPhoneNumber(phone: string): string {
    // Remove spaces and any non-digit characters except +
    const cleanedPhone = phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');

    // If the phone number already starts with +, return as is
    if (cleanedPhone.startsWith('+')) {
      return cleanedPhone;
    }

    // US/Canada format: 10 digits starting with 1
    if (cleanedPhone.length === 10) {
      return '+1' + cleanedPhone;
    }

    // If it starts with 1 and has 11 digits (US/Canada)
    if (cleanedPhone.startsWith('1') && cleanedPhone.length === 11) {
      return '+' + cleanedPhone;
    }

    // Germany format
    if (
      cleanedPhone.startsWith('0') &&
      cleanedPhone.length >= 10 &&
      cleanedPhone.length <= 12
    ) {
      return '+49' + cleanedPhone.substring(1);
    }

    // If it starts with 49 (Germany)
    if (cleanedPhone.startsWith('49')) {
      return '+' + cleanedPhone;
    }

    // Default: assume US number if nothing else matches
    return '+1' + cleanedPhone;
  }
}
