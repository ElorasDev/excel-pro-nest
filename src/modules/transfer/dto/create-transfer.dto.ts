import { IsEnum, IsNumber, IsOptional, Min } from 'class-validator';
import { SubscriptionPlan } from '../../users/entities/enums/enums';

export class CreateTransferDto {
  @IsEnum(SubscriptionPlan)
  plan: SubscriptionPlan;

  @IsNumber()
  @Min(1)
  amount: number;

  @IsOptional()
  email?: string; // Optional, will use user's email if not provided
}

export class CreateTransferWithUserDto extends CreateTransferDto {
  userId: number;
}
