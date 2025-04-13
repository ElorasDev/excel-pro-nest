import { BadRequestException, Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { RedisService } from 'src/common/db/redis.service';
import { User } from './entities/user.entity';
import { otpGenerator } from 'src/common/utils/otp-generator';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRpository: Repository<User>,
    private readonly redisService: RedisService,
  ) {}

  async sendOtp(phone_number: string): Promise<{ message: string }> {
    const otp = otpGenerator();
    if (!phone_number) throw new BadRequestException('Incorrect Phone Number.');
    console.log(otp);
    await this.redisService.setOTP(`otp:${phone_number}`, otp);
    return {
      message: 'OTP Code sent successfully',
    };
  }

  async verifyOtp(phone: string, otp: string): Promise<{ success: boolean }> {
    const storedOtp = await this.redisService.getOTP(`otp:${phone}`);
    if (!storedOtp || storedOtp !== otp) {
      throw new BadRequestException('Invalid or expired OTP');
    }
    await this.redisService.deleteOTP(`otp:${phone}`);
    return { success: true };
  }

  async create(createUserDto: CreateUserDto) {
    const {
      fullname,
      age,
      gender,
      parent_name,
      phone_number,
      email,
      current_skill_level,
      player_positions,
      custom_position,
      session_goals,
      available_days,
      preferred_time,
      medical_conditions,
      comments,
      liability_waiver,
      cancellation_policy,
      program,
    } = createUserDto;

    const newUser = {
      fullname,
      age,
      gender,
      parent_name,
      phone_number,
      email,
      current_skill_level,
      player_positions,
      custom_position,
      session_goals,
      available_days,
      preferred_time,
      medical_conditions,
      comments,
      liability_waiver,
      cancellation_policy,
      program,
    };

    await this.userRpository.save(newUser);
    return newUser;
  }

  async findAll() {
    return await this.userRpository.find();
  }

  async findOne(id: number) {
    return await this.userRpository.findOne({ where: { id } });
  }

  async remove(id: number) {
    await this.userRpository.delete(id);
    return `This action removes a #${id} user`;
  }
}
