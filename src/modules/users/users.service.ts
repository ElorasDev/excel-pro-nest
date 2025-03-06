import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { PaymentStatus } from './entities/enums/enums';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRpository: Repository<User>,
  ) {}

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
      program_id,
      payment_status,
      payment_date,
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
      program_id,
      payment_status: payment_status || PaymentStatus.FAILED,
      payment_date,
    };

    this.userRpository.create(newUser);
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
