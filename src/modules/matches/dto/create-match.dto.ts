import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDate,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MatchStatus } from '../entities/enums/matchStatus.enum';
import { AgeCategory } from '../entities/enums/ageCategory.enum';

export class CreateMatchDto {
  @IsNotEmpty()
  @IsString()
  event_name: string;

  @IsNotEmpty()
  @Type(() => Date)
  @IsDate()
  event_date: Date;

  @IsNotEmpty()
  @Type(() => Date)
  @IsDate()
  registration_deadline: Date;

  @IsNotEmpty()
  @IsEnum(MatchStatus)
  status: MatchStatus;

  @IsNotEmpty()
  @IsEnum(AgeCategory)
  age_category: AgeCategory;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  home_score?: number;

  @IsOptional()
  @IsNumber()
  away_score?: number;

  @IsOptional()
  @IsString()
  penalty_info?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsNumber()
  referee_id?: number;

  @IsNotEmpty()
  @IsNumber()
  home_team_id?: number;

  @IsNotEmpty()
  @IsNumber()
  away_team_id?: number;
}
