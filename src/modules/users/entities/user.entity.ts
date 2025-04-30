import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Payment } from 'src/modules/payment/entities/payment.entity';
import {
  AvailableDays,
  Gender,
  PlayerPosition,
  PreferredTime,
  SkillLevel,
} from './enums/enums';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  fullname: string;

  @Column()
  age: number;

  @Column({
    type: 'enum',
    enum: Gender,
  })
  gender: Gender;

  @Column({ type: 'boolean', default: false })
  isTemporary?: boolean;

  @Column({ type: 'text' })
  parent_name: string;

  @Column({ type: 'text' })
  phone_number: string;

  @Column({ type: 'text' })
  email: string;

  @Column({ type: 'text', nullable: false })
  program: string;

  @Column({
    type: 'enum',
    enum: SkillLevel,
  })
  current_skill_level: SkillLevel;

  @Column({
    type: 'enum',
    enum: PlayerPosition,
    nullable: true,
  })
  player_positions?: PlayerPosition;

  @Column({ type: 'varchar', length: 50, nullable: true })
  custom_position?: string;

  @Column({ type: 'text' })
  session_goals: string;

  @Column({
    type: 'enum',
    enum: AvailableDays,
  })
  available_days: AvailableDays;

  @Column({
    type: 'enum',
    enum: PreferredTime,
  })
  preferred_time: PreferredTime;

  @Column({ type: 'text' })
  medical_conditions: string;

  @Column({ type: 'text', nullable: true })
  comments?: string;

  @Column()
  liability_waiver: boolean;

  @Column()
  cancellation_policy: boolean;

  @Column({ type: 'text', nullable: true })
  stripeCustomerId: string;

  @OneToMany(() => Payment, (payment) => payment.user)
  payments: Payment[];

  @Column({ nullable: true })
  activePlan: string;

  @Column({ nullable: true, type: 'timestamp' })
  currentSubscriptionEndDate: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: false, default: 0 })
  subscriptionCounter: number;
}
