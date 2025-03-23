import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { PaymentsService } from './payment.service';
import { CreateSubscriptionDto } from './dto/CreateSubscription.dto';
import { SubscriptionResponseDto } from './dto/subscription-response.dto';

@ApiTags('payments')
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('subscription')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new subscription for a user' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Subscription successfully created',
    type: SubscriptionResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid input' })
  async createSubscription(
    @Body() createSubscriptionDto: CreateSubscriptionDto,
  ): Promise<SubscriptionResponseDto> {
    return this.paymentsService.createSubscription(createSubscriptionDto);
  }
}
