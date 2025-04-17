import { Injectable } from '@nestjs/common';
import { Twilio } from 'twilio'; // ✅ درستش اینه

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
      console.log('شماره فرمت شده:', formattedPhoneNumber);

      // بررسی کنیم که آیا این شماره یک Short Code است یا خیر
      // شماره‌های Short Code معمولاً 5 یا 6 رقمی هستند
      const numberWithoutPlus = formattedPhoneNumber.replace('+', '');
      if (numberWithoutPlus.length <= 6) {
        throw new Error('شماره نمی‌تواند یک Short Code باشد');
      }

      const response = await this.twilioClient.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: formattedPhoneNumber,
      });

      return response;
    } catch (error) {
      console.error('Twilio SMS Error:', error);
      throw error;
    }
  }

  private formatPhoneNumber(phone: string): string {
    // حذف همه فاصله‌ها و کاراکترهای غیر عددی به جز +
    const cleanedPhone = phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');

    // اگر با + شروع شده، بررسی کنیم که +1 باشد
    if (cleanedPhone.startsWith('+')) {
      // اگر با +1 شروع شده، آن را برگردانیم
      if (cleanedPhone.startsWith('+1')) {
        return cleanedPhone;
      } else {
        throw new Error('شماره باید آمریکایی یا کانادایی باشد (+1)');
      }
    }

    // اگر شماره 10 رقمی است (کد منطقه + شماره محلی)
    if (cleanedPhone.length === 10) {
      return '+1' + cleanedPhone;
    }

    // اگر با 1 شروع شده و 11 رقمی است
    if (cleanedPhone.startsWith('1') && cleanedPhone.length === 11) {
      return '+' + cleanedPhone;
    }

    // اگر هیچ کدام از فرمت‌های بالا نباشد، خطا بدهیم
    throw new Error(
      'فرمت شماره نامعتبر است. شماره باید 10 رقمی یا با 1 شروع شود و 11 رقمی باشد.',
    );
  }
}
