import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RedisService {
  private readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>('redis.url');
    this.client = new Redis(redisUrl);
  }

  async setOTP(key: string, otp: string) {
    await this.client.set(key, otp, 'EX', 120);
  }

  async getOTP(key: string) {
    return this.client.get(key);
  }

  async deleteOTP(key: string) {
    return this.client.del(key);
  }
}
