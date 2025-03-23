import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { PaymentStatus } from './enums/payment-status.enum';
import { SubscriptionPlan } from 'src/modules/users/entities/enums/enums';

@Entity()
export class Payment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column()
  stripeSubscriptionId: string;

  @Column()
  currency: string;

  @Column({ type: 'enum', enum: PaymentStatus })
  status: PaymentStatus;

  @Column({ type: 'enum', enum: SubscriptionPlan })
  plan: SubscriptionPlan;

  @Column()
  stripePaymentId: string;

  @ManyToOne(() => User, (user) => user.payments)
  user: User;

  @CreateDateColumn()
  createdAt: Date;
}
