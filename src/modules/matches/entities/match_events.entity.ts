import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { Match } from './match.entity';
import { Team } from './team.entity';
import { EventType } from './enums/eventType.enum';

@Entity({ name: 'match_events' })
export class MatchEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Match, { nullable: false })
  match: Match;

  @ManyToOne(() => Team, { nullable: false })
  team: Team;

  @Column({ type: 'enum', enum: EventType })
  eventType: EventType;

  @Column({ type: 'text', nullable: true })
  playerName?: string;

  @Column({ type: 'integer', name: 'minute' })
  minute: number;
}
