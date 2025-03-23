import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSubscriptionDto {
  @ApiProperty({
    description: 'The ID of the user',
    example: 1,
  })
  @IsNumber()
  @IsNotEmpty()
  userId: number;

  @ApiProperty({
    description: 'The price ID from Stripe',
    example: 'price_basic_monthly',
  })
  @IsString()
  @IsNotEmpty()
  priceId: string;

  @ApiProperty({
    description: 'The payment method ID from Stripe',
    example: 'pm_1GqIC8AB3cT',
  })
  @IsString()
  @IsOptional()
  paymentMethodId: string;
}
