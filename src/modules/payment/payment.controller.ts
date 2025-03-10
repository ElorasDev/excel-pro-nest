import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Put,
  Delete,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import { CreateSubscriptionDto } from './dto/CreateSubscription.dto';
import { UpdatePaymentDto } from './dto/update-subscription.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Payment } from './entities/payment.entity';

@ApiTags('Payments')
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new subscription' })
  @ApiResponse({
    status: 201,
    description: 'The subscription has been successfully created',
    type: Payment,
  })
  @ApiResponse({
    status: 500,
    description: 'Failed to create the subscription',
  })
  async create(@Body() createPaymentDto: CreateSubscriptionDto) {
    return this.paymentService.create(createPaymentDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all payments' })
  @ApiResponse({
    status: 200,
    description: 'List of all payments',
    type: [Payment],
  })
  async findAll() {
    return this.paymentService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get payment details by ID' })
  @ApiResponse({
    status: 200,
    description: 'Payment details found',
    type: Payment,
  })
  @ApiResponse({
    status: 404,
    description: 'Payment not found',
  })
  async findOne(@Param('id') id: number) {
    return this.paymentService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update payment status' })
  @ApiResponse({
    status: 200,
    description: 'Payment status updated successfully',
    type: Payment,
  })
  @ApiResponse({
    status: 404,
    description: 'Payment not found',
  })
  async update(
    @Param('id') id: number,
    @Body() updatePaymentDto: UpdatePaymentDto,
  ) {
    return this.paymentService.update(id, updatePaymentDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete payment by ID' })
  @ApiResponse({
    status: 200,
    description: 'Payment deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Payment not found',
  })
  async remove(@Param('id') id: number) {
    await this.paymentService.remove(id);
  }
}
