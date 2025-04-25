import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, LessThan, Not, Repository } from 'typeorm';
import { Transfer } from './entities/transfer.entity';
import { User } from '../users/entities/user.entity';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransferStatus } from './entities/enums/transfer-status.enum';
import { v4 as uuidv4 } from 'uuid';
import { NotificationsService } from './notificationsService.service';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class TransferService {
  constructor(
    @InjectRepository(Transfer)
    private transferRepository: Repository<Transfer>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private notificationsService: NotificationsService,
  ) {}

  // Create a new transfer request
  async createTransfer(
    userId: number,
    createTransferDto: CreateTransferDto,
  ): Promise<Transfer> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.userRepository.update(user.id, {
      activePlan: createTransferDto.plan,
    });

    // Check if user already has a pending transfer
    const pendingTransfer = await this.transferRepository.findOne({
      where: {
        userId,
        status: TransferStatus.PENDING,
      },
    });

    if (pendingTransfer) {
      return pendingTransfer; // Return existing pending transfer
    }

    // Generate unique token
    const token = uuidv4();

    // Set expiry date (48 hours from now)
    const expiryDate = new Date();
    expiryDate.setHours(expiryDate.getHours() + 48);

    // Check if this is first payment
    const isFirstTimePayment =
      (
        await this.userRepository.findOne({
          where: { id: userId },
        })
      ).subscriptionCounter === 0
        ? true
        : false;

    // Create transfer
    const transfer = this.transferRepository.create({
      ...createTransferDto,
      userId,
      user,
      token,
      expiryDate,
      isFirstTimePayment,
      status: TransferStatus.PENDING,
    });

    const savedTransfer = await this.transferRepository.save(transfer);

    // Send SMS notification with instructions
    await this.notificationsService.sendTransferInstructions(
      user.phone_number, // Using phone number instead of email
      savedTransfer.token,
      savedTransfer.amount,
      savedTransfer.plan,
    );

    return savedTransfer;
  }

  // Get transfer by token
  async getTransferByToken(token: string): Promise<Transfer> {
    const transfer = await this.transferRepository.findOne({
      where: { token },
      relations: ['user'],
    });

    if (!transfer) {
      throw new NotFoundException('Transfer not found');
    }

    // Check if expired
    if (
      new Date() > transfer.expiryDate &&
      transfer.status === TransferStatus.PENDING
    ) {
      transfer.status = TransferStatus.EXPIRED;
      await this.transferRepository.save(transfer);
    }

    return transfer;
  }

  // User confirms they have made the payment
  async confirmTransfer(token: string): Promise<Transfer> {
    const transfer = await this.getTransferByToken(token);

    if (transfer.status !== TransferStatus.PENDING) {
      throw new BadRequestException(
        `Cannot confirm transfer with status: ${transfer.status}`,
      );
    }

    if (new Date() > transfer.expiryDate) {
      transfer.status = TransferStatus.EXPIRED;
      await this.transferRepository.save(transfer);
      throw new BadRequestException('Transfer request has expired');
    }

    // Update transfer
    transfer.status = TransferStatus.CONFIRMED;
    transfer.confirmedByUser = true;
    transfer.confirmedAt = new Date();

    const savedTransfer = await this.transferRepository.save(transfer);

    // Notify admins about new payment confirmation via SMS
    await this.notificationsService.notifyAdminsAboutPayment(
      savedTransfer.id as number,
      savedTransfer.user.fullname,
      savedTransfer.amount,
      savedTransfer.plan,
    );

    return savedTransfer;
  }

  // Admin verifies the payment
  async verifyTransfer(
    id: string,
    isApproved: boolean,
    notes?: string,
  ): Promise<Transfer> {
    const transfer = await this.transferRepository.findOne({
      where: { id },
      relations: ['user'],
    });

    const user = await this.userRepository.findOne({
      where: { id: transfer.userId },
    });

    if (!transfer) {
      throw new NotFoundException('Transfer not found');
    }

    if (transfer.status !== TransferStatus.CONFIRMED) {
      throw new BadRequestException(
        `Cannot verify transfer with status: ${transfer.status}`,
      );
    }

    // Handle rejection
    if (!isApproved) {
      transfer.status = TransferStatus.REJECTED;
      await this.notificationsService.sendPaymentRejectionNotification(
        transfer.user.phone_number,
        transfer.plan,
        transfer.amount,
        notes || 'Payment could not be verified',
      );

      if (transfer.isFirstTimePayment && transfer.user.isTemporary) {
        try {
          await this.userRepository.remove(transfer.user);
          console.log(
            `User ${transfer.user.id} removed due to rejected payment`,
          );
          return transfer;
        } catch (error) {
          console.error(`Error removing user ${transfer.user.id}:`, error);
        }
      }

      transfer.verifiedByAdmin = false;
      transfer.adminNotes = notes;
      transfer.verifiedAt = new Date();
      return this.transferRepository.save(transfer);
    }

    // Handle approval
    transfer.status = TransferStatus.VERIFIED;
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 2);
    transfer.subscriptionEndDate = endDate;

    await this.userRepository.update(transfer.userId, {
      activePlan: transfer.plan,
      currentSubscriptionEndDate: endDate,
      isTemporary: false,
      subscriptionCounter: user.subscriptionCounter + 1,
    });

    await this.notificationsService.sendPaymentApprovalNotification(
      transfer.user.phone_number,
      transfer.plan,
      transfer.amount,
      endDate,
    );

    transfer.verifiedByAdmin = true;
    transfer.adminNotes = notes;
    transfer.verifiedAt = new Date();
    transfer.expiryDate = null; // Clear expiry date on approval
    return this.transferRepository.save(transfer);
  }

  // Get user's transfers
  async getUserTransfers(userId: number): Promise<Transfer[]> {
    return this.transferRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  // Get transfers for admin panel
  async getTransfersForAdmin(status?: TransferStatus): Promise<Transfer[]> {
    const queryOptions: any = {
      relations: ['user'],
      order: { createdAt: 'DESC' },
    };

    if (status) {
      queryOptions.where = { status };
    }

    return this.transferRepository.find(queryOptions);
  }

  // Get transfers that need admin verification
  async getTransfersNeedingVerification(): Promise<Transfer[]> {
    return this.transferRepository.find({
      where: { status: TransferStatus.CONFIRMED },
      relations: ['user'],
      order: { confirmedAt: 'ASC' }, // Oldest confirmations first
    });
  }

  // Scheduled job to expire pending transfers
  @Cron(CronExpression.EVERY_HOUR)
  async handleExpiredTransfers() {
    const now = new Date();

    // Find all pending transfers that are expired
    const expiredTransfers = await this.transferRepository.find({
      where: {
        status: TransferStatus.PENDING,
        expiryDate: LessThan(now),
      },
      relations: ['user'],
    });

    // Update status to EXPIRED and notify users
    for (const transfer of expiredTransfers) {
      transfer.status = TransferStatus.EXPIRED;
      await this.transferRepository.save(transfer);

      // Send expiry notification via SMS
      await this.notificationsService.sendTransferExpiryNotification(
        transfer.user.phone_number,
        transfer.amount,
        transfer.plan,
      );

      // Cleanup logic - delete temporary users if this was their first payment
      if (transfer.isFirstTimePayment && transfer.user.isTemporary) {
        try {
          await this.userRepository.remove(transfer.user);
          console.log(
            `User ${transfer.user.id} removed due to expired payment`,
          );
        } catch (error) {
          console.error(`Error removing user ${transfer.user.id}:`, error);
        }
      }
    }

    // Reminder logic for subscription renewals
    // 1. Users with subscriptions expiring in 2 days
    const twoDaysFromNow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    const oneDayWindowStart = new Date(
      twoDaysFromNow.getTime() - 24 * 60 * 60 * 1000,
    );

    const usersExpiringSoon = await this.userRepository.find({
      where: {
        currentSubscriptionEndDate: Between(oneDayWindowStart, twoDaysFromNow),
        activePlan: Not(IsNull()),
      },
    });

    for (const user of usersExpiringSoon) {
      await this.notificationsService.sendSubscriptionRenewalReminder(
        user.phone_number,
        user.activePlan,
        user.currentSubscriptionEndDate,
      );
    }

    // 2. Users with expired subscriptions (within 10 days post-expiry)
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    const usersWithExpiredSubscriptions = await this.userRepository.find({
      where: {
        currentSubscriptionEndDate: Between(tenDaysAgo, now),
        activePlan: Not(IsNull()),
      },
    });

    for (const user of usersWithExpiredSubscriptions) {
      const daysSinceExpiry = Math.floor(
        (now.getTime() - user.currentSubscriptionEndDate.getTime()) /
          (24 * 60 * 60 * 1000),
      );

      // Send reminder every 2 days (e.g., day 0, 2, 4, 6, 8, 10)
      if (daysSinceExpiry % 2 === 0) {
        await this.notificationsService.sendPostExpiryRenewalReminder(
          user.phone_number,
          user.activePlan,
          user.currentSubscriptionEndDate,
        );
      }
    }
  }
}
