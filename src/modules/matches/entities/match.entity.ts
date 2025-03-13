import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { MatchStatus } from './enums/matchStatus.enum';
import { AgeCategory } from './enums/ageCategory.enum';
import { Referee } from './referee.entity';
import { Team } from './team.entity';

@Entity({ name: 'matches' })
export class Match {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', name: 'event_name' })
  event_name: string;

  @Column({ type: 'timestamp', name: 'event_date' })
  event_date: Date;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'integer', name: 'home_score', nullable: true })
  home_score?: number;

  @Column({ type: 'integer', name: 'away_score', nullable: true })
  away_score?: number;

  @Column({ type: 'text', name: 'penalty_info', nullable: true })
  penalty_info?: string;

  @Column({ type: 'text', name: 'location' })
  location: string;

  @Column({ type: 'timestamp', name: 'registration_deadline', nullable: true })
  registration_deadline?: Date;

  @Column({ type: 'enum', enum: MatchStatus, name: 'status' })
  status: MatchStatus;

  @Column({ type: 'enum', enum: AgeCategory, name: 'age_category' })
  age_category: AgeCategory;

  @ManyToOne(() => Referee, { nullable: true })
  @JoinColumn({ name: 'referee_id' })
  referee: Referee;

  @ManyToOne(() => Team, (team) => team.id, { nullable: true })
  // @JoinColumn({ name: 'home_team_id' })
  home_team?: Team;

  @ManyToOne(() => Team, (team) => team.id, { nullable: true })
  // @JoinColumn({ name: 'away_team_id' })
  away_team?: Team;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt: Date;
}
