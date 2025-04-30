import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsEmpty,
} from 'class-validator';
import {
  Gender,
  SkillLevel,
  PlayerPosition,
  AvailableDays,
  PreferredTime,
} from '../entities/enums/enums';

export class CreateUserDto {
  @ApiProperty({ description: 'Full name of the user' })
  @IsNotEmpty()
  @IsString()
  fullname: string;

  @ApiProperty({ description: 'Age of the user', example: 25 })
  @IsNotEmpty()
  @IsNumber()
  age: number;

  @ApiProperty({ enum: Gender, description: 'Gender of the user' })
  @IsNotEmpty()
  @IsEnum(Gender)
  gender: Gender;

  @ApiProperty({ description: 'Parent name of the user', example: 'John Doe' })
  @IsNotEmpty()
  @IsString()
  parent_name: string;

  @ApiProperty({
    description: 'Phone number of the user',
    example: '+123456789',
  })
  @IsNotEmpty()
  @IsString()
  phone_number: string;

  @ApiProperty({
    description: 'Email address of the user',
    example: 'user@example.com',
  })
  @IsNotEmpty()
  @IsString()
  email: string;

  @ApiProperty({
    enum: SkillLevel,
    description: 'Current skill level of the user',
  })
  @IsNotEmpty()
  @IsEnum(SkillLevel)
  current_skill_level: SkillLevel;

  @ApiProperty({
    enum: PlayerPosition,
    description: 'Player position',
    required: false,
  })
  @IsOptional()
  @IsEnum(PlayerPosition)
  player_positions?: PlayerPosition;

  @ApiProperty({ description: 'Custom player position', required: false })
  @IsOptional()
  @IsString()
  custom_position?: string;

  @ApiProperty({ description: 'Goals for the session' })
  @IsNotEmpty()
  @IsString()
  session_goals: string;

  @ApiProperty({
    enum: AvailableDays,
    description: 'Available days for training',
  })
  @IsNotEmpty()
  @IsEnum(AvailableDays)
  available_days: AvailableDays;

  @ApiProperty({
    enum: PreferredTime,
    description: 'Preferred time for training',
  })
  @IsNotEmpty()
  @IsEnum(PreferredTime)
  preferred_time: PreferredTime;

  @ApiProperty({ description: 'Medical conditions of the user' })
  @IsNotEmpty()
  @IsString()
  medical_conditions: string;

  @ApiProperty({ description: 'Additional comments' })
  @IsEmpty()
  @IsString()
  comments?: string;

  @ApiProperty({ description: 'Liability waiver agreement' })
  @IsNotEmpty()
  @IsBoolean()
  liability_waiver: boolean;

  @ApiProperty({ description: 'Cancellation policy agreement' })
  @IsNotEmpty()
  @IsBoolean()
  cancellation_policy: boolean;

  @ApiProperty({ description: 'Program', example: 'U15-U17' })
  @IsNotEmpty()
  @IsString()
  program: string;

  @IsOptional()
  @IsString()
  activePlan?: string;
}
