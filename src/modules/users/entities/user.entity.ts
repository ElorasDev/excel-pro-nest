import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import {
  Gender,
  SkillLevel,
  PlayerPosition,
  AvailableDays,
  PreferredTime,
  PaymentStatus,
} from './enums/enums';

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

  @Column()
  program_id: number;

  @Column({ type: 'date' })
  created_at: Date;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    nullable: true,
  })
  payment_status?: PaymentStatus;

  @Column({ type: 'timestamp', nullable: true })
  payment_date?: Date;
}
