// src/modules/transfer/transfer.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { TransferService } from './transfer.service';
import { CreateTransferWithUserDto } from './dto/create-transfer.dto';
import { VerifyTransferDto } from './dto/verify-transfer.dto';
import { TransferStatus } from './entities/enums/transfer-status.enum';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

@Controller('transfer')
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  @Post()
  async createTransfer(@Body() body: CreateTransferWithUserDto) {
    const { userId, ...createTransferDto } = body;
    return this.transferService.createTransfer(userId, createTransferDto);
  }

  @Get('token/:token')
  async getTransferByToken(@Param('token') token: string) {
    const transfer = await this.transferService.getTransferByToken(token);
    const { user, ...transferData } = transfer;
    return {
      ...transferData,
      userName: user.fullname,
    };
  }

  @Post('token/:token/confirm')
  async confirmTransfer(@Param('token') token: string) {
    return this.transferService.confirmTransfer(token);
  }

  @Get('user/:userId')
  @UseGuards(JwtAuthGuard)
  async getUserTransfers(@Param('userId', ParseIntPipe) userId: number) {
    return this.transferService.getUserTransfers(userId);
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard)
  async getTransfersForAdmin(@Query('status') status?: TransferStatus) {
    return this.transferService.getTransfersForAdmin(status);
  }

  @Get('admin/pending-verification')
  @UseGuards(JwtAuthGuard)
  async getTransfersNeedingVerification() {
    return this.transferService.getTransfersNeedingVerification();
  }

  @Post('admin/verify/:id')
  @UseGuards(JwtAuthGuard)
  async verifyTransfer(
    @Param('id') id: string,
    @Body() verifyDto: VerifyTransferDto,
  ) {
    return this.transferService.verifyTransfer(
      id,
      verifyDto.isApproved,
      verifyDto.notes,
    );
  }

  @Post('cron/subscription-reminders')
  @ApiOperation({ summary: 'Run subscription reminder job' })
  @ApiResponse({
    status: 200,
    description: 'Subscription reminders processed successfully',
  })
  async runSubscriptionReminders() {
    console.log('Cron job started at', new Date().toISOString());
    await this.transferService.handleExpiredTransfers();
    console.log('Cron job finished at', new Date().toISOString());
    return {
      success: true,
      message: 'Subscription reminders processed successfully ',
    };
  }
}
