import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
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

  // MAIN ISSUE: When the second user registers, information is recorded under the first user's name
  // SOLUTION: More precise user verification using phone number and full name

  // Create a new transfer request
  async createTransfer(
    userId: number,
    createTransferDto: CreateTransferDto,
  ): Promise<Transfer> {
    // Ensure userId is valid
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Additional verification of user identity with provided information (if exists)
    if (createTransferDto.fullname && createTransferDto.phone_number) {
      // Verify that the found user matches the information provided
      if (
        user.fullname?.toLowerCase() !==
          createTransferDto.fullname.toLowerCase() ||
        user.phone_number !== createTransferDto.phone_number
      ) {
        // Remove sensitive user information logs
        throw new ConflictException(
          'User information does not match our records. Please contact support.',
        );
      }
    }

    // This line should be removed:
    // activePlan should only be updated after payment confirmation by admin, not now
    // await this.userRepository.update(user.id, {
    //   activePlan: createTransferDto.plan,
    // });

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
    const isFirstTimePayment = user.subscriptionCounter === 0;

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

    // FIX: Ensure the received amount is correct
    if (isFirstTimePayment && transfer.amount < 400) {
      // Remove sensitive logs containing amount information
      transfer.amount = 425; // Fixed amount for first-time registration
    } else if (!isFirstTimePayment && transfer.amount < 300) {
      // Remove sensitive logs containing amount information
      transfer.amount = 350; // Fixed amount for renewal
    }

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

    if (!transfer) {
      throw new NotFoundException('Transfer not found');
    }

    // Make sure we find the user associated with the transfer
    const user = await this.userRepository.findOne({
      where: { id: transfer.userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${transfer.userId} not found`);
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
          // Remove sensitive log containing user ID
          return transfer;
        } catch (error) {
          console.error('Error deleting temporary user:', error);
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

    // FIX: Here activePlan is updated - after payment confirmation
    const subscriptionCounter = user.subscriptionCounter || 0;

    await this.userRepository.update(user.id, {
      activePlan: transfer.plan,
      currentSubscriptionEndDate: endDate,
      isTemporary: false, // User is no longer temporary
      subscriptionCounter: subscriptionCounter + 1, // Increment subscription counter
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
    // Verify user validity before returning transfers
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

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
  @Cron(CronExpression.EVERY_DAY_AT_10AM)
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

    for (const transfer of expiredTransfers) {
      try {
        transfer.status = TransferStatus.EXPIRED;
        await this.transferRepository.save(transfer);

        await this.notificationsService.sendTransferExpiryNotification(
          transfer.user.phone_number,
          transfer.amount,
          transfer.plan,
        );
      } catch (err) {
        console.error(
          `❌ Error processing expired transfer ID: ${transfer.id} –`,
          err.message,
        );
      }

      // Cleanup: Delete temp user if it was first-time payment
      if (transfer.isFirstTimePayment && transfer.user.isTemporary) {
        try {
          await this.userRepository.remove(transfer.user);
        } catch (err) {
          console.error(
            `❌ Error deleting temporary user ID: ${transfer.user.id} –`,
            err.message,
          );
        }
      }
    }

    // Users with subscriptions expiring in 2 days
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
      try {
        await this.notificationsService.sendSubscriptionRenewalReminder(
          user.phone_number,
          user.activePlan,
          user.currentSubscriptionEndDate,
        );
      } catch (err) {
        console.error(
          `❌ Error sending renewal reminder to user ID: ${user.id} –`,
          err.message,
        );
      }
    }

    // Users with expired subscriptions (within 10 days)
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

      if (daysSinceExpiry % 2 === 0) {
        try {
          await this.notificationsService.sendPostExpiryRenewalReminder(
            user.phone_number,
            user.activePlan,
            user.currentSubscriptionEndDate,
          );
        } catch (err) {
          console.error(
            `❌ Error sending post-expiry reminder to user ID: ${user.id} –`,
            err.message,
          );
        }
      }
    }
  }
}
