import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsDateString,
} from 'class-validator';
import {
  Gender,
  SkillLevel,
  PlayerPosition,
  AvailableDays,
  PreferredTime,
  PaymentStatus,
} from '../entities/enums/enums';

export class CreateUserDto {
  @IsNotEmpty()
  @IsString()
  fullname: string;

  @IsNotEmpty()
  @IsNumber()
  age: number;

  @IsNotEmpty()
  @IsEnum(Gender)
  gender: Gender;

  @IsNotEmpty()
  @IsString()
  parent_name: string;

  @IsNotEmpty()
  @IsString()
  phone_number: string;

  @IsNotEmpty()
  @IsString()
  email: string;

  @IsNotEmpty()
  @IsEnum(SkillLevel)
  current_skill_level: SkillLevel;

  @IsOptional()
  @IsEnum(PlayerPosition)
  player_positions?: PlayerPosition;

  @IsOptional()
  @IsString()
  custom_position?: string;

  @IsNotEmpty()
  @IsString()
  session_goals: string;

  @IsNotEmpty()
  @IsEnum(AvailableDays)
  available_days: AvailableDays;

  @IsNotEmpty()
  @IsEnum(PreferredTime)
  preferred_time: PreferredTime;

  @IsNotEmpty()
  @IsString()
  medical_conditions: string;

  @IsNotEmpty()
  @IsString()
  comments: string;

  @IsNotEmpty()
  @IsBoolean()
  liability_waiver: boolean;

  @IsNotEmpty()
  @IsBoolean()
  cancellation_policy: boolean;

  @IsNotEmpty()
  @IsNumber()
  program_id: number;

  @IsOptional()
  @IsEnum(PaymentStatus)
  payment_status?: PaymentStatus;

  @IsOptional()
  @IsDateString()
  payment_date?: string;
}
