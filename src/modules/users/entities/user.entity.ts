import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import {
  Gender,
  SkillLevel,
  PlayerPosition,
  AvailableDays,
  PreferredTime,
  SubscriptionPlan,
} from './enums/enums';
import { Payment } from 'src/modules/payment/entities/payment.entity';

@Entity('user')
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

  @Column({ type: 'text' })
  parent_name: string;

  @Column({ type: 'text' })
  phone_number: string;

  @Column({ type: 'text' })
  email: string;

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

  @Column({ type: 'text' })
  comments: string;

  @Column()
  liability_waiver: boolean;

  @Column()
  cancellation_policy: boolean;

  @Column({ nullable: true })
  stripeCustomerId: string;

  @Column({
    type: 'enum',
    enum: SubscriptionPlan,
    default: SubscriptionPlan.FREE,
  })
  currentPlan: SubscriptionPlan;

  @OneToMany(() => Payment, (payment) => payment.user)
  payments: Payment[];

  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;
}
